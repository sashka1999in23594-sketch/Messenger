/**
 * Централизованная авторизация: ВСЕ решения «можно ли X сделать Y» принимаются
 * здесь. Модули не дублируют проверки приватности — так их невозможно забыть
 * в одном месте и сложно случайно ослабить.
 */
import type { Audience, Relationship } from '@omni/shared';
import { SPACE_PERMS, SPACE_PERMS_ALL } from '@omni/shared';
import type { Db } from '../../db/index.js';
import { bool } from '../../db/index.js';
import { privacyOf, type UserRow } from '../users/users.repo.js';

export class Policy {
  constructor(private readonly db: Db) {}

  follows(followerId: string, followeeId: string): boolean {
    return !!this.db.get(
      "SELECT 1 FROM follows WHERE follower_id = :a AND followee_id = :b AND status = 'accepted'",
      { a: followerId, b: followeeId },
    );
  }

  isBlocked(blockerId: string, blockedId: string): boolean {
    return !!this.db.get('SELECT 1 FROM blocks WHERE blocker_id = :a AND blocked_id = :b', { a: blockerId, b: blockedId });
  }

  blockedEitherWay(a: string, b: string): boolean {
    return !!this.db.get(
      `SELECT 1 FROM blocks WHERE (blocker_id = :a AND blocked_id = :b) OR (blocker_id = :b AND blocked_id = :a) LIMIT 1`,
      { a, b },
    );
  }

  relationship(viewerId: string, targetId: string): Relationship | null {
    if (viewerId === targetId) return null;
    const row = this.db.get<Record<string, number>>(
      `SELECT
        EXISTS(SELECT 1 FROM follows WHERE follower_id = :v AND followee_id = :t AND status = 'accepted') AS following,
        EXISTS(SELECT 1 FROM follows WHERE follower_id = :t AND followee_id = :v AND status = 'accepted') AS followed_by,
        EXISTS(SELECT 1 FROM follows WHERE follower_id = :v AND followee_id = :t AND status = 'pending') AS requested,
        EXISTS(SELECT 1 FROM blocks WHERE blocker_id = :v AND blocked_id = :t) AS blocked,
        EXISTS(SELECT 1 FROM blocks WHERE blocker_id = :t AND blocked_id = :v) AS blocked_by,
        EXISTS(SELECT 1 FROM mutes WHERE muter_id = :v AND muted_id = :t) AS muted`,
      { v: viewerId, t: targetId },
    )!;
    return {
      following: bool(row.following),
      followedBy: bool(row.followed_by),
      requested: bool(row.requested),
      blocked: bool(row.blocked),
      blockedBy: bool(row.blocked_by),
      muted: bool(row.muted),
    };
  }

  /** Аудитория настройки: 'following' — люди, на которых подписан ВЛАДЕЛЕЦ настройки. */
  audienceAllows(audience: Audience, ownerId: string, viewerId: string): boolean {
    if (ownerId === viewerId) return true;
    if (audience === 'everyone') return true;
    if (audience === 'nobody') return false;
    return this.follows(ownerId, viewerId);
  }

  canViewContent(viewerId: string, owner: UserRow): boolean {
    if (owner.id === viewerId) return true;
    if (this.blockedEitherWay(viewerId, owner.id)) return false;
    if (!bool(owner.is_private)) return true;
    return this.follows(viewerId, owner.id);
  }

  canMessage(senderId: string, target: UserRow): boolean {
    if (senderId === target.id) return true;
    if (this.blockedEitherWay(senderId, target.id)) return false;
    return this.audienceAllows(privacyOf(target).whoCanMessage, target.id, senderId);
  }

  canSeePresence(viewerId: string, target: UserRow): boolean {
    if (viewerId === target.id) return true;
    if (this.blockedEitherWay(viewerId, target.id)) return false;
    return this.audienceAllows(privacyOf(target).lastSeenVisibility, target.id, viewerId);
  }

  canComment(viewerId: string, author: UserRow): boolean {
    if (viewerId === author.id) return true;
    if (this.blockedEitherWay(viewerId, author.id)) return false;
    return this.audienceAllows(privacyOf(author).whoCanComment, author.id, viewerId);
  }

  canViewPost(
    viewerId: string,
    post: { author_id: string; visibility: string; community_id: string | null; deleted_at: number | null },
    author: UserRow,
  ): boolean {
    if (post.deleted_at) return false;
    if (post.author_id === viewerId) return true;
    if (this.blockedEitherWay(viewerId, post.author_id)) return false;
    if (post.visibility === 'private') return false;
    if (post.community_id && !this.canViewCommunity(viewerId, post.community_id)) return false;
    if (post.visibility === 'followers' || bool(author.is_private)) return this.follows(viewerId, post.author_id);
    return true;
  }

  /** viewer в списке «Близкие друзья» у owner */
  isCloseFriend(ownerId: string, viewerId: string): boolean {
    return !!this.db.get('SELECT 1 FROM close_friends WHERE owner_id = :o AND friend_id = :v', { o: ownerId, v: viewerId });
  }

