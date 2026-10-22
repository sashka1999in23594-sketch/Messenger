/**
 * Групповые звонки до 50 человек. Как и у звонков 1:1, сервер не видит медиа:
 * он хранит состав звонка, рассылает приглашения и пересылает сигналы WebRTC
 * между участниками. Каждый участник соединён с каждым напрямую, поток
 * шифруется DTLS-SRTP (через TURN — тоже в зашифрованном виде).
 *
 * Звонок идёт, пока в нём есть хотя бы один участник. Пригласить может любой
 * участник звонка — тех, кому он вправе писать.
 */
import { MAX_ROOM_MEMBERS, type CallRoom, type LiveChatMessage, type RoomMemberState, type RoomSignal } from '@omni/shared';
import type { Db } from '../../db/index.js';
import { Db as DbClass, iso, isoOrNull } from '../../db/index.js';
import { badRequest, forbidden, notFound } from '../../lib/errors.js';
import { newId } from '../../lib/ids.js';
import type { Policy } from '../policy/policy.service.js';
import type { RealtimeHub } from '../realtime/hub.js';
import type { UserRow, UsersRepo } from '../users/users.repo.js';

interface RoomRow {
  id: string;
  owner_id: string;
  title: string | null;
  video: number;
  status: 'active' | 'ended';
  created_at: number;
  ended_at: number | null;
}

interface MemberRow {
  room_id: string;
  user_id: string;
  role: 'owner' | 'member';
  state: RoomMemberState;
  session_id: string | null;
  invited_by: string | null;
  invited_at: number;
  joined_at: number | null;
  left_at: number | null;
}

const MAX_SIGNAL_BYTES = 24 * 1024;
/** Приглашение «звонит» столько, потом просто остаётся в списке звонка */
export const ROOM_RING_MS = 45_000;

export class RoomsService {
  constructor(
    private readonly db: Db,
    private readonly users: UsersRepo,
    private readonly policy: Policy,
    private readonly hub: RealtimeHub,
  ) {
    // Устройство участника пропало из сети — он выходит из звонка
    hub.onSessionGone((userId, sessionId) => {
      const rows = this.db.all<MemberRow>(
        `SELECT m.* FROM call_room_members m JOIN call_rooms r ON r.id = m.room_id
          WHERE r.status = 'active' AND m.user_id = :u AND m.session_id = :s AND m.state = 'joined'`,
        { u: userId, s: sessionId },
      );
      for (const m of rows) this.markLeft(m.room_id, userId);
    });
  }

  // ─── Чтение ────────────────────────────────────────────────────────────────

  private room(id: string): RoomRow | undefined {
    return this.db.get<RoomRow>('SELECT * FROM call_rooms WHERE id = :id', { id });
  }

  private members(roomId: string): MemberRow[] {
    return this.db.all<MemberRow>('SELECT * FROM call_room_members WHERE room_id = :r ORDER BY invited_at, user_id', { r: roomId });
  }

  private member(roomId: string, userId: string): MemberRow | undefined {
    return this.db.get<MemberRow>('SELECT * FROM call_room_members WHERE room_id = :r AND user_id = :u', { r: roomId, u: userId });
  }

  private toDtos(rooms: RoomRow[]): CallRoom[] {
    if (!rooms.length) return [];
    const list = DbClass.inList(
      rooms.map((r) => r.id),
      'r',
    );
    const all = this.db.all<MemberRow>(`SELECT * FROM call_room_members WHERE room_id IN (${list.sql}) ORDER BY invited_at, user_id`, list.params);
    const users = this.users.summaries([...rooms.map((r) => r.owner_id), ...all.map((m) => m.user_id)]);
    const deleted = (id: string) => ({ id, username: 'deleted', displayName: 'Удалённый аккаунт', avatarUrl: null, verified: false });
    const now = Date.now();
    return rooms.map((r) => {
      const members = all.filter((m) => m.room_id === r.id);
      const firstJoin = Math.min(...members.map((m) => m.joined_at ?? Infinity));
      const start = Number.isFinite(firstJoin) ? firstJoin : r.created_at;
      return {
        id: r.id,
        title: r.title,
        video: r.video === 1,
        status: r.status,
        owner: users.get(r.owner_id) ?? deleted(r.owner_id),
        members: members.map((m) => ({
          user: users.get(m.user_id) ?? deleted(m.user_id),
          state: m.state,
          role: m.role,
          invitedAt: iso(m.invited_at),
          joinedAt: isoOrNull(m.joined_at),
        })),
        durationSec: Math.max(0, Math.round(((r.ended_at ?? now) - start) / 1000)),
        createdAt: iso(r.created_at),
        endedAt: isoOrNull(r.ended_at),
      };
    });
  }

