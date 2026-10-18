/**
 * Дни рождения: в свой день человек получает письмо и поздравление в чате
 * SpaceUp, а подписчики и те, с кем он переписывался, — уведомление, чтобы
 * поздравить. Поздравляем раз в год, не раньше 9 утра по Москве.
 */
import type { Db } from '../../db/index.js';
import type { MailService } from '../mail/mail.service.js';
import { templates } from '../mail/templates.js';
import type { NotificationService } from '../notifications/notifications.service.js';
import type { UserRow } from '../users/users.repo.js';
import { birthdayKey, isBirthdayToday } from '../users/users.service.js';
import type { SystemService } from './system.service.js';

const BATCH = 200;
const CONTACTS_MAX = 500;
const GREET_FROM_HOUR = 9;

const moscow = (now: Date, part: 'year' | 'hour') =>
  Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Moscow', [part]: 'numeric', hourCycle: 'h23' }).format(now));

export class Birthdays {
  constructor(
    private readonly db: Db,
    private readonly system: SystemService,
    private readonly notifications: NotificationService,
    private readonly mail: MailService,
    private readonly origin: string,
  ) {}

  /** Поздравляет всех, у кого сегодня день рождения и кого ещё не поздравили. Возвращает число поздравленных. */
  run(now = new Date()): number {
    if (moscow(now, 'hour') < GREET_FROM_HOUR) return 0;
    const year = moscow(now, 'year');
    const today = birthdayKey(now);
    // 29 февраля в невисокосный год поздравляем 28-го
    const keys = today === '02-28' ? ['02-28', '02-29'] : [today];
    const rows = this.db.all<UserRow>(
      `SELECT * FROM users
       WHERE birth_date IS NOT NULL AND substr(birth_date, 6) IN (:a, :b) AND deleted_at IS NULL AND is_system = 0
         AND (birthday_greeted_year IS NULL OR birthday_greeted_year < :year)
       LIMIT ${BATCH}`,
      { a: keys[0], b: keys[1] ?? keys[0], year },
    );
    let greeted = 0;
    for (const user of rows) {
      if (!isBirthdayToday(user.birth_date, now)) continue;
      // Сначала отмечаем — даже при сбое письма повторного поздравления не будет
      this.db.run('UPDATE users SET birthday_greeted_year = :year WHERE id = :id', { year, id: user.id });
      this.greet(user);
      greeted++;
    }
    return greeted;
  }

  private greet(user: UserRow): void {
    const name = user.display_name;
    this.system.post(
      user.id,
      `🎉 ${name}, с днём рождения!\n\nКоманда SpaceUp от всей души поздравляет вас. Пусть этот год будет ярким, тёплым и полным хороших новостей! 🎂`,
    );
    if (user.email && user.email_verified_at && this.mail.enabled) {
      this.mail.queue(templates.birthday(user.email, name, this.origin));
    }
    for (const contactId of this.contacts(user.id)) {
      this.notifications.notify({
        userId: contactId,
        type: 'birthday',
        actorId: user.id,
        entityType: 'user',
        entityId: user.id,
        link: `/u/${user.username}`,
        preview: `Сегодня день рождения у ${name} — поздравьте! 🎂`,
      });
    }
  }

  /** Подписчики и собеседники по личным чатам (без служебного аккаунта). */
  private contacts(userId: string): string[] {
    return this.db
      .all<{ id: string }>(
        `SELECT follower_id AS id FROM follows WHERE followee_id = :u AND status = 'accepted'
         UNION
         SELECT m2.user_id AS id FROM chat_members m1
           JOIN chats c ON c.id = m1.chat_id AND c.type IN ('direct', 'secret') AND c.deleted_at IS NULL AND c.last_message_id IS NOT NULL
           JOIN chat_members m2 ON m2.chat_id = m1.chat_id AND m2.user_id != m1.user_id
         WHERE m1.user_id = :u
         LIMIT ${CONTACTS_MAX}`,
        { u: userId },
      )
      .map((r) => r.id)
      .filter((id) => id !== userId && !this.isSystem(id));
  }

  private isSystem(id: string): boolean {
    return !!this.db.get('SELECT 1 FROM users WHERE id = :id AND is_system = 1', { id });
  }
}
