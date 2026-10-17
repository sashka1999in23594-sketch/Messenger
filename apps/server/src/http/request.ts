import type { FastifyReply, FastifyRequest } from 'fastify';
import { LIMITS } from '@omni/shared';
import { forbidden, unauthorized } from '../lib/errors.js';
import type { AuthInfo, RequestMeta } from './types.js';

export const SESSION_COOKIE = 'omni_sid';
export const CSRF_COOKIE = 'omni_csrf';
export const CSRF_HEADER = 'x-csrf-token';

/** Требует аутентификации и возвращает данные сеанса. */
export function requireAuth(req: FastifyRequest): AuthInfo {
  if (!req.auth) throw unauthorized();
  return req.auth;
}

export function requireRole(req: FastifyRequest, ...roles: AuthInfo['role'][]): AuthInfo {
  const auth = requireAuth(req);
  if (!roles.includes(auth.role)) throw forbidden();
  return auth;
}

/** Грубое, но приватное определение устройства по User-Agent (без сторонних сервисов). */
export function describeDevice(ua: string): string {
  const os = /iPhone|iPad/.test(ua)
    ? /iPad/.test(ua)
      ? 'iPad'
      : 'iPhone'
    : /Android/.test(ua)
      ? 'Android'
      : /Windows/.test(ua)
        ? 'Windows'
        : /Mac OS X|Macintosh/.test(ua)
          ? 'macOS'
          : /Linux/.test(ua)
            ? 'Linux'
            : 'Устройство';
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /OPR\/|Opera/.test(ua)
      ? 'Opera'
      : /YaBrowser/.test(ua)
        ? 'Яндекс Браузер'
        : /Firefox\//.test(ua)
          ? 'Firefox'
          : /Chrome\//.test(ua)
            ? 'Chrome'
            : /Safari\//.test(ua)
              ? 'Safari'
              : 'Браузер';
  return `${browser} · ${os}`;
}

export function requestMeta(req: FastifyRequest, deviceName?: string): RequestMeta {
  const userAgent = String(req.headers['user-agent'] ?? '').slice(0, 512);
  return {
    ip: req.ip,
    userAgent,
    deviceName: (deviceName?.trim() || describeDevice(userAgent)).slice(0, LIMITS.deviceNameMax),
  };
}

export function noStore(reply: FastifyReply): void {
  reply.header('Cache-Control', 'no-store');
}
