/**
 * Защитный периметр HTTP:
 *  • строгие заголовки (CSP, HSTS, COOP/CORP, запрет фреймов, Referrer-Policy);
 *  • CSRF: проверка Origin + double-submit токен, привязанный к сеансу (HMAC);
 *  • определение сеанса по httpOnly-cookie;
 *  • единый формат ошибок без утечки внутренних деталей.
 */
import helmet from '@fastify/helmet';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ErrorCode, type ApiErrorBody, ERROR_MESSAGES } from '@omni/shared';
import { AppError } from '../lib/errors.js';
import { deriveKey, hmac, randomToken, safeEqual } from '../lib/crypto.js';
import { CSRF_COOKIE, CSRF_HEADER, SESSION_COOKIE } from './request.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export async function registerSecurity(app: FastifyInstance): Promise<void> {
  const { config } = app.ctx;
  const csrfKey = deriveKey(config.secret, 'csrf');

  await app.register(helmet, {
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        mediaSrc: ["'self'", 'blob:'],
        fontSrc: ["'self'", 'data:'],
        connectSrc: ["'self'", ...[...config.allowedOrigins].map((o) => o.replace(/^http/, 'ws'))],
        workerSrc: ["'self'"],
        manifestSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'none'"],
        formAction: ["'self'"],
        ...(config.isProd ? { upgradeInsecureRequests: [] } : {}),
      },
    },
    crossOriginEmbedderPolicy: false,
    frameguard: { action: 'deny' },
    crossOriginResourcePolicy: { policy: 'same-origin' },
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    strictTransportSecurity: config.isProd ? { maxAge: 63072000, includeSubDomains: true, preload: true } : false,
  });

  app.addHook('onSend', async (_req, reply) => {
    reply.header('Permissions-Policy', 'camera=(self), microphone=(self), geolocation=(), payment=(), usb=(), interest-cohort=()');
  });

  // Определяем сеанс
  app.decorateRequest('auth', null);
  app.addHook('onRequest', async (req) => {
    const token = req.cookies[SESSION_COOKIE];
    if (!token) return;
    const s = app.ctx.services.sessions.resolve(token, req.ip);
    if (s) req.auth = { userId: s.userId, sessionId: s.sessionId, role: s.role };
  });

  // CSRF для изменяющих запросов
  app.addHook('preHandler', async (req) => {
    if (SAFE_METHODS.has(req.method) || !req.url.startsWith('/api/')) return;
    const origin = req.headers.origin ?? refererOrigin(req.headers.referer);
    if (!origin || !(config.allowedOrigins.has(origin) || isSameOrigin(origin, req))) {
      throw new AppError(403, ErrorCode.Csrf, 'Запрос с недоверенного источника');
    }
    const header = req.headers[CSRF_HEADER];
    const cookie = req.cookies[CSRF_COOKIE];
    if (typeof header !== 'string' || !cookie || !safeEqual(header, cookie) || !validCsrf(cookie, req)) {
      throw new AppError(403, ErrorCode.Csrf);
    }
  });

  function csrfFor(binding: string, nonce: string): string {
    return `${nonce}.${hmac(csrfKey, `${binding}:${nonce}`).slice(0, 32)}`;
  }
  function validCsrf(token: string, req: FastifyRequest): boolean {
    const [nonce] = token.split('.');
    if (!nonce) return false;
    // Токен привязан к сеансу (или к «анонимному» состоянию до входа)
    return safeEqual(token, csrfFor(req.auth?.sessionId ?? 'anon', nonce));
  }

  /** Выдаёт свежий CSRF-токен, привязанный к текущему (или новому) сеансу. */
  app.decorate('issueCsrf', (reply: FastifyReply, sessionId: string | null) => {
    const token = csrfFor(sessionId ?? 'anon', randomToken(16));
    reply.setCookie(CSRF_COOKIE, token, {
      path: '/',
      httpOnly: false,
      sameSite: 'strict',
      secure: config.secureCookies,
    });
    return token;
  });

  app.setErrorHandler((err, req, reply) => {
    const send = (status: number, body: ApiErrorBody) => {
      reply.header('Cache-Control', 'no-store');
      return reply.status(status).send(body);
    };
    if (err instanceof AppError) {
      if (err.retryAfter) reply.header('Retry-After', String(err.retryAfter));
      return send(err.status, {
        error: { code: err.code, message: err.message, fields: err.fields, retryAfter: err.retryAfter },
      });
    }
    const e = err as { statusCode?: number; code?: string; message?: string };
    if (e.statusCode === 429) {
      return send(429, { error: { code: ErrorCode.RateLimited, message: ERROR_MESSAGES.RATE_LIMITED } });
    }
    if (e.code === 'FST_REQ_FILE_TOO_LARGE' || e.statusCode === 413) {
      return send(413, { error: { code: ErrorCode.PayloadTooLarge, message: ERROR_MESSAGES.PAYLOAD_TOO_LARGE } });
    }
    if (e.statusCode && e.statusCode >= 400 && e.statusCode < 500) {
      return send(e.statusCode, { error: { code: ErrorCode.Validation, message: 'Некорректный запрос' } });
    }
    req.log.error({ err }, 'unhandled error');
    return send(500, { error: { code: ErrorCode.Internal, message: ERROR_MESSAGES.INTERNAL_ERROR } });
  });

  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api/')) {
      return reply.status(404).send({ error: { code: ErrorCode.NotFound, message: 'Метод API не найден' } });
    }
    return reply.status(404).send('Not found');
  });
}

/** Origin совпадает с хостом, на который пришёл запрос (в т.ч. через dev-прокси или с телефона в локальной сети). */
function isSameOrigin(origin: string, req: FastifyRequest): boolean {
  try {
    return new URL(origin).host === req.host;
  } catch {
    return false;
  }
}

function refererOrigin(referer: string | undefined): string | undefined {
  if (!referer) return undefined;
  try {
    return new URL(referer).origin;
  } catch {
    return undefined;
  }
}

declare module 'fastify' {
  interface FastifyInstance {
    issueCsrf(reply: FastifyReply, sessionId: string | null): string;
  }
}
