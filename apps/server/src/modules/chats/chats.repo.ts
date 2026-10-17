import type { ChatRole, ChatType, Message, MessageKind, MessagePreview } from '@omni/shared';
import { excerpt } from '@omni/shared';
import type { Db } from '../../db/index.js';
import { Db as DbClass, iso, isoOrNull } from '../../db/index.js';
import type { CallsRepo } from '../calls/calls.repo.js';
import type { MediaService } from '../media/media.service.js';
import type { UsersRepo } from '../users/users.repo.js';
import type { PollsRepo } from './polls.repo.js';

export interface ChatRow {
  id: string;
  type: ChatType;
  title: string;
  description: string;
  avatar_media_id: string | null;
  owner_id: string | null;
  handle: string | null;
  is_public: number;
  direct_key: string | null;
  last_seq: number;
  last_message_id: string | null;
  last_message_at: number | null;
  pinned_message_id: string | null;
  comments_enabled: number;
  ttl_seconds: number;
  slow_mode_sec: number;
  secret_devices: string | null;
  member_count: number;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
}

export interface MemberRow {
  chat_id: string;
  user_id: string;
  role: ChatRole;
  joined_at: number;
  last_read_seq: number;
  cleared_seq: number;
  pinned: number;
  archived: number;
  muted_until: number | null;
  hidden: number;
  last_sent_at: number | null;
}

export interface MessageRow {
  id: string;
  chat_id: string;
  seq: number;
  sender_id: string | null;
  client_id: string | null;
  /** Колонка БД: text | media | system | encrypted; подвид — в subtype */
  kind: 'text' | 'media' | 'system' | 'encrypted';
  subtype: 'voice' | 'round' | 'poll' | 'call' | null;
  poll_id: string | null;
  call_id: string | null;
  silent: number;
  text: string | null;
  reply_to_id: string | null;
  forward_from_chat_id: string | null;
  forward_sender_name: string | null;
  ciphertext: string | null;
  iv: string | null;
  sender_device_id: string | null;
  edited_at: number | null;
  deleted_at: number | null;
  expires_at: number | null;
  created_at: number;
  thread_root_id: string | null;
  view_count: number;
  comment_count: number;
}

/** Загрузка и преобразование сообщений в DTO — пакетно, без N+1. */
export class MessagesRepo {
  constructor(
    private readonly db: Db,
    private readonly users: UsersRepo,
    private readonly media: MediaService,
    private readonly polls: PollsRepo,
    private readonly calls: CallsRepo,
  ) {}

  /** Вид сообщения для клиента: подвид важнее базового вида. */
  static kindOf(row: Pick<MessageRow, 'kind' | 'subtype'>): MessageKind {
    return row.subtype ?? row.kind;
  }

  byId(id: string): MessageRow | undefined {
    return this.db.get<MessageRow>('SELECT * FROM messages WHERE id = :id', { id });
  }

  preview(row: MessageRow | undefined | null, senderName?: string | null): MessagePreview | null {
    if (!row || row.deleted_at) return null;
    return {
      id: row.id,
      senderId: row.sender_id,
      senderName: senderName ?? (row.sender_id ? (this.users.summary(row.sender_id)?.displayName ?? null) : null),
      kind: MessagesRepo.kindOf(row),
      text: row.kind === 'encrypted' ? null : excerpt(row.text, 140) || null,
      createdAt: iso(row.created_at),
    };
  }

