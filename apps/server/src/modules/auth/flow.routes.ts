import type { FastifyInstance, FastifyReply } from 'fastify';
import {
  availabilitySchema,
  changePasswordHintSchema,
  flowCodeSchema,
  flowNewPasswordSchema,
  flowPasswordSchema,
  flowResendSchema,
  flowResetCodesSchema,
  flowStartSchema,
  flowTokenSchema,
  flowTotpSchema,
  qrPollSchema,
  signupCompleteSchema,
  signupStartSchema,
  type AuthFlowResult,
} from '@omni/shared';
import { parse } from '../../lib/errors.js';
import { noStore, requestMeta, requireAuth, SESSION_COOKIE } from '../../http/request.js';
import type { IssuedSession } from './auth.service.js';

/** Шаги входа: защита от перебора кодов и паролей по IP (лимиты по аккаунту — в сервисе). */
const stepLimit = { rateLimit: { max: 20, timeWindow: '1 minute' } };
/** Первый шаг и отправка кодов: строже — по ним можно перебирать адреса */
const sendLimit = { rateLimit: { max: 10, timeWindow: '10 minutes' } };
/** Опрос статуса QR-кода — раз в 2 секунды */
const pollLimit = { rateLimit: { max: 90, timeWindow: '1 minute' } };

export async function flowRoutes(app: FastifyInstance): Promise<void> {
  const { services, config } = app.ctx;

  const signIn = (reply: FastifyReply, s: IssuedSession): AuthFlowResult => {
    reply.setCookie(SESSION_COOKIE, s.token, {
      path: '/',
      httpOnly: true,
      sameSite: 'strict',
      secure: config.secureCookies,
      maxAge: Math.floor(config.sessionTtlMs / 1000),
    });
    app.issueCsrf(reply, s.sessionId);
    return { status: 'ok', me: services.users.me(s.userId) };
  };

  // ─── Вход ─────────────────────────────────────────────────────────────────

  app.post('/auth/flow/start', { config: sendLimit }, async (req, reply) => {
    noStore(reply);
    const input = parse(flowStartSchema, req.body);
    return services.authFlow.start(input.login, requestMeta(req, input.deviceName));
  });

  app.post('/auth/flow/resend', { config: sendLimit }, async (req, reply) => {
    noStore(reply);
    const input = parse(flowResendSchema, req.body);
    return services.authFlow.resend(input.flow, input.to, requestMeta(req));
  });

  app.post('/auth/flow/code', { config: stepLimit }, async (req, reply) => {
    noStore(reply);
    const input = parse(flowCodeSchema, req.body);
    return services.authFlow.verifyCode(input.flow, input.code, requestMeta(req));
  });

  app.post('/auth/flow/hint', { config: stepLimit }, async (req, reply) => {
    noStore(reply);
    const input = parse(flowTokenSchema, req.body);
    return services.authFlow.hint(input.flow);
  });

  app.post('/auth/flow/password', { config: stepLimit }, async (req, reply) => {
    noStore(reply);
    const input = parse(flowPasswordSchema, req.body);
    const result = await services.authFlow.password(input.flow, input.password, requestMeta(req));
    return 'token' in result ? signIn(reply, result) : result;
  });

  app.post('/auth/flow/totp', { config: stepLimit }, async (req, reply) => {
    noStore(reply);
    const input = parse(flowTotpSchema, req.body);
    return signIn(reply, services.authFlow.totp(input.flow, input.code, requestMeta(req)));
  });

  app.post('/auth/flow/back', { config: stepLimit }, async (req, reply) => {
    noStore(reply);
    const input = parse(flowTokenSchema, req.body);
    return services.authFlow.back(input.flow);
  });

  app.post('/auth/flow/forgot', { config: sendLimit }, async (req, reply) => {
    noStore(reply);
    const input = parse(flowTokenSchema, req.body);
    return services.authFlow.forgot(input.flow, requestMeta(req));
  });

  app.post('/auth/flow/reset-codes', { config: stepLimit }, async (req, reply) => {
    noStore(reply);
    const input = parse(flowResetCodesSchema, req.body);
    return services.authFlow.resetCodes(input.flow, input.emailCode, input.accountCode, requestMeta(req));
  });

  app.post('/auth/flow/reset-password', { config: stepLimit }, async (req, reply) => {
    noStore(reply);
    const input = parse(flowNewPasswordSchema, req.body);
    const result = await services.authFlow.resetPassword(input.flow, input.password, input.passwordHint, requestMeta(req));
    return 'token' in result ? signIn(reply, result) : result;
  });

  // ─── Вход по QR-коду ──────────────────────────────────────────────────────

  app.post('/auth/qr', { config: sendLimit }, async (req, reply) => {
    noStore(reply);
    return services.authFlow.qrStart(requestMeta(req));
  });

  app.post<{ Params: { token: string } }>('/auth/qr/:token/poll', { config: pollLimit }, async (req, reply) => {
    noStore(reply);
    const input = parse(qrPollSchema, req.body);
    return services.authFlow.qrPoll(req.params.token, input.secret, requestMeta(req));
  });

  /** Вошедшее устройство: что за устройство просит войти. */
  app.get<{ Params: { token: string } }>('/auth/qr/:token', async (req, reply) => {
    requireAuth(req);
    noStore(reply);
    return services.authFlow.qrInfo(req.params.token);
  });

  app.post<{ Params: { token: string } }>('/auth/qr/:token/approve', { config: stepLimit }, async (req) => {
    const auth = requireAuth(req);
    services.authFlow.qrDecide(req.params.token, auth.userId, true, requestMeta(req));
    return { ok: true };
  });

  app.post<{ Params: { token: string } }>('/auth/qr/:token/reject', { config: stepLimit }, async (req) => {
    const auth = requireAuth(req);
    services.authFlow.qrDecide(req.params.token, auth.userId, false, requestMeta(req));
    return { ok: true };
  });

  // ─── Регистрация ──────────────────────────────────────────────────────────

  app.post('/auth/signup/start', { config: sendLimit }, async (req, reply) => {
    noStore(reply);
    const input = parse(signupStartSchema, req.body);
    return services.signup.start(input.email, requestMeta(req, input.deviceName));
  });

  app.post('/auth/signup/resend', { config: sendLimit }, async (req, reply) => {
    noStore(reply);
    const input = parse(flowTokenSchema, req.body);
    return services.signup.resend(input.flow);
  });

  app.post('/auth/signup/verify', { config: stepLimit }, async (req, reply) => {
    noStore(reply);
    const input = parse(flowCodeSchema, req.body);
    return services.signup.verify(input.flow, input.code);
  });

  app.get('/auth/signup/available', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (req, reply) => {
    noStore(reply);
    return services.signup.availability(parse(availabilitySchema, req.query));
  });

  app.post('/auth/signup/complete', { config: stepLimit }, async (req, reply) => {
    noStore(reply);
    const input = parse(signupCompleteSchema, req.body);
    const s = await services.signup.complete(input, requestMeta(req));
    return reply.status(201).send(signIn(reply, s));
  });

  // ─── Подсказка к паролю из настроек ───────────────────────────────────────

  app.post('/security/password-hint', { config: { rateLimit: { max: 20, timeWindow: '10 minutes' } } }, async (req) => {
    const auth = requireAuth(req);
    const input = parse(changePasswordHintSchema, req.body);
    await services.auth.setPasswordHint(auth.userId, input.password, input.passwordHint, requestMeta(req));
    return services.users.me(auth.userId);
  });
}
