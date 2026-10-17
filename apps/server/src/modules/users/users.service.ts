import type {
  Me,
  NotificationSettings,
  Paginated,
  PrivacySettings,
  UserProfile,
  UserSummary,
} from '@omni/shared';
import type { Db } from '../../db/index.js';
import { bool, iso, isoOrNull } from '../../db/index.js';
import { badRequest, blocked, conflict, notFound } from '../../lib/errors.js';
import type { MediaService } from '../media/media.service.js';
import type { NotificationService } from '../notifications/notifications.service.js';
import type { Policy } from '../policy/policy.service.js';
import type { RealtimeHub } from '../realtime/hub.js';
import { DEFAULT_NOTIFICATIONS, DEFAULT_PRIVACY, notificationPrefsOf, privacyOf, type UserRow, type UsersRepo } from './users.repo.js';

/** Курсор по смещению — для списков, где порядок не совпадает с id. */
export const offsetCursor = {
  decode: (c?: string) => (c && /^\d{1,7}$/.test(c) ? Number(c) : 0),
  next: (offset: number, got: number, limit: number) => (got > limit ? String(offset + limit) : null),
};

export class UsersService {
  constructor(
    private readonly db: Db,
    private readonly repo: UsersRepo,
    private readonly policy: Policy,
    private readonly media: MediaService,
    private readonly notifications: NotificationService,
    private readonly hub: RealtimeHub,
  ) {}

  me(userId: string): Me {
    const u = this.repo.byId(userId);
    if (!u) throw notFound('Пользователь не найден');
    return {
      ...this.repo.toSummary(u),
      role: u.role,
      bio: u.bio,
      website: u.website,
      location: u.location,
      bannerUrl: this.media.url(u.banner_media_id),
      createdAt: iso(u.created_at),
      twoFactorEnabled: bool(u.totp_enabled),
      privacy: privacyOf(u),
      notifications: notificationPrefsOf(u),
      counters: this.notifications.counters(userId),
    };
  }

  private requireUser(idOrUsername: string): UserRow {
    const u = /^[0-9A-HJKMNP-TV-Z]{26}$/.test(idOrUsername) ? this.repo.byId(idOrUsername) : this.repo.byUsername(idOrUsername);
    if (!u) throw notFound('Пользователь не найден');
    return u;
  }

  profile(viewerId: string, idOrUsername: string): UserProfile {
    const u = this.requireUser(idOrUsername);
    const relationship = this.policy.relationship(viewerId, u.id);
    const stats = this.db.get<{ followers: number; following: number; posts: number }>(
      `SELECT
        (SELECT COUNT(*) FROM follows WHERE followee_id = :id AND status = 'accepted') AS followers,
        (SELECT COUNT(*) FROM follows WHERE follower_id = :id AND status = 'accepted') AS following,
        (SELECT COUNT(*) FROM posts WHERE author_id = :id AND deleted_at IS NULL AND repost_of_id IS NULL) AS posts`,
      { id: u.id },
    )!;
    const isBlockedBy = relationship?.blockedBy ?? false;
    return {
      ...this.repo.toSummary(u),
      bio: isBlockedBy ? '' : u.bio,
      website: isBlockedBy ? null : u.website,
      location: isBlockedBy ? null : u.location,
      bannerUrl: isBlockedBy ? null : this.media.url(u.banner_media_id),
      isPrivate: bool(u.is_private),
      createdAt: iso(u.created_at),
      stats,
      relationship,
      presence: this.presence(viewerId, u),
      canViewContent: this.policy.canViewContent(viewerId, u),
      canMessage: this.policy.canMessage(viewerId, u),
    };
  }

  presence(viewerId: string, u: UserRow): UserProfile['presence'] {
    if (!this.policy.canSeePresence(viewerId, u)) return null;
    return { online: this.hub.isOnline(u.id), lastSeenAt: isoOrNull(u.last_seen_at) };
  }

  updateProfile(
    userId: string,
    input: Partial<{ displayName: string; bio: string; website: string; location: string; avatarMediaId: string | null; bannerMediaId: string | null }>,
  ): Me {
    if (input.avatarMediaId) this.media.assertOwned(userId, [input.avatarMediaId], ['image']);
    if (input.bannerMediaId) this.media.assertOwned(userId, [input.bannerMediaId], ['image']);
    const sets: string[] = [];
    const params: Record<string, unknown> = { id: userId, now: Date.now() };
    const map: Record<string, string> = {
      displayName: 'display_name',
      bio: 'bio',
      website: 'website',
      location: 'location',
      avatarMediaId: 'avatar_media_id',
      bannerMediaId: 'banner_media_id',
    };
    for (const [key, col] of Object.entries(map)) {
      const v = (input as Record<string, unknown>)[key];
      if (v === undefined) continue;
      sets.push(`${col} = :${key}`);
      params[key] = v === '' && (key === 'website' || key === 'location') ? null : v;
    }
    if (sets.length) this.db.run(`UPDATE users SET ${sets.join(', ')}, updated_at = :now WHERE id = :id`, params);
    return this.me(userId);
  }

