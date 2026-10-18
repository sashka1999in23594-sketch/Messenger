/**
 * Прямые эфиры и чаты эфиров и премьер.
 *
 * Видео эфира идёт из браузера ведущего каждому зрителю напрямую по WebRTC
 * (через TURN, если сеть не пускает напрямую). Сервер не видит и не хранит
 * поток: он знает, кто ведущий и кто смотрит, и пересылает сигналы WebRTC
 * между конкретными устройствами — как в звонках. Без отдельного медиасервера
 * это ограничивает эфир десятками зрителей; для тысяч нужен SFU (см. ROADMAP).
 *
 * Чат эфира или премьеры — «комната»: stream:<id> или premiere:<postId>.
 * Сообщения хранятся в live_chat, рассылаются тем, кто сейчас в комнате.
 */
import { randomBytes } from 'node:crypto';
import type { CallSignal, LiveChatMessage, LiveStream } from '@omni/shared';
import type { Db } from '../../db/index.js';
import { iso } from '../../db/index.js';
import { badRequest, forbidden, notFound } from '../../lib/errors.js';
import { newId } from '../../lib/ids.js';
import type { NotificationService } from '../notifications/notifications.service.js';
import type { Policy } from '../policy/policy.service.js';
import type { RealtimeHub } from '../realtime/hub.js';
import type { UsersRepo } from '../users/users.repo.js';

interface StreamRow {
  id: string;
  owner_id: string;
  title: string;
  description: string;
  status: 'live' | 'ended';
  peak_viewers: number;
  total_viewers: number;
  recording_post_id: string | null;
  started_at: number;
  ended_at: number | null;
}

interface Viewer {
  userId: string;
  sessionId: string;
}

interface Live {
  ownerId: string;
  hostSession: string;
  viewers: Map<string, Viewer>;
  /** Ведущий пропал (перезагрузка, сеть) — даём время вернуться */
  graceTimer: NodeJS.Timeout | null;
}

/** Без медиасервера каждый зритель — отдельный поток от ведущего */
export const MAX_VIEWERS = 50;
const HOST_GRACE_MS = 20_000;

export class LiveService {
  private readonly live = new Map<string, Live>();
  /** Кто сейчас в комнате чата: room → «userId:sessionId» → userId */
  private readonly rooms = new Map<string, Map<string, string>>();

  constructor(
    private readonly db: Db,
    private readonly users: UsersRepo,
    private readonly policy: Policy,
    private readonly hub: RealtimeHub,
    private readonly notifications: NotificationService,
  ) {
    // После перезапуска сервера активных соединений нет — незавершённые эфиры закрываем
    db.run("UPDATE live_streams SET status = 'ended', ended_at = coalesce(ended_at, :now) WHERE status = 'live'", { now: Date.now() });
    hub.onSessionGone((userId, sessionId) => this.sessionGone(userId, sessionId));
  }

  // ─── Карточки ─────────────────────────────────────────────────────────────

  private row(id: string): StreamRow {
    const r = this.db.get<StreamRow>('SELECT * FROM live_streams WHERE id = :id', { id });
    if (!r) throw notFound('Эфир не найден');
    return r;
  }

  private dto(r: StreamRow): LiveStream | null {
    const owner = this.users.summary(r.owner_id);
    if (!owner) return null;
    return {
      id: r.id,
      owner,
      title: r.title,
      description: r.description,
      status: r.status,
      viewers: this.live.get(r.id)?.viewers.size ?? 0,
      peakViewers: r.peak_viewers,
      totalViewers: r.total_viewers,
      recordingPostId: r.recording_post_id,
      startedAt: iso(r.started_at),
      endedAt: r.ended_at ? iso(r.ended_at) : null,
    };
  }

  private visible(viewerId: string, r: StreamRow): boolean {
    const owner = this.users.byId(r.owner_id);
    return !!owner && this.policy.canWatchLive(viewerId, owner);
  }

  /** Сейчас в эфире и недавние эфиры (за неделю). */
  list(viewerId: string): { live: LiveStream[]; recent: LiveStream[] } {
    const rows = this.db.all<StreamRow>(
      `SELECT * FROM live_streams WHERE status = 'live' OR started_at > :since ORDER BY status = 'live' DESC, started_at DESC LIMIT 60`,
      { since: Date.now() - 7 * 86_400_000 },
    );
    const items = rows.filter((r) => this.visible(viewerId, r)).map((r) => this.dto(r)).filter((s): s is LiveStream => !!s);
    return { live: items.filter((s) => s.status === 'live').sort((a, b) => b.viewers - a.viewers), recent: items.filter((s) => s.status === 'ended') };
  }

  get(viewerId: string, id: string): { stream: LiveStream; chat: LiveChatMessage[] } {
    const r = this.row(id);
    if (!this.visible(viewerId, r)) throw notFound('Эфир не найден');
    return { stream: this.dto(r)!, chat: this.history(`stream:${id}`) };
  }

