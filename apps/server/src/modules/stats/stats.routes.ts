import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parse } from '../../lib/errors.js';
import { requireAuth } from '../../http/request.js';

const rangeQuery = z.object({ days: z.coerce.number().int().refine((v) => [7, 30, 90].includes(v)).default(30) });

export async function statsRoutes(app: FastifyInstance): Promise<void> {
  const { stats } = app.ctx.services;
  app.get('/stats/overview', async (req) => stats.overview(requireAuth(req).userId, parse(rangeQuery, req.query).days));
  app.get<{ Params: { id: string } }>('/stats/channels/:id', async (req) =>
    stats.channelDetails(requireAuth(req).userId, req.params.id, parse(rangeQuery, req.query).days),
  );
}
