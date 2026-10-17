import type { FastifyInstance } from 'fastify';
import { deviceKeySchema } from '@omni/shared';
import { parse } from '../../lib/errors.js';
import { requestMeta, requireAuth } from '../../http/request.js';

export async function keysRoutes(app: FastifyInstance): Promise<void> {
  const { services } = app.ctx;

  app.put('/keys/devices', async (req) => {
    const auth = requireAuth(req);
    return services.keys.register(auth.userId, parse(deviceKeySchema, req.body), requestMeta(req));
  });

  app.get('/keys/devices', async (req) => ({ items: services.keys.listOwn(requireAuth(req).userId) }));

  app.get<{ Params: { deviceId: string } }>('/keys/devices/:deviceId', async (req) => {
    requireAuth(req);
    return services.keys.get(req.params.deviceId);
  });

  app.delete<{ Params: { deviceId: string } }>('/keys/devices/:deviceId', async (req) => {
    services.keys.revoke(requireAuth(req).userId, req.params.deviceId);
    return { ok: true };
  });

  app.get<{ Params: { userId: string } }>('/keys/users/:userId', async (req) => {
    requireAuth(req);
    return { items: services.keys.listForUser(req.params.userId) };
  });
}
