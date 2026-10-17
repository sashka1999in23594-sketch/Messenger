/**
 * Ссылки-приглашения в группы и каналы (в том числе закрытые): срок действия,
 * лимит использований, отзыв. Создают и видят ссылки только администраторы.
 */
import type { ChatInvite, ChatSummary, InvitePreview } from '@omni/shared';
import type { Db } from '../../db/index.js';
import { iso, isoOrNull } from '../../db/index.js';
import { badRequest, forbidden, notFound } from '../../lib/errors.js';
import { randomToken } from '../../lib/crypto.js';
import type { MediaService } from '../media/media.service.js';
import type { UsersRepo } from '../users/users.repo.js';
import type { ChatRow } from './chats.repo.js';
import type { ChatsService } from './chats.service.js';

interface InviteRow {
  token: string;
  chat_id: string;
  creator_id: string | null;
  title: string;
  expires_at: number | null;
  usage_limit: number | null;
  uses: number;
  revoked_at: number | null;
  created_at: number;
}

export class InvitesService {
  constructor(
    private readonly db: Db,
    private readonly chats: ChatsService,
    private readonly users: UsersRepo,
    private readonly media: MediaService,
    private readonly origin: string,
  ) {}

  private assertAdmin(userId: string, chatId: string): void {
    const role = this.chats.roleIn(userId, chatId);
    if (role !== 'owner' && role !== 'admin') throw forbidden('Ссылками-приглашениями управляют администраторы');
  }

  private toDto(r: InviteRow): ChatInvite {
    return {
      token: r.token,
      url: `${this.origin}/join/${r.token}`,
      title: r.title,
      creator: r.creator_id ? (this.users.summary(r.creator_id) ?? null) : null,
      expiresAt: isoOrNull(r.expires_at),
      usageLimit: r.usage_limit,
      uses: r.uses,
      revoked: !!r.revoked_at,
      createdAt: iso(r.created_at),
    };
  }

  private valid(r: InviteRow | undefined): r is InviteRow {
    return !!r && !r.revoked_at && (!r.expires_at || r.expires_at > Date.now()) && (!r.usage_limit || r.uses < r.usage_limit);
  }

  create(userId: string, chatId: string, input: { title: string; expiresInHours: number; usageLimit: number }): ChatInvite {
    const chat = this.chats.get(userId, chatId);
    if (chat.type !== 'group' && chat.type !== 'channel') throw badRequest('Приглашения бывают только в группы и каналы');
    this.assertAdmin(userId, chatId);
    const active = this.db.value<number>('SELECT COUNT(*) FROM chat_invites WHERE chat_id = :c AND revoked_at IS NULL', { c: chatId }) ?? 0;
    if (active >= 50) throw badRequest('Слишком много активных ссылок — отзовите ненужные');
    const now = Date.now();
    const row: InviteRow = {
      token: randomToken(12),
      chat_id: chatId,
      creator_id: userId,
      title: input.title,
      expires_at: input.expiresInHours ? now + input.expiresInHours * 3600_000 : null,
      usage_limit: input.usageLimit || null,
      uses: 0,
      revoked_at: null,
      created_at: now,
    };
    this.db.run(
      `INSERT INTO chat_invites (token, chat_id, creator_id, title, expires_at, usage_limit, created_at)
       VALUES (:token, :chat_id, :creator_id, :title, :expires_at, :usage_limit, :created_at)`,
      { ...row },
    );
    return this.toDto(row);
  }

  list(userId: string, chatId: string): ChatInvite[] {
    this.assertAdmin(userId, chatId);
    return this.db
      .all<InviteRow>('SELECT * FROM chat_invites WHERE chat_id = :c ORDER BY revoked_at IS NOT NULL, created_at DESC LIMIT 100', { c: chatId })
      .map((r) => this.toDto(r));
  }

  revoke(userId: string, chatId: string, token: string): void {
    this.assertAdmin(userId, chatId);
    const r = this.db.run('UPDATE chat_invites SET revoked_at = :now WHERE token = :t AND chat_id = :c AND revoked_at IS NULL', { now: Date.now(), t: token, c: chatId });
    if (!r.changes) throw notFound('Ссылка не найдена');
  }

  /** Предпросмотр по ссылке: название, описание, число участников. */
  preview(userId: string, token: string): InvitePreview {
    const inv = this.db.get<InviteRow>('SELECT * FROM chat_invites WHERE token = :t', { t: token });
    if (!this.valid(inv)) throw notFound('Ссылка недействительна или устарела');
    const chat = this.db.get<ChatRow>('SELECT * FROM chats WHERE id = :id AND deleted_at IS NULL', { id: inv.chat_id });
    if (!chat) throw notFound('Ссылка недействительна или устарела');
    return {
      token,
      chat: {
        id: chat.id,
        type: chat.type,
        title: chat.title,
        description: chat.description,
        avatarUrl: this.media.url(chat.avatar_media_id),
        memberCount: chat.member_count,
      },
      isMember: !!this.chats.roleIn(userId, chat.id),
    };
  }

  join(userId: string, token: string): ChatSummary {
    const inv = this.db.get<InviteRow>('SELECT * FROM chat_invites WHERE token = :t', { t: token });
    if (!this.valid(inv)) throw notFound('Ссылка недействительна или устарела');
    if (this.chats.roleIn(userId, inv.chat_id)) return this.chats.get(userId, inv.chat_id);
    const summary = this.chats.joinByInvite(userId, inv.chat_id);
    this.db.run('UPDATE chat_invites SET uses = uses + 1 WHERE token = :t', { t: token });
    return summary;
  }
}
