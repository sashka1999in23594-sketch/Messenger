/** Маршруты соцфункций: черновики, списки, коллекции, скрытые слова, «кто оценил». */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { collectionItemSchema, collectionSchema, draftSchema, listMembersSchema, mutedWordSchema, pagination, userListSchema } from '@omni/shared';
import { parse } from '../../lib/errors.js';
import { requireAuth } from '../../http/request.js';

type P = { Params: { id: string } };
type PU = { Params: { id: string; userId: string } };
type PP = { Params: { id: string; postId: string } };

export async function socialRoutes(app: FastifyInstance): Promise<void> {
  const { drafts, lists, collections, mutedWords, posts } = app.ctx.services;
  const write = { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } };

  // ─── Черновики и отложенные публикации ────────────────────────────────────
  const draftsQuery = z.object({ filter: z.enum(['drafts', 'scheduled']).default('drafts') });
  app.get('/me/drafts', async (req) => ({ items: drafts.list(requireAuth(req).userId, parse(draftsQuery, req.query).filter) }));
  app.post('/me/drafts', write, async (req, reply) => reply.status(201).send(drafts.create(requireAuth(req).userId, parse(draftSchema, req.body))));
  app.put<P>('/me/drafts/:id', write, async (req) => drafts.update(requireAuth(req).userId, req.params.id, parse(draftSchema, req.body)));
  app.delete<P>('/me/drafts/:id', async (req) => {
    drafts.remove(requireAuth(req).userId, req.params.id);
    return { ok: true };
  });
  app.post<P>('/me/drafts/:id/publish', write, async (req) => drafts.publish(requireAuth(req).userId, req.params.id));

  // ─── Списки авторов ───────────────────────────────────────────────────────
  const memberOfQuery = z.object({ memberOf: z.string().max(64).optional() });
  app.get('/me/lists', async (req) => ({ items: lists.mine(requireAuth(req).userId, parse(memberOfQuery, req.query).memberOf) }));
  app.post('/lists', write, async (req, reply) => reply.status(201).send(lists.create(requireAuth(req).userId, parse(userListSchema, req.body))));
  app.get<P>('/lists/:id', async (req) => lists.get(requireAuth(req).userId, req.params.id));
  app.put<P>('/lists/:id', write, async (req) => lists.update(requireAuth(req).userId, req.params.id, parse(userListSchema, req.body)));
  app.delete<P>('/lists/:id', async (req) => {
    lists.remove(requireAuth(req).userId, req.params.id);
    return { ok: true };
  });
  app.get<P>('/lists/:id/members', async (req) => ({ items: lists.members(requireAuth(req).userId, req.params.id) }));
  app.post<P>('/lists/:id/members', write, async (req) => {
    const userId = requireAuth(req).userId;
    lists.addMembers(userId, req.params.id, parse(listMembersSchema, req.body).userIds);
    return lists.get(userId, req.params.id);
  });
  app.delete<PU>('/lists/:id/members/:userId', async (req) => {
    lists.removeMember(requireAuth(req).userId, req.params.id, req.params.userId);
    return { ok: true };
  });
  app.get<P>('/lists/:id/feed', async (req) => {
    const q = parse(pagination, req.query);
    return lists.feed(requireAuth(req).userId, req.params.id, q.cursor, q.limit);
  });

  // ─── Коллекции закладок ───────────────────────────────────────────────────
  const postQuery = z.object({ postId: z.string().max(64).optional() });
  app.get('/me/collections', async (req) => ({ items: collections.list(requireAuth(req).userId, parse(postQuery, req.query).postId) }));
  app.post('/me/collections', write, async (req, reply) => reply.status(201).send(collections.create(requireAuth(req).userId, parse(collectionSchema, req.body))));
  app.get<P>('/me/collections/:id', async (req) => collections.get(requireAuth(req).userId, req.params.id));
  app.put<P>('/me/collections/:id', write, async (req) => collections.update(requireAuth(req).userId, req.params.id, parse(collectionSchema, req.body)));
  app.delete<P>('/me/collections/:id', async (req) => {
    collections.remove(requireAuth(req).userId, req.params.id);
    return { ok: true };
  });
  app.get<P>('/me/collections/:id/posts', async (req) => {
    const q = parse(pagination, req.query);
    return collections.items(requireAuth(req).userId, req.params.id, q.cursor, q.limit);
  });
  app.post<P>('/me/collections/:id/items', write, async (req) => collections.setItem(requireAuth(req).userId, req.params.id, parse(collectionItemSchema, req.body).postId, true));
  app.delete<PP>('/me/collections/:id/items/:postId', async (req) => collections.setItem(requireAuth(req).userId, req.params.id, req.params.postId, false));

  // ─── Скрытые слова ────────────────────────────────────────────────────────
  app.get('/me/muted-words', async (req) => ({ items: mutedWords.list(requireAuth(req).userId) }));
  app.post('/me/muted-words', write, async (req, reply) => reply.status(201).send(mutedWords.add(requireAuth(req).userId, parse(mutedWordSchema, req.body))));
  app.delete<P>('/me/muted-words/:id', async (req) => {
    mutedWords.remove(requireAuth(req).userId, req.params.id);
    return { ok: true };
  });

  // ─── Кто оценил ───────────────────────────────────────────────────────────
  app.get<P>('/posts/:id/likers', async (req) => {
    const q = parse(pagination, req.query);
    return posts.likers(requireAuth(req).userId, req.params.id, q.cursor, q.limit);
  });
}
