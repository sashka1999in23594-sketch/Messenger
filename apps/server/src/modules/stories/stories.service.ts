/**
 * Истории на 24 часа (как в Instagram/Telegram): видят подписчики или только
 * «Близкие друзья», автор видит просмотры и реакции. Истёкшие истории остаются
 * в архиве автора и могут жить дальше в «Актуальном» профиля.
 */
import type { Story, StoryAudience, StoryGroup, StoryHighlight, StoryViewerInfo, UserSummary } from '@omni/shared';
import { LIMITS, STORY_TTL_HOURS } from '@omni/shared';
import type { Db } from '../../db/index.js';
import { Db as DbClass, iso } from '../../db/index.js';
import { badRequest, forbidden, notFound } from '../../lib/errors.js';
import { newId } from '../../lib/ids.js';
import type { MediaService } from '../media/media.service.js';
import type { NotificationService } from '../notifications/notifications.service.js';
import { Policy } from '../policy/policy.service.js';
import type { UsersRepo } from '../users/users.repo.js';

interface StoryRow {
  id: string;
  author_id: string;
  media_id: string;
  text: string | null;
  created_at: number;
  expires_at: number;
  deleted_at: number | null;
  audience: StoryAudience;
  allow_replies: number;
}

interface HighlightRow {
  id: string;
  owner_id: string;
  title: string;
  cover_story_id: string | null;
  position: number;
  created_at: number;
}

export class StoriesService {
  constructor(
    private readonly db: Db,
    private readonly users: UsersRepo,
    private readonly policy: Policy,
    private readonly media: MediaService,
    private readonly notifications: NotificationService,
  ) {}

  private toDto(rows: StoryRow[], viewerId: string): Story[] {
    if (!rows.length) return [];
    const authors = this.users.summaries(rows.map((r) => r.author_id));
    const media = this.media.items(rows.map((r) => r.media_id));
    const list = DbClass.inList(rows.map((r) => r.id), 's');
    const viewed = new Set(
      this.db.all<{ story_id: string }>(`SELECT story_id FROM story_views WHERE user_id = :v AND story_id IN (${list.sql})`, { ...list.params, v: viewerId }).map((r) => r.story_id),
    );
    const mine = new Map(
      this.db
        .all<{ story_id: string; emoji: string }>(`SELECT story_id, emoji FROM story_reactions WHERE user_id = :v AND story_id IN (${list.sql})`, { ...list.params, v: viewerId })
        .map((r) => [r.story_id, r.emoji]),
    );
    const own = rows.filter((r) => r.author_id === viewerId);
    const views = new Map<string, number>();
    const reactions = new Map<string, number>();
    if (own.length) {
      const ol = DbClass.inList(own.map((r) => r.id), 'o');
      for (const r of this.db.all<{ story_id: string; c: number }>(`SELECT story_id, COUNT(*) AS c FROM story_views WHERE story_id IN (${ol.sql}) GROUP BY story_id`, ol.params)) {
        views.set(r.story_id, r.c);
      }
      for (const r of this.db.all<{ story_id: string; c: number }>(`SELECT story_id, COUNT(*) AS c FROM story_reactions WHERE story_id IN (${ol.sql}) GROUP BY story_id`, ol.params)) {
        reactions.set(r.story_id, r.c);
      }
    }
    const now = Date.now();
    return rows
      .filter((r) => media.has(r.media_id) && authors.has(r.author_id))
      .map((r) => {
        const isOwn = r.author_id === viewerId;
        return {
          id: r.id,
          author: authors.get(r.author_id)!,
          media: media.get(r.media_id)!,
          text: r.text,
          createdAt: iso(r.created_at),
          expiresAt: iso(r.expires_at),
          expired: r.expires_at <= now,
          viewed: viewed.has(r.id) || isOwn,
          audience: r.audience,
          allowReplies: !!r.allow_replies,
          myReaction: mine.get(r.id) ?? null,
          viewCount: isOwn ? (views.get(r.id) ?? 0) : null,
          reactionCount: isOwn ? (reactions.get(r.id) ?? 0) : null,
        };
      });
  }

  private group(stories: Story[]): StoryGroup[] {
    const groups = new Map<string, StoryGroup>();
    for (const s of stories) {
      const g = groups.get(s.author.id) ?? { author: s.author, stories: [], hasUnseen: false };
      g.stories.push(s);
      g.hasUnseen ||= !s.viewed;
      groups.set(s.author.id, g);
    }
    return [...groups.values()];
  }

