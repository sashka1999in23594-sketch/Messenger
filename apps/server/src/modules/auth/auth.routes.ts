import type { FastifyInstance, FastifyReply } from 'fastify';
import {
  challengeSchema,
  changeEmailSchema,
  changePasswordSchema,
  changeUsernameSchema,
  deleteAccountSchema,
  emailCodeSchema,
  emailTwoFactorConfirmSchema,
  emailTwoFactorSendSchema,
  forgotPasswordSchema,
  loginSchema,
  pagination,
  passwordConfirmSchema,
  registerSchema,
  resetPasswordSchema,
  totpConfirmSchema,
  totpDisableSchema,
  twoFactorLoginSchema,
  type AuthConfig,
  type DevMail,
  type LoginResult,
} from '@omni/shared';
import { notFound, parse } from '../../lib/errors.js';
import { noStore, requestMeta, requireAuth, SESSION_COOKIE } from '../../http/request.js';
import type { IssuedSession } from './auth.service.js';

/** Строгие лимиты на эндпоинты входа: защита от перебора паролей и кодов. */
const authRateLimit = { rateLimit: { max: 10, timeWindow: '1 minute' } };
const sensitiveRateLimit = { rateLimit: { max: 20, timeWindow: '10 minutes' } };
/** Письма: отправка кодов и восстановление пароля — ещё строже */
const mailRateLimit = { rateLimit: { max: 6, timeWindow: '15 minutes' } };

