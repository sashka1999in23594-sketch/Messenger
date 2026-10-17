/**
 * Звонки 1:1 (аудио и видео) на WebRTC. Сервер не видит и не пропускает через
 * себя медиа: он хранит состояние звонка и пересылает сигнальные сообщения
 * (SDP и ICE-кандидаты) между двумя устройствами. Медиапоток шифруется DTLS-SRTP
 * напрямую между участниками (через TURN — тоже в зашифрованном виде).
 *
 * Жизненный цикл: ringing → active → ended, либо ringing → declined / cancelled / missed / busy.
 */
import type { CallInfo, CallSignal, CallStatus, Paginated } from '@omni/shared';
import type { Db } from '../../db/index.js';
import { badRequest, blocked, forbidden, notFound, privacyRestricted } from '../../lib/errors.js';
import { newId } from '../../lib/ids.js';
import type { ChatsService } from '../chats/chats.service.js';
import type { Policy } from '../policy/policy.service.js';
import type { RealtimeHub } from '../realtime/hub.js';
import type { UsersRepo } from '../users/users.repo.js';
import { offsetCursor } from '../users/users.service.js';
import type { CallRow, CallsRepo } from './calls.repo.js';

const RING_TIMEOUT_MS = 45_000;
const MAX_SIGNAL_BYTES = 24 * 1024;

const fmtDuration = (sec: number) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;

export class CallsService {
  private readonly ringTimers = new Map<string, NodeJS.Timeout>();

  constructor(
    private readonly db: Db,
    private readonly repo: CallsRepo,
    private readonly chats: ChatsService,
    private readonly users: UsersRepo,
    private readonly policy: Policy,
    private readonly hub: RealtimeHub,
  ) {
    // Устройство участника пропало из сети — звонок завершается
    hub.onSessionGone((userId, sessionId) => {
      const rows = this.db.all<CallRow>(
        `SELECT * FROM calls WHERE status IN ('ringing', 'active')
           AND ((caller_id = :u AND caller_session = :s) OR (callee_id = :u AND callee_session = :s))`,
        { u: userId, s: sessionId },
      );
      for (const r of rows) this.finish(r, r.status === 'active' ? 'ended' : r.caller_id === userId ? 'cancelled' : 'missed');
    });
  }

  private dto(r: CallRow): CallInfo {
    return this.repo.toDtos([r])[0]!;
  }

  private participant(userId: string, callId: string): CallRow {
    const r = this.repo.byId(callId);
    if (!r || (r.caller_id !== userId && r.callee_id !== userId)) throw notFound('Звонок не найден');
    return r;
  }

  private busy(userId: string): boolean {
    return !!this.db.get("SELECT 1 FROM calls WHERE status IN ('ringing', 'active') AND (caller_id = :u OR callee_id = :u)", { u: userId });
  }

  private broadcast(r: CallRow): void {
    const call = this.dto(r);
    this.hub.sendToUsers([r.caller_id, r.callee_id], { t: 'call.updated', call });
  }

  start(userId: string, sessionId: string, input: { chatId: string; video: boolean }): CallInfo {
    const chat = this.chats.get(userId, input.chatId);
    if (chat.type !== 'direct' && chat.type !== 'secret') throw badRequest('Звонить можно в личном чате');
    const peerId = chat.peer?.id;
    const peer = peerId ? this.users.byId(peerId) : undefined;
    if (!peer) throw notFound('Собеседник не найден');
    if (this.policy.blockedEitherWay(userId, peer.id)) throw blocked();
    if (!this.policy.canMessage(userId, peer)) throw privacyRestricted('Собеседник ограничил круг тех, кто может ему звонить');
    if (this.busy(userId)) throw badRequest('Сначала завершите текущий звонок');

    const now = Date.now();
    const row: CallRow = {
      id: newId(now),
      chat_id: chat.id,
      caller_id: userId,
      callee_id: peer.id,
      video: input.video ? 1 : 0,
      status: this.busy(peer.id) ? 'busy' : 'ringing',
      caller_session: sessionId,
      callee_session: null,
      created_at: now,
      answered_at: null,
      ended_at: null,
    };
    if (row.status === 'busy') row.ended_at = now;
    this.db.run(
      `INSERT INTO calls (id, chat_id, caller_id, callee_id, video, status, caller_session, created_at, ended_at)
       VALUES (:id, :chat_id, :caller_id, :callee_id, :video, :status, :caller_session, :created_at, :ended_at)`,
      { ...row },
    );
    if (row.status === 'busy') {
      this.postMessage(row);
      return this.dto(row);
    }
    this.hub.sendToUser(peer.id, { t: 'call.incoming', call: this.dto(row) });
    const timer = setTimeout(() => {
      const current = this.repo.byId(row.id);
      if (current?.status === 'ringing') this.finish(current, 'missed');
    }, RING_TIMEOUT_MS);
    timer.unref();
    this.ringTimers.set(row.id, timer);
    return this.dto(row);
  }