  private dto(r: RoomRow): CallRoom {
    return this.toDtos([r])[0]!;
  }

  /** Звонок, если пользователь в нём участвует (или приглашён). */
  get(userId: string, roomId: string): CallRoom {
    const r = this.room(roomId);
    if (!r || !this.member(roomId, userId)) throw notFound('Звонок не найден');
    return this.dto(r);
  }

  /** История групповых звонков пользователя, новые сверху. */
  history(userId: string, limit: number): CallRoom[] {
    const rows = this.db.all<RoomRow>(
      `SELECT r.* FROM call_rooms r JOIN call_room_members m ON m.room_id = r.id
        WHERE m.user_id = :u ORDER BY r.created_at DESC LIMIT :l`,
      { u: userId, l: limit },
    );
    return this.toDtos(rows);
  }

  /** Идущий звонок, в котором пользователь состоит или куда его позвали (после перезагрузки). */
  current(userId: string): { room: CallRoom; state: RoomMemberState } | null {
    const m = this.db.get<MemberRow>(
      `SELECT m.* FROM call_room_members m JOIN call_rooms r ON r.id = m.room_id
        WHERE r.status = 'active' AND m.user_id = :u AND (m.state = 'joined' OR (m.state = 'invited' AND m.invited_at > :since))
        ORDER BY m.invited_at DESC LIMIT 1`,
      { u: userId, since: Date.now() - ROOM_RING_MS },
    );
    return m ? { room: this.dto(this.room(m.room_id)!), state: m.state } : null;
  }

  // ─── Создание и приглашения ────────────────────────────────────────────────

  /** Кого из перечисленных можно позвать: существуют, не заблокированы, разрешают писать. */
  private resolvePeople(userId: string, input: { userIds: string[]; usernames: string[] }): UserRow[] {
    const out = new Map<string, UserRow>();
    const skipped: string[] = [];
    const consider = (u: UserRow | undefined, label: string) => {
      if (!u || u.id === userId) return void (u ? undefined : skipped.push(label));
      if (this.policy.blockedEitherWay(userId, u.id) || !this.policy.canMessage(userId, u)) return void skipped.push(`@${u.username}`);
      out.set(u.id, u);
    };
    for (const id of input.userIds) consider(this.users.byId(id), id);
    for (const raw of input.usernames) {
      const name = raw.replace(/^@/, '').trim().toLowerCase();
      if (name) consider(this.users.byUsername(name), `@${name}`);
    }
    if (!out.size && skipped.length) throw badRequest(`Нельзя позвать: ${skipped.slice(0, 3).join(', ')}`);
    return [...out.values()];
  }

  create(userId: string, sessionId: string, input: { userIds: string[]; usernames: string[]; video: boolean; title?: string }): CallRoom {
    const people = this.resolvePeople(userId, input);
    if (!people.length) throw badRequest('Выберите, кому позвонить');
    if (people.length > MAX_ROOM_MEMBERS - 1) throw badRequest(`В звонке может быть до ${MAX_ROOM_MEMBERS} человек`);
    this.leaveOthers(userId);
    const now = Date.now();
    const id = newId(now);
    this.db.tx(() => {
      this.db.run('INSERT INTO call_rooms (id, owner_id, title, video, status, created_at) VALUES (:id, :o, :t, :v, :st, :now)', {
        id,
        o: userId,
        t: input.title?.trim() || null,
        v: input.video ? 1 : 0,
        st: 'active',
        now,
      });
      this.db.run(
        `INSERT INTO call_room_members (room_id, user_id, role, state, session_id, invited_at, joined_at)
         VALUES (:r, :u, 'owner', 'joined', :s, :now, :now)`,
        { r: id, u: userId, s: sessionId, now },
      );
      for (const p of people) {
        this.db.run(`INSERT INTO call_room_members (room_id, user_id, role, state, invited_by, invited_at) VALUES (:r, :u, 'member', 'invited', :by, :now)`, {
          r: id,
          u: p.id,
          by: userId,
          now,
        });
      }
    });
    const room = this.dto(this.room(id)!);
    this.ring(room, userId, people.map((p) => p.id));
    return room;
  }

