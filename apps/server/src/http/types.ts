import type { Ctx } from '../context.js';

export interface AuthInfo {
  userId: string;
  sessionId: string;
  role: 'user' | 'moderator' | 'admin';
}

export interface RequestMeta {
  ip: string;
  userAgent: string;
  deviceName: string;
}

declare module 'fastify' {
  interface FastifyInstance {
    ctx: Ctx;
  }
  interface FastifyRequest {
    auth: AuthInfo | null;
  }
}