  private broadcastStream(id: string): void {
    const r = this.row(id);
    const dto = this.dto(r);
    const l = this.live.get(id);
    if (!dto) return;
    const users = new Set<string>([r.owner_id, ...[...(l?.viewers.values() ?? [])].map((v) => v.userId)]);
    this.hub.sendToUsers(users, { t: 'live.updated', stream: dto });
  }

  // ─── Ведущий ──────────────────────────────────────────────────────────────

  start(userId: string, sessionId: string, input: { title: string; description: string }): LiveStream {
    // Один эфир на человека: прошлый (например, с другого устройства) завершаем
    for (const r of this.db.all<{ id: string }>("SELECT id FROM live_streams WHERE owner_id = :u AND status = 'live'", { u: userId })) this.finish(r.id);
    const now = Date.now();
    const id = newId(now);
    this.db.run(
      `INSERT INTO live_streams (id, owner_id, title, description, status, started_at) VALUES (:id, :u, :t, :d, 'live', :now)`,
      { id, u: userId, t: input.title, d: input.description, now },
    );
    this.live.set(id, { ownerId: userId, hostSession: sessionId, viewers: new Map(), graceTimer: null });
    this.joinRoom(`stream:${id}`, userId, sessionId);
    // «Колокольчик»: подписчикам, включившим уведомления о публикациях автора
    const subs = this.db.all<{ user_id: string }>('SELECT user_id FROM post_subscriptions WHERE author_id = :a LIMIT 5000', { a: userId });
    const owner = this.users.byId(userId)!;
    for (const { user_id } of subs) {
      if (!this.policy.canWatchLive(user_id, owner)) continue;
      this.notifications.notify({ userId: user_id, type: 'new_post', actorId: userId, entityType: null, entityId: null, link: `/live/${id}`, preview: `в прямом эфире: ${input.title}` });
    }
    return this.dto(this.row(id))!;
  }

  private assertHost(userId: string, id: string): StreamRow {
    const r = this.row(id);
    if (r.owner_id !== userId) throw forbidden('Это не ваш эфир');
    return r;
  }

  end(userId: string, id: string): LiveStream {
    this.assertHost(userId, id);
    this.finish(id);
    return this.dto(this.row(id))!;
  }

  /** Запись эфира опубликована как видео — показываем её вместо завершённого эфира. */
  attachRecording(userId: string, id: string, postId: string): LiveStream {
    this.assertHost(userId, id);
    const post = this.db.get<{ author_id: string; kind: string }>('SELECT author_id, kind FROM posts WHERE id = :p AND deleted_at IS NULL', { p: postId });
    if (!post || post.author_id !== userId || post.kind !== 'video') throw badRequest('Видео не найдено');
    this.db.run('UPDATE live_streams SET recording_post_id = :p WHERE id = :id', { p: postId, id });
    return this.dto(this.row(id))!;
  }

  private finish(id: string): void {
    const l = this.live.get(id);
    if (l?.graceTimer) clearTimeout(l.graceTimer);
    this.db.run("UPDATE live_streams SET status = 'ended', ended_at = coalesce(ended_at, :now) WHERE id = :id", { now: Date.now(), id });
    this.broadcastStream(id);
    this.live.delete(id);
  }

  // ─── Зрители ──────────────────────────────────────────────────────────────

  /** Зритель подключается: ведущий получает «новый зритель» и отправляет ему предложение WebRTC. */
  join(userId: string, sessionId: string, id: string): { peer: string; stream: LiveStream } {
    const r = this.row(id);
    if (!this.visible(userId, r)) throw notFound('Эфир не найден');
    const l = this.live.get(id);
    if (r.status !== 'live' || !l) throw badRequest('Эфир уже завершён');
    if (userId === r.owner_id && sessionId === l.hostSession) throw badRequest('Вы ведёте этот эфир');
    // Повторное подключение того же устройства заменяет прошлое
    for (const [peer, v] of l.viewers) if (v.userId === userId && v.sessionId === sessionId) this.dropViewer(id, peer);
    if (l.viewers.size >= MAX_VIEWERS) throw badRequest(`В эфире уже ${MAX_VIEWERS} зрителей — это предел без медиасервера. Попробуйте чуть позже`);
    const peer = randomBytes(9).toString('base64url');
    l.viewers.set(peer, { userId, sessionId });
    this.joinRoom(`stream:${id}`, userId, sessionId);
    const unique = new Set([...l.viewers.values()].map((v) => v.userId)).size;
    this.db.run('UPDATE live_streams SET peak_viewers = max(peak_viewers, :n), total_viewers = total_viewers + 1 WHERE id = :id', { n: unique, id });
    this.hub.sendToSession(l.ownerId, l.hostSession, { t: 'live.viewer', streamId: id, peer, joined: true });
    this.broadcastStream(id);
    return { peer, stream: this.dto(this.row(id))! };
  }

