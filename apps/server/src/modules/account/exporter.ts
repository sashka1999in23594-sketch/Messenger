/** Экспорт данных пользователя (GDPR / 152-ФЗ: право получить копию своих данных). */
import type { Db } from '../../db/index.js';
import { iso } from '../../db/index.js';
import type { UsersService } from '../users/users.service.js';

export class AccountExporter {
  constructor(
    private readonly db: Db,
    private readonly users: UsersService,
  ) {}

  export(userId: string) {
    const ts = (rows: Record<string, unknown>[]) =>
      rows.map((r) =>
        Object.fromEntries(
          Object.entries(r).map(([k, v]) => [k, k.endsWith('_at') && typeof v === 'number' ? iso(v) : v]),
        ),
      );
    return {
      exportedAt: new Date().toISOString(),
      profile: this.users.me(userId),
      posts: ts(this.db.all('SELECT id, kind, title, text, visibility, created_at, edited_at FROM posts WHERE author_id = :u AND deleted_at IS NULL', { u: userId })),
      comments: ts(this.db.all('SELECT id, post_id, text, created_at FROM comments WHERE author_id = :u AND deleted_at IS NULL', { u: userId })),
      following: this.db.all("SELECT followee_id AS userId FROM follows WHERE follower_id = :u AND status = 'accepted'", { u: userId }),
      followers: this.db.all("SELECT follower_id AS userId FROM follows WHERE followee_id = :u AND status = 'accepted'", { u: userId }),
      chats: this.db.all('SELECT chat_id AS chatId, role FROM chat_members WHERE user_id = :u', { u: userId }),
      // Содержимое секретных чатов сервер не знает — экспортируются только облачные сообщения
      messages: ts(
        this.db.all(
          "SELECT id, chat_id, text, created_at FROM messages WHERE sender_id = :u AND deleted_at IS NULL AND kind IN ('text', 'media') LIMIT 50000",
          { u: userId },
        ),
      ),
      bookmarks: this.db.all('SELECT post_id AS postId FROM bookmarks WHERE user_id = :u', { u: userId }),
      securityEvents: ts(this.db.all('SELECT type, ip, user_agent, created_at FROM security_events WHERE user_id = :u ORDER BY created_at DESC LIMIT 1000', { u: userId })),
    };
  }
}
