/** Коллекции закладок: сохранённое можно разложить по темам. Видны только владельцу. */
import type { Collection, Paginated, Post } from '@omni/shared';
import { LIMITS } from '@omni/shared';
import type { Db } from '../../db/index.js';
import { Db as DbClass, iso } from '../../db/index.js';
import { badRequest, notFound } from '../../lib/errors.js';
import { newId } from '../../lib/ids.js';
import type { MediaService } from '../media/media.service.js';
import { Policy } from '../policy/policy.service.js';
import { BASE_FROM, type PostRow, type PostsService } from '../posts/posts.service.js';

interface CollectionRow {
  id: string;
  owner_id: string;
  name: string;
  emoji: string;
  created_at: number;
}

export class CollectionsService {
  constructor(
    private readonly db: Db,
    private readonly media: MediaService,
    private readonly posts: PostsService,
  ) {}

  private toDto(rows: CollectionRow[], postId?: string): Collection[] {
    if (!rows.length) return [];
    const list = DbClass.inList(rows.map((r) => r.id), 'c');
    const counts = new Map(
      this.db
        .all<{ collection_id: string; c: number }>(`SELECT collection_id, COUNT(*) AS c FROM collection_items WHERE collection_id IN (${list.sql}) GROUP BY collection_id`, list.params)
        .map((r) => [r.collection_id, r.c]),
    );
    // Обложка — первое медиа последней сохранённой публикации
    const covers = new Map<string, string>();
    for (const r of rows) {
      const m = this.db.get<{ media_id: string }>(
        `SELECT pm.media_id FROM collection_items ci JOIN post_media pm ON pm.post_id = ci.post_id JOIN posts p ON p.id = ci.post_id AND p.deleted_at IS NULL
         WHERE ci.collection_id = :c ORDER BY ci.added_at DESC, pm.position LIMIT 1`,
        { c: r.id },
      );
      if (m) covers.set(r.id, m.media_id);
    }
    const media = this.media.items([...covers.values()]);
    const has = postId
      ? new Set(this.db.all<{ collection_id: string }>(`SELECT collection_id FROM collection_items WHERE post_id = :p AND collection_id IN (${list.sql})`, { ...list.params, p: postId }).map((r) => r.collection_id))
      : null;
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      emoji: r.emoji,
      count: counts.get(r.id) ?? 0,
      cover: covers.has(r.id) ? (media.get(covers.get(r.id)!) ?? null) : null,
      createdAt: iso(r.created_at),
      ...(has ? { hasPost: has.has(r.id) } : {}),
    }));
  }

  private own(userId: string, id: string): CollectionRow {
    const r = this.db.get<CollectionRow>('SELECT * FROM collections WHERE id = :id AND owner_id = :u', { id, u: userId });
    if (!r) throw notFound('Коллекция не найдена');
    return r;
  }

  list(userId: string, postId?: string): Collection[] {
    return this.toDto(this.db.all<CollectionRow>('SELECT * FROM collections WHERE owner_id = :u ORDER BY created_at', { u: userId }), postId);
  }

  get(userId: string, id: string): Collection {
    return this.toDto([this.own(userId, id)])[0]!;
  }

  create(userId: string, input: { name: string; emoji: string }): Collection {
    const n = this.db.value<number>('SELECT COUNT(*) FROM collections WHERE owner_id = :u', { u: userId }) ?? 0;
    if (n >= LIMITS.collectionsMax) throw badRequest(`Не более ${LIMITS.collectionsMax} коллекций`);
    const now = Date.now();
    const id = newId(now);
    this.db.run('INSERT INTO collections (id, owner_id, name, emoji, created_at) VALUES (:id, :u, :n, :e, :now)', { id, u: userId, n: input.name, e: input.emoji || '🔖', now });
    return this.get(userId, id);
  }

  update(userId: string, id: string, input: { name: string; emoji: string }): Collection {
    this.own(userId, id);
    this.db.run('UPDATE collections SET name = :n, emoji = :e WHERE id = :id', { n: input.name, e: input.emoji || '🔖', id });
    return this.get(userId, id);
  }

  remove(userId: string, id: string): void {
    this.own(userId, id);
    this.db.run('DELETE FROM collections WHERE id = :id', { id });
  }

  /** Добавить в коллекцию (заодно — в закладки) или убрать из неё */
  setItem(userId: string, id: string, postId: string, on: boolean): Collection {
    this.own(userId, id);
    if (on) {
      this.posts.viewable(userId, postId);
      this.posts.bookmark(userId, postId, true);
      this.db.run('INSERT OR IGNORE INTO collection_items (collection_id, post_id, added_at) VALUES (:c, :p, :now)', { c: id, p: postId, now: Date.now() });
    } else {
      this.db.run('DELETE FROM collection_items WHERE collection_id = :c AND post_id = :p', { c: id, p: postId });
    }
    return this.get(userId, id);
  }

  items(userId: string, id: string, cursor: string | undefined, limit: number): Paginated<Post> {
    this.own(userId, id);
    const rows = this.db.all<PostRow & { added_at: number }>(
      `SELECT p.*, ci.added_at ${BASE_FROM} JOIN collection_items ci ON ci.post_id = p.id AND ci.collection_id = :c
       WHERE ${Policy.visiblePostsSql({ excludeMuted: false })} AND (:cursor IS NULL OR ci.added_at < :cursor)
       ORDER BY ci.added_at DESC LIMIT :limit`,
      { viewer: userId, c: id, cursor: cursor ? Number(cursor) : null, limit: limit + 1 },
    );
    return { items: this.posts.toDto(rows.slice(0, limit), userId), nextCursor: rows.length > limit ? String(rows[limit - 1]!.added_at) : null };
  }
}
