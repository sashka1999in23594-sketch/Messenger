import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { endLiveSchema, liveChatSchema, startLiveSchema } from '@omni/shared';
import { parse } from '../../lib/errors.js';
import { requireAuth } from '../../http/request.js';

type P = { Params: { id: string } };
const peerBody = z.object({ peer: z.string().min(4).max(32) });
const remindBody = z.object({ on: z.boolean() });

/** Прямые эфиры и премьеры: состояние — REST, видео эфира — WebRTC, сигналы — WebSocket. */
export async function liveRoutes(app: FastifyInstance): Promise<void> {
  const { live, posts } = app.ctx.services;
  const chatLimit = { rateLimit: { max: 30, timeWindow: '1 minute' } };

  app.get('/live', async (req) => live.list(requireAuth(req).userId));
  app.post('/live', { config: { rateLimit: { max: 10, timeWindow: '1 hour' } } }, async (req, reply) => {
    const auth = requireAuth(req);
    return reply.status(201).send(live.start(auth.userId, auth.sessionId, parse(startLiveSchema, req.body)));
  });
  app.get<P>('/live/:id', async (req) => live.get(requireAuth(req).userId, req.params.id));
  app.post<P>('/live/:id/join', async (req) => {
    const auth = requireAuth(req);
    return live.join(auth.userId, auth.sessionId, req.params.id);
  });
  app.post<P>('/live/:id/leave', async (req) => {
    live.leave(requireAuth(req).userId, req.params.id, parse(peerBody, req.body).peer);
    return { ok: true };
  });
  app.post<P>('/live/:id/end', async (req) => live.end(requireAuth(req).userId, req.params.id));
  app.post<P>('/live/:id/recording', async (req) => {
    const postId = parse(endLiveSchema, req.body).recordingPostId;
    if (!postId) return live.get(requireAuth(req).userId, req.params.id).stream;
    return live.attachRecording(requireAuth(req).userId, req.params.id, postId);
  });
  app.post<P>('/live/:id/chat', { config: chatLimit }, async (req, reply) => {
    const auth = requireAuth(req);
    return reply.status(201).send(live.chat(auth.userId, auth.sessionId, req.params.id, parse(liveChatSchema, req.body).text));
  });

  // ─── Премьеры ─────────────────────────────────────────────────────────────
  app.get('/premieres', async (req) => ({ items: posts.premieres(requireAuth(req).userId) }));
  app.post<P>('/premieres/:id/remind', async (req) => {
    posts.remindPremiere(requireAuth(req).userId, req.params.id, parse(remindBody, req.body).on);
    return { ok: true };
  });
  /** Комната премьеры: кто смотрит вместе и чат */
  app.post<P>('/premieres/:id/join', async (req) => {
    const auth = requireAuth(req);
    posts.viewable(auth.userId, req.params.id);
    live.joinRoom(`premiere:${req.params.id}`, auth.userId, auth.sessionId);
    return { watching: live.roomSize(`premiere:${req.params.id}`), chat: live.history(`premiere:${req.params.id}`) };
  });
  app.post<P>('/premieres/:id/leave', async (req) => {
    const auth = requireAuth(req);
    live.leaveRoom(`premiere:${req.params.id}`, auth.userId, auth.sessionId);
    return { ok: true };
  });
  app.post<P>('/premieres/:id/chat', { config: chatLimit }, async (req, reply) => {
    const auth = requireAuth(req);
    posts.viewable(auth.userId, req.params.id);
    live.joinRoom(`premiere:${req.params.id}`, auth.userId, auth.sessionId);
    return reply.status(201).send(live.say(`premiere:${req.params.id}`, auth.userId, parse(liveChatSchema, req.body).text));
  });
}