  updatePrivacy(userId: string, input: Partial<PrivacySettings>): PrivacySettings {
    const u = this.requireUser(userId);
    const current = privacyOf(u);
    const next = { ...current, ...input };
    const { isPrivate, showInSearch, ...rest } = next;
    const stored = Object.fromEntries(Object.keys(DEFAULT_PRIVACY).map((k) => [k, (rest as Record<string, unknown>)[k]]));
    this.db.tx(() => {
      this.db.run('UPDATE users SET is_private = :p, searchable = :s, privacy = :json, updated_at = :now WHERE id = :id', {
        p: isPrivate,
        s: showInSearch,
        json: JSON.stringify(stored),
        now: Date.now(),
        id: userId,
      });
      // Профиль стал открытым — принимаем все ожидающие заявки
      if (current.isPrivate && !isPrivate) {
        this.db.run("UPDATE follows SET status = 'accepted' WHERE followee_id = :id AND status = 'pending'", { id: userId });
      }
    });
    return next;
  }

  updateNotificationPrefs(userId: string, input: Partial<NotificationSettings>): NotificationSettings {
    const u = this.requireUser(userId);
    const next = { ...notificationPrefsOf(u), ...input };
    const stored = Object.fromEntries(Object.keys(DEFAULT_NOTIFICATIONS).map((k) => [k, (next as Record<string, unknown>)[k]]));
    this.db.run('UPDATE users SET notification_prefs = :json, updated_at = :now WHERE id = :id', {
      json: JSON.stringify(stored),
      now: Date.now(),
      id: userId,
    });
    return next;
  }

  // ─── Подписки ─────────────────────────────────────────────────────────────

  follow(viewerId: string, targetId: string): { status: 'accepted' | 'pending' } {
    if (viewerId === targetId) throw badRequest('Нельзя подписаться на себя');
    const target = this.requireUser(targetId);
    if (this.policy.blockedEitherWay(viewerId, target.id)) throw blocked();
    const existing = this.db.get<{ status: 'accepted' | 'pending' }>(
      'SELECT status FROM follows WHERE follower_id = :a AND followee_id = :b',
      { a: viewerId, b: target.id },
    );
    if (existing) return { status: existing.status };
    const status = bool(target.is_private) ? 'pending' : 'accepted';
    this.db.run('INSERT INTO follows (follower_id, followee_id, status, created_at) VALUES (:a, :b, :s, :now)', {
      a: viewerId,
      b: target.id,
      s: status,
      now: Date.now(),
    });
    const me = this.repo.byId(viewerId)!;
    this.notifications.notify({
      userId: target.id,
      type: status === 'pending' ? 'follow_request' : 'follow',
      actorId: viewerId,
      entityType: 'user',
      entityId: viewerId,
      link: status === 'pending' ? '/notifications/requests' : `/u/${me.username}`,
    });
    return { status };
  }

  unfollow(viewerId: string, targetId: string): void {
    this.db.run('DELETE FROM follows WHERE follower_id = :a AND followee_id = :b', { a: viewerId, b: targetId });
  }

  removeFollower(userId: string, followerId: string): void {
    this.db.run('DELETE FROM follows WHERE follower_id = :a AND followee_id = :b', { a: followerId, b: userId });
  }

  followRequests(userId: string): UserSummary[] {
    const ids = this.db
      .all<{ follower_id: string }>(
        "SELECT follower_id FROM follows WHERE followee_id = :u AND status = 'pending' ORDER BY created_at DESC LIMIT 200",
        { u: userId },
      )
      .map((r) => r.follower_id);
    const map = this.repo.summaries(ids);
    return ids.map((id) => map.get(id)).filter((v): v is UserSummary => !!v);
  }

  answerFollowRequest(userId: string, followerId: string, accept: boolean): void {
    if (accept) {
      const r = this.db.run(
        "UPDATE follows SET status = 'accepted' WHERE follower_id = :f AND followee_id = :u AND status = 'pending'",
        { f: followerId, u: userId },
      );
      if (r.changes) {
        const me = this.repo.byId(userId)!;
        this.notifications.notify({
          userId: followerId,
          type: 'follow_accepted',
          actorId: userId,
          entityType: 'user',
          entityId: userId,
          link: `/u/${me.username}`,
        });
      }
    } else {
      this.db.run("DELETE FROM follows WHERE follower_id = :f AND followee_id = :u AND status = 'pending'", { f: followerId, u: userId });
    }
    this.notifications.pushCounters(userId);
  }

