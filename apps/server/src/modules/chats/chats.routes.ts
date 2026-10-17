import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  addMembersSchema,
  chatPrefsSchema,
  createChannelSchema,
  createDirectChatSchema,
  createGroupSchema,
  createSecretChatSchema,
  editMessageSchema,
  forwardMessageSchema,
  memberRoleSchema,
  pagination,
  reactionSchema,
  readSchema,
  sendMessageSchema,
  updateChatSchema,
} from '@omni/shared';
import { parse } from '../../lib/errors.js';
import { requireAuth } from '../../http/request.js';
import type { ChatFolder } from './chats.service.js';

const listQuery = pagination.extend({
  folder: z.enum(['all', 'direct', 'groups', 'channels', 'secret', 'archived', 'unread']).default('all'),
});
const messagesQuery = z.object({
  before: z.coerce.number().int().min(0).optional(),
  after: z.coerce.number().int().min(0).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
const searchQuery = z.object({ q: z.string().trim().min(1).max(100) });
const discoverQuery = z.object({ q: z.string().trim().max(100).optional() });
const pinBody = z.object({ messageId: z.string().max(64).nullable() });
const deleteQuery = z.object({
  forEveryone: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
});

type P = { Params: { id: string } };
type PM = { Params: { id: string; messageId: string } };
type PU = { Params: { id: string; userId: string } };

/** Отправка сообщений — отдельный лимит (антиспам), щедрый для живой переписки. */
const sendLimit = { rateLimit: { max: 60, timeWindow: '1 minute' } };

export async function chatsRoutes(app: FastifyInstance): Promise<void> {
  const chats = app.ctx.services.chats;

  app.get('/chats', async (req) => {
    const q = parse(listQuery, req.query);
    return chats.list(requireAuth(req).userId, q.folder as ChatFolder, q.cursor, q.limit);
  });

  app.get('/chats/discover', async (req) => {
    const q = parse(discoverQuery, req.query);
    return { items: chats.discover(requireAuth(req).userId, q.q || undefined) };
  });

  app.post('/chats/direct', async (req) => chats.getOrCreateDirect(requireAuth(req).userId, parse(createDirectChatSchema, req.body).userId));
  app.post('/chats/saved', async (req) => chats.getOrCreateSaved(requireAuth(req).userId));
  app.post('/chats/group', async (req) => chats.createGroup(requireAuth(req).userId, parse(createGroupSchema, req.body)));
  app.post('/chats/channel', async (req) => chats.createChannel(requireAuth(req).userId, parse(createChannelSchema, req.body)));
  app.post('/chats/secret', async (req) => chats.createSecret(requireAuth(req).userId, parse(createSecretChatSchema, req.body)));

  app.get<P>('/chats/:id', async (req) => chats.get(requireAuth(req).userId, req.params.id));
  app.patch<P>('/chats/:id', async (req) => chats.update(requireAuth(req).userId, req.params.id, parse(updateChatSchema, req.body)));
  app.delete<P>('/chats/:id', async (req) => {
    chats.remove(requireAuth(req).userId, req.params.id);
    return { ok: true };
  });
  app.patch<P>('/chats/:id/prefs', async (req) => chats.setPrefs(requireAuth(req).userId, req.params.id, parse(chatPrefsSchema, req.body)));
  app.post<P>('/chats/:id/leave', async (req) => {
    chats.leave(requireAuth(req).userId, req.params.id);
    return { ok: true };
  });
  app.post<P>('/chats/:id/join', async (req) => chats.join(requireAuth(req).userId, req.params.id));
  app.post<P>('/chats/:id/clear', async (req) => {
    chats.clearHistory(requireAuth(req).userId, req.params.id);
    return { ok: true };
  });
  app.post<P>('/chats/:id/read', async (req) => {
    chats.read(requireAuth(req).userId, req.params.id, parse(readSchema, req.body).seq);
    return { ok: true };
  });
  app.post<P>('/chats/:id/pin', async (req) => chats.pin(requireAuth(req).userId, req.params.id, parse(pinBody, req.body).messageId));

  app.get<P>('/chats/:id/members', async (req) => {
    const q = parse(pagination, req.query);
    return chats.members(requireAuth(req).userId, req.params.id, q.cursor, q.limit);
  });
  app.post<P>('/chats/:id/members', async (req) =>
    chats.addMembers(requireAuth(req).userId, req.params.id, parse(addMembersSchema, req.body).userIds),
  );
  app.delete<PU>('/chats/:id/members/:userId', async (req) => {
    chats.removeMember(requireAuth(req).userId, req.params.id, req.params.userId);
    return { ok: true };
  });
  app.patch<PU>('/chats/:id/members/:userId', async (req) => {
    chats.setRole(requireAuth(req).userId, req.params.id, req.params.userId, parse(memberRoleSchema, req.body).role);
    return { ok: true };
  });

  app.get<P>('/chats/:id/messages', async (req) => {
    const q = parse(messagesQuery, req.query);
    return chats.messages(requireAuth(req).userId, req.params.id, q);
  });
  app.get<P>('/chats/:id/search', async (req) => ({
    items: chats.search(requireAuth(req).userId, req.params.id, parse(searchQuery, req.query).q),
  }));
  app.get<P>('/chats/:id/media', async (req) => {
    const q = parse(pagination, req.query);
    return chats.sharedMedia(requireAuth(req).userId, req.params.id, q.cursor, q.limit);
  });

  app.post<P>('/chats/:id/messages', { config: sendLimit }, async (req, reply) => {
    const msg = chats.send(requireAuth(req).userId, req.params.id, parse(sendMessageSchema, req.body));
    return reply.status(201).send(msg);
  });
  app.patch<PM>('/chats/:id/messages/:messageId', async (req) =>
    chats.edit(requireAuth(req).userId, req.params.id, req.params.messageId, parse(editMessageSchema, req.body)),
  );
  app.delete<PM>('/chats/:id/messages/:messageId', async (req) => {
    const { forEveryone } = parse(deleteQuery, req.query);
    chats.deleteMessage(requireAuth(req).userId, req.params.id, req.params.messageId, forEveryone);
    return { ok: true };
  });
  app.post<PM>('/chats/:id/messages/:messageId/reactions', async (req) =>
    chats.react(requireAuth(req).userId, req.params.id, req.params.messageId, parse(reactionSchema, req.body).emoji),
  );
  app.post<PM>('/chats/:id/messages/:messageId/forward', { config: sendLimit }, async (req) => ({
    items: chats.forward(requireAuth(req).userId, req.params.id, req.params.messageId, parse(forwardMessageSchema, req.body).toChatIds),
  }));
}