  leave(userId: string, id: string, peer: string): void {
    const v = this.live.get(id)?.viewers.get(peer);
    if (!v || v.userId !== userId) return;
    this.dropViewer(id, peer);
    this.leaveRoom(`stream:${id}`, userId, v.sessionId);
    this.broadcastStream(id);
  }

  private dropViewer(id: string, peer: string): void {
    const l = this.live.get(id);
    if (!l?.viewers.delete(peer)) return;
    this.hub.sendToSession(l.ownerId, l.hostSession, { t: 'live.viewer', streamId: id, peer, joined: false });
  }

  /** Сигналы WebRTC: от ведущего — зрителю peer, от зрителя — ведущему. Чужие сигналы отбрасываются. */
  signal(userId: string, sessionId: string, id: string, peer: string, signal: CallSignal): void {
    const l = this.live.get(id);
    if (!l || typeof peer !== 'string') return;
    const viewer = l.viewers.get(peer);
    if (!viewer) return;
    if (userId === l.ownerId && sessionId === l.hostSession) {
      this.hub.sendToSession(viewer.userId, viewer.sessionId, { t: 'live.signal', streamId: id, peer, signal });
    } else if (userId === viewer.userId && sessionId === viewer.sessionId) {
      this.hub.sendToSession(l.ownerId, l.hostSession, { t: 'live.signal', streamId: id, peer, signal });
    }
  }

  private sessionGone(userId: string, sessionId: string): void {
    for (const [id, l] of this.live) {
      if (l.ownerId === userId && l.hostSession === sessionId && !l.graceTimer) {
        l.graceTimer = setTimeout(() => {
          l.graceTimer = null;
          if (!this.hub.sessionOnline(userId, sessionId)) this.finish(id);
        }, HOST_GRACE_MS);
        l.graceTimer.unref?.();
      }
      let changed = false;
      for (const [peer, v] of l.viewers) {
        if (v.userId === userId && v.sessionId === sessionId) {
          this.dropViewer(id, peer);
          changed = true;
        }
      }
      if (changed) this.broadcastStream(id);
    }
    for (const [room, members] of this.rooms) {
      members.delete(`${userId}:${sessionId}`);
      if (!members.size) this.rooms.delete(room);
    }
  }

  // ─── Чат комнаты ──────────────────────────────────────────────────────────

  joinRoom(room: string, userId: string, sessionId: string): void {
    let members = this.rooms.get(room);
    if (!members) this.rooms.set(room, (members = new Map()));
    members.set(`${userId}:${sessionId}`, userId);
  }

  leaveRoom(room: string, userId: string, sessionId: string): void {
    const members = this.rooms.get(room);
    members?.delete(`${userId}:${sessionId}`);
    if (members && !members.size) this.rooms.delete(room);
  }

  /** Сколько человек сейчас в комнате (для премьер — «смотрят вместе с вами»). */
  roomSize(room: string): number {
    return new Set(this.rooms.get(room)?.values() ?? []).size;
  }

  history(room: string, limit = 100): LiveChatMessage[] {
    const rows = this.db.all<{ id: string; user_id: string; text: string; created_at: number }>(
      'SELECT * FROM (SELECT * FROM live_chat WHERE room = :r ORDER BY created_at DESC LIMIT :l) ORDER BY created_at ASC',
      { r: room, l: limit },
    );
    const users = this.users.summaries(rows.map((r) => r.user_id));
    return rows.filter((r) => users.has(r.user_id)).map((r) => ({ id: r.id, user: users.get(r.user_id)!, text: r.text, createdAt: iso(r.created_at) }));
  }

  say(room: string, userId: string, text: string): LiveChatMessage {
    const user = this.users.summary(userId);
    if (!user) throw notFound();
    const now = Date.now();
    const msg: LiveChatMessage = { id: newId(now), user, text, createdAt: iso(now) };
    this.db.run('INSERT INTO live_chat (id, room, user_id, text, created_at) VALUES (:id, :r, :u, :t, :now)', { id: msg.id, r: room, u: userId, t: text, now });
    this.hub.sendToUsers(new Set(this.rooms.get(room)?.values() ?? []), { t: 'live.chat', room, message: msg });
    return msg;
  }

  /** Чат эфира: писать могут зрители и ведущий, пока эфир идёт. */
  chat(userId: string, sessionId: string, id: string, text: string): LiveChatMessage {
    const r = this.row(id);
    if (!this.visible(userId, r)) throw notFound('Эфир не найден');
    if (r.status !== 'live') throw badRequest('Эфир завершён — чат закрыт');
    this.joinRoom(`stream:${id}`, userId, sessionId);
    return this.say(`stream:${id}`, userId, text);
  }

  /** Ведущий в комнате своего эфира с самого начала — видит чат. */
  hostJoined(userId: string, sessionId: string, id: string): void {
    this.assertHost(userId, id);
    this.joinRoom(`stream:${id}`, userId, sessionId);
  }
}