  feed(viewerId: string): StoryGroup[] {
    const rows = this.db.all<StoryRow>(
      `SELECT s.* FROM stories s JOIN users u ON u.id = s.author_id
       WHERE s.deleted_at IS NULL AND s.expires_at > :now AND u.deleted_at IS NULL
         AND (s.author_id = :v OR EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = :v AND f.followee_id = s.author_id AND f.status = 'accepted'))
         AND NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker_id = :v AND b.blocked_id = s.author_id) OR (b.blocker_id = s.author_id AND b.blocked_id = :v))
         AND NOT EXISTS (SELECT 1 FROM mutes m WHERE m.muter_id = :v AND m.muted_id = s.author_id)
         AND ${Policy.visibleStoriesSql()}
       ORDER BY s.created_at ASC LIMIT 500`,
      { v: viewerId, now: Date.now() },
    );
    const groups = this.group(this.toDto(rows, viewerId));
    return groups.sort((a, b) => {
      if (a.author.id === viewerId) return -1;
      if (b.author.id === viewerId) return 1;
      if (a.hasUnseen !== b.hasUnseen) return a.hasUnseen ? -1 : 1;
      return b.stories.at(-1)!.createdAt.localeCompare(a.stories.at(-1)!.createdAt);
    });
  }

  ofUser(viewerId: string, userId: string): Story[] {
    const author = this.users.byId(userId);
    if (!author || !this.policy.canViewContent(viewerId, author)) return [];
    const rows = this.db.all<StoryRow>(
      `SELECT * FROM stories s WHERE author_id = :u AND deleted_at IS NULL AND expires_at > :now AND ${Policy.visibleStoriesSql()} ORDER BY created_at`,
      { u: userId, v: viewerId, now: Date.now() },
    );
    return this.toDto(rows, viewerId);
  }

  create(userId: string, input: { mediaId: string; text?: string; audience: StoryAudience; allowReplies: boolean }): Story {
    this.media.assertOwned(userId, [input.mediaId], ['image', 'video']);
    const now = Date.now();
    const id = newId(now);
    this.db.run(
      `INSERT INTO stories (id, author_id, media_id, text, created_at, expires_at, audience, allow_replies)
       VALUES (:id, :u, :m, :t, :now, :exp, :aud, :ar)`,
      { id, u: userId, m: input.mediaId, t: input.text || null, now, exp: now + STORY_TTL_HOURS * 3600 * 1000, aud: input.audience, ar: input.allowReplies },
    );
    return this.toDto([this.row(id)!], userId)[0]!;
  }

  private row(id: string): StoryRow | undefined {
    return this.db.get<StoryRow>('SELECT * FROM stories WHERE id = :id AND deleted_at IS NULL', { id });
  }

  /** История, доступная зрителю: активная — по правилам аудитории, истёкшая — только из «Актуального» или автору */
  private visible(viewerId: string, id: string): StoryRow {
    const s = this.row(id);
    if (!s) throw notFound('История не найдена');
    const author = this.users.byId(s.author_id);
    if (!author || !this.policy.canViewStory(viewerId, author, s.audience)) throw notFound('История не найдена');
    if (s.expires_at <= Date.now() && s.author_id !== viewerId) {
      const inHighlight = this.db.get('SELECT 1 FROM story_highlight_items WHERE story_id = :s LIMIT 1', { s: id });
      if (!inHighlight) throw notFound('История не найдена');
    }
    return s;
  }

  get(viewerId: string, id: string): Story {
    return this.toDto([this.visible(viewerId, id)], viewerId)[0]!;
  }

  view(viewerId: string, id: string): void {
    const s = this.visible(viewerId, id);
    if (s.author_id === viewerId) return;
    this.db.run('INSERT OR IGNORE INTO story_views (story_id, user_id, viewed_at) VALUES (:s, :u, :now)', { s: id, u: viewerId, now: Date.now() });
  }

  /** Реакция на историю (null — снять). Автору приходит уведомление. */
  react(viewerId: string, id: string, emoji: string | null): Story {
    const s = this.visible(viewerId, id);
    if (s.author_id === viewerId) throw badRequest('Нельзя реагировать на свою историю');
    const now = Date.now();
    if (emoji) {
      this.db.run(
        `INSERT INTO story_reactions (story_id, user_id, emoji, created_at) VALUES (:s, :u, :e, :now)
         ON CONFLICT (story_id, user_id) DO UPDATE SET emoji = excluded.emoji, created_at = excluded.created_at`,
        { s: id, u: viewerId, e: emoji, now },
      );
      this.db.run('INSERT OR IGNORE INTO story_views (story_id, user_id, viewed_at) VALUES (:s, :u, :now)', { s: id, u: viewerId, now });
      this.notifications.notify({
        userId: s.author_id,
        type: 'story_reaction',
        actorId: viewerId,
        entityType: 'story',
        entityId: id,
        link: `/stories/archive?story=${id}`,
        preview: `${emoji} ${s.text ?? ''}`.trim(),
      });
    } else {
      this.db.run('DELETE FROM story_reactions WHERE story_id = :s AND user_id = :u', { s: id, u: viewerId });
    }
    return this.toDto([s], viewerId)[0]!;
  }

