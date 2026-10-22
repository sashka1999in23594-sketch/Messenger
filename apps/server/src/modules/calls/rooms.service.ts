/**
 * Групповые звонки до 50 человек. Как и у звонков 1:1, сервер не видит медиа:
 * он хранит состав звонка, рассылает приглашения и пересылает сигналы WebRTC
 * между участниками. Каждый участник соединён с каждым напрямую, поток
 * шифруется DTLS-SRTP (через TURN — тоже в зашифрованном виде).
 *
 * Звонок идёт, пока в нём есть хотя бы один участник. Организатор (создатель)
 * и соорганизаторы управляют звонком: выключают микрофоны и камеры, удаляют,
 * закрепляют участника для всех, дают слово поднявшим руку, задают правила
 * (кто может говорить, показывать экран, писать в чат, приглашать) и могут
 * завершить звонок для всех. Медиа идёт напрямую между людьми, поэтому
 * запреты на микрофон, камеру и экран выполняет приложение участника.
 */
import {
  MAX_ROOM_MEMBERS,
  type CallRoom,
  type LiveChatMessage,
  type RoomControl,
  type RoomMemberState,
  type RoomRole,
  type RoomSettings,
  type RoomSignal,
} from '@omni/shared';
import type { Db } from '../../db/index.js';
import { Db as DbClass, iso, isoOrNull } from '../../db/index.js';
import { badRequest, forbidden, notFound } from '../../lib/errors.js';
import { newId } from '../../lib/ids.js';
import type { ChatsService } from '../chats/chats.service.js';
import type { Policy } from '../policy/policy.service.js';
import type { RealtimeHub } from '../realtime/hub.js';
import type { UserRow, UsersRepo } from '../users/users.repo.js';

interface RoomRow {
  id: string;
  owner_id: string;
  title: string | null;
  video: number;
  status: 'active' | 'ended';
  chat_id: string | null;
  settings: string;
  created_at: number;
  ended_at: number | null;
}

interface MemberRow {
  room_id: string;
  user_id: string;
  role: RoomRole;
  state: RoomMemberState;
  session_id: string | null;
  invited_by: string | null;
  invited_at: number;
  joined_at: number | null;
  left_at: number | null;
  hand_at: number | null;
  speak: number;
}

export type RoomAction =
  | 'mute'
  | 'muteAll'
  | 'cameraOff'
  | 'stopScreen'
  | 'lowerHand'
  | 'lowerAllHands'
  | 'allowSpeak'
  | 'remove'
  | 'cohost'
  | 'spotlight'
  | 'settings'
  | 'rename'
  | 'end';

export interface ModerateInput {
  action: RoomAction;
  userId?: string;
  on?: boolean;
  spotlight?: string | null;
  title?: string;
  settings?: Partial<Omit<RoomSettings, 'spotlight'>>;
}

const MAX_SIGNAL_BYTES = 24 * 1024;
/** Приглашение «звонит» столько, потом просто остаётся в списке звонка */
export const ROOM_RING_MS = 45_000;

export const DEFAULT_ROOM_SETTINGS: RoomSettings = {
  locked: false,
  allowMic: true,
  allowCamera: true,
  allowScreen: true,
  allowChat: true,
  allowInvite: true,
  spotlight: null,
};

const isMod = (m: MemberRow | undefined) => m?.role === 'owner' || m?.role === 'cohost';
const fmtDuration = (sec: number) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;

