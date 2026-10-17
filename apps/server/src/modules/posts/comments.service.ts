/**
 * Комментарии с ветками (2 уровня, как в YouTube/Instagram): ответ на ответ
 * прикрепляется к корневому комментарию, чтобы обсуждение оставалось читаемым
 * на телефоне. Работают одинаково для заметок, фото, видео и клипов.
 */
import type { Comment, Paginated } from '@omni/shared';
import type { Db } from '../../db/index.js';
import { iso, isoOrNull } from '../../db/index.js';
import { badRequest, forbidden, notFound, privacyRestricted } from '../../lib/errors.js';
import { newId } from '../../lib/ids.js';
import { extractMentions } from '@omni/shared';
import type { NotificationService } from '../notifications/notifications.service.js';
import type { Policy } from '../policy/policy.service.js';
import { privacyOf, type UsersRepo } from '../users/users.repo.js';
import { offsetCursor } from '../users/users.service.js';
import type { PostsService } from './posts.service.js';

interface CommentRow {
  id: string;
  post_id: string;
  author_id: string;
  parent_id: string | null;
  text: string;
  like_count: number;
  reply_count: number;
  created_at: number;
  edited_at: number | null;
  deleted_at: number | null;
}

const NOT_BLOCKED = `NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker_id = :viewer AND b.blocked_id = c.author_id)
                                                  OR (b.blocker_id = c.author_id AND b.blocked_id = :viewer))`;

export class CommentsService {
  constructor(
    private readonly db: Db,
    private readonly users: UsersRepo,
    private readonly policy: Policy,
    private readonly posts: PostsService,
    private readonly notifications: NotificationService,
  ) {}

  private toDto(rows: CommentRow[], viewerId: string): Comment[] {
    if (!rows.length) return [];
    const authors = this.users.summaries(rows.map((r) => r.author_id));
    const placeholders = rows.map((_, i) => `:c${i}`).join(',');
    const params = Object.fromEntries(rows.map((r, i) => [`c${i}`, r.id]));
    const liked = new Set(
      this.db
        .all<{ comment_id: string }>(`SELECT comment_id FROM comment_likes WHERE user_id = :v AND comment_id IN (${placeholders})`, {
          ...params,
          v: viewerId,
        })
        .map((r) => r.comment_id),
    );
    return rows.map((r) => ({
      id: r.id,
      postId: r.post_id,
      parentId: r.parent_id,
      author: authors.get(r.author_id)!,
      text: r.deleted_at ? '' : r.text,
      likes: r.like_count,
      liked: liked.has(r.id),
      replyCount: r.reply_count,
      createdAt: iso(r.created_at),
      editedAt: isoOrNull(r.edited_at),
      deleted: !!r.deleted_at,
    }));
  }

  list(viewerId: string, postId: string, sort: 'top' | 'new', cursor: string | undefined, limit: number): Paginated<Comment> {
    this.posts.viewable(viewerId, postId);
    const offset = offsetCursor.decode(cursor);
    const order = sort === 'top' ? '(c.like_count * 2 + c.reply_count) DESC, c.id DESC' : 'c.id DESC';
    const rows = this.db.all<CommentRow>(
      `SELECT c.* FROM comments c WHERE c.post_id = :p AND c.parent_id IS NULL AND ${NOT_BLOCKED}
         AND (c.deleted_at IS NULL OR c.reply_count > 0)
       ORDER BY ${order} LIMIT :l OFFSET :o`,
      { p: postId, viewer: viewerId, l: limit + 1, o: offset },
    );
    return { items: this.toDto(rows.slice(0, limit), viewerId), nextCursor: offsetCursor.next(offset, rows.length, limit) };
  }

  replies(viewerId: string, commentId: string, cursor: string | undefined, limit: number): Paginated<Comment> {
    const parent = this.db.get<CommentRow>('SELECT * FROM comments WHERE id = :id', { id: commentId });
    if (!parent) throw notFound('Комментарий не найден');
    this.posts.viewable(viewerId, parent.post_id);
    const rows = this.db.all<CommentRow>(
      `SELECT c.* FROM comments c WHERE c.parent_id = :id AND c.deleted_at IS NULL AND ${NOT_BLOCKED}
         AND (:cursor IS NULL OR c.id > :cursor)
       ORDER BY c.id ASC LIMIT :l`,
      { id: commentId, viewer: viewerId, cursor: cursor ?? null, l: limit + 1 },
    );
    return { items: this.toDto(rows.slice(0, limit), viewerId), nextCursor: rows.length > limit ? (rows[limit - 1]?.id ?? null) : null };
  }

