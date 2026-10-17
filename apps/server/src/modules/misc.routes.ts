/** Маршруты небольших модулей: истории, сообщества, уведомления, поиск, жалобы, модерация. */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { createCommunitySchema, createStorySchema, pagination, reportSchema, searchSchema } from '@omni/shared';
import { parse } from '../lib/errors.js';
import { requireAuth, requireRole } from '../http/request.js';

type P = { Params: { id: string } };

export async function miscRoutes(app: FastifyInstance): Promise<void> {
  const { stories, communities, notifications, search, reports, posts } = app.ctx.services;

  // ─── Истории ──────────────────────────────────────────────────────────────
  app.get('/stories', async (req) => ({ items: stories.feed(requireAuth(req).userId) }));
  app.get<P>('/users/:id/stories', async (req) => ({ items: stories.ofUser(requireAuth(req).userId, req.params.id) }));
  app.post('/stories', { config: { rateLimit: { max: 30, timeWindow: '10 minutes' } } }, async (req, reply) =>
    reply.status(201).send(stories.create(requireAuth(req).userId, parse(createStorySchema, req.body))),
  );
  app.post<P>('/stories/:id/view', async (req) => {
    stories.view(requireAuth(req).userId, req.params.id);
    return { ok: true };
  });
  app.get<P>('/stories/:id/viewers', async (req) => ({ items: stories.viewers(requireAuth(req).userId, req.params.id) }));
  app.delete<P>('/stories/:id', async (req) => {
    stories.remove(requireAuth(req).userId, req.params.id);
    return { ok: true };
  });

  // ─── Сообщества ───────────────────────────────────────────────────────────
  const discoverQuery = pagination.extend({ q: z.string().trim().max(100).optional() });
  app.get('/communities', async (req) => {
    const q = parse(discoverQuery, req.query);
    return communities.discover(requireAuth(req).userId, q.q || undefined, q.cursor, q.limit);
  });
  app.get('/me/communities', async (req) => ({ items: communities.mine(requireAuth(req).userId) }));
  app.post('/communities', { config: { rateLimit: { max: 5, timeWindow: '1 hour' } } }, async (req, reply) =>
    reply.status(201).send(communities.create(requireAuth(req).userId, parse(createCommunitySchema, req.body))),
  );
  app.get<P>('/communities/:id', async (req) => communities.get(requireAuth(req).userId, req.params.id));
  app.patch<P>('/communities/:id', async (req) =>
    communities.update(
      requireAuth(req).userId,
      req.params.id,
      parse(createCommunitySchema.pick({ name: true, description: true }).partial().extend({ avatarMediaId: z.string().nullable().optional() }), req.body),
    ),
  );
  app.delete<P>('/communities/:id', async (req) => {
    communities.remove(requireAuth(req).userId, req.params.id);
    return { ok: true };
  });
  app.post<P>('/communities/:id/join', async (req) => communities.join(requireAuth(req).userId, req.params.id));
  app.post<P>('/communities/:id/leave', async (req) => {
    communities.leave(requireAuth(req).userId, req.params.id);
    return { ok: true };
  });
  app.get<P>('/communities/:id/members', async (req) => {
    const q = parse(pagination, req.query);
    return communities.members(requireAuth(req).userId, req.params.id, q.cursor, q.limit);
  });
  app.get<P>('/communities/:id/posts', async (req) => {
    const q = parse(pagination, req.query);
    return posts.communityPosts(requireAuth(req).userId, req.params.id, q.cursor, q.limit);
  });

  // ─── Уведомления ──────────────────────────────────────────────────────────
  const notifQuery = pagination.extend({ filter: z.enum(['all', 'mentions', 'replies', 'follows', 'likes', 'security']).default('all') });
  app.get('/notifications', async (req) => {
    const q = parse(notifQuery, req.query);
    return notifications.list(requireAuth(req).userId, q.filter, q.cursor, q.limit);
  });
  app.post('/notifications/read', async (req) => {
    const body = parse(z.object({ ids: z.array(z.string().max(64)).max(200).optional() }), req.body);
    notifications.markRead(requireAuth(req).userId, body.ids);
    return { ok: true };
  });

  // ─── Поиск ────────────────────────────────────────────────────────────────
  app.get('/search', { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } }, async (req) => {
    const q = parse(searchSchema, req.query);
    return search.search(requireAuth(req).userId, q.q, q.type, q.limit);
  });

  // ─── Жалобы и модерация ───────────────────────────────────────────────────
  app.post('/reports', { config: { rateLimit: { max: 20, timeWindow: '1 hour' } } }, async (req, reply) =>
    reply.status(201).send(reports.create(requireAuth(req).userId, parse(reportSchema, req.body))),
  );
  app.get('/admin/reports', async (req) => {
    requireRole(req, 'moderator', 'admin');
    const q = parse(pagination.extend({ status: z.enum(['open', 'resolved', 'rejected']).default('open') }), req.query);
    return reports.list(q.status, q.cursor, q.limit);
  });
  app.post<P>('/admin/reports/:id', async (req) => {
    const auth = requireRole(req, 'moderator', 'admin');
    const body = parse(z.object({ status: z.enum(['resolved', 'rejected']), removeContent: z.boolean().default(false) }), req.body);
    reports.resolve(auth.userId, req.params.id, body.status, body.removeContent);
    return { ok: true };
  });

  // ─── Служебное ────────────────────────────────────────────────────────────
  app.get('/health', { config: { rateLimit: false } }, async () => ({ ok: true, time: new Date().toISOString() }));
}