  viewers(userId: string, id: string): StoryViewerInfo[] {
    const s = this.db.get<StoryRow>('SELECT * FROM stories WHERE id = :id', { id });
    if (!s || s.author_id !== userId) throw forbidden();
    const rows = this.db.all<{ user_id: string; viewed_at: number; emoji: string | null }>(
      `SELECT v.user_id, v.viewed_at, r.emoji FROM story_views v
       LEFT JOIN story_reactions r ON r.story_id = v.story_id AND r.user_id = v.user_id
       WHERE v.story_id = :s ORDER BY (r.emoji IS NOT NULL) DESC, v.viewed_at DESC LIMIT 500`,
      { s: id },
    );
    const map = this.users.summaries(rows.map((r) => r.user_id));
    return rows.filter((r) => map.has(r.user_id)).map((r) => ({ user: map.get(r.user_id)!, reaction: r.emoji, viewedAt: iso(r.viewed_at) }));
  }

  remove(userId: string, id: string): void {
    const r = this.db.run('UPDATE stories SET deleted_at = :now WHERE id = :id AND author_id = :u', { now: Date.now(), id, u: userId });
    if (!r.changes) throw notFound('История не найдена');
    this.db.run('DELETE FROM story_highlight_items WHERE story_id = :id', { id });
  }

  /** Архив: все свои истории, включая истёкшие (новые сверху). */
  archive(userId: string, cursor: string | undefined, limit: number) {
    const rows = this.db.all<StoryRow>(
      `SELECT * FROM stories WHERE author_id = :u AND deleted_at IS NULL AND (:cursor IS NULL OR id < :cursor)
       ORDER BY id DESC LIMIT :limit`,
      { u: userId, cursor: cursor ?? null, limit: limit + 1 },
    );
    const items = this.toDto(rows.slice(0, limit), userId);
    return { items, nextCursor: rows.length > limit ? (rows[limit - 1]?.id ?? null) : null };
  }

  /** Удаляем только то, что автор удалил сам (архив хранится, как в Instagram) */
  purgeExpired(): number {
    return this.db.run('DELETE FROM stories WHERE deleted_at IS NOT NULL AND deleted_at < :cutoff', { cutoff: Date.now() - 7 * 24 * 3600 * 1000 }).changes;
  }

  // ─── «Актуальное» ─────────────────────────────────────────────────────────

  private highlightDto(rows: HighlightRow[], viewerId: string): StoryHighlight[] {
    if (!rows.length) return [];
    const out: StoryHighlight[] = [];
    for (const h of rows) {
      const stories = this.highlightRows(h.id, viewerId);
      if (!stories.length && h.owner_id !== viewerId) continue;
      const coverRow = stories.find((s) => s.id === h.cover_story_id) ?? stories[0];
      out.push({
        id: h.id,
        title: h.title,
        cover: coverRow ? (this.media.items([coverRow.media_id]).get(coverRow.media_id) ?? null) : null,
        count: stories.length,
        createdAt: iso(h.created_at),
      });
    }
    return out;
  }

  /** Истории подборки, которые видит зритель (для близких — только близким) */
  private highlightRows(highlightId: string, viewerId: string): StoryRow[] {
    return this.db.all<StoryRow>(
      `SELECT s.* FROM story_highlight_items i JOIN stories s ON s.id = i.story_id
       WHERE i.highlight_id = :h AND s.deleted_at IS NULL AND ${Policy.visibleStoriesSql()}
       ORDER BY s.created_at`,
      { h: highlightId, v: viewerId },
    );
  }

  highlights(viewerId: string, userId: string): StoryHighlight[] {
    const author = this.users.byId(userId);
    if (!author || !this.policy.canViewContent(viewerId, author)) return [];
    const rows = this.db.all<HighlightRow>('SELECT * FROM story_highlights WHERE owner_id = :u ORDER BY position, created_at', { u: userId });
    return this.highlightDto(rows, viewerId);
  }

  highlightStories(viewerId: string, id: string): { highlight: StoryHighlight; author: UserSummary; stories: Story[] } {
    const h = this.db.get<HighlightRow>('SELECT * FROM story_highlights WHERE id = :id', { id });
    const author = h ? this.users.byId(h.owner_id) : undefined;
    if (!h || !author || !this.policy.canViewContent(viewerId, author)) throw notFound('Подборка не найдена');
    const stories = this.toDto(this.highlightRows(id, viewerId), viewerId);
    return { highlight: this.highlightDto([h], viewerId)[0]!, author: this.users.toSummary(author), stories };
  }

