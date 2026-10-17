/**
 * WebSocket-эндпоинт. Аутентификация — тем же httpOnly-cookie сеанса,
 * плюс проверка Origin (защита от Cross-Site WebSocket Hijacking).
 */
import type { FastifyInstance } from 'fastify';
import type { ClientEvent } from '@omni/shared';

/** Сигналы звонков (SDP) бывают по несколько килобайт */
const MAX_MESSAGE_BYTES = 32 * 1024;
const TYPING_THROTTLE_MS = 2000;

export async function wsRoutes(app: FastifyInstance): Promise<void> {
  const { services, config, hub } = app.ctx;

  app.get('/ws', { websocket: true, config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, (socket, req) => {
    const origin = req.headers.origin;
    const sameHost = (() => {
      try {
        return !!origin && new URL(origin).host === req.host;
      } catch {
        return false;
      }
    })();
    if (!origin || !(config.allowedOrigins.has(origin) || sameHost)) {
      socket.close(4003, 'forbidden origin');
      return;
    }
    if (!req.auth) {
      socket.close(4001, 'unauthorized');
      return;
    }
    const { userId, sessionId } = req.auth;
    const conn = hub.add(socket, userId, sessionId);
    hub.sendConn(conn, { t: 'hello', userId, serverTime: new Date().toISOString() });
    hub.sendConn(conn, { t: 'counters', counters: services.notifications.counters(userId) });

    const lastTyping = new Map<string, number>();
    socket.on('message', (raw: Buffer, isBinary: boolean) => {
      if (isBinary || raw.length > MAX_MESSAGE_BYTES) return;
      let event: ClientEvent;
      try {
        event = JSON.parse(raw.toString('utf8')) as ClientEvent;
      } catch {
        return;
      }
      try {
        switch (event.t) {
          case 'ping':
            hub.sendConn(conn, { t: 'pong' });
            break;
          case 'typing': {
            if (typeof event.chatId !== 'string' || event.chatId.length > 64) return;
            const now = Date.now();
            if (now - (lastTyping.get(event.chatId) ?? 0) < TYPING_THROTTLE_MS) return;
            lastTyping.set(event.chatId, now);
            const activity = event.activity === 'voice' || event.activity === 'round' ? event.activity : 'typing';
            services.chats.typing(userId, event.chatId, activity);
            break;
          }
          case 'call.signal': {
            if (typeof event.callId !== 'string' || event.callId.length > 64 || typeof event.signal !== 'object' || !event.signal) return;
            services.calls.signal(userId, sessionId, event.callId, event.signal);
            break;
          }
          case 'presence.subscribe': {
            if (!Array.isArray(event.userIds)) return;
            const ids = event.userIds.filter((id): id is string => typeof id === 'string' && id.length <= 64).slice(0, 200);
            const allowed = ids.filter((id) => {
              const target = services.usersRepo.byId(id);
              return !!target && services.policy.canSeePresence(userId, target);
            });
            hub.watchPresence(conn, allowed);
            for (const id of allowed) {
              const target = services.usersRepo.byId(id)!;
              hub.sendConn(conn, {
                t: 'presence',
                userId: id,
                online: hub.isOnline(id),
                lastSeenAt: target.last_seen_at ? new Date(target.last_seen_at).toISOString() : null,
              });
            }
            break;
          }
        }
      } catch (err) {
        req.log.warn({ err }, 'ws message handling failed');
      }
    });
  });
}
