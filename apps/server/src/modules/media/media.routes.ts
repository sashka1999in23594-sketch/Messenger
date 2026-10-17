import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ErrorCode } from '@omni/shared';
import { AppError, notFound, parse } from '../../lib/errors.js';
import { requireAuth } from '../../http/request.js';

const uploadQuery = z.object({
  width: z.coerce.number().int().min(1).max(20000).optional(),
  height: z.coerce.number().int().min(1).max(20000).optional(),
  duration: z.coerce.number().min(0).max(86400).optional(),
  posterId: z.string().max(64).optional(),
});
const serveQuery = z.object({ e: z.string().max(20).optional(), s: z.string().max(64).optional() });

export async function mediaRoutes(app: FastifyInstance): Promise<void> {
  const { media } = app.ctx.services;

  app.post('/media', { config: { rateLimit: { max: 60, timeWindow: '10 minutes' } } }, async (req, reply) => {
    const auth = requireAuth(req);
    const q = parse(uploadQuery, req.query);
    if (!req.isMultipart()) throw new AppError(415, ErrorCode.UnsupportedMedia, 'Ожидается multipart/form-data');
    const file = await req.file();
    if (!file) throw new AppError(400, ErrorCode.Validation, 'Файл не передан');
    const item = await media.store(auth.userId, file.file, {
      originalName: file.filename,
      width: q.width,
      height: q.height,
      durationSec: q.duration,
      posterId: q.posterId,
    });
    return reply.status(201).send(item);
  });

  /**
   * Раздача файлов по подписанной ссылке. Поддерживает Range (перемотка видео),
   * ETag и кэширование. Файл отдаётся с запретом исполнения скриптов (CSP sandbox).
   */
  app.get<{ Params: { id: string } }>('/media/:id', { config: { rateLimit: { max: 2000, timeWindow: '1 minute' } } }, async (req, reply) => {
    const q = parse(serveQuery, req.query);
    if (!media.verify(req.params.id, q.e, q.s)) throw notFound('Файл не найден или ссылка устарела');
    const row = media.get(req.params.id);
    if (!row) throw notFound('Файл не найден');
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Content-Security-Policy', "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'; sandbox");
    reply.header('Cross-Origin-Resource-Policy', 'same-origin');
    reply.header('Cache-Control', 'private, max-age=86400, immutable');
    if (row.kind === 'file') {
      const name = encodeURIComponent(row.original_name ?? `file-${row.id}`);
      reply.header('Content-Disposition', `attachment; filename*=UTF-8''${name}`);
    }
    return reply.sendFile(row.storage_key, app.ctx.config.uploadsDir, { cacheControl: false });
  });
}