  private assertOwnStories(userId: string, storyIds: string[]): void {
    const list = DbClass.inList(storyIds, 's');
    const n = this.db.value<number>(`SELECT COUNT(*) FROM stories WHERE author_id = :u AND deleted_at IS NULL AND id IN (${list.sql})`, { ...list.params, u: userId }) ?? 0;
    if (n !== new Set(storyIds).size) throw badRequest('Можно добавить только свои истории');
  }

  private setItems(highlightId: string, storyIds: string[]): void {
    const now = Date.now();
    this.db.run('DELETE FROM story_highlight_items WHERE highlight_id = :h', { h: highlightId });
    for (const sid of new Set(storyIds)) {
      this.db.run('INSERT INTO story_highlight_items (highlight_id, story_id, added_at) VALUES (:h, :s, :now)', { h: highlightId, s: sid, now });
    }
  }

  createHighlight(userId: string, input: { title: string; storyIds: string[]; coverStoryId?: string | null }): StoryHighlight {
    const count = this.db.value<number>('SELECT COUNT(*) FROM story_highlights WHERE owner_id = :u', { u: userId }) ?? 0;
    if (count >= LIMITS.highlightsMax) throw badRequest(`Не более ${LIMITS.highlightsMax} подборок`);
    this.assertOwnStories(userId, input.storyIds);
    const now = Date.now();
    const id = newId(now);
    const cover = input.coverStoryId && input.storyIds.includes(input.coverStoryId) ? input.coverStoryId : input.storyIds[0]!;
    this.db.tx(() => {
      this.db.run(
        'INSERT INTO story_highlights (id, owner_id, title, cover_story_id, position, created_at) VALUES (:id, :u, :t, :c, :pos, :now)',
        { id, u: userId, t: input.title, c: cover, pos: count, now },
      );
      this.setItems(id, input.storyIds);
    });
    return this.highlightDto([this.ownHighlight(userId, id)], userId)[0]!;
  }

  private ownHighlight(userId: string, id: string): HighlightRow {
    const h = this.db.get<HighlightRow>('SELECT * FROM story_highlights WHERE id = :id AND owner_id = :u', { id, u: userId });
    if (!h) throw notFound('Подборка не найдена');
    return h;
  }

  updateHighlight(userId: string, id: string, input: { title: string; storyIds: string[]; coverStoryId?: string | null }): StoryHighlight {
    this.ownHighlight(userId, id);
    this.assertOwnStories(userId, input.storyIds);
    const cover = input.coverStoryId && input.storyIds.includes(input.coverStoryId) ? input.coverStoryId : input.storyIds[0]!;
    this.db.tx(() => {
      this.db.run('UPDATE story_highlights SET title = :t, cover_story_id = :c WHERE id = :id', { t: input.title, c: cover, id });
      this.setItems(id, input.storyIds);
    });
    return this.highlightDto([this.ownHighlight(userId, id)], userId)[0]!;
  }

  /** Список id историй подборки — для редактора */
  highlightStoryIds(userId: string, id: string): string[] {
    this.ownHighlight(userId, id);
    return this.db.all<{ story_id: string }>('SELECT story_id FROM story_highlight_items WHERE highlight_id = :h ORDER BY added_at', { h: id }).map((r) => r.story_id);
  }

  deleteHighlight(userId: string, id: string): void {
    this.ownHighlight(userId, id);
    this.db.run('DELETE FROM story_highlights WHERE id = :id', { id });
  }

  // ─── «Близкие друзья» ─────────────────────────────────────────────────────

  closeFriends(userId: string): UserSummary[] {
    const ids = this.db.all<{ friend_id: string }>('SELECT friend_id FROM close_friends WHERE owner_id = :u ORDER BY created_at DESC', { u: userId }).map((r) => r.friend_id);
    const map = this.users.summaries(ids);
    return ids.map((i) => map.get(i)).filter((u): u is UserSummary => !!u);
  }

  setCloseFriend(userId: string, friendId: string, on: boolean): void {
    if (friendId === userId) throw badRequest('Себя добавлять не нужно');
    if (on) {
      if (!this.users.byId(friendId)) throw notFound('Пользователь не найден');
      const n = this.db.value<number>('SELECT COUNT(*) FROM close_friends WHERE owner_id = :u', { u: userId }) ?? 0;
      if (n >= LIMITS.closeFriendsMax) throw badRequest('Список близких друзей переполнен');
      this.db.run('INSERT OR IGNORE INTO close_friends (owner_id, friend_id, created_at) VALUES (:u, :f, :now)', { u: userId, f: friendId, now: Date.now() });
    } else {
      this.db.run('DELETE FROM close_friends WHERE owner_id = :u AND friend_id = :f', { u: userId, f: friendId });
    }
  }
}
