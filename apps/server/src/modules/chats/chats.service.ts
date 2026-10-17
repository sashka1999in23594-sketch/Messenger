/**
 * Чаты: личные, группы, каналы, секретные (E2E) и «Избранное».
 *
 * Модель доставки: сообщение сохраняется в транзакции с монотонным seq внутри
 * чата → рассылается участникам через RealtimeHub. Клиент восстанавливает
 * пропуски после переподключения запросом `after=seq`. Повторная отправка с тем
 * же clientId не создаёт дубль (идемпотентность при плохой мобильной сети).
 */
import type {
  ChatBan,
  ChatMember,
  ChatRole,
  ChatSummary,
  Message,
  MessageSearchHit,
  Paginated,
  SecretChatInfo,
  SendMessageInput,
  UserSummary,
} from '@omni/shared';
import { ErrorCode, extractMentions, LIMITS } from '@omni/shared';
import type { Db } from '../../db/index.js';
import { bool, iso } from '../../db/index.js';
import { AppError, badRequest, blocked, conflict, forbidden, notFound, privacyRestricted } from '../../lib/errors.js';
import { newId } from '../../lib/ids.js';
import type { KeysService } from '../keys/keys.service.js';
import type { MediaService } from '../media/media.service.js';
import type { NotificationService } from '../notifications/notifications.service.js';
import type { Policy } from '../policy/policy.service.js';
import type { RealtimeHub } from '../realtime/hub.js';
import { privacyOf, type UsersRepo } from '../users/users.repo.js';
import { offsetCursor } from '../users/users.service.js';
import { bumpStat } from '../stats/daily.js';
import { MessagesRepo, type ChatRow, type MemberRow, type MessageRow } from './chats.repo.js';
import type { PollsRepo } from './polls.repo.js';

/** Входные данные отправки: «без звука» по умолчанию выключено. */
export type SendInput = Omit<SendMessageInput, 'silent'> & { silent?: boolean };

/** Пустые поля нового сообщения — чтобы не перечислять их в каждом месте вставки. */
const BLANK: Pick<
  MessageRow,
  | 'subtype'
  | 'poll_id'
  | 'call_id'
  | 'silent'
  | 'reply_to_id'
  | 'forward_from_chat_id'
  | 'forward_sender_name'
  | 'ciphertext'
  | 'iv'
  | 'sender_device_id'
  | 'edited_at'
  | 'deleted_at'
  | 'expires_at'
  | 'thread_root_id'
  | 'view_count'
  | 'comment_count'
> = {
  subtype: null,
  poll_id: null,
  call_id: null,
  silent: 0,
  reply_to_id: null,
  forward_from_chat_id: null,
  forward_sender_name: null,
  ciphertext: null,
  iv: null,
  sender_device_id: null,
  edited_at: null,
  deleted_at: null,
  expires_at: null,
  thread_root_id: null,
  view_count: 0,
  comment_count: 0,
};

const EDIT_WINDOW_MS = 48 * 3600 * 1000;
const MAX_REACTIONS_PER_USER = 3;

export type ChatFolder = 'all' | 'direct' | 'groups' | 'channels' | 'secret' | 'archived' | 'unread';

const FOLDER_SQL: Record<ChatFolder, string> = {
  all: "m.archived = 0 AND c.type != 'channel'",
  direct: "m.archived = 0 AND c.type IN ('direct', 'saved')",
  groups: "m.archived = 0 AND c.type = 'group'",
  channels: "m.archived = 0 AND c.type = 'channel'",
  secret: "c.type = 'secret'",
  archived: 'm.archived = 1',
  unread: "m.archived = 0 AND c.type != 'channel' AND c.last_seq > max(m.last_read_seq, m.cleared_seq)",
};

const likeEscape = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/** Проверка доступа к чату внутри компании или сообщества (задаёт SpacesService). */
export type SpaceGate = (userId: string, chat: ChatRow) => boolean;

export class ChatsService {
  private spaceGate: SpaceGate = () => false;

  constructor(
    private readonly db: Db,
    private readonly users: UsersRepo,
    private readonly messagesRepo: MessagesRepo,
    private readonly policy: Policy,
    private readonly media: MediaService,
    private readonly hub: RealtimeHub,
    private readonly notifications: NotificationService,
    private readonly keys: KeysService,
    private readonly polls: PollsRepo,
  ) {}

  // ─── Доступ ───────────────────────────────────────────────────────────────

  setSpaceGate(gate: SpaceGate): void {
    this.spaceGate = gate;
  }

  /** Открытый чат можно смотреть без вступления; внутри пространства — только его участникам. */
  private canPreview(chat: ChatRow, userId: string): boolean {
    if (!bool(chat.is_public)) return false;
    return !chat.space_id || this.spaceGate(userId, chat);
  }

  private chat(chatId: string): ChatRow {
    const c = this.db.get<ChatRow>('SELECT * FROM chats WHERE id = :id AND deleted_at IS NULL', { id: chatId });
    if (!c) throw notFound('Чат не найден');
    return c;
  }

  member(chatId: string, userId: string): MemberRow | undefined {
    return this.db.get<MemberRow>('SELECT * FROM chat_members WHERE chat_id = :c AND user_id = :u', { c: chatId, u: userId });
  }

  private access(chatId: string, userId: string): { chat: ChatRow; member: MemberRow } {
    const chat = this.chat(chatId);
    const member = this.member(chatId, userId);
    if (!member) throw notFound('Чат не найден');
    return { chat, member };
  }

  memberIds(chatId: string): string[] {
    return this.db.all<{ user_id: string }>('SELECT user_id FROM chat_members WHERE chat_id = :c', { c: chatId }).map((r) => r.user_id);
  }

  private isAdmin(m: MemberRow): boolean {
    return m.role === 'owner' || m.role === 'admin';
  }

  private canPost(chat: ChatRow, m: MemberRow): boolean {
    return chat.type === 'channel' ? this.isAdmin(m) : m.role !== 'subscriber';
  }

  // ─── Список и карточки чатов ──────────────────────────────────────────────

  /** Список чатов: встроенная папка или условие своей папки (см. FoldersService.where). */
  list(
    userId: string,
    folder: ChatFolder | { sql: string; params: Record<string, unknown> },
    cursor: string | undefined,
    limit: number,
  ): Paginated<ChatSummary> {
    const offset = offsetCursor.decode(cursor);
    const where = typeof folder === 'string' ? { sql: FOLDER_SQL[folder], params: {} } : folder;
    const rows = this.db.all<ChatRow & { m_json: string }>(
      `SELECT c.*, json_object('chat_id', m.chat_id, 'user_id', m.user_id, 'role', m.role, 'joined_at', m.joined_at,
              'last_read_seq', m.last_read_seq, 'cleared_seq', m.cleared_seq, 'pinned', m.pinned, 'archived', m.archived,
              'muted_until', m.muted_until, 'hidden', m.hidden) AS m_json
       FROM chat_members m JOIN chats c ON c.id = m.chat_id
       WHERE m.user_id = :u AND m.hidden = 0 AND c.deleted_at IS NULL AND c.space_id IS NULL AND ${where.sql}
       ORDER BY m.pinned DESC, coalesce(c.last_message_at, c.created_at) DESC
       LIMIT :limit OFFSET :offset`,
      { u: userId, limit: limit + 1, offset, ...where.params },
    );
    const items = rows.slice(0, limit).map((r) => this.summarize(r, JSON.parse(r.m_json) as MemberRow, userId));
    return { items, nextCursor: offsetCursor.next(offset, rows.length, limit) };
  }

  get(userId: string, chatId: string): ChatSummary {
    const chat = this.chat(chatId);
    const member = this.member(chatId, userId);
    if (!member) {
      // Публичный канал/группа можно просматривать без вступления
      if (this.canPreview(chat, userId)) return this.summarize(chat, null, userId);
      throw notFound('Чат не найден');
    }
    return this.summarize(chat, member, userId);
  }

