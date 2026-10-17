/**
 * Отложенные сообщения: хранятся отдельно и отправляются фоновой задачей
 * в назначенное время от имени автора (с теми же проверками, что и обычная отправка).
 */
import type { ScheduledMessage } from '@omni/shared';
import { LIMITS } from '@omni/shared';
import type { Db } from '../../db/index.js';
import { bool, iso } from '../../db/index.js';
import { badRequest, notFound } from '../../lib/errors.js';
import { newId } from '../../lib/ids.js';
import type { MediaService } from '../media/media.service.js';
import type { ChatsService } from './chats.service.js';

interface ScheduledRow {
  id: string;
  chat_id: string;
  sender_id: string;
  text: string | null;
  media_ids: string;
  reply_to_id: string | null;
  silent: number;
  send_at: number;
  created_at: number;
}

const MAX_AHEAD_MS = 365 * 86400_000;

export class ScheduledService {
  constructor(
    private readonly db: Db,
    private readonly chats: ChatsService,
    private readonly media: MediaService,
  ) {}

  private mediaIds(r: ScheduledRow): string[] {
    try {
      const v: unknown = JSON.parse(r.media_ids);
      return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
    } catch {
      return [];
    }
  }

  private toDto(r: ScheduledRow): ScheduledMessage {
    const ids = this.mediaIds(r);
    const items = this.media.items(ids);
    return {
      id: r.id,
      chatId: r.chat_id,
      text: r.text,
      media: ids.map((id) => items.get(id)).filter((m) => !!m),
      kind: ids.length ? 'media' : 'text',
      silent: bool(r.silent),
      sendAt: iso(r.send_at),
      createdAt: iso(r.created_at),
    };
  }

  schedule(userId: string, chatId: string, input: { text?: string; mediaIds: string[]; replyToId?: string; silent: boolean; sendAt: string }): ScheduledMessage {
    this.chats.assertCanPost(userId, chatId);
    if (!input.text && !input.mediaIds.length) throw badRequest('Пустое сообщение', { text: 'Пустое сообщение' });
    const sendAt = Date.parse(input.sendAt);
    const now = Date.now();
    if (sendAt < now + 30_000) throw badRequest('Выберите время хотя бы через минуту', { sendAt: 'Время уже прошло' });
    if (sendAt > now + MAX_AHEAD_MS) throw badRequest('Не позднее чем через год', { sendAt: 'Слишком далеко' });
    if (input.mediaIds.length) this.media.assertOwned(userId, input.mediaIds);
    const count = this.db.value<number>('SELECT COUNT(*) FROM scheduled_messages WHERE sender_id = :u', { u: userId }) ?? 0;
    if (count >= LIMITS.scheduledMax) throw badRequest(`Не больше ${LIMITS.scheduledMax} отложенных сообщений`);
    const row: ScheduledRow = {
      id: newId(now),
      chat_id: chatId,
      sender_id: userId,
      text: input.text || null,
      media_ids: JSON.stringify(input.mediaIds),
      reply_to_id: input.replyToId ?? null,
      silent: input.silent ? 1 : 0,
      send_at: sendAt,
      created_at: now,
    };
    this.db.run(
      `INSERT INTO scheduled_messages (id, chat_id, sender_id, text, media_ids, reply_to_id, silent, send_at, created_at)
       VALUES (:id, :chat_id, :sender_id, :text, :media_ids, :reply_to_id, :silent, :send_at, :created_at)`,
      { ...row },
    );
    return this.toDto(row);
  }

  list(userId: string, chatId: string): ScheduledMessage[] {
    return this.db
      .all<ScheduledRow>('SELECT * FROM scheduled_messages WHERE chat_id = :c AND sender_id = :u ORDER BY send_at', { c: chatId, u: userId })
      .map((r) => this.toDto(r));
  }

  remove(userId: string, chatId: string, id: string): void {
    const r = this.db.run('DELETE FROM scheduled_messages WHERE id = :id AND chat_id = :c AND sender_id = :u', { id, c: chatId, u: userId });
    if (!r.changes) throw notFound('Сообщение не найдено');
  }

  sendNow(userId: string, chatId: string, id: string) {
    const r = this.db.get<ScheduledRow>('SELECT * FROM scheduled_messages WHERE id = :id AND chat_id = :c AND sender_id = :u', { id, c: chatId, u: userId });
    if (!r) throw notFound('Сообщение не найдено');
    return this.deliver(r);
  }

  private deliver(r: ScheduledRow) {
    this.db.run('DELETE FROM scheduled_messages WHERE id = :id', { id: r.id });
    return this.chats.send(r.sender_id, r.chat_id, {
      clientId: `sched-${r.id}`,
      text: r.text ?? undefined,
      mediaIds: this.mediaIds(r),
      replyToId: r.reply_to_id ?? undefined,
      silent: bool(r.silent),
    });
  }

  /** Фоновая задача: отправить всё, что пора. Ошибки (автор покинул чат и т. п.) не мешают остальным. */
  sendDue(onError: (err: unknown) => void): number {
    const due = this.db.all<ScheduledRow>('SELECT * FROM scheduled_messages WHERE send_at <= :now ORDER BY send_at LIMIT 100', { now: Date.now() });
    for (const r of due) {
      try {
        this.deliver(r);
      } catch (err) {
        onError(err);
      }
    }
    return due.length;
  }
}