export class RoomsService {
  constructor(
    private readonly db: Db,
    private readonly users: UsersRepo,
    private readonly policy: Policy,
    private readonly hub: RealtimeHub,
    private readonly chats: ChatsService,
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

  private settingsOf(r: RoomRow): RoomSettings {
    try {
      return { ...DEFAULT_ROOM_SETTINGS, ...(JSON.parse(r.settings || '{}') as Partial<RoomSettings>) };
    } catch {
      return { ...DEFAULT_ROOM_SETTINGS };
    }
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
        chatId: r.chat_id,
        settings: this.settingsOf(r),
        video: r.video === 1,
        status: r.status,
        owner: users.get(r.owner_id) ?? deleted(r.owner_id),
        members: members.map((m) => ({
          user: users.get(m.user_id) ?? deleted(m.user_id),
          state: m.state,
          role: m.role,
          invitedAt: iso(m.invited_at),
          joinedAt: isoOrNull(m.joined_at),
          hand: isoOrNull(m.hand_at),
          canSpeak: m.speak === 1,
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

  create(userId: string, sessionId: string, input: { userIds: string[]; usernames: string[]; video: boolean; title?: string; chatId?: string }): CallRoom {
    const people = this.resolvePeople(userId, input);
    if (!people.length) throw badRequest('Выберите, кому позвонить');
    if (people.length > MAX_ROOM_MEMBERS - 1) throw badRequest(`В звонке может быть до ${MAX_ROOM_MEMBERS} человек`);
    // Звонок из чата — только из того, где человек состоит (итог звонка придёт туда)
    if (input.chatId) this.chats.get(userId, input.chatId);
    this.leaveOthers(userId);
    const now = Date.now();
    const id = newId(now);
    this.db.tx(() => {
      this.db.run(
        `INSERT INTO call_rooms (id, owner_id, title, video, status, chat_id, settings, created_at)
         VALUES (:id, :o, :t, :v, 'active', :c, :s, :now)`,
        { id, o: userId, t: input.title?.trim() || null, v: input.video ? 1 : 0, c: input.chatId ?? null, s: JSON.stringify(DEFAULT_ROOM_SETTINGS), now },
      );
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
    const settings = this.settingsOf(r);
    if (!isMod(me) && (settings.locked || !settings.allowInvite)) throw forbidden('Организатор запретил приглашать в этот звонок');
    const people = this.resolvePeople(userId, input);
    const existing = new Map(this.members(roomId).map((m) => [m.user_id, m]));
    // Удалённых организатором может вернуть только организатор; тех, кто в звонке, пропускаем
    const fresh = people.filter((p) => {
      const st = existing.get(p.id)?.state;
      return st !== 'joined' && (st !== 'removed' || isMod(me));
    });
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
    if (m.state === 'removed') throw forbidden('Организатор удалил вас из этого звонка');
    if (this.settingsOf(r).locked && m.state !== 'invited' && m.state !== 'joined' && !isMod(m)) throw forbidden('Организатор закрыл вход в звонок');
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
      // Отказались все, кого звали, — организатор один: звонок не состоялся
      this.endIfAlone(roomId, userId);
      return room;
    }
    return this.markLeft(roomId, userId) ?? this.dto(r);
  }

  private markLeft(roomId: string, userId: string, state: 'left' | 'removed' = 'left'): CallRoom | null {
    const now = Date.now();
    const leaving = this.member(roomId, userId);
    const changed = this.db.run(
      `UPDATE call_room_members SET state = :st, session_id = NULL, left_at = :now, hand_at = NULL WHERE room_id = :r AND user_id = :u AND state = 'joined'`,
      { st: state, now, r: roomId, u: userId },
    );
    if (!changed.changes) return null;
    const left = this.members(roomId).filter((m) => m.state === 'joined');
    if (!left.length) {
      // Последний вышел — звонок завершён, приглашения больше не действуют
      this.finish(roomId);
    } else if (isMod(leaving) && !left.some(isMod)) {
      // Ведущих не осталось — ведёт тот, кто в звонке дольше всех
      const next = [...left].sort((a, b) => (a.joined_at ?? 0) - (b.joined_at ?? 0))[0]!;
      this.db.run(`UPDATE call_room_members SET role = 'cohost' WHERE room_id = :r AND user_id = :u`, { r: roomId, u: next.user_id });
    }
    const room = this.dto(this.room(roomId)!);
    this.broadcast(room);
    return room;
  }

  /** Звонок завершён: статус, итог в личном чате (если начат оттуда). */
  private finish(roomId: string): void {
    const now = Date.now();
    const changed = this.db.run(`UPDATE call_rooms SET status = 'ended', ended_at = :now WHERE id = :r AND status = 'active'`, { now, r: roomId });
    if (!changed.changes) return;
    const r = this.room(roomId)!;
    if (!r.chat_id) return;
    const talked = this.members(roomId).filter((m) => m.user_id !== r.owner_id && m.joined_at);
    const kind = r.video ? 'по видео' : '';
    const firstJoin = Math.min(...this.members(roomId).map((m) => (m.user_id !== r.owner_id ? (m.joined_at ?? Infinity) : Infinity)));
    const text = talked.length
      ? `позвонил(а) ${kind} · ${fmtDuration(Math.max(0, Math.round((now - firstJoin) / 1000)))}`.replace('  ', ' ')
      : 'позвонил(а) — нет ответа';
    try {
      this.chats.systemMessage(r.chat_id, r.owner_id, text);
    } catch {
      // чат удалён — итог не нужен
    }
  }

  private endIfAlone(roomId: string, byId: string): void {
    const ms = this.members(roomId);
    const waiting = ms.some((m) => m.state === 'invited');
    const joined = ms.filter((m) => m.state === 'joined');
    // Был кто-то, кроме оставшегося, — это не «отклонили», а обычный звонок
    const talked = ms.some((m) => m.joined_at && !joined.includes(m));
    if (waiting || joined.length !== 1 || talked) return;
    this.control(roomId, [joined[0]!.user_id], 'declined', byId);
    this.markLeft(roomId, joined[0]!.user_id);
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

  // ─── Рука и управление ─────────────────────────────────────────────────────

  /** Поднять или опустить руку; организаторы получают уведомление. */
  hand(userId: string, roomId: string, up: boolean): CallRoom {
    const r = this.room(roomId);
    const me = r && this.member(roomId, userId);
    if (!r || !me || me.state !== 'joined') throw notFound('Звонок не найден');
    this.db.run('UPDATE call_room_members SET hand_at = :h WHERE room_id = :r AND user_id = :u', { h: up ? (me.hand_at ?? Date.now()) : null, r: roomId, u: userId });
    const room = this.dto(r);
    this.broadcast(room);
    if (up && !me.hand_at) {
      const user = this.users.summaries([userId]).get(userId)!;
      const mods = this.members(roomId).filter((m) => m.state === 'joined' && isMod(m) && m.user_id !== userId);
      this.hub.sendToUsers(
        mods.map((m) => m.user_id),
        { t: 'room.hand', roomId, user },
      );
    }
    return room;
  }

  private control(roomId: string, userIds: string[], action: RoomControl, byId: string): void {
    const by = this.users.summaries([byId]).get(byId);
    if (!by || !userIds.length) return;
    this.hub.sendToUsers(userIds, { t: 'room.control', roomId, action, by });
  }

  /** Команды организатора и соорганизаторов. */
  moderate(userId: string, roomId: string, input: ModerateInput): CallRoom {
    const r = this.room(roomId);
    const me = r && this.member(roomId, userId);
    if (!r || !me) throw notFound('Звонок не найден');
    if (r.status !== 'active') throw badRequest('Звонок уже завершён');
    if (me.state !== 'joined' || !isMod(me)) throw forbidden('Управлять звонком могут организатор и соорганизаторы');
    const members = this.members(roomId);
    const joined = members.filter((m) => m.state === 'joined');
    const others = joined.filter((m) => m.user_id !== userId && !isMod(m)).map((m) => m.user_id);
    const target = (() => {
      if (!input.userId) return undefined;
      const t = members.find((m) => m.user_id === input.userId);
      if (!t || t.state !== 'joined') throw notFound('Участник не в звонке');
      // Соорганизатор не может управлять организатором
      if (t.role === 'owner' && me.role !== 'owner') throw forbidden('Организатором управлять нельзя');
      return t;
    })();
    const need = () => {
      if (!target) throw badRequest('Выберите участника');
      return target;
    };
    const set = (sql: string, params: Record<string, unknown>) => this.db.run(sql, { r: roomId, ...params });
    const settings = this.settingsOf(r);

    switch (input.action) {
      case 'mute': {
        const t = need();
        set('UPDATE call_room_members SET speak = 0 WHERE room_id = :r AND user_id = :u', { u: t.user_id });
        this.control(roomId, [t.user_id], 'mute', userId);
        break;
      }
      case 'muteAll':
        set("UPDATE call_room_members SET speak = 0 WHERE room_id = :r AND role = 'member'", {});
        this.control(roomId, others, 'mute', userId);
        break;
      case 'cameraOff':
        this.control(roomId, [need().user_id], 'camera-off', userId);
        break;
      case 'stopScreen':
        this.control(roomId, [need().user_id], 'stop-screen', userId);
        break;
      case 'lowerHand': {
        const t = need();
        set('UPDATE call_room_members SET hand_at = NULL WHERE room_id = :r AND user_id = :u', { u: t.user_id });
        this.control(roomId, [t.user_id], 'lower-hand', userId);
        break;
      }
      case 'lowerAllHands': {
        const raised = joined.filter((m) => m.hand_at).map((m) => m.user_id);
        set('UPDATE call_room_members SET hand_at = NULL WHERE room_id = :r', {});
        this.control(roomId, raised, 'lower-hand', userId);
        break;
      }
      case 'allowSpeak': {
        // Дать слово: можно включить микрофон, даже если участникам нельзя; рука опускается
        const t = need();
        const on = input.on !== false;
        set('UPDATE call_room_members SET speak = :s, hand_at = CASE WHEN :s = 1 THEN NULL ELSE hand_at END WHERE room_id = :r AND user_id = :u', { s: on ? 1 : 0, u: t.user_id });
        if (!on) this.control(roomId, [t.user_id], 'mute', userId);
        break;
      }
      case 'remove': {
        const t = need();
        if (t.user_id === userId) throw badRequest('Чтобы выйти, нажмите «Завершить»');
        this.control(roomId, [t.user_id], 'removed', userId);
        this.markLeft(roomId, t.user_id, 'removed');
        break;
      }
      case 'cohost': {
        const t = need();
        if (me.role !== 'owner') throw forbidden('Назначать соорганизаторов может организатор');
        if (t.role === 'owner') throw badRequest('Это организатор звонка');
        set('UPDATE call_room_members SET role = :role WHERE room_id = :r AND user_id = :u', { role: input.on === false ? 'member' : 'cohost', u: t.user_id });
        break;
      }
      case 'spotlight': {
        const v = input.spotlight ?? null;
        const id = v?.replace(/^screen:/, '');
        if (id && !joined.some((m) => m.user_id === id)) throw badRequest('Участник не в звонке');
        set('UPDATE call_rooms SET settings = :s WHERE id = :r', { s: JSON.stringify({ ...settings, spotlight: v }) });
        break;
      }
      case 'settings': {
        const patch = input.settings ?? {};
        set('UPDATE call_rooms SET settings = :s WHERE id = :r', { s: JSON.stringify({ ...settings, ...patch, spotlight: settings.spotlight }) });
        break;
      }
      case 'rename':
        set('UPDATE call_rooms SET title = :t WHERE id = :r', { t: input.title?.trim() || null });
        break;
      case 'end': {
        // Завершить для всех: каждый получает команду и выходит
        this.control(
          roomId,
          joined.filter((m) => m.user_id !== userId).map((m) => m.user_id),
          'ended',
          userId,
        );
        const now = Date.now();
        set("UPDATE call_room_members SET state = 'left', session_id = NULL, left_at = :now, hand_at = NULL WHERE room_id = :r AND state = 'joined'", { now });
        set("UPDATE call_room_members SET state = 'declined' WHERE room_id = :r AND state = 'invited'", {});
        this.finish(roomId);
        break;
      }
    }
    const room = this.dto(this.room(roomId)!);
    this.broadcast(room);
    if (input.action === 'end') this.hub.sendToUser(userId, { t: 'room.updated', room });
    return room;
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
    const r = this.room(roomId);
    const me = r && this.member(roomId, userId);
    if (!r || !me || me.state !== 'joined') throw forbidden('Писать в чат звонка могут его участники');
    if (!this.settingsOf(r).allowChat && !isMod(me)) throw forbidden('Организатор выключил чат звонка');
    const user = this.users.summaries([userId]).get(userId)!;
    const message: LiveChatMessage = { id: newId(), user, text, createdAt: new Date().toISOString() };
    const ids = this.members(roomId)
      .filter((m) => m.state === 'joined')
      .map((m) => m.user_id);
    this.hub.sendToUsers(ids, { t: 'room.chat', roomId, message });
    return message;
  }
}