  accept(userId: string, sessionId: string, callId: string): CallInfo {
    const r = this.participant(userId, callId);
    if (r.callee_id !== userId) throw forbidden('Принять звонок может только вызываемый');
    if (r.status !== 'ringing') throw badRequest('Звонок уже завершён');
    this.clearTimer(callId);
    this.db.run("UPDATE calls SET status = 'active', answered_at = :now, callee_session = :s WHERE id = :id", { now: Date.now(), s: sessionId, id: callId });
    const updated = this.repo.byId(callId)!;
    this.broadcast(updated);
    return this.dto(updated);
  }

  /** Отклонить (вызываемый), отменить (звонящий) или положить трубку (любой). */
  hangup(userId: string, callId: string): CallInfo {
    const r = this.participant(userId, callId);
    if (r.status !== 'ringing' && r.status !== 'active') return this.dto(r);
    const status: CallStatus = r.status === 'active' ? 'ended' : r.callee_id === userId ? 'declined' : 'cancelled';
    return this.dto(this.finish(r, status));
  }

  private finish(r: CallRow, status: CallStatus): CallRow {
    this.clearTimer(r.id);
    const now = Date.now();
    const changed = this.db.run("UPDATE calls SET status = :st, ended_at = :now WHERE id = :id AND status IN ('ringing', 'active')", { st: status, now, id: r.id });
    const updated = this.repo.byId(r.id)!;
    if (changed.changes) {
      this.broadcast(updated);
      this.postMessage(updated);
    }
    return updated;
  }

  /** Сообщение о звонке в переписке: «Видеозвонок · 3:12», «Пропущенный звонок»… */
  private postMessage(r: CallRow): void {
    const kind = r.video ? 'Видеозвонок' : 'Звонок';
    const dur = r.answered_at ? Math.round(((r.ended_at ?? Date.now()) - r.answered_at) / 1000) : 0;
    const text =
      r.status === 'ended'
        ? `${kind} · ${fmtDuration(dur)}`
        : r.status === 'missed'
          ? `Пропущенный ${kind.toLowerCase()}`
          : r.status === 'declined'
            ? `${kind} отклонён`
            : r.status === 'busy'
              ? `${kind}: абонент занят`
              : `${kind} отменён`;
    try {
      this.chats.systemMessage(r.chat_id, r.caller_id, text, { subtype: 'call', call_id: r.id });
    } catch {
      // Чат удалён — сообщение не нужно
    }
  }

  private clearTimer(callId: string): void {
    const t = this.ringTimers.get(callId);
    if (t) clearTimeout(t);
    this.ringTimers.delete(callId);
  }

  /**
   * Пересылка сигнала второй стороне. До ответа сигналы не нужны (предложение
   * отправляется после принятия), после — идут только на принявшее устройство.
   */
  signal(userId: string, sessionId: string, callId: string, signal: CallSignal): void {
    const r = this.participant(userId, callId);
    if (r.status !== 'active') return;
    const mine = r.caller_id === userId ? r.caller_session : r.callee_session;
    if (mine !== sessionId) throw forbidden('Звонок идёт на другом устройстве');
    if (JSON.stringify(signal).length > MAX_SIGNAL_BYTES) throw badRequest('Слишком большой сигнал');
    const valid =
      ((signal.type === 'offer' || signal.type === 'answer') && typeof signal.sdp === 'string') ||
      (signal.type === 'ice' && typeof signal.candidate === 'string') ||
      (signal.type === 'media' && typeof signal.audio === 'boolean' && typeof signal.video === 'boolean');
    if (!valid) throw badRequest('Некорректный сигнал');
    const [otherId, otherSession] = r.caller_id === userId ? [r.callee_id, r.callee_session] : [r.caller_id, r.caller_session];
    if (otherSession) this.hub.sendToSession(otherId, otherSession, { t: 'call.signal', callId, signal });
  }

  /** Текущий входящий/исходящий звонок (после перезагрузки страницы). */
  current(userId: string): CallInfo | null {
    const r = this.db.get<CallRow>("SELECT * FROM calls WHERE status IN ('ringing', 'active') AND (caller_id = :u OR callee_id = :u) ORDER BY created_at DESC LIMIT 1", {
      u: userId,
    });
    return r ? this.dto(r) : null;
  }

  history(userId: string, cursor: string | undefined, limit: number): Paginated<CallInfo> {
    const offset = offsetCursor.decode(cursor);
    const rows = this.db.all<CallRow>(
      'SELECT * FROM calls WHERE caller_id = :u OR callee_id = :u ORDER BY created_at DESC LIMIT :l OFFSET :o',
      { u: userId, l: limit + 1, o: offset },
    );
    return { items: this.repo.toDtos(rows.slice(0, limit)), nextCursor: offsetCursor.next(offset, rows.length, limit) };
  }

  stop(): void {
    for (const t of this.ringTimers.values()) clearTimeout(t);
    this.ringTimers.clear();
  }
}
