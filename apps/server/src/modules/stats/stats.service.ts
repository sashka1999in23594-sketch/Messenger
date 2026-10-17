/**
 * Статистика: рост подписчиков, просмотры профиля, каналы и звонки.
 *
 * Ряды строятся от текущего значения назад по дневным счётчикам (stat_daily):
 * подписчиков на конец дня d−1 = на конец дня d − пришло(d) + ушло(d).
 * Так график честно опускается при отписках, а последняя точка всегда
 * совпадает с числом в профиле.
 */
import type { ChannelPostStat, ChannelStats, ChannelStatsDetails, StatsOverview } from '@omni/shared';
import type { Db } from '../../db/index.js';
import { iso } from '../../db/index.js';
import { forbidden, notFound } from '../../lib/errors.js';
import type { MediaService } from '../media/media.service.js';
import { dayKey, type StatMetric } from './daily.js';

const DAY = 86_400_000;

export class StatsService {
  constructor(
    private readonly db: Db,
    private readonly media: MediaService,
  ) {}

  /** Последние n дней, включая сегодня. */
  private days(n: number, endOffset = 0): string[] {
    const today = Date.now() - endOffset * DAY;
    return Array.from({ length: n }, (_, i) => dayKey(today - (n - 1 - i) * DAY));
  }

  private daily(metric: StatMetric, entityId: string, days: string[]): number[] {
    const rows = this.db.all<{ day: string; value: number }>(
      'SELECT day, value FROM stat_daily WHERE metric = :m AND entity_id = :e AND day >= :from AND day <= :to',
      { m: metric, e: entityId, from: days[0]!, to: days.at(-1)! },
    );
    const map = new Map(rows.map((r) => [r.day, r.value]));
    return days.map((d) => map.get(d) ?? 0);
  }

  /** Значение на конец каждого дня, восстановленное от текущего. */
  private walkBack(current: number, gained: number[], lost: number[]): number[] {
    const out = new Array<number>(gained.length);
    let v = current;
    for (let i = gained.length - 1; i >= 0; i--) {
      out[i] = Math.max(0, v);
      v = v - gained[i]! + lost[i]!;
    }
    return out;
  }

  private channel(chatId: string, role: string, days: string[]): ChannelStats {
    const chat = this.db.get<{ id: string; title: string; avatar_media_id: string | null; handle: string | null; member_count: number }>(
      'SELECT id, title, avatar_media_id, handle, member_count FROM chats WHERE id = :id',
      { id: chatId },
    )!;
    const joins = this.daily('channel_joins', chatId, days);
    const leaves = this.daily('channel_leaves', chatId, days);
    const from = Date.parse(`${days[0]}T00:00:00Z`);
    return {
      chat: {
        id: chat.id,
        title: chat.title,
        avatarUrl: this.media.url(chat.avatar_media_id),
        handle: chat.handle,
        memberCount: chat.member_count,
        role: role as ChannelStats['chat']['role'],
      },
      subscribers: this.walkBack(chat.member_count, joins, leaves),
      joins,
      leaves,
      views: this.daily('channel_views', chatId, days),
      posts:
        this.db.value<number>(
          "SELECT COUNT(*) FROM messages WHERE chat_id = :c AND thread_root_id IS NULL AND deleted_at IS NULL AND kind != 'system' AND created_at >= :from",
          { c: chatId, from },
        ) ?? 0,
    };
  }

  overview(userId: string, range: number): StatsOverview {
    const days = this.days(range);
    const followersNow =
      this.db.value<number>("SELECT COUNT(*) FROM follows WHERE followee_id = :u AND status = 'accepted'", { u: userId }) ?? 0;
    const gained = this.daily('followers_gained', userId, days);
    const lost = this.daily('followers_lost', userId, days);
    const views = this.daily('profile_views', userId, days);
    const previous = this.daily('profile_views', userId, this.days(range, range));
    // Каналы, где вы владелец или администратор
    const owned = this.db.all<{ chat_id: string; role: string }>(
      `SELECT m.chat_id, m.role FROM chat_members m JOIN chats c ON c.id = m.chat_id
       WHERE m.user_id = :u AND m.role IN ('owner', 'admin') AND c.type = 'channel' AND c.deleted_at IS NULL
       ORDER BY c.member_count DESC LIMIT 20`,
      { u: userId },
    );
    const from = Date.parse(`${days[0]}T00:00:00Z`);
    const calls = this.db.all<{ created_at: number; status: string; caller_id: string; answered_at: number | null; ended_at: number | null }>(
      'SELECT created_at, status, caller_id, answered_at, ended_at FROM calls WHERE (caller_id = :u OR callee_id = :u) AND created_at >= :from',
      { u: userId, from },
    );
    const perDay = days.map(() => 0);
    let minutes = 0;
    let missed = 0;
    for (const c of calls) {
      const idx = days.indexOf(dayKey(c.created_at));
      if (idx >= 0) perDay[idx]!++;
      if (c.answered_at && c.ended_at) minutes += (c.ended_at - c.answered_at) / 60_000;
      if (c.caller_id !== userId && (c.status === 'missed' || c.status === 'cancelled')) missed++;
    }
    return {
      days,
      followers: { total: followersNow, series: this.walkBack(followersNow, gained, lost), gained, lost },
      profileViews: { series: views, total: views.reduce((a, b) => a + b, 0), previousTotal: previous.reduce((a, b) => a + b, 0) },
      channels: owned.map((o) => this.channel(o.chat_id, o.role, days)),
      calls: { total: calls.length, missed, minutes: Math.round(minutes), perDay },
    };
  }

  /** Подробно об одном канале — только владельцу и администраторам. */
  channelDetails(userId: string, chatId: string, range: number): ChannelStatsDetails {
    const m = this.db.get<{ role: string; type: string }>(
      'SELECT m.role, c.type FROM chat_members m JOIN chats c ON c.id = m.chat_id AND c.deleted_at IS NULL WHERE m.chat_id = :c AND m.user_id = :u',
      { c: chatId, u: userId },
    );
    if (!m || m.type !== 'channel') throw notFound('Канал не найден');
    if (m.role !== 'owner' && m.role !== 'admin') throw forbidden('Статистика доступна владельцу и администраторам');
    const days = this.days(range);
    const from = Date.parse(`${days[0]}T00:00:00Z`);
    const top = this.db.all<{ id: string; text: string | null; kind: ChannelPostStat['kind']; view_count: number; comment_count: number; created_at: number; reactions: number }>(
      `SELECT m.id, m.text, m.kind, m.view_count, m.comment_count, m.created_at,
         (SELECT COUNT(*) FROM message_reactions r WHERE r.message_id = m.id) AS reactions
       FROM messages m WHERE m.chat_id = :c AND m.thread_root_id IS NULL AND m.deleted_at IS NULL AND m.kind != 'system' AND m.created_at >= :from
       ORDER BY m.view_count DESC, m.created_at DESC LIMIT 10`,
      { c: chatId, from },
    );
    return {
      ...this.channel(chatId, m.role, days),
      days,
      topPosts: top.map((p) => ({
        id: p.id,
        text: p.text,
        kind: p.kind,
        viewCount: Math.max(1, p.view_count),
        commentCount: p.comment_count,
        reactions: p.reactions,
        createdAt: iso(p.created_at),
      })),
    };
  }
}