export async function authRoutes(app: FastifyInstance): Promise<void> {
  const { services, config } = app.ctx;

  const setSession = (reply: FastifyReply, s: IssuedSession) => {
    reply.setCookie(SESSION_COOKIE, s.token, {
      path: '/',
      httpOnly: true,
      sameSite: 'strict',
      secure: config.secureCookies,
      maxAge: Math.floor(config.sessionTtlMs / 1000),
    });
    app.issueCsrf(reply, s.sessionId);
  };

  /** Текущий сеанс + свежий CSRF-токен. Вызывается клиентом при старте. */
  app.get('/auth/session', async (req, reply) => {
    noStore(reply);
    app.issueCsrf(reply, req.auth?.sessionId ?? null);
    return { me: req.auth ? services.users.me(req.auth.userId) : null };
  });

  /** Что умеет сервер: отправляются ли письма, публичное ли это демо. */
  app.get('/auth/config', async () => {
    return { mail: { enabled: services.mail.enabled, dev: services.mail.dev }, demo: config.demoSeed } satisfies AuthConfig;
  });

  app.post('/auth/register', { config: authRateLimit }, async (req, reply) => {
    noStore(reply);
    const input = parse(registerSchema, req.body);
    const s = await services.auth.register(input, requestMeta(req, input.deviceName));
    setSession(reply, s);
    return reply.status(201).send({ status: 'ok', me: services.users.me(s.userId) } satisfies LoginResult);
  });

  app.post('/auth/login', { config: authRateLimit }, async (req, reply) => {
    noStore(reply);
    const input = parse(loginSchema, req.body);
    const result = await services.auth.login(input.username, input.password, requestMeta(req, input.deviceName));
    if ('challenge' in result) {
      return { status: 'two_factor_required', ...result.challenge } satisfies LoginResult;
    }
    setSession(reply, result.session);
    return { status: 'ok', me: services.users.me(result.session.userId) } satisfies LoginResult;
  });

  /** Прислать код входа на почту (если включён вход по коду из письма). */
  app.post('/auth/login/2fa/email', { config: mailRateLimit }, async (req, reply) => {
    noStore(reply);
    const input = parse(challengeSchema, req.body);
    return services.auth.sendLoginCode(input.challengeId, requestMeta(req));
  });

  /** Восстановление пароля: ответ одинаковый для существующих и несуществующих аккаунтов. */
  app.post('/auth/password/forgot', { config: mailRateLimit }, async (req, reply) => {
    noStore(reply);
    const input = parse(forgotPasswordSchema, req.body);
    services.auth.requestPasswordReset(input.login, requestMeta(req));
    return { ok: true };
  });

  app.post('/auth/password/reset', { config: authRateLimit }, async (req, reply) => {
    noStore(reply);
    const input = parse(resetPasswordSchema, req.body);
    const s = await services.auth.resetPassword(input.login, input.code, input.newPassword, requestMeta(req, input.deviceName));
    if (!s) return { status: 'login_required' as const };
    setSession(reply, s);
    return { status: 'ok' as const, me: services.users.me(s.userId) };
  });

  // ─── Почта аккаунта ────────────────────────────────────────────────────────

  app.post('/me/email/send-code', { config: mailRateLimit }, async (req) => {
    const auth = requireAuth(req);
    return services.auth.sendEmailVerification(auth.userId);
  });

  app.post('/me/email/verify', { config: authRateLimit }, async (req) => {
    const auth = requireAuth(req);
    const input = parse(emailCodeSchema, req.body);
    services.auth.verifyEmail(auth.userId, input.code, requestMeta(req));
    return services.users.me(auth.userId);
  });

  app.post('/me/email', { config: sensitiveRateLimit }, async (req) => {
    const auth = requireAuth(req);
    const input = parse(changeEmailSchema, req.body);
    const r = await services.auth.changeEmail(auth.userId, input.email, input.password, requestMeta(req));
    return { ...r, me: services.users.me(auth.userId) };
  });

  /** Тестовый почтовый ящик — только в режиме разработки (в production маршрута нет). */
  if (services.mail.dev && !config.isProd) {
    app.get('/dev/mail', async (_req, reply) => {
      noStore(reply);
      return {
        items: services.mail.outbox.map((m) => ({ id: m.id, to: m.to, subject: m.subject, text: m.text, createdAt: new Date(m.createdAt).toISOString() })),
      } satisfies { items: DevMail[] };
    });
  }

  app.post('/auth/login/2fa', { config: authRateLimit }, async (req, reply) => {
    noStore(reply);
    const input = parse(twoFactorLoginSchema, req.body);
    const s = services.auth.loginWithSecondFactor(input.challengeId, input.code, requestMeta(req));
    setSession(reply, s);
    return { status: 'ok', me: services.users.me(s.userId) } satisfies LoginResult;
  });

  app.post('/auth/logout', async (req, reply) => {
    if (req.auth) services.auth.logout(req.auth.userId, req.auth.sessionId, requestMeta(req));
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    app.issueCsrf(reply, null);
    return { ok: true };
  });

  // ─── Безопасность аккаунта ──────────────────────────────────────────────

  app.get('/security/overview', async (req) => {
    const auth = requireAuth(req);
    const me = services.users.me(auth.userId);
    return {
      twoFactorEnabled: me.twoFactorEnabled,
      twoFactor: me.twoFactor,
      emailVerified: me.emailVerified,
      mailEnabled: services.mail.enabled,
      recoveryCodesLeft: services.auth.recoveryCodesLeft(auth.userId),
      activeSessions: services.sessions.list(auth.userId, auth.sessionId).length,
      deviceKeys: services.keys.listOwn(auth.userId).length,
    };
  });

  app.get('/security/sessions', async (req, reply) => {
    const auth = requireAuth(req);
    noStore(reply);
    return { items: services.sessions.list(auth.userId, auth.sessionId) };
  });

  app.delete<{ Params: { id: string } }>('/security/sessions/:id', async (req) => {
    const auth = requireAuth(req);
    if (!services.auth.revokeSession(auth.userId, req.params.id, requestMeta(req))) throw notFound('Сеанс не найден');
    return { ok: true };
  });

  app.post('/security/sessions/revoke-others', async (req) => {
    const auth = requireAuth(req);
    return { revoked: services.auth.revokeOtherSessions(auth.userId, auth.sessionId, requestMeta(req)) };
  });

  app.get('/security/events', async (req) => {
    const auth = requireAuth(req);
    const q = parse(pagination, req.query);
    return services.securityLog.list(auth.userId, q.cursor, q.limit);
  });

  app.post('/security/password', { config: sensitiveRateLimit }, async (req) => {
    const auth = requireAuth(req);
    const input = parse(changePasswordSchema, req.body);
    await services.auth.changePassword(auth.userId, auth.sessionId, input.currentPassword, input.newPassword, requestMeta(req));
    return { ok: true };
  });

  app.post('/security/username', { config: sensitiveRateLimit }, async (req) => {
    const auth = requireAuth(req);
    const input = parse(changeUsernameSchema, req.body);
    await services.auth.changeUsername(auth.userId, input.username, input.password, requestMeta(req));
    return services.users.me(auth.userId);
  });

  app.post('/security/2fa/setup', { config: sensitiveRateLimit }, async (req, reply) => {
    const auth = requireAuth(req);
    noStore(reply);
    const input = parse(passwordConfirmSchema, req.body);
    return services.auth.beginTotpSetup(auth.userId, input.password);
  });

  app.post('/security/2fa/enable', { config: sensitiveRateLimit }, async (req, reply) => {
    const auth = requireAuth(req);
    noStore(reply);
    const input = parse(totpConfirmSchema, req.body);
    return { recoveryCodes: services.auth.confirmTotpSetup(auth.userId, input.code, requestMeta(req)) };
  });

  app.post('/security/2fa/disable', { config: sensitiveRateLimit }, async (req) => {
    const auth = requireAuth(req);
    const input = parse(totpDisableSchema, req.body);
    await services.auth.disableTotp(auth.userId, input.password, input.code, requestMeta(req));
    return { ok: true };
  });

  app.post('/security/2fa/email/send', { config: mailRateLimit }, async (req) => {
    const auth = requireAuth(req);
    const input = parse(emailTwoFactorSendSchema, req.body);
    return services.auth.sendEmailTwoFactorCode(auth.userId, input.action, input.password);
  });

  app.post('/security/2fa/email/confirm', { config: sensitiveRateLimit }, async (req, reply) => {
    const auth = requireAuth(req);
    noStore(reply);
    const input = parse(emailTwoFactorConfirmSchema, req.body);
    return services.auth.confirmEmailTwoFactor(auth.userId, input.action, input.code, requestMeta(req));
  });

  app.post('/security/2fa/recovery-codes', { config: sensitiveRateLimit }, async (req, reply) => {
    const auth = requireAuth(req);
    noStore(reply);
    const input = parse(passwordConfirmSchema, req.body);
    return { recoveryCodes: await services.auth.regenerateRecoveryCodes(auth.userId, input.password, requestMeta(req)) };
  });

  app.post('/account/delete', { config: sensitiveRateLimit }, async (req, reply) => {
    const auth = requireAuth(req);
    const input = parse(deleteAccountSchema, req.body);
    await services.auth.deleteAccount(auth.userId, input.password, requestMeta(req));
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  /** Экспорт своих данных (право на переносимость данных). */
  app.get('/account/export', { config: sensitiveRateLimit }, async (req, reply) => {
    const auth = requireAuth(req);
    noStore(reply);
    reply.header('Content-Disposition', 'attachment; filename="omni-export.json"');
    return services.exporter.export(auth.userId);
  });
}