  private summarize(chat: ChatRow, member: MemberRow | null, userId: string): ChatSummary {
    let peer = null;
    let peerReadSeq = 0;
    let title = chat.title;
    let avatarUrl = this.media.url(chat.avatar_media_id);

    if (chat.type === 'direct' || chat.type === 'secret') {
      const peerRow = this.db.get<{ user_id: string; last_read_seq: number }>(
        'SELECT user_id, last_read_seq FROM chat_members WHERE chat_id = :c AND user_id != :u',
        { c: chat.id, u: userId },
      );
      if (peerRow) {
        peer = this.users.summary(peerRow.user_id);
        const me = this.users.byId(userId);
        const them = this.users.byId(peerRow.user_id);
        // Отчёты о прочтении взаимны: если кто-то выключил — не видит никто
        if (me && them && privacyOf(me).readReceipts && privacyOf(them).readReceipts) peerReadSeq = peerRow.last_read_seq;
      }
      title = peer?.displayName ?? 'Удалённый аккаунт';
      avatarUrl = peer?.avatarUrl ?? null;
    } else if (chat.type === 'group') {
      peerReadSeq =
        this.db.value<number>('SELECT coalesce(MAX(last_read_seq), 0) FROM chat_members WHERE chat_id = :c AND user_id != :u', {
          c: chat.id,
          u: userId,
        }) ?? 0;
    } else if (chat.type === 'saved') {
      title = 'Избранное';
    }

    const lastMessage = this.lastVisibleMessage(chat.id, userId, member);
    const fromSeq = member ? Math.max(member.last_read_seq, member.cleared_seq) : chat.last_seq;
    const unreadCount = member
      ? (this.db.value<number>(
          `SELECT COUNT(*) FROM messages WHERE chat_id = :c AND seq > :s AND deleted_at IS NULL AND thread_root_id IS NULL
             AND (sender_id IS NULL OR sender_id != :u)`,
          { c: chat.id, s: fromSeq, u: userId },
        ) ?? 0)
      : 0;
    const pinned = chat.pinned_message_id ? this.messagesRepo.byId(chat.pinned_message_id) : undefined;
    const unreadMentions = member
      ? (this.db.value<number>('SELECT COUNT(*) FROM message_mentions WHERE user_id = :u AND chat_id = :c AND seq > :s', {
          u: userId,
          c: chat.id,
          s: fromSeq,
        }) ?? 0)
      : 0;

    let secret: SecretChatInfo | null = null;
    if (chat.type === 'secret' && chat.secret_devices) {
      const devices = JSON.parse(chat.secret_devices) as Record<string, string>;
      secret = { initiatorId: chat.owner_id ?? '', devices, ttlSeconds: chat.ttl_seconds };
    }

    return {
      id: chat.id,
      type: chat.type,
      unreadMentions,
      slowModeSec: chat.slow_mode_sec,
      ttlSeconds: chat.ttl_seconds,
      title,
      description: chat.description,
      avatarUrl,
      peer,
      handle: chat.handle,
      isPublic: bool(chat.is_public),
      commentsEnabled: chat.type === 'channel' && bool(chat.comments_enabled),
      spaceId: chat.space_id,
      memberCount: chat.member_count,
      role: member?.role ?? null,
      lastMessage,
      unreadCount: Math.min(unreadCount, 9999),
      lastReadSeq: member?.last_read_seq ?? 0,
      peerReadSeq,
      pinned: bool(member?.pinned),
      archived: bool(member?.archived),
      mutedUntil: member?.muted_until && member.muted_until > Date.now() ? iso(member.muted_until) : null,
      pinnedMessage: pinned && !pinned.deleted_at ? this.messagesRepo.preview(pinned) : null,
      secret,
      createdAt: iso(chat.created_at),
      updatedAt: iso(chat.last_message_at ?? chat.created_at),
    };
  }

  private lastVisibleMessage(chatId: string, userId: string, member: MemberRow | null) {
    const row = this.db.get<MessageRow>(
      `SELECT * FROM messages WHERE chat_id = :c AND deleted_at IS NULL AND seq > :cleared AND thread_root_id IS NULL
         AND NOT EXISTS (SELECT 1 FROM message_hidden h WHERE h.message_id = messages.id AND h.user_id = :u)
       ORDER BY seq DESC LIMIT 1`,
      { c: chatId, cleared: member?.cleared_seq ?? 0, u: userId },
    );
    return this.messagesRepo.preview(row);
  }

  // ─── Создание ─────────────────────────────────────────────────────────────

  private insertChat(row: Partial<ChatRow> & Pick<ChatRow, 'type'>): string {
    const now = Date.now();
    const id = newId(now);
    this.db.run(
      `INSERT INTO chats (id, type, title, description, avatar_media_id, owner_id, handle, is_public, direct_key, ttl_seconds, secret_devices,
         space_id, space_category_id, space_position, created_at, updated_at)
       VALUES (:id, :type, :title, :description, :avatar, :owner, :handle, :pub, :dk, :ttl, :sd, :space, :cat, :pos, :now, :now)`,
      {
        id,
        type: row.type,
        title: row.title ?? '',
        description: row.description ?? '',
        avatar: row.avatar_media_id ?? null,
        owner: row.owner_id ?? null,
        handle: row.handle ?? null,
        pub: row.is_public ?? 0,
        dk: row.direct_key ?? null,
        ttl: row.ttl_seconds ?? 0,
        sd: row.secret_devices ?? null,
        space: row.space_id ?? null,
        cat: row.space_category_id ?? null,
        pos: row.space_position ?? 0,
        now,
      },
    );
    return id;
  }

  private addMember(chatId: string, userId: string, role: ChatRole, hidden = false): void {
    const chat = this.db.get<{ last_seq: number }>('SELECT last_seq FROM chats WHERE id = :id', { id: chatId })!;
    const r = this.db.run(
      `INSERT OR IGNORE INTO chat_members (chat_id, user_id, role, joined_at, last_read_seq, cleared_seq, hidden)
       VALUES (:c, :u, :role, :now, :seq, :cleared, :hidden)`,
      // Новый участник видит историю, но старые сообщения не считаются для него непрочитанными
      { c: chatId, u: userId, role, now: Date.now(), seq: chat.last_seq, cleared: 0, hidden },
    );
    if (r.changes) this.db.run('UPDATE chats SET member_count = member_count + 1 WHERE id = :id', { id: chatId });
  }

  getOrCreateDirect(userId: string, peerId: string): ChatSummary {
    if (peerId === userId) return this.getOrCreateSaved(userId);
    const peer = this.users.byId(peerId);
    if (!peer) throw notFound('Пользователь не найден');
    const key = [userId, peerId].sort().join(':');
    const existing = this.db.get<{ id: string }>('SELECT id FROM chats WHERE direct_key = :k', { k: key });
    if (existing) {
      this.db.run('UPDATE chat_members SET hidden = 0 WHERE chat_id = :c AND user_id = :u', { c: existing.id, u: userId });
      return this.get(userId, existing.id);
    }
    if (this.policy.blockedEitherWay(userId, peerId)) throw blocked();
    if (!this.policy.canMessage(userId, peer)) throw privacyRestricted('Пользователь ограничил круг тех, кто может ему писать');
    const id = this.db.tx(() => {
      const chatId = this.insertChat({ type: 'direct', direct_key: key, owner_id: userId });
      this.addMember(chatId, userId, 'member');
      // Собеседник увидит чат только после первого сообщения
      this.addMember(chatId, peerId, 'member', true);
      return chatId;
    });
    return this.get(userId, id);
  }

  getOrCreateSaved(userId: string): ChatSummary {
    const key = `saved:${userId}`;
    const existing = this.db.get<{ id: string }>('SELECT id FROM chats WHERE direct_key = :k', { k: key });
    if (existing) return this.get(userId, existing.id);
    const id = this.db.tx(() => {
      const chatId = this.insertChat({ type: 'saved', direct_key: key, owner_id: userId, title: 'Избранное' });
      this.addMember(chatId, userId, 'owner');
      return chatId;
    });
    return this.get(userId, id);
  }

  createGroup(
    userId: string,
    input: { title: string; description: string; memberIds: string[]; avatarMediaId?: string | null; isPublic?: boolean; handle?: string | null },
  ): ChatSummary & { skipped: string[] } {
    if (input.avatarMediaId) this.media.assertOwned(userId, [input.avatarMediaId], ['image']);
    if (input.handle) this.assertHandleFree(input.handle);
    const skipped: string[] = [];
    const id = this.db.tx(() => {
      const chatId = this.insertChat({
        type: 'group',
        title: input.title,
        description: input.description,
        owner_id: userId,
        handle: input.handle ?? null,
        is_public: input.isPublic ? 1 : 0,
        avatar_media_id: input.avatarMediaId ?? null,
      });
      this.addMember(chatId, userId, 'owner');
      for (const mid of [...new Set(input.memberIds)].filter((m) => m !== userId)) {
        const u = this.users.byId(mid);
        if (!u || !this.policy.canMessage(userId, u)) {
          skipped.push(mid);
          continue;
        }
        this.addMember(chatId, mid, 'member');
      }
      return chatId;
    });
    this.systemMessage(id, userId, `создал(а) группу «${input.title}»`);
    return { ...this.get(userId, id), skipped };
  }

  createChannel(
    userId: string,
    input: { title: string; description: string; handle?: string | null; isPublic: boolean; avatarMediaId?: string | null },
  ): ChatSummary {
    if (input.avatarMediaId) this.media.assertOwned(userId, [input.avatarMediaId], ['image']);
    if (input.handle) this.assertHandleFree(input.handle);
    const id = this.db.tx(() => {
      const chatId = this.insertChat({
        type: 'channel',
        title: input.title,
        description: input.description,
        owner_id: userId,
        handle: input.handle ?? null,
        is_public: input.isPublic ? 1 : 0,
        avatar_media_id: input.avatarMediaId ?? null,
      });
      this.addMember(chatId, userId, 'owner');
      return chatId;
    });
    this.systemMessage(id, userId, `создал(а) канал «${input.title}»`);
    return this.get(userId, id);
  }

  private assertHandleFree(handle: string, exceptChatId?: string): void {
    const taken =
      this.db.get('SELECT 1 FROM chats WHERE handle = :h AND id != :id', { h: handle, id: exceptChatId ?? '' }) ||
      this.db.get('SELECT 1 FROM users WHERE username = :h', { h: handle });
    if (taken) throw conflict('Это имя уже занято', { handle: 'Это имя уже занято' });
  }

