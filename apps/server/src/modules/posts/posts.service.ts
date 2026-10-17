/**
 * Единая модель контента: заметки (как в X), фото (Instagram), видео (YouTube)
 * и клипы (TikTok) — это один тип Post с разным kind. Лайки, комментарии,
 * репосты, закладки, история и рекомендации работают одинаково для всех видов,
 * поэтому новый формат (например, аудио или прямые эфиры) добавляется без
 * переделки остальных модулей.
 */
import type { CreatePostInput, Hashtag, HistoryEntry, MediaKind, Paginated, Playlist, Post, PostKind } from '@omni/shared';
import { extractHashtags, extractMentions } from '@omni/shared';
import type { Db } from '../../db/index.js';
import { bool, Db as DbClass, iso, isoOrNull } from '../../db/index.js';
import { badRequest, conflict, forbidden, notFound } from '../../lib/errors.js';
import { newId } from '../../lib/ids.js';
import type { MediaService } from '../media/media.service.js';
import type { NotificationService } from '../notifications/notifications.service.js';
import { Policy } from '../policy/policy.service.js';
import { privacyOf, type UsersRepo } from '../users/users.repo.js';
import { offsetCursor } from '../users/users.service.js';

export interface PostRow {
  id: string;
  author_id: string;
  kind: PostKind;
  title: string | null;
  text: string;
  visibility: 'public' | 'followers' | 'private';
  community_id: string | null;
  repost_of_id: string | null;
  comments_disabled: number;
  like_count: number;
  comment_count: number;
  repost_count: number;
  view_count: number;
  created_at: number;
  edited_at: number | null;
  deleted_at: number | null;
}

export type FeedMode = 'for-you' | 'following' | 'latest' | 'trending';

const MEDIA_RULES: Record<PostKind, { kinds: MediaKind[]; min: number; max: number }> = {
  note: { kinds: ['image', 'video'], min: 0, max: 4 },
  photo: { kinds: ['image'], min: 1, max: 10 },
  video: { kinds: ['video'], min: 1, max: 1 },
  short: { kinds: ['video'], min: 1, max: 1 },
};

const BASE_FROM = `FROM posts p JOIN users u ON u.id = p.author_id LEFT JOIN communities c ON c.id = p.community_id`;
/** Вовлечённость с затуханием по времени (как в HN/Reddit): свежие и обсуждаемые — выше. */
const SCORE_SQL = `((p.like_count * 2.0 + p.comment_count * 3.0 + p.repost_count * 4.0 + p.view_count * 0.05 + 1.0)
  * (CASE WHEN EXISTS (SELECT 1 FROM follows ff WHERE ff.follower_id = :viewer AND ff.followee_id = p.author_id AND ff.status = 'accepted') THEN 1.7 ELSE 1.0 END)
  / (((:now - p.created_at) / 3600000.0 + 2.0) * ((:now - p.created_at) / 3600000.0 + 2.0)))`;

export class PostsService {
  constructor(
    private readonly db: Db,
    private readonly users: UsersRepo,
    private readonly policy: Policy,
    private readonly media: MediaService,
    private readonly notifications: NotificationService,
  ) {}

  row(id: string): PostRow | undefined {
    return this.db.get<PostRow>('SELECT * FROM posts WHERE id = :id', { id });
  }

  /** Пост, доступный зрителю, иначе 404 (не раскрываем существование скрытого контента). */
  viewable(viewerId: string, id: string): PostRow {
    const p = this.row(id);
    if (!p) throw notFound('Публикация не найдена');
    const author = this.users.byId(p.author_id);
    if (!author || !this.policy.canViewPost(viewerId, p, author)) throw notFound('Публикация не найдена');
    return p;
  }

  // ─── Создание и изменение ─────────────────────────────────────────────────

