import type { AppNotification, Counters, NotificationType, Paginated } from '@omni/shared';
import { excerpt } from '@omni/shared';
import type { Db } from '../../db/index.js';
import { iso, isoOrNull } from '../../db/index.js';
import { newId } from '../../lib/ids.js';
import type { RealtimeHub } from '../realtime/hub.js';
import { notificationPrefsOf, type UsersRepo } from '../users/users.repo.js';

interface NotificationRow {
  id: string;
  user_id: string;
  type: NotificationType;
  actor_id: string | null;
  entity_type: AppNotification['entityType'];
  entity_id: string | null;
  link: string | null;
  preview: string | null;
  read_at: number | null;
  created_at: number;
}

/** Какая настройка уведомлений отвечает за тип события. */
const PREF_FOR: Record<NotificationType, keyof ReturnType<typeof notificationPrefsOf>> = {
  follow: 'follows',
  follow_request: 'follows',
  follow_accepted: 'follows',
  like: 'likes',
  comment: 'replies',
  reply: 'replies',
  mention: 'mentions',
  repost: 'reposts',
  community_join: 'communities',
  space_invite: 'communities',
  new_post: 'subscriptions',
  story_reaction: 'stories',
  security: 'security',
};

export interface NotifyInput {
  userId: string;
  type: NotificationType;
  actorId?: string | null;
  entityType?: AppNotification['entityType'];
  entityId?: string | null;
  link?: string | null;
  preview?: string | null;
}

export class NotificationService {
  constructor(
    private readonly db: Db,
    private readonly users: UsersRepo,
    private readonly hub: RealtimeHub,
  ) {}

  notify(input: NotifyInput): void {
    if (input.actorId && input.actorId === input.userId) return;
    const target = this.users.byId(input.userId);
    if (!target) return;
    const prefs = notificationPrefsOf(target);
    // Безопасность и приглашения в компании приходят всегда — без них не узнать о важном
    if (input.type !== 'security' && input.type !== 'space_invite' && !prefs[PREF_FOR[input.type]]) return;
    if (input.actorId) {
      const muted = this.db.get(
        `SELECT 1 FROM blocks WHERE blocker_id = :u AND blocked_id = :a
         UNION ALL SELECT 1 FROM mutes WHERE muter_id = :u AND muted_id = :a LIMIT 1`,
        { u: input.userId, a: input.actorId },
      );
      if (muted) return;
      // Не дублируем одинаковые уведомления (например, лайк → снятие → лайк)
      const dup = this.db.get(
        `SELECT 1 FROM notifications WHERE user_id = :u AND type = :type AND actor_id = :a
         AND entity_id IS :e AND created_at > :since`,
        { u: input.userId, type: input.type, a: input.actorId, e: input.entityId ?? null, since: Date.now() - 3600_000 },
      );
      if (dup) return;
    }
    const row: NotificationRow = {
      id: newId(),
      user_id: input.userId,
      type: input.type,
      actor_id: input.actorId ?? null,
      entity_type: input.entityType ?? null,
      entity_id: input.entityId ?? null,
      link: input.link ?? null,
      preview: input.preview ? excerpt(input.preview, 140) : null,
      read_at: null,
      created_at: Date.now(),
    };
    this.db.run(
      `INSERT INTO notifications (id, user_id, type, actor_id, entity_type, entity_id, link, preview, created_at)
       VALUES (:id, :user_id, :type, :actor_id, :entity_type, :entity_id, :link, :preview, :created_at)`,
      { ...row },
    );
    const [dto] = this.toDto([row]);
    if (dto) this.hub.sendToUser(input.userId, { t: 'notification.new', notification: prefs.showPreviews ? dto : { ...dto, preview: null } });
    this.pushCounters(input.userId);
  }

  private toDto(rows: NotificationRow[]): AppNotification[] {
    const actors = this.users.summaries(rows.map((r) => r.actor_id));
    return rows.map((r) => ({
      id: r.id,
      type: r.type,
      actor: r.actor_id ? (actors.get(r.actor_id) ?? null) : null,
      entityType: r.entity_type,
      entityId: r.entity_id,
      link: r.link,
      preview: r.preview,
      readAt: isoOrNull(r.read_at),
      createdAt: iso(r.created_at),
    }));
  }

  list(userId: string, filter: string, cursor: string | undefined, limit: number): Paginated<AppNotification> {
    const types: Record<string, string[]> = {
      mentions: ['mention'],
      replies: ['comment', 'reply'],
      follows: ['follow', 'follow_request', 'follow_accepted'],
      likes: ['like', 'repost', 'story_reaction'],
      posts: ['new_post'],
      security: ['security'],
    };
    const filterTypes = types[filter];
    const typeSql = filterTypes ? `AND type IN (${filterTypes.map((t) => `'${t}'`).join(',')})` : '';
    const rows = this.db.all<NotificationRow>(
      `SELECT * FROM notifications WHERE user_id = :u ${typeSql} AND (:cursor IS NULL OR id < :cursor)
       ORDER BY id DESC LIMIT :limit`,
      { u: userId, cursor: cursor ?? null, limit: limit + 1 },
    );
    const items = this.toDto(rows.slice(0, limit));
    return { items, nextCursor: rows.length > limit ? (items.at(-1)?.id ?? null) : null };
  }

  markRead(userId: string, ids?: string[]): void {
    if (ids && ids.length) {
      for (const id of ids.slice(0, 200)) {
        this.db.run('UPDATE notifications SET read_at = :now WHERE id = :id AND user_id = :u AND read_at IS NULL', {
          now: Date.now(),
          id,
          u: userId,
        });
      }
    } else {
      this.db.run('UPDATE notifications SET read_at = :now WHERE user_id = :u AND read_at IS NULL', { now: Date.now(), u: userId });
    }
    this.pushCounters(userId);
  }

  counters(userId: string): Counters {
    const unread = (kind: string) => `(SELECT COUNT(*) FROM chat_members m JOIN chats c ON c.id = m.chat_id
          WHERE m.user_id = :u AND m.hidden = 0 AND m.archived = 0 AND c.deleted_at IS NULL AND c.space_id IS NULL AND ${kind}
            AND EXISTS (SELECT 1 FROM messages x WHERE x.chat_id = c.id AND x.seq > max(m.last_read_seq, m.cleared_seq)
              AND x.thread_root_id IS NULL AND x.deleted_at IS NULL AND (x.sender_id IS NULL OR x.sender_id != :u))
            AND (m.muted_until IS NULL OR m.muted_until < :now))`;
    const row = this.db.get<{ chats: number; channels: number; notifs: number; requests: number }>(
      `SELECT
        ${unread("c.type != 'channel'")} AS chats,
        ${unread("c.type = 'channel'")} AS channels,
        (SELECT COUNT(*) FROM notifications WHERE user_id = :u AND read_at IS NULL) AS notifs,
        (SELECT COUNT(*) FROM follows WHERE followee_id = :u AND status = 'pending') AS requests`,
      { u: userId, now: Date.now() },
    )!;
    return { unreadChats: row.chats, unreadChannels: row.channels, unreadNotifications: row.notifs, followRequests: row.requests };
  }

  pushCounters(userId: string): void {
    if (this.hub.isOnline(userId)) this.hub.sendToUser(userId, { t: 'counters', counters: this.counters(userId) });
  }
}