  createSecret(userId: string, input: { userId: string; myDeviceId: string; ttlSeconds: number }): ChatSummary {
    if (input.userId === userId) throw badRequest('Секретный чат с самим собой не нужен — используйте «Избранное»');
    const peer = this.users.byId(input.userId);
    if (!peer) throw notFound('Пользователь не найден');
    if (this.policy.blockedEitherWay(userId, peer.id)) throw blocked();
    if (!this.policy.canMessage(userId, peer)) throw privacyRestricted();
    const myKey = this.keys.listOwn(userId).find((k) => k.deviceId === input.myDeviceId);
    if (!myKey) throw badRequest('Ключ этого устройства не зарегистрирован');
    const peerKey = this.keys.latestFor(peer.id);
    if (!peerKey) {
      throw privacyRestricted('Собеседник ещё ни разу не открывал SpaceUp на устройстве с поддержкой шифрования');
    }
    const devices = { [userId]: myKey.deviceId, [peer.id]: peerKey.deviceId };
    const id = this.db.tx(() => {
      const chatId = this.insertChat({
        type: 'secret',
        owner_id: userId,
        ttl_seconds: input.ttlSeconds,
        secret_devices: JSON.stringify(devices),
      });
      this.addMember(chatId, userId, 'member');
      this.addMember(chatId, peer.id, 'member');
      return chatId;
    });
    this.systemMessage(id, userId, 'начал(а) секретный чат со сквозным шифрованием');
    return this.get(userId, id);
  }

  // ─── Управление ───────────────────────────────────────────────────────────

  update(
    userId: string,
    chatId: string,
    input: Partial<{
      title: string;
      description: string;
      avatarMediaId: string | null;
      ttlSeconds: number;
      slowModeSec: number;
      isPublic: boolean;
      handle: string | null;
      commentsEnabled: boolean;
    }>,
  ): ChatSummary {
    const { chat, member } = this.access(chatId, userId);
    const shared = chat.type === 'group' || chat.type === 'channel';
    if (input.isPublic !== undefined || input.handle !== undefined || input.commentsEnabled !== undefined) {
      // Тип доступа, адрес и комментарии меняют только владелец и администраторы
      if (!shared) throw badRequest('Эти настройки есть только у групп и каналов');
      if (!this.isAdmin(member)) throw forbidden('Только администраторы могут менять эти настройки');
      if (input.commentsEnabled !== undefined && chat.type !== 'channel') throw badRequest('Комментарии бывают только в каналах');
      if (input.handle) this.assertHandleFree(input.handle, chatId);
      this.db.run(
        `UPDATE chats SET is_public = coalesce(:pub, is_public), comments_enabled = coalesce(:com, comments_enabled),
           handle = CASE WHEN :setHandle = 1 THEN :handle ELSE handle END, updated_at = :now WHERE id = :id`,
        {
          pub: input.isPublic === undefined ? null : input.isPublic ? 1 : 0,
          com: input.commentsEnabled === undefined ? null : input.commentsEnabled ? 1 : 0,
          setHandle: input.handle !== undefined ? 1 : 0,
          handle: input.handle ?? null,
          now: Date.now(),
          id: chatId,
        },
      );
    }
    if (input.ttlSeconds !== undefined && input.ttlSeconds !== chat.ttl_seconds) {
      // Автоудаление: в общих чатах меняют администраторы, в личных — любой из двоих
      if (shared && !this.isAdmin(member)) throw forbidden('Только администраторы могут менять автоудаление');
      this.db.run('UPDATE chats SET ttl_seconds = :t, updated_at = :now WHERE id = :id', { t: input.ttlSeconds, now: Date.now(), id: chatId });
      const what = chat.type === 'secret' ? 'таймер самоуничтожения' : 'автоудаление сообщений';
      this.systemMessage(chatId, userId, input.ttlSeconds ? `установил(а) ${what}: ${formatTtl(input.ttlSeconds)}` : `выключил(а) ${what}`);
    }
    if (input.slowModeSec !== undefined && input.slowModeSec !== chat.slow_mode_sec) {
      if (chat.type !== 'group') throw badRequest('Медленный режим доступен только в группах');
      if (!this.isAdmin(member)) throw forbidden('Только администраторы могут включать медленный режим');
      this.db.run('UPDATE chats SET slow_mode_sec = :s, updated_at = :now WHERE id = :id', { s: input.slowModeSec, now: Date.now(), id: chatId });
      this.systemMessage(chatId, userId, input.slowModeSec ? `включил(а) медленный режим: ${formatTtl(input.slowModeSec)}` : 'выключил(а) медленный режим');
    }
    const meta = input.title !== undefined || input.description !== undefined || input.avatarMediaId !== undefined;
    if (!meta) {
      this.broadcastChanged(chatId);
      return this.get(userId, chatId);
    }
    if (!shared) throw badRequest('Этот чат нельзя переименовать');
    if (!this.isAdmin(member)) throw forbidden('Только администраторы могут менять чат');
    if (input.avatarMediaId) this.media.assertOwned(userId, [input.avatarMediaId], ['image']);
    this.db.run(
      `UPDATE chats SET title = coalesce(:title, title), description = coalesce(:description, description),
         avatar_media_id = CASE WHEN :setAvatar = 1 THEN :avatar ELSE avatar_media_id END, updated_at = :now WHERE id = :id`,
      {
        title: input.title ?? null,
        description: input.description ?? null,
        setAvatar: input.avatarMediaId !== undefined ? 1 : 0,
        avatar: input.avatarMediaId ?? null,
        now: Date.now(),
        id: chatId,
      },
    );
    if (input.title && input.title !== chat.title) this.systemMessage(chatId, userId, `переименовал(а) чат в «${input.title}»`);
    this.broadcastChanged(chatId);
    return this.get(userId, chatId);
  }

  setPrefs(userId: string, chatId: string, prefs: Partial<{ pinned: boolean; archived: boolean; mutedUntil: string | null }>): ChatSummary {
    this.access(chatId, userId);
    if (prefs.pinned) {
      const pinnedCount = this.db.value<number>('SELECT COUNT(*) FROM chat_members WHERE user_id = :u AND pinned = 1 AND chat_id != :c', {
        u: userId,
        c: chatId,
      })!;
      if (pinnedCount >= 10) throw badRequest('Можно закрепить не более 10 чатов');
    }
    this.db.run(
      `UPDATE chat_members SET
         pinned = coalesce(:pinned, pinned), archived = coalesce(:archived, archived),
         muted_until = CASE WHEN :setMute = 1 THEN :muted ELSE muted_until END
       WHERE chat_id = :c AND user_id = :u`,
      {
        pinned: prefs.pinned ?? null,
        archived: prefs.archived ?? null,
        setMute: prefs.mutedUntil !== undefined,
        muted: prefs.mutedUntil ? Date.parse(prefs.mutedUntil) : null,
        c: chatId,
        u: userId,
      },
    );
    this.notifications.pushCounters(userId);
    return this.get(userId, chatId);
  }

  /** Удалить чат: владелец группы/канала удаляет для всех; личный — скрывает у себя и очищает историю. */
  remove(userId: string, chatId: string): void {
    const { chat, member } = this.access(chatId, userId);
    if (chat.type === 'group' || chat.type === 'channel') {
      if (member.role !== 'owner') return this.leave(userId, chatId);
      const ids = this.memberIds(chatId);
      this.db.run('UPDATE chats SET deleted_at = :now WHERE id = :id', { now: Date.now(), id: chatId });
      this.hub.sendToUsers(ids, { t: 'chat.removed', chatId });
      return;
    }
    if (chat.type === 'secret') {
      // Секретный чат удаляется у обоих участников вместе с перепиской
      const ids = this.memberIds(chatId);
      this.db.tx(() => {
        this.db.run('DELETE FROM messages WHERE chat_id = :id', { id: chatId });
        this.db.run('UPDATE chats SET deleted_at = :now WHERE id = :id', { now: Date.now(), id: chatId });
      });
      this.hub.sendToUsers(ids, { t: 'chat.removed', chatId });
      return;
    }
    this.db.run('UPDATE chat_members SET hidden = 1, cleared_seq = :seq, pinned = 0 WHERE chat_id = :c AND user_id = :u', {
      seq: chat.last_seq,
      c: chatId,
      u: userId,
    });
    this.hub.sendToUser(userId, { t: 'chat.removed', chatId });
  }

  clearHistory(userId: string, chatId: string): void {
    const { chat } = this.access(chatId, userId);
    this.db.run('UPDATE chat_members SET cleared_seq = :seq, last_read_seq = :seq WHERE chat_id = :c AND user_id = :u', {
      seq: chat.last_seq,
      c: chatId,
      u: userId,
    });
    this.hub.sendToUser(userId, { t: 'chat.changed', chatId });
  }

  leave(userId: string, chatId: string): void {
    const { chat, member } = this.access(chatId, userId);
    if (chat.type !== 'group' && chat.type !== 'channel') return this.remove(userId, chatId);
    this.db.tx(() => {
      this.db.run('DELETE FROM chat_members WHERE chat_id = :c AND user_id = :u', { c: chatId, u: userId });
      this.db.run('UPDATE chats SET member_count = member_count - 1 WHERE id = :id', { id: chatId });
      if (chat.type === 'channel') bumpStat(this.db, 'channel_leaves', chatId);
      if (member.role === 'owner') {
        // Передаём владение старейшему администратору или участнику
        const next = this.db.get<{ user_id: string }>(
          `SELECT user_id FROM chat_members WHERE chat_id = :c
           ORDER BY CASE role WHEN 'admin' THEN 0 WHEN 'member' THEN 1 ELSE 2 END, joined_at LIMIT 1`,
          { c: chatId },
        );
        if (next) {
          this.db.run("UPDATE chat_members SET role = 'owner' WHERE chat_id = :c AND user_id = :u", { c: chatId, u: next.user_id });
          this.db.run('UPDATE chats SET owner_id = :u WHERE id = :c', { u: next.user_id, c: chatId });
        } else {
          this.db.run('UPDATE chats SET deleted_at = :now WHERE id = :id', { now: Date.now(), id: chatId });
        }
      }
    });
    if (chat.type === 'group') this.systemMessage(chatId, userId, 'покинул(а) группу');
    this.hub.sendToUser(userId, { t: 'chat.removed', chatId });
  }