  /** История видна: доступен контент автора, а «для близких» — только близким друзьям */
  canViewStory(viewerId: string, author: UserRow, audience: string): boolean {
    if (viewerId === author.id) return true;
    if (!this.canViewContent(viewerId, author)) return false;
    return audience !== 'close' || this.isCloseFriend(author.id, viewerId);
  }

  /** SQL-условие видимости историй (таблица stories s). Параметр :v обязателен. */
  static visibleStoriesSql(): string {
    return `(s.author_id = :v OR (
      s.audience = 'all' OR EXISTS (SELECT 1 FROM close_friends cf WHERE cf.owner_id = s.author_id AND cf.friend_id = :v)
    ))`;
  }

  canViewCommunity(viewerId: string, communityId: string): boolean {
    const row = this.db.get<{ visibility: string; member: number }>(
      `SELECT c.visibility, EXISTS(SELECT 1 FROM community_members m WHERE m.community_id = c.id AND m.user_id = :v) AS member
       FROM communities c WHERE c.id = :id AND c.deleted_at IS NULL`,
      { id: communityId, v: viewerId },
    );
    return !!row && (row.visibility === 'public' || bool(row.member));
  }

  // ─── Компании и сообщества ────────────────────────────────────────────────

  isSpaceMember(spaceId: string, userId: string): boolean {
    return !!this.db.get('SELECT 1 FROM space_members WHERE space_id = :s AND user_id = :u', { s: spaceId, u: userId });
  }

  /**
   * Права участника: владелец — все; остальным — объединение прав их ролей
   * и роли «Все участники». Право «Администратор» включает все остальные.
   * Не участник — 0.
   */
  spacePermissions(spaceId: string, userId: string): number {
    const space = this.db.get<{ owner_id: string }>('SELECT owner_id FROM spaces WHERE id = :s AND deleted_at IS NULL', { s: spaceId });
    if (!space || !this.isSpaceMember(spaceId, userId)) return 0;
    if (space.owner_id === userId) return SPACE_PERMS_ALL;
    const rows = this.db.all<{ permissions: number }>(
      `SELECT r.permissions FROM space_roles r
       WHERE r.space_id = :s AND (r.is_default = 1
         OR EXISTS (SELECT 1 FROM space_member_roles mr WHERE mr.role_id = r.id AND mr.user_id = :u))`,
      { s: spaceId, u: userId },
    );
    const perms = rows.reduce((acc, r) => acc | r.permissions, 0);
    return perms & SPACE_PERMS.admin ? SPACE_PERMS_ALL : perms;
  }

  hasSpacePerm(spaceId: string, userId: string, perm: number): boolean {
    return (this.spacePermissions(spaceId, userId) & perm) === perm;
  }

  /** Видит ли участник чат пространства: чат без ограничений или у человека есть одна из его ролей. */
  canSeeSpaceRoom(spaceId: string, chatId: string, userId: string): boolean {
    if (!this.isSpaceMember(spaceId, userId)) return false;
    const owner = this.db.get('SELECT 1 FROM spaces WHERE id = :s AND owner_id = :u', { s: spaceId, u: userId });
    if (owner || this.hasSpacePerm(spaceId, userId, SPACE_PERMS.admin)) return true;
    const restricted = this.db.all<{ role_id: string }>('SELECT role_id FROM space_room_roles WHERE chat_id = :c', { c: chatId });
    if (!restricted.length) return true;
    return !!this.db.get(
      `SELECT 1 FROM space_room_roles rr JOIN space_roles r ON r.id = rr.role_id
       WHERE rr.chat_id = :c AND (r.is_default = 1 OR EXISTS (SELECT 1 FROM space_member_roles mr WHERE mr.role_id = r.id AND mr.user_id = :u))
       LIMIT 1`,
      { c: chatId, u: userId },
    );
  }

  /**
   * SQL-условие видимости постов для ленты (таблицы: posts p, users u, communities c LEFT JOIN).
   * Параметр :viewer обязателен. Отсекает удалённые, заблокированные, скрытые (mute) и закрытые посты.
   */
  static visiblePostsSql({ excludeMuted = true } = {}): string {
    return `
      p.deleted_at IS NULL AND u.deleted_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker_id = :viewer AND b.blocked_id = p.author_id)
                                              OR (b.blocker_id = p.author_id AND b.blocked_id = :viewer))
      ${excludeMuted ? 'AND NOT EXISTS (SELECT 1 FROM mutes mu WHERE mu.muter_id = :viewer AND mu.muted_id = p.author_id)' : ''}
      AND (
        p.author_id = :viewer
        OR (p.visibility != 'private' AND (
              (p.visibility = 'public' AND u.is_private = 0)
              OR EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = :viewer AND f.followee_id = p.author_id AND f.status = 'accepted')
        ))
      )
      AND (p.community_id IS NULL OR c.visibility = 'public'
           OR EXISTS (SELECT 1 FROM community_members cm WHERE cm.community_id = p.community_id AND cm.user_id = :viewer))`;
  }
}
