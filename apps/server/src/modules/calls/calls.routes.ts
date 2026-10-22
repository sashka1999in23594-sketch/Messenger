import type { FastifyInstance } from 'fastify';
import { createRoomSchema, inviteRoomSchema, pagination, roomChatSchema, startCallSchema } from '@omni/shared';
import { parse } from '../../lib/errors.js';
import { requireAuth } from '../../http/request.js';
import { IceProvider } from './ice.js';

type P = { Params: { id: string } };

/** Звонки: состояние — через REST, сигнализация WebRTC — через WebSocket. */
export async function callsRoutes(app: FastifyInstance): Promise<void> {
  const { calls, rooms } = app.ctx.services;
  const { config } = app.ctx;
  const callLimit = { rateLimit: { max: 20, timeWindow: '1 minute' } };

  const ice = new IceProvider(config, app.log);
  /** STUN/TURN-серверы для установки соединения (TURN — с временными учётными данными) */
  app.get('/calls/config', async (req) => {
    requireAuth(req);
    return { ...(await ice.get()), turnSource: ice.source };
  });
  app.get('/calls/current', async (req) => ({ call: calls.current(requireAuth(req).userId) }));
  app.get('/calls', async (req) => {
    const q = parse(pagination, req.query);
    const missed = (req.query as { filter?: string }).filter === 'missed';
    return calls.history(requireAuth(req).userId, q.cursor, q.limit, missed);
  });
  app.post('/calls', { config: callLimit }, async (req, reply) => {
    const auth = requireAuth(req);
    return reply.status(201).send(calls.start(auth.userId, auth.sessionId, parse(startCallSchema, req.body)));
  });
  app.post<P>('/calls/:id/accept', async (req) => {
    const auth = requireAuth(req);
    return calls.accept(auth.userId, auth.sessionId, req.params.id);
  });
  app.post<P>('/calls/:id/hangup', async (req) => calls.hangup(requireAuth(req).userId, req.params.id));

  // ─── Групповые звонки ─────────────────────────────────────────────────────
  app.get('/calls/rooms', async (req) => {
    const q = parse(pagination, req.query);
    return { items: rooms.history(requireAuth(req).userId, q.limit) };
  });
  app.get('/calls/rooms/current', async (req) => rooms.current(requireAuth(req).userId) ?? { room: null, state: null });
  app.post('/calls/rooms', { config: callLimit }, async (req, reply) => {
    const auth = requireAuth(req);
    return reply.status(201).send(rooms.create(auth.userId, auth.sessionId, parse(createRoomSchema, req.body)));
  });
  app.get<P>('/calls/rooms/:id', async (req) => rooms.get(requireAuth(req).userId, req.params.id));
  app.post<P>('/calls/rooms/:id/join', { config: callLimit }, async (req) => {
    const auth = requireAuth(req);
    return rooms.join(auth.userId, auth.sessionId, req.params.id);
  });
  app.post<P>('/calls/rooms/:id/leave', async (req) => rooms.leave(requireAuth(req).userId, req.params.id));
  app.post<P>('/calls/rooms/:id/invite', { config: callLimit }, async (req) => rooms.invite(requireAuth(req).userId, req.params.id, parse(inviteRoomSchema, req.body)));
  app.post<P>('/calls/rooms/:id/chat', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (req) =>
    rooms.chat(requireAuth(req).userId, req.params.id, parse(roomChatSchema, req.body).text),
  );
}