  join(userId: string, chatId: string): ChatSummary {
    const chat = this.chat(chatId);
    if (!bool(chat.is_public) || (chat.type !== 'channel' && chat.type !== 'group')) throw forbidden('Вступить можно только в открытый чат');
    if (chat.space_id && !this.spaceGate(userId, chat)) throw forbidden('Сначала вступите в сообщество');
    this.assertNotBanned(chatId, userId);
    if (!this.member(chatId, userId)) {
      this.db.tx(() => {
        this.addMember(chatId, userId, chat.type === 'channel' ? 'subscriber' : 'member');
        if (chat.type === 'channel') bumpStat(this.db, 'channel_joins', chatId);
      });
      if (chat.type === 'group') this.systemMessage(chatId, userId, 'присоединился(-ась) к группе');
    }
    return this.get(userId, chatId);
  }

  /** Вступление по ссылке-приглашению (в том числе в закрытые группы и каналы). */
  joinByInvite(userId: string, chatId: string): ChatSummary {
    const chat = this.chat(chatId);
    if (chat.type !== 'channel' && chat.type !== 'group') throw badRequest('Приглашение недействительно');
    if (chat.space_id && !this.spaceGate(userId, chat)) throw forbidden('Сначала вступите в сообщество');
    this.assertNotBanned(chatId, userId);
    if (!this.member(chatId, userId)) {
      if (chat.member_count >= LIMITS.groupMembersMax) throw badRequest('Достигнут лимит участников');
      this.db.tx(() => {
        this.addMember(chatId, userId, chat.type === 'channel' ? 'subscriber' : 'member');
        if (chat.type === 'channel') bumpStat(this.db, 'channel_joins', chatId);
      });
      if (chat.type === 'group') this.systemMessage(chatId, userId, 'присоединился(-ась) по ссылке-приглашению');
      this.hub.sendToUser(userId, { t: 'chat.changed', chatId });
    }
    return this.get(userId, chatId);
  }

  /** Может ли пользователь писать в чат (для отложенных сообщений и приглашений). */
  assertCanPost(userId: string, chatId: string): { chat: ChatRow; member: MemberRow } {
    const { chat, member } = this.access(chatId, userId);
    if (!this.canPost(chat, member)) throw forbidden('В этом канале публикуют только администраторы');
    if (chat.type === 'secret') throw badRequest('В секретном чате это недоступно');
    return { chat, member };
  }

  /** Роль пользователя в чате (null — не участник). */
  roleIn(userId: string, chatId: string): ChatRole | null {
    return this.member(chatId, userId)?.role ?? null;
  }

  members(userId: string, chatId: string, cursor?: string, limit = 50): Paginated<ChatMember> {
    const { chat, member } = this.access(chatId, userId);
    if (chat.type === 'channel' && !this.isAdmin(member)) return { items: [], nextCursor: null };
    const offset = offsetCursor.decode(cursor);
    const rows = this.db.all<MemberRow>(
      `SELECT * FROM chat_members WHERE chat_id = :c
       ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, joined_at LIMIT :l OFFSET :o`,
      { c: chatId, l: limit + 1, o: offset },
    );
    const users = this.users.summaries(rows.map((r) => r.user_id));
    return {
      items: rows
        .slice(0, limit)
        .filter((r) => users.has(r.user_id))
        .map((r) => ({ user: users.get(r.user_id)!, role: r.role, joinedAt: iso(r.joined_at) })),
      nextCursor: offsetCursor.next(offset, rows.length, limit),
    };
  }

  addMembers(userId: string, chatId: string, userIds: string[]): { added: string[]; skipped: string[] } {
    const { chat, member } = this.access(chatId, userId);
    if (chat.type !== 'group' && chat.type !== 'channel') throw badRequest('В этот чат нельзя добавлять участников');
    if (!this.isAdmin(member) && chat.type === 'channel') throw forbidden();
    if (chat.member_count + userIds.length > LIMITS.groupMembersMax) throw badRequest('Достигнут лимит участников');
    const added: string[] = [];
    const skipped: string[] = [];
    this.db.tx(() => {
      for (const id of new Set(userIds)) {
        const u = this.users.byId(id);
        if (!u || this.member(chatId, id) || !this.policy.canMessage(userId, u)) {
          skipped.push(id);
          continue;
        }
        this.addMember(chatId, id, chat.type === 'channel' ? 'subscriber' : 'member');
        if (chat.type === 'channel') bumpStat(this.db, 'channel_joins', chatId);
        added.push(id);
      }
    });
    if (added.length && chat.type === 'group') {
      const names = [...this.users.summaries(added).values()].map((u) => u.displayName).join(', ');
      this.systemMessage(chatId, userId, `добавил(а) в группу: ${names}`);
    }
    for (const id of added) this.hub.sendToUser(id, { t: 'chat.changed', chatId });
    return { added, skipped };
  }

  removeMember(userId: string, chatId: string, targetId: string): void {
    if (targetId === userId) return this.leave(userId, chatId);
    const { chat, member } = this.access(chatId, userId);
    const target = this.member(chatId, targetId);
    if (!target) throw notFound('Участник не найден');
    if (!this.isAdmin(member) || target.role === 'owner' || (target.role === 'admin' && member.role !== 'owner')) throw forbidden();
    this.db.tx(() => {
      this.db.run('DELETE FROM chat_members WHERE chat_id = :c AND user_id = :u', { c: chatId, u: targetId });
      this.db.run('UPDATE chats SET member_count = member_count - 1 WHERE id = :id', { id: chatId });
      if (chat.type === 'channel') bumpStat(this.db, 'channel_leaves', chatId);
    });
    if (chat.type === 'group') {
      this.systemMessage(chatId, userId, `удалил(а) из группы: ${this.users.summary(targetId)?.displayName ?? 'участника'}`);
    }
    this.hub.sendToUser(targetId, { t: 'chat.removed', chatId });
  }

  setRole(userId: string, chatId: string, targetId: string, role: 'admin' | 'member'): void {
    const { chat, member } = this.access(chatId, userId);
    if (member.role !== 'owner') throw forbidden('Только владелец назначает администраторов');
    const target = this.member(chatId, targetId);
    if (!target || target.role === 'owner') throw notFound('Участник не найден');
    const newRole: ChatRole = chat.type === 'channel' && role === 'member' ? 'subscriber' : role;
    this.db.run('UPDATE chat_members SET role = :r WHERE chat_id = :c AND user_id = :u', { r: newRole, c: chatId, u: targetId });
    this.broadcastChanged(chatId);
  }

  discover(userId: string, q: string | undefined, limit = 30): ChatSummary[] {
    const rows = this.db.all<ChatRow>(
      `SELECT * FROM chats WHERE is_public = 1 AND deleted_at IS NULL AND space_id IS NULL AND type IN ('channel', 'group')
         AND (:q IS NULL OR title LIKE :like ESCAPE '\\' OR handle LIKE :like ESCAPE '\\')
       ORDER BY member_count DESC, created_at DESC LIMIT :limit`,
      { q: q ?? null, like: q ? `%${likeEscape(q)}%` : null, limit },
    );
    return rows.map((c) => this.summarize(c, this.member(c.id, userId) ?? null, userId));
  }

  // ─── Сообщения ────────────────────────────────────────────────────────────

  messages(userId: string, chatId: string, opts: { before?: number; after?: number; limit: number }): { items: Message[]; hasMore: boolean } {
    const chat = this.chat(chatId);
    const member = this.member(chatId, userId);
    if (!member && !this.canPreview(chat, userId)) throw notFound('Чат не найден');
    const cleared = member?.cleared_seq ?? 0;
    const params = { c: chatId, u: userId, cleared, limit: opts.limit + 1, before: opts.before ?? null, after: opts.after ?? null };
    const base = `FROM messages WHERE chat_id = :c AND deleted_at IS NULL AND seq > :cleared AND thread_root_id IS NULL
      AND NOT EXISTS (SELECT 1 FROM message_hidden h WHERE h.message_id = messages.id AND h.user_id = :u)`;
    let rows: MessageRow[];
    if (opts.after !== undefined) {
      rows = this.db.all<MessageRow>(`SELECT * ${base} AND seq > :after ORDER BY seq ASC LIMIT :limit`, params);
      const hasMore = rows.length > opts.limit;
      return { items: this.messagesRepo.toDto(rows.slice(0, opts.limit), userId), hasMore };
    }
    rows = this.db.all<MessageRow>(`SELECT * ${base} AND (:before IS NULL OR seq < :before) ORDER BY seq DESC LIMIT :limit`, params);
    const hasMore = rows.length > opts.limit;
    return { items: this.messagesRepo.toDto(rows.slice(0, opts.limit).reverse(), userId), hasMore };
  }