  create(viewerId: string, postId: string, input: { text: string; parentId?: string }): Comment {
    const post = this.posts.viewable(viewerId, postId);
    if (post.comments_disabled) throw forbidden('Автор отключил комментарии');
    const author = this.users.byId(post.author_id)!;
    if (!this.policy.canComment(viewerId, author)) throw privacyRestricted('Автор ограничил круг комментирующих');

    let parent: CommentRow | undefined;
    if (input.parentId) {
      parent = this.db.get<CommentRow>('SELECT * FROM comments WHERE id = :id', { id: input.parentId });
      if (!parent || parent.post_id !== postId) throw badRequest('Комментарий для ответа не найден');
      if (this.policy.blockedEitherWay(viewerId, parent.author_id)) throw forbidden();
    }
    const replyTarget = parent;
    const rootId = parent ? (parent.parent_id ?? parent.id) : null;

    const now = Date.now();
    const id = newId(now);
    this.db.tx(() => {
      this.db.run(
        'INSERT INTO comments (id, post_id, author_id, parent_id, text, created_at) VALUES (:id, :p, :a, :parent, :t, :now)',
        { id, p: postId, a: viewerId, parent: rootId, t: input.text, now },
      );
      this.db.run('UPDATE posts SET comment_count = comment_count + 1 WHERE id = :p', { p: postId });
      if (rootId) this.db.run('UPDATE comments SET reply_count = reply_count + 1 WHERE id = :r', { r: rootId });
    });

    const link = `/post/${postId}?comment=${id}`;
    this.notifications.notify({
      userId: post.author_id,
      type: 'comment',
      actorId: viewerId,
      entityType: 'comment',
      entityId: id,
      link,
      preview: input.text,
    });
    if (replyTarget && replyTarget.author_id !== post.author_id) {
      this.notifications.notify({
        userId: replyTarget.author_id,
        type: 'reply',
        actorId: viewerId,
        entityType: 'comment',
        entityId: id,
        link,
        preview: input.text,
      });
    }
    for (const username of extractMentions(input.text).slice(0, 10)) {
      const target = this.users.byUsername(username);
      if (!target || target.id === post.author_id || target.id === replyTarget?.author_id) continue;
      if (!privacyOf(target).allowTagging || !this.policy.canViewPost(target.id, post, author)) continue;
      this.notifications.notify({ userId: target.id, type: 'mention', actorId: viewerId, entityType: 'comment', entityId: id, link, preview: input.text });
    }
    return this.toDto([this.db.get<CommentRow>('SELECT * FROM comments WHERE id = :id', { id })!], viewerId)[0]!;
  }

  update(viewerId: string, id: string, text: string): Comment {
    const c = this.db.get<CommentRow>('SELECT * FROM comments WHERE id = :id AND deleted_at IS NULL', { id });
    if (!c) throw notFound('Комментарий не найден');
    if (c.author_id !== viewerId) throw forbidden('Редактировать может только автор');
    this.db.run('UPDATE comments SET text = :t, edited_at = :now WHERE id = :id', { t: text, now: Date.now(), id });
    return this.toDto([{ ...c, text, edited_at: Date.now() }], viewerId)[0]!;
  }

  remove(viewerId: string, id: string): void {
    const c = this.db.get<CommentRow>('SELECT * FROM comments WHERE id = :id AND deleted_at IS NULL', { id });
    if (!c) throw notFound('Комментарий не найден');
    const post = this.posts.row(c.post_id);
    // Удалить может автор комментария или автор публикации (модерация своих обсуждений)
    if (c.author_id !== viewerId && post?.author_id !== viewerId) throw forbidden();
    this.db.tx(() => {
      this.db.run("UPDATE comments SET deleted_at = :now, text = '' WHERE id = :id", { now: Date.now(), id });
      this.db.run('UPDATE posts SET comment_count = max(comment_count - 1, 0) WHERE id = :p', { p: c.post_id });
      if (c.parent_id) this.db.run('UPDATE comments SET reply_count = max(reply_count - 1, 0) WHERE id = :r', { r: c.parent_id });
    });
  }

  like(viewerId: string, id: string, on: boolean): Comment {
    const c = this.db.get<CommentRow>('SELECT * FROM comments WHERE id = :id AND deleted_at IS NULL', { id });
    if (!c) throw notFound('Комментарий не найден');
    this.posts.viewable(viewerId, c.post_id);
    if (on) {
      const r = this.db.run('INSERT OR IGNORE INTO comment_likes (comment_id, user_id, created_at) VALUES (:c, :u, :now)', {
        c: id,
        u: viewerId,
        now: Date.now(),
      });
      if (r.changes) this.db.run('UPDATE comments SET like_count = like_count + 1 WHERE id = :c', { c: id });
    } else {
      const r = this.db.run('DELETE FROM comment_likes WHERE comment_id = :c AND user_id = :u', { c: id, u: viewerId });
      if (r.changes) this.db.run('UPDATE comments SET like_count = max(like_count - 1, 0) WHERE id = :c', { c: id });
    }
    return this.toDto([this.db.get<CommentRow>('SELECT * FROM comments WHERE id = :id', { id })!], viewerId)[0]!;
  }
}