  followList(viewerId: string, targetId: string, which: 'followers' | 'following', cursor?: string, limit = 50): Paginated<UserSummary> {
    const target = this.requireUser(targetId);
    if (!this.policy.canViewContent(viewerId, target)) return { items: [], nextCursor: null };
    const offset = offsetCursor.decode(cursor);
    const sql =
      which === 'followers'
        ? "SELECT follower_id AS id FROM follows WHERE followee_id = :t AND status = 'accepted' ORDER BY created_at DESC LIMIT :l OFFSET :o"
        : "SELECT followee_id AS id FROM follows WHERE follower_id = :t AND status = 'accepted' ORDER BY created_at DESC LIMIT :l OFFSET :o";
    const ids = this.db.all<{ id: string }>(sql, { t: target.id, l: limit + 1, o: offset }).map((r) => r.id);
    const map = this.repo.summaries(ids.slice(0, limit));
    return {
      items: ids.slice(0, limit).map((id) => map.get(id)).filter((v): v is UserSummary => !!v),
      nextCursor: offsetCursor.next(offset, ids.length, limit),
    };
  }

  suggestions(viewerId: string, limit = 10): UserSummary[] {
    const ids = this.db
      .all<{ id: string }>(
        `SELECT u.id FROM users u
         WHERE u.id != :v AND u.deleted_at IS NULL AND u.searchable = 1
           AND NOT EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = :v AND f.followee_id = u.id)
           AND NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker_id = :v AND b.blocked_id = u.id) OR (b.blocker_id = u.id AND b.blocked_id = :v))
         ORDER BY (SELECT COUNT(*) FROM follows f2 WHERE f2.followee_id = u.id) DESC, u.created_at DESC
         LIMIT :limit`,
        { v: viewerId, limit },
      )
      .map((r) => r.id);
    const map = this.repo.summaries(ids);
    return ids.map((id) => map.get(id)!).filter(Boolean);
  }

  // ─── Чёрный список и скрытие ──────────────────────────────────────────────

  block(userId: string, targetId: string): void {
    if (userId === targetId) throw badRequest('Нельзя заблокировать себя');
    this.requireUser(targetId);
    this.db.tx(() => {
      this.db.run('INSERT OR IGNORE INTO blocks (blocker_id, blocked_id, created_at) VALUES (:a, :b, :now)', {
        a: userId,
        b: targetId,
        now: Date.now(),
      });
      this.db.run(
        'DELETE FROM follows WHERE (follower_id = :a AND followee_id = :b) OR (follower_id = :b AND followee_id = :a)',
        { a: userId, b: targetId },
      );
    });
  }

  unblock(userId: string, targetId: string): void {
    this.db.run('DELETE FROM blocks WHERE blocker_id = :a AND blocked_id = :b', { a: userId, b: targetId });
  }

  mute(userId: string, targetId: string, on: boolean): void {
    if (userId === targetId) throw badRequest('Нельзя скрыть себя');
    if (on) {
      this.requireUser(targetId);
      this.db.run('INSERT OR IGNORE INTO mutes (muter_id, muted_id, created_at) VALUES (:a, :b, :now)', {
        a: userId,
        b: targetId,
        now: Date.now(),
      });
    } else {
      this.db.run('DELETE FROM mutes WHERE muter_id = :a AND muted_id = :b', { a: userId, b: targetId });
    }
  }

  listRelations(userId: string, which: 'blocks' | 'mutes'): UserSummary[] {
    const sql =
      which === 'blocks'
        ? 'SELECT blocked_id AS id FROM blocks WHERE blocker_id = :u ORDER BY created_at DESC'
        : 'SELECT muted_id AS id FROM mutes WHERE muter_id = :u ORDER BY created_at DESC';
    const ids = this.db.all<{ id: string }>(sql, { u: userId }).map((r) => r.id);
    const map = this.repo.summaries(ids);
    return ids.map((id) => map.get(id)!).filter(Boolean);
  }

  assertUsernameFree(username: string, exceptId?: string): void {
    const row = this.db.get<{ id: string }>('SELECT id FROM users WHERE username = :u', { u: username });
    if (row && row.id !== exceptId) throw conflict('Это имя уже занято', { username: 'Это имя уже занято' });
    const chat = this.db.get('SELECT 1 FROM chats WHERE handle = :u', { u: username });
    const community = this.db.get('SELECT 1 FROM communities WHERE slug = :u', { u: username });
    if (chat || community) throw conflict('Это имя уже занято', { username: 'Это имя уже занято' });
  }
}
