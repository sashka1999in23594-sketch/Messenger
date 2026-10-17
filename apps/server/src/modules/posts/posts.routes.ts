import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  createCommentSchema,
  createPlaylistSchema,
  createPostSchema,
  feedQuerySchema,
  pagination,
  updatePostSchema,
  viewSchema,
} from '@omni/shared';
import { parse } from '../../lib/errors.js';
import { requireAuth } from '../../http/request.js';

type P = { Params: { id: string } };
const kindQuery = pagination.extend({ kind: z.enum(['note', 'photo', 'video', 'short', 'all']).default('all') });
const userPostsQuery = pagination.extend({ tab: z.enum(['posts', 'media', 'likes', 'note', 'photo', 'video', 'short']).default('posts') });
const commentsQuery = pagination.extend({ sort: z.enum(['top', 'new']).default('top') });
const editComment = createCommentSchema.pick({ text: true });
const playlistItem = z.object({ postId: z.string().min(8).max(64) });

const createLimit = { rateLimit: { max: 30, timeWindow: '10 minutes' } };
const commentLimit = { rateLimit: { max: 30, timeWindow: '1 minute' } };

export async function postsRoutes(app: FastifyInstance): Promise<void> {
  const { posts, comments } = app.ctx.services;

  // ─── Ленты ────────────────────────────────────────────────────────────────
  for (const mode of ['for-you', 'following', 'latest', 'trending'] as const) {
    app.get(`/feed/${mode}`, async (req) => {
      const q = parse(feedQuerySchema, req.query);
      return posts.feed(requireAuth(req).userId, mode, q.kind, q.cursor, q.limit);
    });
  }

  // ─── Публикации ───────────────────────────────────────────────────────────
  app.post('/posts', { config: createLimit }, async (req, reply) => {
    const post = posts.create(requireAuth(req).userId, parse(createPostSchema, req.body));
    return reply.status(201).send(post);
  });
  app.get<P>('/posts/:id', async (req) => posts.get(requireAuth(req).userId, req.params.id));
  app.patch<P>('/posts/:id', async (req) => posts.update(requireAuth(req).userId, req.params.id, parse(updatePostSchema, req.body)));
  app.delete<P>('/posts/:id', async (req) => {
    posts.remove(requireAuth(req).userId, req.params.id);
    return { ok: true };
  });
  app.get<P>('/posts/:id/related', async (req) => ({ items: posts.related(requireAuth(req).userId, req.params.id) }));

  app.post<P>('/posts/:id/like', async (req) => posts.like(requireAuth(req).userId, req.params.id, true));
  app.delete<P>('/posts/:id/like', async (req) => posts.like(requireAuth(req).userId, req.params.id, false));
  app.post<P>('/posts/:id/bookmark', async (req) => {
    posts.bookmark(requireAuth(req).userId, req.params.id, true);
    return { ok: true };
  });
  app.delete<P>('/posts/:id/bookmark', async (req) => {
    posts.bookmark(requireAuth(req).userId, req.params.id, false);
    return { ok: true };
  });
  app.post<P>('/posts/:id/watch-later', async (req) => {
    posts.watchLater(requireAuth(req).userId, req.params.id, true);
    return { ok: true };
  });
  app.delete<P>('/posts/:id/watch-later', async (req) => {
    posts.watchLater(requireAuth(req).userId, req.params.id, false);
    return { ok: true };
  });
  app.post<P>('/posts/:id/repost', { config: createLimit }, async (req) =>
    posts.create(requireAuth(req).userId, { kind: 'note', text: '', mediaIds: [], visibility: 'public', commentsDisabled: false, repostOfId: req.params.id }),
  );
  app.delete<P>('/posts/:id/repost', async (req) => {
    posts.undoRepost(requireAuth(req).userId, req.params.id);
    return { ok: true };
  });
  app.post<P>('/posts/:id/view', { config: { rateLimit: { max: 600, timeWindow: '1 minute' } } }, async (req) => {
    posts.view(requireAuth(req).userId, req.params.id, parse(viewSchema, req.body).progressSec);
    return { ok: true };
  });

  // ─── Комментарии ──────────────────────────────────────────────────────────
  app.get<P>('/posts/:id/comments', async (req) => {
    const q = parse(commentsQuery, req.query);
    return comments.list(requireAuth(req).userId, req.params.id, q.sort, q.cursor, q.limit);
  });
  app.post<P>('/posts/:id/comments', { config: commentLimit }, async (req, reply) => {
    const c = comments.create(requireAuth(req).userId, req.params.id, parse(createCommentSchema, req.body));
    return reply.status(201).send(c);
  });
  app.get<P>('/comments/:id/replies', async (req) => {
    const q = parse(pagination, req.query);
    return comments.replies(requireAuth(req).userId, req.params.id, q.cursor, q.limit);
  });
  app.patch<P>('/comments/:id', async (req) => comments.update(requireAuth(req).userId, req.params.id, parse(editComment, req.body).text));
  app.delete<P>('/comments/:id', async (req) => {
    comments.remove(requireAuth(req).userId, req.params.id);
    return { ok: true };
  });
  app.post<P>('/comments/:id/like', async (req) => comments.like(requireAuth(req).userId, req.params.id, true));
  app.delete<P>('/comments/:id/like', async (req) => comments.like(requireAuth(req).userId, req.params.id, false));

  // ─── Профильные ленты и личные списки ─────────────────────────────────────
  app.get<P>('/users/:id/posts', async (req) => {
    const q = parse(userPostsQuery, req.query);
    return posts.userPosts(requireAuth(req).userId, req.params.id, q.tab, q.cursor, q.limit);
  });
  app.get('/me/bookmarks', async (req) => {
    const q = parse(kindQuery, req.query);
    return posts.bookmarks(requireAuth(req).userId, q.kind, q.cursor, q.limit);
  });
  app.get('/me/watch-later', async (req) => {
    const q = parse(pagination, req.query);
    return posts.watchLaterList(requireAuth(req).userId, q.cursor, q.limit);
  });
  app.get('/me/liked', async (req) => {
    const q = parse(kindQuery, req.query);
    return posts.liked(requireAuth(req).userId, q.kind, q.cursor, q.limit);
  });
  app.get('/me/history', async (req) => {
    const q = parse(kindQuery, req.query);
    return posts.history(requireAuth(req).userId, q.kind, q.cursor, q.limit);
  });
  app.delete('/me/history', async (req) => {
    posts.clearHistory(requireAuth(req).userId);
    return { ok: true };
  });
  app.delete<P>('/me/history/:id', async (req) => {
    posts.clearHistory(requireAuth(req).userId, req.params.id);
    return { ok: true };
  });
  app.get('/me/studio', async (req) => posts.studio(requireAuth(req).userId));

  // ─── Хэштеги ──────────────────────────────────────────────────────────────
  app.get('/hashtags/trending', async (req) => {
    requireAuth(req);
    const q = parse(z.object({ days: z.coerce.number().int().min(1).max(90).default(7) }), req.query);
    return { items: posts.trendingHashtags(q.days) };
  });
  app.get<{ Params: { tag: string } }>('/hashtags/:tag/posts', async (req) => {
    const q = parse(pagination, req.query);
    const tag = parse(z.string().min(1).max(64), req.params.tag);
    return posts.hashtagPosts(requireAuth(req).userId, tag, q.cursor, q.limit);
  });

  // ─── Плейлисты ────────────────────────────────────────────────────────────
  app.get('/me/playlists', async (req) => ({ items: posts.playlists(requireAuth(req).userId) }));
  app.post('/playlists', async (req) => posts.createPlaylist(requireAuth(req).userId, parse(createPlaylistSchema, req.body)));
  app.get<P>('/playlists/:id', async (req) => posts.playlist(requireAuth(req).userId, req.params.id));
  app.delete<P>('/playlists/:id', async (req) => {
    posts.deletePlaylist(requireAuth(req).userId, req.params.id);
    return { ok: true };
  });
  app.post<P>('/playlists/:id/items', async (req) => {
    posts.playlistItem(requireAuth(req).userId, req.params.id, parse(playlistItem, req.body).postId, true);
    return { ok: true };
  });
  app.delete<{ Params: { id: string; postId: string } }>('/playlists/:id/items/:postId', async (req) => {
    posts.playlistItem(requireAuth(req).userId, req.params.id, req.params.postId, false);
    return { ok: true };
  });
}