  create(userId: string, input: CreatePostInput): Post {
    if (input.repostOfId) return this.repost(userId, input.repostOfId, input.text, input.visibility);
    const rule = MEDIA_RULES[input.kind];
    if (input.mediaIds.length < rule.min || input.mediaIds.length > rule.max) {
      throw badRequest(`Для этого формата нужно файлов: от ${rule.min} до ${rule.max}`, { mediaIds: 'Неверное количество файлов' });
    }
    this.media.assertOwned(userId, input.mediaIds, rule.kinds);
    if (input.communityId) {
      const member = this.db.get('SELECT 1 FROM community_members WHERE community_id = :c AND user_id = :u', { c: input.communityId, u: userId });
      if (!member) throw forbidden('Публиковать могут только участники сообщества');
    }
    const now = Date.now();
    const id = newId(now);
    this.db.tx(() => {
      this.db.run(
        `INSERT INTO posts (id, author_id, kind, title, text, visibility, community_id, comments_disabled, created_at)
         VALUES (:id, :author, :kind, :title, :text, :vis, :community, :cd, :now)`,
        {
          id,
          author: userId,
          kind: input.kind,
          title: input.title || null,
          text: input.text,
          vis: input.communityId ? 'public' : input.visibility,
          community: input.communityId ?? null,
          cd: input.commentsDisabled,
          now,
        },
      );
      input.mediaIds.forEach((mediaId, position) =>
        this.db.run('INSERT INTO post_media (post_id, media_id, position) VALUES (:p, :m, :pos)', { p: id, m: mediaId, pos: position }),
      );
      this.indexHashtags(id, `${input.title ?? ''} ${input.text}`, now);
      if (input.communityId) this.db.run('UPDATE communities SET post_count = post_count + 1 WHERE id = :c', { c: input.communityId });
    });
    this.notifyMentions(userId, id, input.text);
    return this.get(userId, id);
  }

  private repost(userId: string, originalId: string, text: string, visibility: Post['visibility']): Post {
    let original = this.viewable(userId, originalId);
    // Репост репоста → репостим оригинал
    if (original.repost_of_id && !original.text) original = this.viewable(userId, original.repost_of_id);
    if (original.visibility !== 'public') throw forbidden('Эту публикацию нельзя репостить');
    const isQuote = text.length > 0;
    if (!isQuote) {
      const exists = this.db.get(
        "SELECT 1 FROM posts WHERE author_id = :u AND repost_of_id = :o AND text = '' AND deleted_at IS NULL",
        { u: userId, o: original.id },
      );
      if (exists) throw conflict('Вы уже сделали репост');
    }
    const now = Date.now();
    const id = newId(now);
    this.db.tx(() => {
      this.db.run(
        `INSERT INTO posts (id, author_id, kind, text, visibility, repost_of_id, created_at)
         VALUES (:id, :u, 'note', :text, :vis, :o, :now)`,
        { id, u: userId, text, vis: visibility, o: original.id, now },
      );
      this.db.run('UPDATE posts SET repost_count = repost_count + 1 WHERE id = :o', { o: original.id });
      if (isQuote) this.indexHashtags(id, text, now);
    });
    this.notifications.notify({
      userId: original.author_id,
      type: 'repost',
      actorId: userId,
      entityType: 'post',
      entityId: original.id,
      link: `/post/${original.id}`,
      preview: isQuote ? text : (original.title ?? original.text),
    });
    if (isQuote) this.notifyMentions(userId, id, text);
    return this.get(userId, id);
  }

  undoRepost(userId: string, originalId: string): void {
    const row = this.db.get<{ id: string }>(
      "SELECT id FROM posts WHERE author_id = :u AND repost_of_id = :o AND text = '' AND deleted_at IS NULL",
      { u: userId, o: originalId },
    );
    if (row) this.remove(userId, row.id);
  }

  private indexHashtags(postId: string, text: string, now: number): void {
    this.db.run('DELETE FROM post_hashtags WHERE post_id = :p', { p: postId });
    for (const tag of extractHashtags(text)) {
      this.db.run('INSERT OR IGNORE INTO post_hashtags (tag, post_id, created_at) VALUES (:t, :p, :now)', { t: tag, p: postId, now });
    }
  }

  private notifyMentions(authorId: string, postId: string, text: string): void {
    const post = this.row(postId)!;
    for (const username of extractMentions(text).slice(0, 10)) {
      const target = this.users.byUsername(username);
      if (!target || target.id === authorId || !privacyOf(target).allowTagging) continue;
      const author = this.users.byId(authorId)!;
      if (!this.policy.canViewPost(target.id, post, author)) continue;
      this.notifications.notify({
        userId: target.id,
        type: 'mention',
        actorId: authorId,
        entityType: 'post',
        entityId: postId,
        link: `/post/${postId}`,
        preview: text,
      });
    }
  }