  send(userId: string, chatId: string, input: SendInput): Message {
    const { chat, member } = this.access(chatId, userId);
    if (!this.canPost(chat, member)) throw forbidden('В этом канале публикуют только администраторы');

    // Идемпотентность: повтор с тем же clientId возвращает уже созданное сообщение
    const dup = this.db.get<MessageRow>('SELECT * FROM messages WHERE sender_id = :u AND client_id = :cid', { u: userId, cid: input.clientId });
    if (dup) return this.messagesRepo.toDto([dup], userId)[0]!;

    if (chat.type === 'direct') {
      const peerId = this.memberIds(chatId).find((id) => id !== userId);
      if (peerId && this.policy.blockedEitherWay(userId, peerId)) throw blocked();
    }

    // Медленный режим: пауза между сообщениями обычного участника группы
    const now = Date.now();
    if (chat.slow_mode_sec > 0 && !this.isAdmin(member) && member.last_sent_at) {
      const wait = Math.ceil((member.last_sent_at + chat.slow_mode_sec * 1000 - now) / 1000);
      if (wait > 0) throw new AppError(429, ErrorCode.RateLimited, `Медленный режим: следующее сообщение через ${formatTtl(wait)}`, undefined, wait);
    }

    let kind: MessageRow['kind'] = 'text';
    let subtype: MessageRow['subtype'] = null;
    if (chat.type === 'secret') {
      if (!input.encrypted || input.text || input.mediaIds.length || input.poll || input.kind) {
        throw badRequest('В секретном чате принимаются только зашифрованные на устройстве сообщения');
      }
      const devices = JSON.parse(chat.secret_devices ?? '{}') as Record<string, string>;
      if (devices[userId] !== input.encrypted.senderDeviceId) throw forbidden('Секретный чат привязан к другому устройству');
      kind = 'encrypted';
    } else {
      if (input.encrypted) throw badRequest('Шифрованные сообщения допустимы только в секретных чатах');
      if (input.mediaIds.length) {
        const rows = this.media.assertOwned(userId, input.mediaIds);
        kind = 'media';
        if (input.kind) {
          // Голосовое — одна аудиодорожка, кружок — одно короткое видео
          const want = input.kind === 'voice' ? 'audio' : 'video';
          const max = input.kind === 'voice' ? LIMITS.voiceMaxSec : LIMITS.roundMaxSec;
          if (rows.length !== 1 || rows[0]!.kind !== want) throw badRequest(input.kind === 'voice' ? 'Голосовое сообщение — это одна аудиозапись' : 'Кружок — это одно видео');
          if ((rows[0]!.duration_sec ?? 0) > max + 1) throw badRequest(`Слишком длинная запись: максимум ${formatTtl(max)}`);
          subtype = input.kind;
        }
      } else if (input.kind) {
        throw badRequest('Нет записи для отправки');
      }
      if (input.poll) {
        if (chat.type !== 'group' && chat.type !== 'channel') throw badRequest('Опросы можно создавать в группах и каналах');
        if (input.mediaIds.length) throw badRequest('К опросу нельзя прикрепить файлы');
        subtype = 'poll';
      }
    }
    if (input.replyToId) {
      const reply = this.messagesRepo.byId(input.replyToId);
      if (!reply || reply.chat_id !== chatId) throw badRequest('Сообщение для ответа не найдено');
    }

    // Упоминания @имя — только участники группы (в канале и личке не нужны)
    const mentioned =
      chat.type === 'group' && input.text
        ? this.db
            .all<{ id: string }>(
              `SELECT u.id FROM users u JOIN chat_members m ON m.user_id = u.id AND m.chat_id = :c
               WHERE u.deleted_at IS NULL AND u.id != :me AND u.username IN (${extractMentions(input.text)
                 .slice(0, 20)
                 .map((_, i) => `:n${i}`)
                 .join(',') || "''"})`,
              { c: chatId, me: userId, ...Object.fromEntries(extractMentions(input.text).slice(0, 20).map((n, i) => [`n${i}`, n.toLowerCase()])) },
            )
            .map((r) => r.id)
        : [];

    const id = newId(now);
    const row = this.db.tx(() => {
      const { last_seq: seq } = this.db.get<{ last_seq: number }>(
        'UPDATE chats SET last_seq = last_seq + 1, last_message_id = :id, last_message_at = :now, updated_at = :now WHERE id = :c RETURNING last_seq',
        { id, now, c: chatId },
      )!;
      const pollId = input.poll ? this.polls.create(chatId, userId, input.poll) : null;
      const msg: MessageRow = {
        ...BLANK,
        id,
        chat_id: chatId,
        seq,
        sender_id: userId,
        client_id: input.clientId,
        kind,
        subtype,
        poll_id: pollId,
        silent: input.silent ? 1 : 0,
        text: input.poll ? input.poll.question : input.text || null,
        reply_to_id: input.replyToId ?? null,
        ciphertext: input.encrypted?.ciphertext ?? null,
        iv: input.encrypted?.iv ?? null,
        sender_device_id: input.encrypted?.senderDeviceId ?? null,
        expires_at: chat.ttl_seconds > 0 ? now + chat.ttl_seconds * 1000 : null,
        created_at: now,
      };
      this.insertMessage(msg, input.mediaIds);
      for (const uid of mentioned) {
        this.db.run('INSERT OR IGNORE INTO message_mentions (message_id, user_id, chat_id, seq) VALUES (:m, :u, :c, :s)', { m: id, u: uid, c: chatId, s: seq });
      }
      this.db.run('UPDATE chat_members SET last_read_seq = :seq, last_sent_at = :now WHERE chat_id = :c AND user_id = :u', { seq, now, c: chatId, u: userId });
      // Новое сообщение «возвращает» скрытый чат в список у всех участников
      this.db.run('UPDATE chat_members SET hidden = 0 WHERE chat_id = :c AND hidden = 1', { c: chatId });
      return msg;
    });
    const dto = this.publishNew(row, userId);
    for (const uid of mentioned) {
      this.notifications.notify({
        userId: uid,
        type: 'mention',
        actorId: userId,
        entityType: 'message',
        entityId: row.id,
        link: `/chats/${chatId}?m=${row.seq}`,
        preview: `в «${chat.title}»: ${input.text ?? ''}`,
      });
    }
    return dto;
  }

  private insertMessage(m: MessageRow, mediaIds: string[]): void {
    this.db.run(
      `INSERT INTO messages (id, chat_id, seq, sender_id, client_id, kind, subtype, poll_id, call_id, silent, text, reply_to_id,
         forward_from_chat_id, forward_sender_name, ciphertext, iv, sender_device_id, expires_at, created_at, thread_root_id)
       VALUES (:id, :chat_id, :seq, :sender_id, :client_id, :kind, :subtype, :poll_id, :call_id, :silent, :text, :reply_to_id,
         :forward_from_chat_id, :forward_sender_name, :ciphertext, :iv, :sender_device_id, :expires_at, :created_at, :thread_root_id)`,
      {
        id: m.id,
        thread_root_id: m.thread_root_id,
        subtype: m.subtype,
        poll_id: m.poll_id,
        call_id: m.call_id,
        silent: m.silent,
        chat_id: m.chat_id,
        seq: m.seq,
        sender_id: m.sender_id,
        client_id: m.client_id,
        kind: m.kind,
        text: m.text,
        reply_to_id: m.reply_to_id,
        forward_from_chat_id: m.forward_from_chat_id,
        forward_sender_name: m.forward_sender_name,
        ciphertext: m.ciphertext,
        iv: m.iv,
        sender_device_id: m.sender_device_id,
        expires_at: m.expires_at,
        created_at: m.created_at,
      },
    );
    mediaIds.forEach((mediaId, position) =>
      this.db.run('INSERT INTO message_media (message_id, media_id, position) VALUES (:m, :media, :p)', { m: m.id, media: mediaId, p: position }),
    );
  }

  private publishNew(row: MessageRow, actorId: string): Message {
    const ids = this.memberIds(row.chat_id);
    // DTO строится для каждого получателя отдельно (поле mine в реакциях, clientId)
    const forActor = this.messagesRepo.toDto([row], actorId)[0]!;
    for (const uid of ids) {
      const dto = uid === actorId ? forActor : { ...forActor, clientId: null };
      this.hub.sendToUser(uid, { t: 'message.new', chatId: row.chat_id, message: dto });
      if (uid !== actorId) this.notifications.pushCounters(uid);
    }
    return forActor;
  }

  systemMessage(chatId: string, actorId: string, text: string, extra: Partial<Pick<MessageRow, 'subtype' | 'call_id'>> = {}): void {
    const now = Date.now();
    const id = newId(now);
    const row = this.db.tx(() => {
      const { last_seq: seq } = this.db.get<{ last_seq: number }>(
        'UPDATE chats SET last_seq = last_seq + 1, last_message_id = :id, last_message_at = :now WHERE id = :c RETURNING last_seq',
        { id, now, c: chatId },
      )!;
      const msg: MessageRow = {
        ...BLANK,
        id,
        chat_id: chatId,
        seq,
        sender_id: actorId,
        client_id: null,
        kind: 'system',
        text,
        created_at: now,
        ...extra,
      };
      this.insertMessage(msg, []);
      this.db.run('UPDATE chat_members SET last_read_seq = max(last_read_seq, :seq) WHERE chat_id = :c AND user_id = :u', {
        seq,
        c: chatId,
        u: actorId,
      });
      return msg;
    });
    this.publishNew(row, actorId);
  }

