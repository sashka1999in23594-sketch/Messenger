import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  createSpaceSchema,
  memberRolesSchema,
  spaceCategorySchema,
  spaceInviteSchema,
  spaceRoleSchema,
  spaceRoomSchema,
  updateSpaceRoleSchema,
  updateSpaceRoomSchema,
  updateSpaceSchema,
} from '@omni/shared';
import { parse } from '../../lib/errors.js';
import { requireAuth } from '../../http/request.js';

type P = { Params: { id: string } };
type PX = { Params: { id: string; sub: string } };

const kindQuery = z.object({ kind: z.enum(['company', 'community']).default('community') });
const discoverQuery = z.object({ q: z.string().trim().max(100).optional() });
const respondBody = z.object({ accept: z.boolean() });

export async function spacesRoutes(app: FastifyInstance): Promise<void> {
  const { spaces } = app.ctx.services;
  const me = (req: Parameters<typeof requireAuth>[0]) => requireAuth(req).userId;
  const ok = { ok: true } as const;
  /** Создание и приглашения ограничены: защита от спама */
  const strict = { rateLimit: { max: 30, timeWindow: '1 hour' } };

  app.get('/spaces', async (req) => ({ items: spaces.list(me(req), parse(kindQuery, req.query).kind) }));
  app.get('/spaces/discover', async (req) => ({ items: spaces.discover(me(req), parse(discoverQuery, req.query).q || undefined) }));
  app.post('/spaces', { config: strict }, async (req, reply) => reply.status(201).send(spaces.create(me(req), parse(createSpaceSchema, req.body))));

  app.get('/space-invites', async (req) => ({ items: spaces.myInvites(me(req)) }));
  app.post<{ Params: { inviteId: string } }>('/space-invites/:inviteId/respond', async (req) => ({
    space: spaces.respond(me(req), req.params.inviteId, parse(respondBody, req.body).accept),
  }));
  app.post<{ Params: { token: string } }>('/spaces/link/:token', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req) =>
    spaces.joinByLink(me(req), req.params.token),
  );

  app.get<P>('/spaces/:id', async (req) => spaces.get(me(req), req.params.id));
  app.patch<P>('/spaces/:id', async (req) => spaces.update(me(req), req.params.id, parse(updateSpaceSchema, req.body)));
  app.delete<P>('/spaces/:id', async (req) => (spaces.remove(me(req), req.params.id), ok));
  app.post<P>('/spaces/:id/join', async (req) => spaces.join(me(req), req.params.id));
  app.post<P>('/spaces/:id/leave', async (req) => (spaces.leave(me(req), req.params.id), ok));
  app.post<P>('/spaces/:id/link', async (req) => spaces.resetLink(me(req), req.params.id));

  app.get<P>('/spaces/:id/members', async (req) => ({ items: spaces.members(me(req), req.params.id) }));
  app.delete<PX>('/spaces/:id/members/:sub', async (req) => (spaces.kick(me(req), req.params.id, req.params.sub), ok));
  app.put<PX>('/spaces/:id/members/:sub/roles', async (req) =>
    spaces.setMemberRoles(me(req), req.params.id, req.params.sub, parse(memberRolesSchema, req.body).roleIds),
  );

  app.post<P>('/spaces/:id/roles', async (req, reply) => reply.status(201).send(spaces.createRole(me(req), req.params.id, parse(spaceRoleSchema, req.body))));
  app.patch<PX>('/spaces/:id/roles/:sub', async (req) => spaces.updateRole(me(req), req.params.id, req.params.sub, parse(updateSpaceRoleSchema, req.body)));
  app.delete<PX>('/spaces/:id/roles/:sub', async (req) => (spaces.deleteRole(me(req), req.params.id, req.params.sub), ok));

  app.post<P>('/spaces/:id/categories', async (req, reply) =>
    reply.status(201).send(spaces.createCategory(me(req), req.params.id, parse(spaceCategorySchema, req.body))),
  );
  app.patch<PX>('/spaces/:id/categories/:sub', async (req) =>
    (spaces.updateCategory(me(req), req.params.id, req.params.sub, parse(spaceCategorySchema.partial(), req.body)), ok),
  );
  app.delete<PX>('/spaces/:id/categories/:sub', async (req) => (spaces.deleteCategory(me(req), req.params.id, req.params.sub), ok));

  app.post<P>('/spaces/:id/rooms', async (req, reply) => reply.status(201).send(spaces.createRoom(me(req), req.params.id, parse(spaceRoomSchema, req.body))));
  app.patch<PX>('/spaces/:id/rooms/:sub', async (req) => spaces.updateRoom(me(req), req.params.id, req.params.sub, parse(updateSpaceRoomSchema, req.body)));
  app.delete<PX>('/spaces/:id/rooms/:sub', async (req) => (spaces.deleteRoom(me(req), req.params.id, req.params.sub), ok));

  app.get<P>('/spaces/:id/invites', async (req) => ({ items: spaces.sentInvites(me(req), req.params.id) }));
  app.post<P>('/spaces/:id/invites', { config: { rateLimit: { max: 100, timeWindow: '1 hour' } } }, async (req, reply) =>
    reply.status(201).send(spaces.invite(me(req), req.params.id, parse(spaceInviteSchema, req.body).userId)),
  );
  app.delete<PX>('/spaces/:id/invites/:sub', async (req) => (spaces.revokeInvite(me(req), req.params.id, req.params.sub), ok));
}