  invite(userId: string, roomId: string, input: { userIds: string[]; usernames: string[] }): CallRoom {
    const r = this.room(roomId);
    const me = r && this.member(roomId, userId);
    if (!r || !me) throw notFound('Звонок не найден');
    if (r.status !== 'active') throw badRequest('Звонок уже завершён');
    if (me.state !== 'joined') throw forbidden('Приглашать могут участники звонка');
    const people = this.resolvePeople(userId, input);
    const existing = new Map(this.members(roomId).map((m) => [m.user_id, m]));
    // Повторно звоним тем, кто вышел или отказался; тех, кто в звонке, пропускаем
    const fresh = people.filter((p) => existing.get(p.id)?.state !== 'joined');
    const total = new Set([...existing.keys(), ...fresh.map((p) => p.id)]).size;
    if (total > MAX_ROOM_MEMBERS) throw badRequest(`В звонке может быть до ${MAX_ROOM_MEMBERS} человек`);
    const now = Date.now();
    this.db.tx(() => {
      for (const p of fresh) {
        if (existing.has(p.id)) {
          this.db.run(`UPDATE call_room_members SET state = 'invited', invited_by = :by, invited_at = :now, left_at = NULL WHERE room_id = :r AND user_id = :u`, {
            r: roomId,
            u: p.id,
            by: userId,
            now,
          });
        } else {
          this.db.run(`INSERT INTO call_room_members (room_id, user_id, role, state, invited_by, invited_at) VALUES (:r, :u, 'member', 'invited', :by, :now)`, {
            r: roomId,
            u: p.id,
            by: userId,
            now,
          });
        }
      }
    });
    const room = this.dto(r);
    this.broadcast(room);
    this.ring(room, userId, fresh.map((p) => p.id));
    return room;
  }

  private ring(room: CallRoom, fromId: string, userIds: string[]): void {
    const from = this.users.summaries([fromId]).get(fromId);
    if (!from) return;
    for (const id of userIds) this.hub.sendToUser(id, { t: 'room.invite', room, from });
  }

  // ─── Вход и выход ──────────────────────────────────────────────────────────