  private ownMessage(userId: string, chatId: string, messageId: string): { chat: ChatRow; member: MemberRow; msg: MessageRow } {
    const { chat, member } = this.access(chatId, userId);
    const msg = this.messagesRepo.byId(messageId);
    if (!msg || msg.chat_id !== chatId || msg.deleted_at) throw notFound('Сообщение не найдено');
    return { chat, member, msg };
  }

  edit(userId: string, chatId: string, messageId: string, input: { text?: string; encrypted?: Message['encrypted'] }): Message {
    const { chat, msg } = this.ownMessage(userId, chatId, messageId);
    if (msg.sender_id !== userId || msg.kind === 'system') throw forbidden('Можно редактировать только свои сообщения');
    if (Date.now() - msg.created_at > EDIT_WINDOW_MS) throw forbidden('Сообщение можно редактировать в течение 48 часов');
    if (chat.type === 'secret') {
      if (!input.encrypted || input.encrypted.senderDeviceId !== msg.sender_device_id) throw badRequest('Нужен зашифрованный текст');
      this.db.run('UPDATE messages SET ciphertext = :ct, iv = :iv, edited_at = :now WHERE id = :id', {
        ct: input.encrypted.ciphertext,
        iv: input.encrypted.iv,
        now: Date.now(),
        id: messageId,
      });
    } else {
      if (!input.text) throw badRequest('Пустое сообщение');
      this.db.run('UPDATE messages SET text = :t, edited_at = :now WHERE id = :id', { t: input.text, now: Date.now(), id: messageId });
    }
    return this.publishUpdated(chatId, messageId, userId);
  }

  private publishUpdated(chatId: string, messageId: string, actorId: string): Message {
    const row = this.messagesRepo.byId(messageId)!;
    let actorDto: Message | null = null;
    for (const uid of this.memberIds(chatId)) {
      const dto = this.messagesRepo.toDto([row], uid)[0]!;
      if (uid === actorId) actorDto = dto;
      this.hub.sendToUser(uid, { t: 'message.updated', chatId, message: dto });
    }
    return actorDto ?? this.messagesRepo.toDto([row], actorId)[0]!;
  }

  deleteMessage(userId: string, chatId: string, messageId: string, forEveryone: boolean): void {
    const { chat, member, msg } = this.ownMessage(userId, chatId, messageId);
    const canDeleteForAll =
      chat.type === 'saved' ||
      msg.sender_id === userId ||
      ((chat.type === 'group' || chat.type === 'channel') && this.isAdmin(member));
    if (forEveryone || chat.type === 'channel' || chat.type === 'secret' || chat.type === 'saved') {
      if (!canDeleteForAll) throw forbidden('Можно удалить только свои сообщения');
      this.hardDelete(chatId, messageId);
      return;
    }
    this.db.run('INSERT OR IGNORE INTO message_hidden (message_id, user_id) VALUES (:m, :u)', { m: messageId, u: userId });
    this.hub.sendToUser(userId, { t: 'message.deleted', chatId, messageId });
  }

  private hardDelete(chatId: string, messageId: string): void {
    const root = this.db.value<string>('SELECT thread_root_id FROM messages WHERE id = :id AND deleted_at IS NULL', { id: messageId });
    this.db.tx(() => {
      if (root) this.db.run('UPDATE messages SET comment_count = max(0, comment_count - 1) WHERE id = :r', { r: root });
      // Содержимое стирается сразу, строка остаётся как «надгробие» для синхронизации
      this.db.run(
        'UPDATE messages SET deleted_at = :now, text = NULL, ciphertext = NULL, iv = NULL WHERE id = :id',
        { now: Date.now(), id: messageId },
      );
      this.db.run('DELETE FROM message_media WHERE message_id = :id', { id: messageId });
      this.db.run('DELETE FROM message_reactions WHERE message_id = :id', { id: messageId });
      this.db.run('DELETE FROM message_mentions WHERE message_id = :id', { id: messageId });
      this.db.run('UPDATE chats SET pinned_message_id = NULL WHERE id = :c AND pinned_message_id = :id', { c: chatId, id: messageId });
    });
    this.hub.sendToUsers(this.memberIds(chatId), { t: 'message.deleted', chatId, messageId });
  }

  react(userId: string, chatId: string, messageId: string, emoji: string): Message {
    const { chat, msg } = this.ownMessage(userId, chatId, messageId);
    if (msg.kind === 'system') throw badRequest('На системные сообщения нельзя реагировать');
    if (chat.type === 'channel' && !this.member(chatId, userId)) throw forbidden();
    const existing = this.db.get('SELECT 1 FROM message_reactions WHERE message_id = :m AND user_id = :u AND emoji = :e', {
      m: messageId,
      u: userId,
      e: emoji,
    });
    if (existing) {
      this.db.run('DELETE FROM message_reactions WHERE message_id = :m AND user_id = :u AND emoji = :e', { m: messageId, u: userId, e: emoji });
    } else {
      const mine = this.db.value<number>('SELECT COUNT(*) FROM message_reactions WHERE message_id = :m AND user_id = :u', {
        m: messageId,
        u: userId,
      })!;
      if (mine >= MAX_REACTIONS_PER_USER) {
        this.db.run(
          `DELETE FROM message_reactions WHERE rowid = (SELECT rowid FROM message_reactions WHERE message_id = :m AND user_id = :u ORDER BY created_at LIMIT 1)`,
          { m: messageId, u: userId },
        );
      }
      this.db.run('INSERT INTO message_reactions (message_id, user_id, emoji, created_at) VALUES (:m, :u, :e, :now)', {
        m: messageId,
        u: userId,
        e: emoji,
        now: Date.now(),
      });
    }
    return this.publishUpdated(chatId, messageId, userId);
  }

  forward(userId: string, chatId: string, messageId: string, toChatIds: string[]): Message[] {
    const { chat, msg } = this.ownMessage(userId, chatId, messageId);
    if (chat.type === 'secret' || msg.kind === 'encrypted' || msg.kind === 'system' || msg.subtype === 'poll' || msg.subtype === 'call') {
      throw forbidden('Это сообщение нельзя переслать');
    }
    const media = this.db
      .all<{ media_id: string }>('SELECT media_id FROM message_media WHERE message_id = :m ORDER BY position', { m: messageId })
      .map((r) => r.media_id);
    const senderName = msg.forward_sender_name ?? (chat.type === 'channel' ? chat.title : (this.users.summary(msg.sender_id ?? '')?.displayName ?? ''));
    const out: Message[] = [];
    for (const targetId of [...new Set(toChatIds)]) {
      const { chat: target, member } = this.access(targetId, userId);
      if (target.type === 'secret') throw badRequest('В секретный чат нельзя пересылать');
      if (!this.canPost(target, member)) throw forbidden();
      const now = Date.now();
      const id = newId(now);
      const row = this.db.tx(() => {
        const { last_seq: seq } = this.db.get<{ last_seq: number }>(
          'UPDATE chats SET last_seq = last_seq + 1, last_message_id = :id, last_message_at = :now WHERE id = :c RETURNING last_seq',
          { id, now, c: targetId },
        )!;
        const m: MessageRow = {
          ...msg,
          id,
          chat_id: targetId,
          seq,
          sender_id: userId,
          client_id: null,
          reply_to_id: null,
          forward_from_chat_id: bool(chat.is_public) ? chat.id : null,
          forward_sender_name: senderName,
          silent: 0,
          edited_at: null,
          expires_at: target.ttl_seconds > 0 ? now + target.ttl_seconds * 1000 : null,
          created_at: now,
        };
        this.insertMessage(m, media);
        this.db.run('UPDATE chat_members SET last_read_seq = :seq WHERE chat_id = :c AND user_id = :u', { seq, c: targetId, u: userId });
        this.db.run('UPDATE chat_members SET hidden = 0 WHERE chat_id = :c', { c: targetId });
        return m;
      });
      out.push(this.publishNew(row, userId));
    }
    return out;
  }

  read(userId: string, chatId: string, seq: number): void {
    const { chat, member } = this.access(chatId, userId);
    const target = Math.min(seq, chat.last_seq);
    if (target <= member.last_read_seq) return;
    this.db.run('UPDATE chat_members SET last_read_seq = :s WHERE chat_id = :c AND user_id = :u', { s: target, c: chatId, u: userId });
    this.notifications.pushCounters(userId);
    if (chat.type === 'channel') return;
    const me = this.users.byId(userId);
    if (me && !privacyOf(me).readReceipts && (chat.type === 'direct' || chat.type === 'secret')) return;
    this.hub.sendToUsers(this.memberIds(chatId), { t: 'read', chatId, userId, seq: target }, userId);
  }

  pin(userId: string, chatId: string, messageId: string | null): ChatSummary {
    const { chat, member } = this.access(chatId, userId);
    if ((chat.type === 'group' || chat.type === 'channel') && !this.isAdmin(member)) throw forbidden('Закреплять могут администраторы');
    if (messageId) {
      const msg = this.messagesRepo.byId(messageId);
      if (!msg || msg.chat_id !== chatId || msg.deleted_at) throw notFound('Сообщение не найдено');
    }
    this.db.run('UPDATE chats SET pinned_message_id = :m WHERE id = :c', { m: messageId, c: chatId });
    this.broadcastChanged(chatId);
    return this.get(userId, chatId);
  }

