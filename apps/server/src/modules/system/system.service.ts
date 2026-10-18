/**
 * Служебный аккаунт SpaceUp и его чат у каждого пользователя. Сюда приходят
 * коды входа (с устройством и IP), поздравления и новости об обновлениях.
 * Чат нельзя удалить или покинуть, писать в него может только сам SpaceUp
 * (ограничения — в ChatsService и UsersService).
 */
import { SYSTEM_USER_ID } from '@omni/shared';
import type { Db } from '../../db/index.js';
import { newId } from '../../lib/ids.js';
import type { ChatsService } from '../chats/chats.service.js';

export class SystemService {
  /** Пользователи, у которых чат уже проверен в этом процессе */
  private readonly ensured = new Set<string>();

  constructor(
    private readonly db: Db,
    private readonly chats: ChatsService,
  ) {
    this.ensureUser();
  }

  /** Создаёт служебный аккаунт, если его ещё нет (войти в него нельзя: пароля нет). */
  private ensureUser(): void {
    if (this.db.get('SELECT 1 FROM users WHERE id = :id', { id: SYSTEM_USER_ID })) return;
    const now = Date.now();
    // Имя «spaceup» могли занять до появления служебного аккаунта — тогда берём запасное
    const taken = this.db.get('SELECT 1 FROM users WHERE username = :u', { u: 'spaceup' });
    this.db.run(
      `INSERT INTO users (id, username, display_name, password_hash, verified, is_system, searchable, bio, created_at, updated_at, onboarded_at)
       VALUES (:id, :username, 'SpaceUp', '!', 1, 1, 0, 'Служебный чат: коды входа и новости SpaceUp', :now, :now, :now)`,
      { id: SYSTEM_USER_ID, username: taken ? 'spaceup_official' : 'spaceup', now },
    );
  }

  /** Чат пользователя со SpaceUp (создаётся при первом обращении). */
  chatId(userId: string): string {
    const key = [SYSTEM_USER_ID, userId].sort().join(':');
    const existing = this.db.get<{ id: string }>('SELECT id FROM chats WHERE direct_key = :k', { k: key });
    if (existing) {
      if (!this.ensured.has(userId)) {
        this.db.run('UPDATE chat_members SET hidden = 0 WHERE chat_id = :c AND user_id = :u', { c: existing.id, u: userId });
        this.ensured.add(userId);
      }
      return existing.id;
    }
    const now = Date.now();
    const chatId = newId(now);
    this.db.tx(() => {
      this.db.run(
        `INSERT INTO chats (id, type, owner_id, direct_key, member_count, created_at, updated_at)
         VALUES (:id, 'direct', :sys, :key, 2, :now, :now)`,
        { id: chatId, sys: SYSTEM_USER_ID, key, now },
      );
      for (const member of [SYSTEM_USER_ID, userId]) {
        this.db.run(
          `INSERT INTO chat_members (chat_id, user_id, role, joined_at, hidden) VALUES (:c, :u, 'member', :now, :hidden)`,
          { c: chatId, u: member, now, hidden: member === SYSTEM_USER_ID ? 1 : 0 },
        );
      }
    });
    this.ensured.add(userId);
    return chatId;
  }

  /** Сообщение от SpaceUp в чат пользователя. */
  post(userId: string, text: string): void {
    this.chats.send(SYSTEM_USER_ID, this.chatId(userId), { clientId: newId(), text, mediaIds: [], silent: false });
  }

  /** Есть ли у пользователя активные сеансы — значит, код из чата SpaceUp ему доступен. */
  hasActiveSessions(userId: string): boolean {
    return !!this.db.get('SELECT 1 FROM sessions WHERE user_id = :u AND revoked_at IS NULL AND expires_at > :now LIMIT 1', {
      u: userId,
      now: Date.now(),
    });
  }
}