  toDto(rows: MessageRow[], viewerId: string): Message[] {
    if (rows.length === 0) return [];
    // Просмотры показываем только у постов каналов
    const chatTypes = new Map(
      this.db
        .all<{ id: string; type: string }>(`SELECT id, type FROM chats WHERE id IN (${DbClass.inList([...new Set(rows.map((r) => r.chat_id))], 'ct').sql})`, DbClass.inList([...new Set(rows.map((r) => r.chat_id))], 'ct').params)
        .map((c) => [c.id, c.type]),
    );
    const ids = rows.map((r) => r.id);
    const list = DbClass.inList(ids, 'm');
    const senders = this.users.summaries(rows.map((r) => r.sender_id));

    const mediaLinks = this.db.all<{ message_id: string; media_id: string }>(
      `SELECT message_id, media_id FROM message_media WHERE message_id IN (${list.sql}) ORDER BY position`,
      list.params,
    );
    const mediaItems = this.media.items(mediaLinks.map((l) => l.media_id));
    const mediaBy = new Map<string, string[]>();
    for (const l of mediaLinks) mediaBy.set(l.message_id, [...(mediaBy.get(l.message_id) ?? []), l.media_id]);

    const replyIds = [...new Set(rows.map((r) => r.reply_to_id).filter((v): v is string => !!v))];
    const replies = new Map<string, MessageRow>();
    if (replyIds.length) {
      const rl = DbClass.inList(replyIds, 'r');
      for (const r of this.db.all<MessageRow>(`SELECT * FROM messages WHERE id IN (${rl.sql})`, rl.params)) replies.set(r.id, r);
    }
    const replySenders = this.users.summaries([...replies.values()].map((r) => r.sender_id));

    const reactions = this.db.all<{ message_id: string; emoji: string; c: number; mine: number }>(
      `SELECT message_id, emoji, COUNT(*) AS c, MAX(user_id = :viewer) AS mine
       FROM message_reactions WHERE message_id IN (${list.sql})
       GROUP BY message_id, emoji ORDER BY MIN(created_at)`,
      { ...list.params, viewer: viewerId },
    );
    const reactionsBy = new Map<string, Message['reactions']>();
    for (const r of reactions) {
      reactionsBy.set(r.message_id, [...(reactionsBy.get(r.message_id) ?? []), { emoji: r.emoji, count: r.c, mine: r.mine === 1 }]);
    }

    const polls = this.polls.dtos(rows.map((r) => r.poll_id).filter((v): v is string => !!v), viewerId);
    const calls = this.calls.dtos(rows.map((r) => r.call_id).filter((v): v is string => !!v));

    return rows.map((r) => {
      const reply = r.reply_to_id ? replies.get(r.reply_to_id) : undefined;
      return {
        id: r.id,
        chatId: r.chat_id,
        seq: r.seq,
        clientId: r.sender_id === viewerId ? r.client_id : null,
        sender: r.sender_id ? (senders.get(r.sender_id) ?? null) : null,
        kind: MessagesRepo.kindOf(r),
        text: r.text,
        media: (mediaBy.get(r.id) ?? []).map((id) => mediaItems.get(id)).filter((m) => !!m),
        poll: r.poll_id ? (polls.get(r.poll_id) ?? null) : null,
        call: r.call_id ? (calls.get(r.call_id) ?? null) : null,
        silent: r.silent === 1,
        replyTo: reply ? this.preview(reply, reply.sender_id ? replySenders.get(reply.sender_id)?.displayName : null) : null,
        forwardedFrom: r.forward_sender_name ? { chatId: r.forward_from_chat_id, senderName: r.forward_sender_name } : null,
        reactions: reactionsBy.get(r.id) ?? [],
        encrypted:
          r.kind === 'encrypted' && r.ciphertext && r.iv && r.sender_device_id
            ? { ciphertext: r.ciphertext, iv: r.iv, senderDeviceId: r.sender_device_id }
            : null,
        editedAt: isoOrNull(r.edited_at),
        deletedAt: isoOrNull(r.deleted_at),
        expiresAt: isoOrNull(r.expires_at),
        createdAt: iso(r.created_at),
        threadRootId: r.thread_root_id ?? null,
        viewCount: chatTypes.get(r.chat_id) === 'channel' && !r.thread_root_id ? Math.max(1, r.view_count ?? 0) : null,
        commentCount: r.comment_count ?? 0,
      };
    });
  }
}
