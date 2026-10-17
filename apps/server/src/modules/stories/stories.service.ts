/** Истории на 24 часа (как в Instagram/Telegram): видят подписчики, автор видит просмотры. */
import type { Story, StoryGroup, UserSummary } from '@omni/shared';
import { STORY_TTL_HOURS } from '@omni/shared';
import type { Db } from '../../db/index.js';
import { iso } from '../../db/index.js';
import { forbidden, notFound } from '../../lib/errors.js';
import { newId } from '../../lib/ids.js';
import type { MediaService } from '../media/media.service.js';
import type { Policy } from '../policy/policy.service.js';
import type { UsersRepo } from '../users/users.repo.js';

interface StoryRow {
  id: string;
  author_id: string;
  media_id: string;
  text: string | null;
  created_at: number;
  expires_at: number;
  deleted_at: number | null;
}

export class StoriesService {
  constructor(
    private readonly db: Db,
    private readonly users: UsersRepo,
    private readonly policy: Policy,
    private readonly media: MediaService,
  ) {}

  private toDto(rows: StoryRow[], viewerId: string): Story[] {
    if (!rows.length) return [];
    const authors = this.users.summaries(rows.map((r) => r.author_id));
    const media = this.media.items(rows.map((r) => r.media_id));
    const placeholders = rows.map((_, i) => `:s${i}`).join(',');
    const params = Object.fromEntries(rows.map((r, i) => [`s${i}`, r.id]));
    const viewed = new Set(
      this.db
        .all<{ story_id: string }>(`SELECT story_id FROM story_views WHERE user_id = :v AND story_id IN (${placeholders})`, { ...params, v: viewerId })
        .map((r) => r.story_id),
    );
    const counts = new Map(
      this.db
        .all<{ story_id: string; c: number }>(`SELECT story_id, COUNT(*) AS c FROM story_views WHERE story_id IN (${placeholders}) GROUP BY story_id`, params)
        .map((r) => [r.story_id, r.c]),
    );
    return rows
      .filter((r) => media.has(r.media_id))
      .map((r) => ({
        id: r.id,
        author: authors.get(r.author_id)!,
        media: media.get(r.media_id)!,
        text: r.text,
        createdAt: iso(r.created_at),
        expiresAt: iso(r.expires_at),
        viewed: viewed.has(r.id) || r.author_id === viewerId,
        viewCount: r.author_id === viewerId ? (counts.get(r.id) ?? 0) : null,
      }));
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
      'SELECT * FROM stories WHERE author_id = :u AND deleted_at IS NULL AND expires_at > :now ORDER BY created_at',
      { u: userId, now: Date.now() },
    );
    return this.toDto(rows, viewerId);
  }

  create(userId: string, input: { mediaId: string; text?: string }): Story {
    this.media.assertOwned(userId, [input.mediaId], ['image', 'video']);
    const now = Date.now();
    const id = newId(now);
    this.db.run(
      'INSERT INTO stories (id, author_id, media_id, text, created_at, expires_at) VALUES (:id, :u, :m, :t, :now, :exp)',
      { id, u: userId, m: input.mediaId, t: input.text || null, now, exp: now + STORY_TTL_HOURS * 3600 * 1000 },
    );
    return this.toDto([this.db.get<StoryRow>('SELECT * FROM stories WHERE id = :id', { id })!], userId)[0]!;
  }

  private visible(viewerId: string, id: string): StoryRow {
    const s = this.db.get<StoryRow>('SELECT * FROM stories WHERE id = :id AND deleted_at IS NULL AND expires_at > :now', { id, now: Date.now() });
    if (!s) throw notFound('История не найдена');
    const author = this.users.byId(s.author_id);
    if (!author || !this.policy.canViewContent(viewerId, author)) throw notFound('История не найдена');
    return s;
  }

  view(viewerId: string, id: string): void {
    const s = this.visible(viewerId, id);
    if (s.author_id === viewerId) return;
    this.db.run('INSERT OR IGNORE INTO story_views (story_id, user_id, viewed_at) VALUES (:s, :u, :now)', { s: id, u: viewerId, now: Date.now() });
  }

  viewers(userId: string, id: string): UserSummary[] {
    const s = this.db.get<StoryRow>('SELECT * FROM stories WHERE id = :id', { id });
    if (!s || s.author_id !== userId) throw forbidden();
    const ids = this.db
      .all<{ user_id: string }>('SELECT user_id FROM story_views WHERE story_id = :s ORDER BY viewed_at DESC LIMIT 500', { s: id })
      .map((r) => r.user_id);
    const map = this.users.summaries(ids);
    return ids.map((i) => map.get(i)!).filter(Boolean);
  }

  remove(userId: string, id: string): void {
    const r = this.db.run('UPDATE stories SET deleted_at = :now WHERE id = :id AND author_id = :u', { now: Date.now(), id, u: userId });
    if (!r.changes) throw notFound('История не найдена');
  }

  purgeExpired(): number {
    return this.db.run('DELETE FROM stories WHERE expires_at < :cutoff', { cutoff: Date.now() - 7 * 24 * 3600 * 1000 }).changes;
  }
}