  join(userId: string, sessionId: string, roomId: string): CallRoom {
    const r = this.room(roomId);
    const m = r && this.member(roomId, userId);
    if (!r || !m) throw notFound('Звонок не найден');
    if (r.status !== 'active') throw badRequest('Звонок уже завершён');
    const joined = this.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM call_room_members WHERE room_id = :r AND state = 'joined' AND user_id <> :u", {
      r: roomId,
      u: userId,
    })!.n;
    if (joined >= MAX_ROOM_MEMBERS) throw badRequest(`В звонке уже ${MAX_ROOM_MEMBERS} человек`);
    this.leaveOthers(userId, roomId);
    this.db.run(`UPDATE call_room_members SET state = 'joined', session_id = :s, joined_at = :now, left_at = NULL WHERE room_id = :r AND user_id = :u`, {
      s: sessionId,
      now: Date.now(),
      r: roomId,
      u: userId,
    });
    const room = this.dto(r);
    this.broadcast(room);
    return room;
  }

  /** Выйти (участник) или отказаться (приглашённый). */
  leave(userId: string, roomId: string): CallRoom {
    const r = this.room(roomId);
    const m = r && this.member(roomId, userId);
    if (!r || !m) throw notFound('Звонок не найден');
    if (m.state === 'invited') {
      this.db.run(`UPDATE call_room_members SET state = 'declined', left_at = :now WHERE room_id = :r AND user_id = :u`, { now: Date.now(), r: roomId, u: userId });
      const room = this.dto(r);
      this.broadcast(room);
      return room;
    }
    return this.markLeft(roomId, userId) ?? this.dto(r);
  }

  private markLeft(roomId: string, userId: string): CallRoom | null {
    const now = Date.now();
    const changed = this.db.run(`UPDATE call_room_members SET state = 'left', session_id = NULL, left_at = :now WHERE room_id = :r AND user_id = :u AND state = 'joined'`, {
      now,
      r: roomId,
      u: userId,
    });
    if (!changed.changes) return null;
    const left = this.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM call_room_members WHERE room_id = :r AND state = 'joined'", { r: roomId })!.n;
    // Последний вышел — звонок завершён, приглашения больше не действуют
    if (!left) this.db.run(`UPDATE call_rooms SET status = 'ended', ended_at = :now WHERE id = :r AND status = 'active'`, { now, r: roomId });
    const room = this.dto(this.room(roomId)!);
    this.broadcast(room);
    return room;
  }

  /** Человек может быть только в одном групповом звонке: из прежнего выходит. */
  private leaveOthers(userId: string, except?: string): void {
    const rows = this.db.all<{ room_id: string }>(
      `SELECT m.room_id FROM call_room_members m JOIN call_rooms r ON r.id = m.room_id
        WHERE r.status = 'active' AND m.user_id = :u AND m.state = 'joined' AND m.room_id <> :e`,
      { u: userId, e: except ?? '' },
    );
    for (const r of rows) this.markLeft(r.room_id, userId);
  }

  private broadcast(room: CallRoom): void {
    // Изменения видят все, кто в звонке или приглашён (у них список участников)
    const ids = room.members.filter((m) => m.state === 'joined' || m.state === 'invited').map((m) => m.user.id);
    this.hub.sendToUsers(ids, { t: 'room.updated', room });
  }

  // ─── Сигналы и чат ─────────────────────────────────────────────────────────

  /** Пересылка сигнала одному участнику — на то устройство, с которого он в звонке. */
  signal(userId: string, sessionId: string, roomId: string, to: string, signal: RoomSignal): void {
    const me = this.member(roomId, userId);
    if (!me || me.state !== 'joined') return;
    if (me.session_id !== sessionId) throw forbidden('Звонок идёт на другом устройстве');
    if (JSON.stringify(signal).length > MAX_SIGNAL_BYTES) throw badRequest('Слишком большой сигнал');
    const valid =
      ((signal.type === 'offer' || signal.type === 'answer') && typeof signal.sdp === 'string') ||
      (signal.type === 'ice' && typeof signal.candidate === 'string') ||
      (signal.type === 'media' &&
        typeof signal.audio === 'boolean' &&
        typeof signal.video === 'boolean' &&
        typeof signal.hand === 'boolean' &&
        (signal.screen === null || (typeof signal.screen === 'string' && signal.screen.length <= 128)));
    if (!valid) throw badRequest('Некорректный сигнал');
    const other = this.member(roomId, to);
    if (!other || other.state !== 'joined' || !other.session_id) return;
    this.hub.sendToSession(to, other.session_id, { t: 'room.signal', roomId, from: userId, signal });
  }

  /** Сообщение в чате звонка: видят те, кто сейчас в звонке; не сохраняется. */
  chat(userId: string, roomId: string, text: string): LiveChatMessage {
    const me = this.member(roomId, userId);
    if (!me || me.state !== 'joined') throw forbidden('Писать в чат звонка могут его участники');
    const user = this.users.summaries([userId]).get(userId)!;
    const message: LiveChatMessage = { id: newId(), user, text, createdAt: new Date().toISOString() };
    const ids = this.members(roomId)
      .filter((m) => m.state === 'joined')
      .map((m) => m.user_id);
    this.hub.sendToUsers(ids, { t: 'room.chat', roomId, message });
    return message;
  }
}