  update(userId: string, id: string, input: Partial<{ text: string; title: string; commentsDisabled: boolean; visibility: Post['visibility'] }>): Post {
    const p = this.row(id);
    if (!p || p.deleted_at) throw notFound('Публикация не найдена');
    if (p.author_id !== userId) throw forbidden('Редактировать может только автор');
    if (p.repost_of_id && !p.text && input.text) throw badRequest('Репост нельзя отредактировать');
    const now = Date.now();
    this.db.tx(() => {
      this.db.run(
        `UPDATE posts SET text = coalesce(:text, text), title = coalesce(:title, title),
           comments_disabled = coalesce(:cd, comments_disabled), visibility = coalesce(:vis, visibility),
           edited_at = CASE WHEN :text IS NOT NULL OR :title IS NOT NULL THEN :now ELSE edited_at END
         WHERE id = :id`,
        {
          text: input.text ?? null,
          title: input.title ?? null,
          cd: input.commentsDisabled ?? null,
          vis: p.community_id ? null : (input.visibility ?? null),
          now,
          id,
        },
      );
      if (input.text !== undefined || input.title !== undefined) {
        const updated = this.row(id)!;
        this.indexHashtags(id, `${updated.title ?? ''} ${updated.text}`, p.created_at);
      }
    });
    return this.get(userId, id);
  }

  remove(userId: string, id: string): void {
    const p = this.row(id);
    if (!p || p.deleted_at) throw notFound('Публикация не найдена');
    let allowed = p.author_id === userId;
    if (!allowed && p.community_id) {
      allowed = !!this.db.get(
        "SELECT 1 FROM community_members WHERE community_id = :c AND user_id = :u AND role IN ('owner', 'moderator')",
        { c: p.community_id, u: userId },
      );
    }
    if (!allowed) throw forbidden('Удалить может только автор');
    this.db.tx(() => {
      this.db.run('UPDATE posts SET deleted_at = :now WHERE id = :id', { now: Date.now(), id });
      this.db.run('DELETE FROM post_hashtags WHERE post_id = :id', { id });
      if (p.repost_of_id) this.db.run('UPDATE posts SET repost_count = max(repost_count - 1, 0) WHERE id = :o', { o: p.repost_of_id });
      if (p.community_id) this.db.run('UPDATE communities SET post_count = max(post_count - 1, 0) WHERE id = :c', { c: p.community_id });
    });
  }

  // ─── Чтение ───────────────────────────────────────────────────────────────

  get(viewerId: string, id: string): Post {
    const p = this.viewable(viewerId, id);
    return this.toDto([p], viewerId)[0]!;
  }

  toDto(rows: PostRow[], viewerId: string, depth = 0): Post[] {
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.id);
    const list = DbClass.inList(ids, 'p');
    const authors = this.users.summaries(rows.map((r) => r.author_id));

    const links = this.db.all<{ post_id: string; media_id: string }>(
      `SELECT post_id, media_id FROM post_media WHERE post_id IN (${list.sql}) ORDER BY position`,
      list.params,
    );
    const mediaItems = this.media.items(links.map((l) => l.media_id));
    const mediaBy = new Map<string, string[]>();
    for (const l of links) mediaBy.set(l.post_id, [...(mediaBy.get(l.post_id) ?? []), l.media_id]);

    const tags = new Map<string, string[]>();
    for (const t of this.db.all<{ post_id: string; tag: string }>(`SELECT post_id, tag FROM post_hashtags WHERE post_id IN (${list.sql})`, list.params)) {
      tags.set(t.post_id, [...(tags.get(t.post_id) ?? []), t.tag]);
    }

    const set = (sql: string) => new Set(this.db.all<{ id: string }>(sql, { ...list.params, v: viewerId }).map((r) => r.id));
    const liked = set(`SELECT post_id AS id FROM post_likes WHERE user_id = :v AND post_id IN (${list.sql})`);
    const bookmarked = set(`SELECT post_id AS id FROM bookmarks WHERE user_id = :v AND post_id IN (${list.sql})`);
    const later = set(`SELECT post_id AS id FROM watch_later WHERE user_id = :v AND post_id IN (${list.sql})`);
    const reposted = set(
      `SELECT repost_of_id AS id FROM posts WHERE author_id = :v AND text = '' AND deleted_at IS NULL AND repost_of_id IN (${list.sql})`,
    );