  search(userId: string, chatId: string, q: string, limit = 50): Message[] {
    const { chat, member } = this.access(chatId, userId);
    if (chat.type === 'secret') return []; // сервер не видит содержимое секретных чатов
    const rows = this.db.all<MessageRow>(
      `SELECT * FROM messages WHERE chat_id = :c AND deleted_at IS NULL AND seq > :cleared AND kind IN ('text', 'media')
         AND thread_root_id IS NULL AND text LIKE :q ESCAPE '\\'
       ORDER BY seq DESC LIMIT :limit`,
      { c: chatId, cleared: member.cleared_seq, q: `%${likeEscape(q)}%`, limit },
    );
    return this.messagesRepo.toDto(rows, userId);
  }

  sharedMedia(userId: string, chatId: string, cursor: string | undefined, limit = 60) {
    const { member } = this.access(chatId, userId);
    const offset = offsetCursor.decode(cursor);
    const rows = this.db.all<{ media_id: string; message_id: string }>(
      `SELECT mm.media_id, mm.message_id FROM message_media mm JOIN messages m ON m.id = mm.message_id
       WHERE m.chat_id = :c AND m.deleted_at IS NULL AND m.seq > :cleared
       ORDER BY m.seq DESC, mm.position LIMIT :l OFFSET :o`,
      { c: chatId, cleared: member.cleared_seq, l: limit + 1, o: offset },
    );
    const items = this.media.items(rows.map((r) => r.media_id));
    return {
      items: rows
        .slice(0, limit)
        .map((r) => ({ messageId: r.message_id, media: items.get(r.media_id) }))
        .filter((r) => r.media),
      nextCursor: offsetCursor.next(offset, rows.length, limit),
    };
  }

  typing(userId: string, chatId: string, activity: 'typing' | 'voice' | 'round' = 'typing'): void {
    const member = this.member(chatId, userId);
    if (!member || member.role === 'subscriber') return;
    const u = this.users.summary(userId);
    if (!u) return;
    this.hub.sendToUsers(this.memberIds(chatId), { t: 'typing', chatId, userId, displayName: u.displayName, activity }, userId);
  }

  // ─── Чаты внутри компаний и сообществ ──────────────────────────────────────

  /** Новый чат или канал пространства; участников расставляет SpacesService. */
  createSpaceRoom(
    ownerId: string,
    spaceId: string,
    input: { title: string; description: string; type: 'group' | 'channel'; isPublic: boolean; categoryId: string | null; position: number },
  ): string {
    return this.insertChat({
      type: input.type,
      title: input.title,
      description: input.description,
      owner_id: ownerId,
      is_public: input.isPublic ? 1 : 0,
      space_id: spaceId,
      space_category_id: input.categoryId,
      space_position: input.position,
    });
  }

  spaceRooms(spaceId: string): ChatRow[] {
    return this.db.all<ChatRow>('SELECT * FROM chats WHERE space_id = :s AND deleted_at IS NULL ORDER BY space_position, created_at', { s: spaceId });
  }

  /** Карточки чатов пространства для боковой панели: с непрочитанным для этого человека. */
  roomSummary(userId: string, chat: ChatRow): ChatSummary {
    return this.summarize(chat, this.member(chat.id, userId) ?? null, userId);
  }

  /**
   * Участие в чате пространства: роль или null (убрать). Возвращает true,
   * если что-то изменилось. Уведомления о составе шлёт вызывающий.
   */
  setSpaceMembership(chatId: string, userId: string, role: ChatRole | null): boolean {
    const current = this.member(chatId, userId);
    if (!role) {
      if (!current) return false;
      this.db.run('DELETE FROM chat_members WHERE chat_id = :c AND user_id = :u', { c: chatId, u: userId });
      this.db.run('UPDATE chats SET member_count = member_count - 1 WHERE id = :id', { id: chatId });
      this.hub.sendToUser(userId, { t: 'chat.removed', chatId });
      return true;
    }
    if (!current) {
      this.addMember(chatId, userId, role);
      return true;
    }
    if (current.role === role) return false;
    this.db.run('UPDATE chat_members SET role = :r WHERE chat_id = :c AND user_id = :u', { r: role, c: chatId, u: userId });
    return true;
  }

  updateSpaceRoom(chatId: string, patch: { categoryId?: string | null; position?: number }): void {
    this.db.run(
      `UPDATE chats SET space_category_id = CASE WHEN :setCat = 1 THEN :cat ELSE space_category_id END,
         space_position = coalesce(:pos, space_position), updated_at = :now WHERE id = :id`,
      { setCat: patch.categoryId !== undefined ? 1 : 0, cat: patch.categoryId ?? null, pos: patch.position ?? null, now: Date.now(), id: chatId },
    );
  }

  deleteSpaceRoom(chatId: string): void {
    const ids = this.memberIds(chatId);
    this.db.run('UPDATE chats SET deleted_at = :now WHERE id = :id', { now: Date.now(), id: chatId });
    this.hub.sendToUsers(ids, { t: 'chat.removed', chatId });
  }

  // ─── Каналы: комментарии, просмотры, баны ─────────────────────────────────

  /** Заблокирован ли пользователь в чате (бан действует до until или навсегда). */
  private bannedUntil(chatId: string, userId: string): number | null | undefined {
    const row = this.db.get<{ until: number | null }>(
      'SELECT until FROM chat_bans WHERE chat_id = :c AND user_id = :u AND (until IS NULL OR until > :now)',
      { c: chatId, u: userId, now: Date.now() },
    );
    return row ? row.until : undefined;
  }

  isBanned(chatId: string, userId: string): boolean {
    return this.bannedUntil(chatId, userId) !== undefined;
  }

  private assertNotBanned(chatId: string, userId: string): void {
    const until = this.bannedUntil(chatId, userId);
    if (until === undefined) return;
    throw forbidden(until ? `Вы заблокированы в этом чате до ${new Date(until).toLocaleDateString('ru-RU')}` : 'Вы заблокированы в этом чате');
  }

  /** Пост канала, к которому можно оставить комментарий. */
  private threadRoot(chatId: string, rootId: string): MessageRow {
    const root = this.messagesRepo.byId(rootId);
    if (!root || root.chat_id !== chatId || root.deleted_at || root.thread_root_id || root.kind === 'system') throw notFound('Пост не найден');
    return root;
  }

  /** Комментарий к посту: пишут подписчики, если владелец не выключил комментарии. */
  comment(userId: string, chatId: string, rootId: string, input: { clientId: string; text?: string; mediaIds: string[] }): Message {
    const { chat } = this.access(chatId, userId);
    if (chat.type !== 'channel') throw badRequest('Комментарии бывают только в каналах');
    if (!bool(chat.comments_enabled)) throw forbidden('Комментарии в этом канале выключены');
    this.assertNotBanned(chatId, userId);
    const root = this.threadRoot(chatId, rootId);
    const dup = this.db.get<MessageRow>('SELECT * FROM messages WHERE sender_id = :u AND client_id = :cid', { u: userId, cid: input.clientId });
    if (dup) return this.messagesRepo.toDto([dup], userId)[0]!;
    if (input.mediaIds.length) this.media.assertOwned(userId, input.mediaIds);
    const now = Date.now();
    const id = newId(now);
    const row = this.db.tx(() => {
      // seq общий с чатом, но последнее сообщение и непрочитанные не меняются
      const { last_seq: seq } = this.db.get<{ last_seq: number }>('UPDATE chats SET last_seq = last_seq + 1 WHERE id = :c RETURNING last_seq', { c: chatId })!;
      const msg: MessageRow = {
        ...BLANK,
        id,
        chat_id: chatId,
        seq,
        sender_id: userId,
        client_id: input.clientId,
        kind: input.mediaIds.length ? 'media' : 'text',
        text: input.text || null,
        thread_root_id: root.id,
        created_at: now,
      };
      this.insertMessage(msg, input.mediaIds);
      this.db.run('UPDATE messages SET comment_count = comment_count + 1 WHERE id = :id', { id: root.id });
      return msg;
    });
    const dto = this.messagesRepo.toDto([row], userId)[0]!;
    this.hub.sendToUsers(this.memberIds(chatId), { t: 'message.new', chatId, message: { ...dto, clientId: null } }, userId);
    if (root.sender_id && root.sender_id !== userId) {
      this.notifications.notify({
        userId: root.sender_id,
        type: 'reply',
        actorId: userId,
        entityType: 'message',
        entityId: row.id,
        link: `/channels/${chatId}?post=${root.id}`,
        preview: `в «${chat.title}»: ${input.text ?? 'вложение'}`,
      });
    }
    return dto;
  }

  comments(userId: string, chatId: string, rootId: string, opts: { after?: number; limit: number }): { root: Message; items: Message[]; hasMore: boolean } {
    const chat = this.chat(chatId);
    const member = this.member(chatId, userId);
    if (!member && !this.canPreview(chat, userId)) throw notFound('Чат не найден');
    const root = this.threadRoot(chatId, rootId);
    const rows = this.db.all<MessageRow>(
      `SELECT * FROM messages WHERE thread_root_id = :r AND deleted_at IS NULL AND seq > :after ORDER BY seq ASC LIMIT :limit`,
      { r: rootId, after: opts.after ?? 0, limit: opts.limit + 1 },
    );
    return {
      root: this.messagesRepo.toDto([root], userId)[0]!,
      items: this.messagesRepo.toDto(rows.slice(0, opts.limit), userId),
      hasMore: rows.length > opts.limit,
    };
  }

