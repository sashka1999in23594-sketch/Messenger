import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import websocket from '@fastify/websocket';
import Fastify, { type FastifyInstance } from 'fastify';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { API_PREFIX, WS_HEARTBEAT_MS } from '@omni/shared';
import type { Config } from './config.js';
import { createServices, type Ctx } from './context.js';
import { Db } from './db/index.js';
import { migrate } from './db/migrate.js';
import { registerSecurity } from './http/security.js';
import './http/types.js';
import { authRoutes } from './modules/auth/auth.routes.js';
import { chatsRoutes } from './modules/chats/chats.routes.js';
import { keysRoutes } from './modules/keys/keys.routes.js';
import { mediaRoutes } from './modules/media/media.routes.js';
import { miscRoutes } from './modules/misc.routes.js';
import { postsRoutes } from './modules/posts/posts.routes.js';
import { RealtimeHub } from './modules/realtime/hub.js';
import { wsRoutes } from './modules/realtime/ws.routes.js';
import { usersRoutes } from './modules/users/users.routes.js';

export async function buildApp(config: Config, opts: { db?: Db } = {}): Promise<FastifyInstance> {
  const db = opts.db ?? new Db(config.dbFile);
  const app = Fastify({
    logger: config.isTest
      ? false
      : {
          level: config.logLevel,
          // Никогда не пишем в логи cookies, токены и пароли
          redact: ['req.headers.cookie', 'req.headers.authorization', 'req.headers["x-csrf-token"]', 'res.headers["set-cookie"]'],
        },
    // Доверяем ровно N прокси перед приложением (X-Forwarded-For дальше N хопов игнорируется)
    trustProxy: config.trustProxy > 0 ? (_addr: string, hop: number) => hop < config.trustProxy : false,
    bodyLimit: 256 * 1024,
    routerOptions: { maxParamLength: 128 },
  });

  migrate(db, (m) => app.log.info(m));
  const hub = new RealtimeHub();
  const ctx: Ctx = { config, db, hub, services: createServices(db, config, hub) };
  ctx.services.mail.logger = {
    info: (obj: unknown, msg?: string) => app.log.info(obj, msg),
    warn: (obj: unknown, msg?: string) => app.log.warn(obj, msg),
    error: (obj: unknown, msg?: string) => app.log.error(obj, msg),
  };
  app.decorate('ctx', ctx);

  await app.register(cookie, { hook: 'onRequest' });
  await app.register(rateLimit, {
    global: true,
    max: 600,
    timeWindow: '1 minute',
    // Лимит по пользователю, если он вошёл, иначе — по IP
    keyGenerator: (req) => req.auth?.userId ?? req.ip,
    hook: 'preHandler',
  });
  await registerSecurity(app);
  await app.register(multipart, {
    limits: { fileSize: Math.max(config.limits.videoBytes, config.limits.imageBytes, config.limits.fileBytes), files: 1, fields: 10, parts: 12 },
  });
  await app.register(websocket, { options: { maxPayload: 64 * 1024 } });
  await app.register(fastifyStatic, { root: config.uploadsDir, serve: false });

  await app.register(
    async (api) => {
      await api.register(authRoutes);
      await api.register(usersRoutes);
      await api.register(keysRoutes);
      await api.register(chatsRoutes);
      await api.register(postsRoutes);
      await api.register(mediaRoutes);
      await api.register(miscRoutes);
      await api.register(wsRoutes);
    },
    { prefix: API_PREFIX },
  );

  // В production сервер может сам отдавать собранный веб-клиент (один origin — проще и безопаснее)
  if (config.webDist && existsSync(config.webDist)) {
    await app.register(fastifyStatic, {
      root: config.webDist,
      prefix: '/',
      decorateReply: false,
      wildcard: false,
      setHeaders: (res, filePath) => {
        if (filePath.includes(`${path.sep}assets${path.sep}`)) res.header('Cache-Control', 'public, max-age=31536000, immutable');
        else res.header('Cache-Control', 'no-cache');
      },
    });
    // SPA: все неизвестные не-API пути → index.html
    app.get('/*', (req, reply) => {
      if (req.url.startsWith('/api/')) return reply.callNotFound();
      return reply.sendFile('index.html', config.webDist!);
    });
  }

  hub.start(WS_HEARTBEAT_MS);
  app.addHook('onClose', async () => {
    hub.stop();
    if (!opts.db) db.close();
  });
  return app;
}