    const communityIds = [...new Set(rows.map((r) => r.community_id).filter((v): v is string => !!v))];
    const communities = new Map<string, { id: string; slug: string; name: string }>();
    if (communityIds.length) {
      const cl = DbClass.inList(communityIds, 'c');
      for (const c of this.db.all<{ id: string; slug: string; name: string }>(`SELECT id, slug, name FROM communities WHERE id IN (${cl.sql})`, cl.params)) {
        communities.set(c.id, c);
      }
    }

    const originals = new Map<string, Post>();
    if (depth === 0) {
      const origIds = [...new Set(rows.map((r) => r.repost_of_id).filter((v): v is string => !!v))];
      const visible: PostRow[] = [];
      for (const oid of origIds) {
        const o = this.row(oid);
        const author = o ? this.users.byId(o.author_id) : undefined;
        if (o && author && this.policy.canViewPost(viewerId, o, author)) visible.push(o);
      }
      for (const o of this.toDto(visible, viewerId, 1)) originals.set(o.id, o);
    }

    return rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      author: authors.get(r.author_id)!,
      title: r.title,
      text: r.text,
      media: (mediaBy.get(r.id) ?? []).map((id) => mediaItems.get(id)).filter((m) => !!m),
      hashtags: tags.get(r.id) ?? [],
      visibility: r.visibility,
      community: r.community_id ? (communities.get(r.community_id) ?? null) : null,
      repostOf: r.repost_of_id ? (originals.get(r.repost_of_id) ?? null) : null,
      commentsDisabled: bool(r.comments_disabled),
      stats: { likes: r.like_count, comments: r.comment_count, reposts: r.repost_count, views: r.view_count },
      viewer: { liked: liked.has(r.id), bookmarked: bookmarked.has(r.id), reposted: reposted.has(r.id), watchLater: later.has(r.id) },
      createdAt: iso(r.created_at),
      editedAt: isoOrNull(r.edited_at),
    }));
  }

  feed(viewerId: string, mode: FeedMode, kind: PostKind | 'all', cursor: string | undefined, limit: number): Paginated<Post> {
    const params: Record<string, unknown> = { viewer: viewerId, now: Date.now(), kind: kind === 'all' ? null : kind, limit: limit + 1 };
    const kindSql = '(:kind IS NULL OR p.kind = :kind)';
    const visible = Policy.visiblePostsSql();

    if (mode === 'following' || mode === 'latest') {
      const followSql =
        mode === 'following'
          ? `AND (p.author_id = :viewer OR EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = :viewer AND f.followee_id = p.author_id AND f.status = 'accepted'))`
          : 'AND p.community_id IS NULL';
      params.cursor = cursor ?? null;
      // Репосты показываем в ленте заметок, а в видео/фото/клипах — только оригиналы
      const repostSql = kind === 'all' || kind === 'note' ? '' : 'AND p.repost_of_id IS NULL';
      const rows = this.db.all<PostRow>(
        `SELECT p.* ${BASE_FROM} WHERE ${visible} AND ${kindSql} ${followSql} ${repostSql}
           AND (:cursor IS NULL OR p.id < :cursor)
         ORDER BY p.id DESC LIMIT :limit`,
        params,
      );
      const items = this.toDto(rows.slice(0, limit), viewerId);
      return { items, nextCursor: rows.length > limit ? (rows[limit - 1]?.id ?? null) : null };
    }

    const offset = offsetCursor.decode(cursor);
    params.offset = offset;
    const windowSql = mode === 'trending' ? 'AND p.created_at > :since' : '';
    params.since = Date.now() - 7 * 24 * 3600 * 1000;
    const order = mode === 'trending' ? '(p.like_count * 2 + p.comment_count * 3 + p.repost_count * 4 + p.view_count * 0.05) DESC, p.id DESC' : `${SCORE_SQL} DESC, p.id DESC`;
    const rows = this.db.all<PostRow>(
      `SELECT p.* ${BASE_FROM} WHERE ${visible} AND ${kindSql} AND p.repost_of_id IS NULL ${windowSql}
       ORDER BY ${order} LIMIT :limit OFFSET :offset`,
      params,
    );
    return { items: this.toDto(rows.slice(0, limit), viewerId), nextCursor: offsetCursor.next(offset, rows.length, limit) };
  }

  userPosts(
    viewerId: string,
    userId: string,
    tab: 'posts' | 'media' | 'likes' | PostKind,
    cursor: string | undefined,
    limit: number,
  ): Paginated<Post> {
    const author = this.users.byId(userId);
    if (!author) throw notFound('Пользователь не найден');
    if (!this.policy.canViewContent(viewerId, author)) return { items: [], nextCursor: null };
    const params: Record<string, unknown> = { viewer: viewerId, u: userId, cursor: cursor ?? null, limit: limit + 1 };
    const visible = Policy.visiblePostsSql({ excludeMuted: false });
    let where = 'p.author_id = :u';
    if (tab === 'media') where += " AND p.kind IN ('photo', 'video', 'short')";
    else if (tab === 'note' || tab === 'photo' || tab === 'video' || tab === 'short') {
      where += ` AND p.kind = '${tab}'`;
      if (tab !== 'note') where += ' AND p.repost_of_id IS NULL';
    }
    if (tab === 'likes') {
      if (viewerId !== userId) return { items: [], nextCursor: null }; // лайки приватны
      const rows = this.db.all<PostRow & { liked_at: number }>(
        `SELECT p.*, l.created_at AS liked_at ${BASE_FROM} JOIN post_likes l ON l.post_id = p.id AND l.user_id = :u
         WHERE ${visible} AND (:cursor IS NULL OR l.created_at < :cursor) ORDER BY l.created_at DESC LIMIT :limit`,
        { ...params, cursor: cursor ? Number(cursor) : null },
      );
      return {
        items: this.toDto(rows.slice(0, limit), viewerId),
        nextCursor: rows.length > limit ? String(rows[limit - 1]!.liked_at) : null,
      };
    }
    const rows = this.db.all<PostRow>(
      `SELECT p.* ${BASE_FROM} WHERE ${visible} AND ${where} AND (:cursor IS NULL OR p.id < :cursor) ORDER BY p.id DESC LIMIT :limit`,
      params,
    );
    return { items: this.toDto(rows.slice(0, limit), viewerId), nextCursor: rows.length > limit ? (rows[limit - 1]?.id ?? null) : null };
  }

  communityPosts(viewerId: string, communityId: string, cursor: string | undefined, limit: number): Paginated<Post> {
    if (!this.policy.canViewCommunity(viewerId, communityId)) return { items: [], nextCursor: null };
    const rows = this.db.all<PostRow>(
      `SELECT p.* ${BASE_FROM} WHERE ${Policy.visiblePostsSql()} AND p.community_id = :c AND (:cursor IS NULL OR p.id < :cursor)
       ORDER BY p.id DESC LIMIT :limit`,
      { viewer: viewerId, c: communityId, cursor: cursor ?? null, limit: limit + 1 },
    );
    return { items: this.toDto(rows.slice(0, limit), viewerId), nextCursor: rows.length > limit ? (rows[limit - 1]?.id ?? null) : null };
  }

  /** Похожие публикации: тот же автор или общие хэштеги, того же вида. */
  related(viewerId: string, postId: string, limit = 12): Post[] {
    const p = this.viewable(viewerId, postId);
    const rows = this.db.all<PostRow>(
      `SELECT p.* ${BASE_FROM}
       WHERE ${Policy.visiblePostsSql()} AND p.id != :id AND p.kind = :kind AND p.repost_of_id IS NULL
       ORDER BY (p.author_id = :author) + (SELECT COUNT(*) FROM post_hashtags a JOIN post_hashtags b ON a.tag = b.tag
                                           WHERE a.post_id = :id AND b.post_id = p.id) * 2 DESC,
                p.view_count DESC, p.id DESC
       LIMIT :limit`,
      { viewer: viewerId, id: p.id, kind: p.kind, author: p.author_id, limit },
    );
    return this.toDto(rows, viewerId);
  }

  // ─── Реакции зрителя ──────────────────────────────────────────────────────

  like(viewerId: string, postId: string, on: boolean): Post {
    const p = this.viewable(viewerId, postId);
    if (on) {
      const r = this.db.run('INSERT OR IGNORE INTO post_likes (post_id, user_id, created_at) VALUES (:p, :u, :now)', {
        p: postId,
        u: viewerId,
        now: Date.now(),
      });
      if (r.changes) {
        this.db.run('UPDATE posts SET like_count = like_count + 1 WHERE id = :p', { p: postId });
        this.notifications.notify({
          userId: p.author_id,
          type: 'like',
          actorId: viewerId,
          entityType: 'post',
          entityId: postId,
          link: `/post/${postId}`,
          preview: p.title ?? p.text,
        });
      }
    } else {
      const r = this.db.run('DELETE FROM post_likes WHERE post_id = :p AND user_id = :u', { p: postId, u: viewerId });
      if (r.changes) this.db.run('UPDATE posts SET like_count = max(like_count - 1, 0) WHERE id = :p', { p: postId });
    }
    return this.get(viewerId, postId);
  }

  bookmark(viewerId: string, postId: string, on: boolean): void {
    this.viewable(viewerId, postId);
    if (on) {
      this.db.run('INSERT OR IGNORE INTO bookmarks (user_id, post_id, created_at) VALUES (:u, :p, :now)', { u: viewerId, p: postId, now: Date.now() });
    } else {
      this.db.run('DELETE FROM bookmarks WHERE user_id = :u AND post_id = :p', { u: viewerId, p: postId });
    }
  }

  watchLater(viewerId: string, postId: string, on: boolean): void {
    this.viewable(viewerId, postId);
    if (on) {
      this.db.run('INSERT OR IGNORE INTO watch_later (user_id, post_id, created_at) VALUES (:u, :p, :now)', { u: viewerId, p: postId, now: Date.now() });
    } else {
      this.db.run('DELETE FROM watch_later WHERE user_id = :u AND post_id = :p', { u: viewerId, p: postId });
    }
  }

  /** Просмотр: засчитывается не чаще раза в сутки на пользователя, прогресс сохраняется в историю. */
  view(viewerId: string, postId: string, progressSec: number): void {
    this.viewable(viewerId, postId);
    const now = Date.now();
    const existing = this.db.get<{ counted_at: number }>('SELECT counted_at FROM view_history WHERE user_id = :u AND post_id = :p', {
      u: viewerId,
      p: postId,
    });
    const count = !existing || now - existing.counted_at > 24 * 3600 * 1000;
    this.db.run(
      `INSERT INTO view_history (user_id, post_id, progress_sec, viewed_at, counted_at) VALUES (:u, :p, :prog, :now, :now)
       ON CONFLICT (user_id, post_id) DO UPDATE SET progress_sec = :prog, viewed_at = :now,
         counted_at = CASE WHEN :count = 1 THEN :now ELSE counted_at END`,
      { u: viewerId, p: postId, prog: progressSec, now, count },
    );
    if (count) this.db.run('UPDATE posts SET view_count = view_count + 1 WHERE id = :p', { p: postId });
  }

  private listJoined(
    viewerId: string,
    table: 'bookmarks' | 'watch_later',
    kind: PostKind | 'all',
    cursor: string | undefined,
    limit: number,
  ): Paginated<Post> {
    const rows = this.db.all<PostRow & { joined_at: number }>(
      `SELECT p.*, j.created_at AS joined_at ${BASE_FROM} JOIN ${table} j ON j.post_id = p.id AND j.user_id = :viewer
       WHERE ${Policy.visiblePostsSql({ excludeMuted: false })} AND (:kind IS NULL OR p.kind = :kind)
         AND (:cursor IS NULL OR j.created_at < :cursor)
       ORDER BY j.created_at DESC LIMIT :limit`,
      { viewer: viewerId, kind: kind === 'all' ? null : kind, cursor: cursor ? Number(cursor) : null, limit: limit + 1 },
    );
    return { items: this.toDto(rows.slice(0, limit), viewerId), nextCursor: rows.length > limit ? String(rows[limit - 1]!.joined_at) : null };
  }

  bookmarks(viewerId: string, kind: PostKind | 'all', cursor: string | undefined, limit: number) {
    return this.listJoined(viewerId, 'bookmarks', kind, cursor, limit);
  }

  watchLaterList(viewerId: string, cursor: string | undefined, limit: number) {
    return this.listJoined(viewerId, 'watch_later', 'all', cursor, limit);
  }

  liked(viewerId: string, kind: PostKind | 'all', cursor: string | undefined, limit: number): Paginated<Post> {
    const rows = this.db.all<PostRow & { liked_at: number }>(
      `SELECT p.*, l.created_at AS liked_at ${BASE_FROM} JOIN post_likes l ON l.post_id = p.id AND l.user_id = :viewer
       WHERE ${Policy.visiblePostsSql({ excludeMuted: false })} AND (:kind IS NULL OR p.kind = :kind)
         AND (:cursor IS NULL OR l.created_at < :cursor)
       ORDER BY l.created_at DESC LIMIT :limit`,
      { viewer: viewerId, kind: kind === 'all' ? null : kind, cursor: cursor ? Number(cursor) : null, limit: limit + 1 },
    );
    return { items: this.toDto(rows.slice(0, limit), viewerId), nextCursor: rows.length > limit ? String(rows[limit - 1]!.liked_at) : null };
  }

  history(viewerId: string, kind: PostKind | 'all', cursor: string | undefined, limit: number): Paginated<HistoryEntry> {
    const rows = this.db.all<PostRow & { h_viewed: number; h_progress: number }>(
      `SELECT p.*, h.viewed_at AS h_viewed, h.progress_sec AS h_progress ${BASE_FROM}
       JOIN view_history h ON h.post_id = p.id AND h.user_id = :viewer
       WHERE ${Policy.visiblePostsSql({ excludeMuted: false })} AND (:kind IS NULL OR p.kind = :kind)
         AND (:cursor IS NULL OR h.viewed_at < :cursor)
       ORDER BY h.viewed_at DESC LIMIT :limit`,
      { viewer: viewerId, kind: kind === 'all' ? null : kind, cursor: cursor ? Number(cursor) : null, limit: limit + 1 },
    );
    const page = rows.slice(0, limit);
    const posts = this.toDto(page, viewerId);
    return {
      items: posts.map((post, i) => ({ post, viewedAt: iso(page[i]!.h_viewed), progressSec: page[i]!.h_progress })),
      nextCursor: rows.length > limit ? String(rows[limit - 1]!.h_viewed) : null,
    };
  }

  clearHistory(viewerId: string, postId?: string): void {
    if (postId) this.db.run('DELETE FROM view_history WHERE user_id = :u AND post_id = :p', { u: viewerId, p: postId });
    else this.db.run('DELETE FROM view_history WHERE user_id = :u', { u: viewerId });
  }

  // ─── Хэштеги и тренды ─────────────────────────────────────────────────────

  trendingHashtags(days = 7, limit = 20): Hashtag[] {
    return this.db.all<Hashtag>(
      `SELECT h.tag, COUNT(*) AS count FROM post_hashtags h JOIN posts p ON p.id = h.post_id
       WHERE h.created_at > :since AND p.deleted_at IS NULL AND p.visibility = 'public'
       GROUP BY h.tag ORDER BY count DESC, MAX(h.created_at) DESC LIMIT :limit`,
      { since: Date.now() - days * 24 * 3600 * 1000, limit },
    );
  }

  hashtagPosts(viewerId: string, tag: string, cursor: string | undefined, limit: number): Paginated<Post> {
    const rows = this.db.all<PostRow>(
      `SELECT p.* ${BASE_FROM} JOIN post_hashtags h ON h.post_id = p.id AND h.tag = :tag
       WHERE ${Policy.visiblePostsSql()} AND (:cursor IS NULL OR p.id < :cursor) ORDER BY p.id DESC LIMIT :limit`,
      { viewer: viewerId, tag: tag.toLowerCase(), cursor: cursor ?? null, limit: limit + 1 },
    );
    return { items: this.toDto(rows.slice(0, limit), viewerId), nextCursor: rows.length > limit ? (rows[limit - 1]?.id ?? null) : null };
  }

  // ─── Студия автора ────────────────────────────────────────────────────────

  studio(userId: string) {
    const totals = this.db.get<Record<string, number>>(
      `SELECT COUNT(*) AS posts, coalesce(SUM(view_count), 0) AS views, coalesce(SUM(like_count), 0) AS likes,
              coalesce(SUM(comment_count), 0) AS comments, coalesce(SUM(repost_count), 0) AS reposts
       FROM posts WHERE author_id = :u AND deleted_at IS NULL AND repost_of_id IS NULL`,
      { u: userId },
    )!;
    const byKind = this.db.all<{ kind: PostKind; posts: number; views: number; likes: number }>(
      `SELECT kind, COUNT(*) AS posts, coalesce(SUM(view_count), 0) AS views, coalesce(SUM(like_count), 0) AS likes
       FROM posts WHERE author_id = :u AND deleted_at IS NULL AND repost_of_id IS NULL GROUP BY kind`,
      { u: userId },
    );
    const followers = this.db.value<number>("SELECT COUNT(*) FROM follows WHERE followee_id = :u AND status = 'accepted'", { u: userId }) ?? 0;
    const top = this.db.all<PostRow>(
      `SELECT * FROM posts WHERE author_id = :u AND deleted_at IS NULL AND repost_of_id IS NULL
       ORDER BY view_count DESC, like_count DESC LIMIT 10`,
      { u: userId },
    );
    return { totals: { ...totals, followers }, byKind, top: this.toDto(top, userId) };
  }

  // ─── Плейлисты ────────────────────────────────────────────────────────────

  private playlistDto(r: { id: string; title: string; description: string; is_public: number; created_at: number }): Playlist {
    const count = this.db.value<number>('SELECT COUNT(*) FROM playlist_items WHERE playlist_id = :id', { id: r.id }) ?? 0;
    const coverId = this.db.value<string>(
      `SELECT pm.media_id FROM playlist_items pi JOIN post_media pm ON pm.post_id = pi.post_id
       WHERE pi.playlist_id = :id ORDER BY pi.added_at, pm.position LIMIT 1`,
      { id: r.id },
    );
    const cover = coverId ? (this.media.items([coverId]).get(coverId) ?? null) : null;
    return { id: r.id, title: r.title, description: r.description, isPublic: bool(r.is_public), itemCount: count, cover, createdAt: iso(r.created_at) };
  }

  playlists(userId: string): Playlist[] {
    return this.db
      .all<{ id: string; title: string; description: string; is_public: number; created_at: number }>(
        'SELECT * FROM playlists WHERE owner_id = :u ORDER BY updated_at DESC',
        { u: userId },
      )
      .map((r) => this.playlistDto(r));
  }

  createPlaylist(userId: string, input: { title: string; description: string; isPublic: boolean }): Playlist {
    const count = this.db.value<number>('SELECT COUNT(*) FROM playlists WHERE owner_id = :u', { u: userId }) ?? 0;
    if (count >= 200) throw badRequest('Слишком много плейлистов');
    const now = Date.now();
    const id = newId(now);
    this.db.run(
      'INSERT INTO playlists (id, owner_id, title, description, is_public, created_at, updated_at) VALUES (:id, :u, :t, :d, :p, :now, :now)',
      { id, u: userId, t: input.title, d: input.description, p: input.isPublic, now },
    );
    return this.playlistDto({ id, title: input.title, description: input.description, is_public: input.isPublic ? 1 : 0, created_at: now });
  }

  private ownPlaylist(userId: string, id: string) {
    const row = this.db.get<{ id: string; owner_id: string; title: string; description: string; is_public: number; created_at: number }>(
      'SELECT * FROM playlists WHERE id = :id',
      { id },
    );
    if (!row) throw notFound('Плейлист не найден');
    return row;
  }

  playlist(viewerId: string, id: string): { playlist: Playlist; items: Post[] } {
    const row = this.ownPlaylist(viewerId, id);
    if (row.owner_id !== viewerId && !bool(row.is_public)) throw notFound('Плейлист не найден');
    const posts = this.db.all<PostRow>(
      `SELECT p.* ${BASE_FROM} JOIN playlist_items pi ON pi.post_id = p.id AND pi.playlist_id = :pl
       WHERE ${Policy.visiblePostsSql({ excludeMuted: false })} ORDER BY pi.added_at`,
      { viewer: viewerId, pl: id },
    );
    return { playlist: this.playlistDto(row), items: this.toDto(posts, viewerId) };
  }

  playlistItem(userId: string, id: string, postId: string, add: boolean): void {
    const row = this.ownPlaylist(userId, id);
    if (row.owner_id !== userId) throw forbidden();
    if (add) {
      this.viewable(userId, postId);
      this.db.run('INSERT OR IGNORE INTO playlist_items (playlist_id, post_id, added_at) VALUES (:pl, :p, :now)', { pl: id, p: postId, now: Date.now() });
    } else {
      this.db.run('DELETE FROM playlist_items WHERE playlist_id = :pl AND post_id = :p', { pl: id, p: postId });
    }
    this.db.run('UPDATE playlists SET updated_at = :now WHERE id = :id', { now: Date.now(), id });
  }

  deletePlaylist(userId: string, id: string): void {
    const row = this.ownPlaylist(userId, id);
    if (row.owner_id !== userId) throw forbidden();
    this.db.run('DELETE FROM playlists WHERE id = :id', { id });
  }
}