  /** Отметить посты канала просмотренными: каждый человек считается один раз. */
  markViews(userId: string, chatId: string, messageIds: string[]): Record<string, number> {
    const chat = this.chat(chatId);
    if (chat.type !== 'channel') return {};
    if (!this.member(chatId, userId) && !this.canPreview(chat, userId)) throw notFound('Чат не найден');
    const out: Record<string, number> = {};
    let fresh = 0;
    this.db.tx(() => {
      for (const mid of new Set(messageIds)) {
        const msg = this.messagesRepo.byId(mid);
        if (!msg || msg.chat_id !== chatId || msg.deleted_at || msg.thread_root_id || msg.kind === 'system') continue;
        const r = this.db.run('INSERT OR IGNORE INTO message_views (message_id, user_id, viewed_at) VALUES (:m, :u, :now)', {
          m: mid,
          u: userId,
          now: Date.now(),
        });
        if (r.changes) {
          fresh++;
          this.db.run('UPDATE messages SET view_count = view_count + 1 WHERE id = :id', { id: mid });
        }
        out[mid] = Math.max(1, (msg.view_count ?? 0) + (r.changes ? 1 : 0));
      }
      if (fresh) bumpStat(this.db, 'channel_views', chatId, fresh);
    });
    return out;
  }

  /** Заблокировать в группе или канале: человек исключается и не может вернуться до срока. */
  ban(userId: string, chatId: string, targetId: string, days: number): void {
    const { chat, member } = this.access(chatId, userId);
    if (chat.type !== 'group' && chat.type !== 'channel') throw badRequest('Блокировать можно только в группах и каналах');
    if (!this.isAdmin(member)) throw forbidden('Блокируют только администраторы');
    if (targetId === userId) throw badRequest('Нельзя заблокировать себя');
    const target = this.member(chatId, targetId);
    if (target && (target.role === 'owner' || (target.role === 'admin' && member.role !== 'owner'))) throw forbidden('Администратора может заблокировать только владелец');
    if (!this.users.byId(targetId)) throw notFound('Пользователь не найден');
    const now = Date.now();
    this.db.tx(() => {
      this.db.run(
        `INSERT INTO chat_bans (chat_id, user_id, banned_by, until, created_at) VALUES (:c, :u, :by, :until, :now)
         ON CONFLICT (chat_id, user_id) DO UPDATE SET banned_by = excluded.banned_by, until = excluded.until, created_at = excluded.created_at`,
        { c: chatId, u: targetId, by: userId, until: days ? now + days * 86400_000 : null, now },
      );
      if (target) {
        this.db.run('DELETE FROM chat_members WHERE chat_id = :c AND user_id = :u', { c: chatId, u: targetId });
        this.db.run('UPDATE chats SET member_count = member_count - 1 WHERE id = :id', { id: chatId });
        if (chat.type === 'channel') bumpStat(this.db, 'channel_leaves', chatId);
      }
    });
    if (target) {
      if (chat.type === 'group') this.systemMessage(chatId, userId, `заблокировал(а): ${this.users.summary(targetId)?.displayName ?? 'участника'}`);
      this.hub.sendToUser(targetId, { t: 'chat.removed', chatId });
    }
    this.broadcastChanged(chatId);
  }

  unban(userId: string, chatId: string, targetId: string): void {
    const { member } = this.access(chatId, userId);
    if (!this.isAdmin(member)) throw forbidden('Разблокируют только администраторы');
    this.db.run('DELETE FROM chat_bans WHERE chat_id = :c AND user_id = :u', { c: chatId, u: targetId });
  }

  bans(userId: string, chatId: string): ChatBan[] {
    const { member } = this.access(chatId, userId);
    if (!this.isAdmin(member)) throw forbidden();
    const rows = this.db.all<{ user_id: string; until: number | null; created_at: number }>(
      'SELECT user_id, until, created_at FROM chat_bans WHERE chat_id = :c AND (until IS NULL OR until > :now) ORDER BY created_at DESC LIMIT 500',
      { c: chatId, now: Date.now() },
    );
    const users = this.users.summaries(rows.map((r) => r.user_id));
    return rows
      .filter((r) => users.has(r.user_id))
      .map((r) => ({ user: users.get(r.user_id)!, until: r.until ? iso(r.until) : null, createdAt: iso(r.created_at) }));
  }

  // ─── Опросы ───────────────────────────────────────────────────────────────

  votePoll(userId: string, chatId: string, messageId: string, optionIds: string[]): Message {
    const { msg } = this.ownMessage(userId, chatId, messageId);
    if (msg.subtype !== 'poll' || !msg.poll_id) throw badRequest('Это не опрос');
    this.polls.vote(msg.poll_id, userId, optionIds);
    return this.publishUpdated(chatId, messageId, userId);
  }

  closePoll(userId: string, chatId: string, messageId: string): Message {
    const { member, msg } = this.ownMessage(userId, chatId, messageId);
    if (msg.subtype !== 'poll' || !msg.poll_id) throw badRequest('Это не опрос');
    if (msg.sender_id !== userId && !this.isAdmin(member)) throw forbidden('Завершить опрос может автор или администратор');
    this.polls.close(msg.poll_id);
    return this.publishUpdated(chatId, messageId, userId);
  }

  // ─── Кто прочитал (группы) ────────────────────────────────────────────────

  readers(userId: string, chatId: string, messageId: string): UserSummary[] {
    const { chat, msg } = this.ownMessage(userId, chatId, messageId);
    if (chat.type !== 'group' || chat.member_count > 100) return [];
    const ids = this.db
      .all<{ user_id: string }>(
        `SELECT user_id FROM chat_members WHERE chat_id = :c AND last_read_seq >= :s AND user_id != :sender ORDER BY joined_at`,
        { c: chatId, s: msg.seq, sender: msg.sender_id ?? '' },
      )
      .map((r) => r.user_id)
      // Кто выключил отчёты о прочтении — не показывается
      .filter((id) => {
        const u = this.users.byId(id);
        return !!u && privacyOf(u).readReceipts;
      });
    const users = this.users.summaries(ids);
    return ids.map((id) => users.get(id)).filter((u): u is UserSummary => !!u);
  }

  // ─── Поиск по всем перепискам ─────────────────────────────────────────────

  searchAll(userId: string, q: string, limit = 40): MessageSearchHit[] {
    const terms = q
      .replace(/["*^():{}[\]\\]/g, ' ')
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 8);
    if (!terms.length) return [];
    const match = terms.map((t) => `"${t}"*`).join(' ');
    const rows = this.db.all<MessageRow>(
      `SELECT m.* FROM messages_fts f
         JOIN messages m ON m.rowid = f.rowid
         JOIN chat_members cm ON cm.chat_id = m.chat_id AND cm.user_id = :u
         JOIN chats c ON c.id = m.chat_id
       WHERE messages_fts MATCH :q AND m.deleted_at IS NULL AND m.kind IN ('text', 'media') AND m.thread_root_id IS NULL
         AND c.deleted_at IS NULL AND c.type != 'secret' AND m.seq > cm.cleared_seq
         AND NOT EXISTS (SELECT 1 FROM message_hidden h WHERE h.message_id = m.id AND h.user_id = :u)
       ORDER BY m.created_at DESC LIMIT :limit`,
      { u: userId, q: match, limit },
    );
    const dtos = this.messagesRepo.toDto(rows, userId);
    const chats = new Map<string, MessageSearchHit['chat']>();
    for (const r of rows) {
      if (chats.has(r.chat_id)) continue;
      const c = this.get(userId, r.chat_id);
      chats.set(r.chat_id, { id: c.id, type: c.type, title: c.title, avatarUrl: c.avatarUrl });
    }
    return dtos.map((m) => ({ message: m, chat: chats.get(m.chatId)! }));
  }

  private broadcastChanged(chatId: string): void {
    this.hub.sendToUsers(this.memberIds(chatId), { t: 'chat.changed', chatId });
  }

  /** Удаляет сообщения с истёкшим таймером (секретные чаты и автоудаление). */
  sweepExpired(): number {
    const rows = this.db.all<{ id: string; chat_id: string }>(
      'SELECT id, chat_id FROM messages WHERE expires_at IS NOT NULL AND expires_at < :now AND deleted_at IS NULL LIMIT 500',
      { now: Date.now() },
    );
    for (const r of rows) this.hardDelete(r.chat_id, r.id);
    return rows.length;
  }

  /** Есть ли общий чат — используется при проверке доступа к профилю/присутствию. */
  shareChat(a: string, b: string): boolean {
    return !!this.db.get(
      `SELECT 1 FROM chat_members x JOIN chat_members y ON x.chat_id = y.chat_id WHERE x.user_id = :a AND y.user_id = :b LIMIT 1`,
      { a, b },
    );
  }

}

function formatTtl(sec: number): string {
  if (sec < 60) return `${sec} с`;
  if (sec < 3600) return `${sec / 60} мин`;
  if (sec < 86400) return `${sec / 3600} ч`;
  if (sec < 604800) return `${sec / 86400} дн`;
  return `${sec / 604800} нед`;
}
