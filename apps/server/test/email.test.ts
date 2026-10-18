import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { Client, createTestApp, registerUser } from './helpers.js';

let app: FastifyInstance;
beforeAll(async () => {
  app = await createTestApp();
});
afterAll(async () => {
  await app.close();
});

/** Последнее письмо адресату из тестового ящика. */
function lastMail(to: string, subjectPart?: string) {
  const m = app.ctx.services.mail.outbox.find((x) => x.to === to && (!subjectPart || x.subject.includes(subjectPart)));
  if (!m) throw new Error(`нет письма для ${to}`);
  return m;
}
const codeOf = (text: string) => /Код: (\d{6})/.exec(text)?.[1] ?? '';
const wrong = (code: string) => String((Number(code) + 1) % 1_000_000).padStart(6, '0');

async function verifiedUser() {
  const r = await registerUser(app);
  const email = `${r.user.username}@example.com`;
  const code = codeOf(lastMail(email, 'подтверждения').text);
  const res = await r.client.post('/me/email/verify', { code });
  expect(res.status).toBe(200);
  return { ...r, email };
}

describe('почта: подтверждение адреса', () => {
  it('при регистрации отправляет код; неверный код отклоняется, верный — подтверждает почту', async () => {
    const { client, user } = await registerUser(app);
    const email = `${user.username}@example.com`;
    const mail = lastMail(email, 'подтверждения');
    const code = codeOf(mail.text);
    expect(code).toMatch(/^\d{6}$/);

    const me0 = await client.get('/me');
    expect(me0.body.email).toBe(email);
    expect(me0.body.emailVerified).toBe(false);

    const bad = await client.post('/me/email/verify', { code: wrong(code) });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('EMAIL_CODE_INVALID');

    const ok = await client.post('/me/email/verify', { code });
    expect(ok.status).toBe(200);
    expect(ok.body.emailVerified).toBe(true);
    expect(lastMail(email).subject).toContain('Почта подтверждена');
  });

  it('после 5 неверных попыток код перестаёт действовать', async () => {
    const { client, user } = await registerUser(app);
    const code = codeOf(lastMail(`${user.username}@example.com`, 'подтверждения').text);
    for (let i = 0; i < 5; i++) await client.post('/me/email/verify', { code: wrong(code) });
    const res = await client.post('/me/email/verify', { code });
    expect(res.status).toBe(400);
  });

  it('повторная отправка кода — не чаще раза в минуту', async () => {
    const { client } = await registerUser(app);
    const res = await client.post('/me/email/send-code');
    expect(res.status).toBe(429);
    expect(res.body.error.retryAfter).toBeGreaterThan(0);
  });

  it('вход по подтверждённой почте работает, по неподтверждённой — нет', async () => {
    const unverified = await registerUser(app);
    const c1 = new Client(app);
    const r1 = await c1.post('/auth/login', { username: `${unverified.user.username}@example.com`, password: unverified.password });
    expect(r1.status).toBe(401);

    const verified = await verifiedUser();
    const c2 = new Client(app);
    const r2 = await c2.post('/auth/login', { username: verified.email.toUpperCase(), password: verified.password });
    expect(r2.status).toBe(200);
    expect(r2.body.me.id).toBe(verified.user.id);
  });

  it('смена адреса требует пароль, сбрасывает подтверждение и уведомляет старый адрес', async () => {
    const { client, email, password } = await verifiedUser();
    const badPw = await client.post('/me/email', { email: 'new-address@example.com', password: 'wrong-password-123' });
    expect(badPw.status).toBe(400);
    const res = await client.post('/me/email', { email: 'New-Address@Example.com', password });
    expect(res.status).toBe(200);
    expect(res.body.me.email).toBe('new-address@example.com');
    expect(res.body.me.emailVerified).toBe(false);
    expect(lastMail(email).subject).toContain('Адрес почты изменён');
  });
});

describe('почта: восстановление пароля', () => {
  it('одинаковый ответ для несуществующих аккаунтов и аккаунтов без подтверждённой почты', async () => {
    const c = new Client(app);
    const before = app.ctx.services.mail.outbox.length;
    const unknown = await c.post('/auth/password/forgot', { login: 'nobody_here_at_all' });
    const { user } = await registerUser(app);
    const sizeAfterRegister = app.ctx.services.mail.outbox.length;
    const noEmail = await c.post('/auth/password/forgot', { login: user.username });
    expect(unknown.status).toBe(200);
    expect(noEmail.status).toBe(200);
    expect(noEmail.body).toEqual(unknown.body);
    // Письмо о сбросе не уходит: почта не подтверждена
    expect(app.ctx.services.mail.outbox.length).toBe(sizeAfterRegister);
    expect(sizeAfterRegister).toBeGreaterThan(before);
  });

  it('сброс по коду меняет пароль, завершает все сеансы, код одноразовый', async () => {
    const { client, user, email, password } = await verifiedUser();
    const anon = new Client(app);
    expect((await anon.post('/auth/password/forgot', { login: email })).status).toBe(200);
    const code = codeOf(lastMail(email, 'восстановление').text);

    const newPassword = 'another-long-passphrase-42';
    const reset = await anon.post('/auth/password/reset', { login: user.username, code, newPassword });
    expect(reset.status).toBe(200);
    expect(reset.body.status).toBe('ok');
    expect(reset.body.me.id).toBe(user.id);

    // Старый сеанс завершён, старый пароль не подходит
    expect((await client.get('/me')).status).toBe(401);
    expect((await new Client(app).post('/auth/login', { username: user.username, password })).status).toBe(401);
    expect((await new Client(app).post('/auth/login', { username: user.username, password: newPassword })).status).toBe(200);

    const again = await new Client(app).post('/auth/password/reset', { login: user.username, code, newPassword: 'yet-another-passphrase-7' });
    expect(again.status).toBe(400);
    expect(lastMail(email).subject).toContain('Пароль сброшен');
  });
});

describe('почта: вход по коду из письма (2FA)', () => {
  it('включение, вход с кодом из письма, защита от неверного кода', async () => {
    const { client, user, email, password } = await verifiedUser();
    expect((await client.post('/security/2fa/email/send', { action: 'enable', password: 'wrong-password-123' })).status).toBe(400);
    expect((await client.post('/security/2fa/email/send', { action: 'enable', password })).status).toBe(200);
    const enableCode = codeOf(lastMail(email, 'подтверждение действия').text);
    const enabled = await client.post('/security/2fa/email/confirm', { action: 'enable', code: enableCode });
    expect(enabled.status).toBe(200);
    expect(enabled.body.recoveryCodes).toHaveLength(10);
    expect((await client.get('/me')).body.twoFactor).toEqual({ totp: false, email: true });

    const c = new Client(app);
    const step1 = await c.post('/auth/login', { username: user.username, password });
    expect(step1.body.status).toBe('two_factor_required');
    expect(step1.body.methods).toEqual(['email']);
    expect(step1.body.emailSent).toBe(true);
    expect(step1.body.emailHint).toMatch(/\*/);
    const loginCode = codeOf(lastMail(email, 'для входа').text);

    const bad = await c.post('/auth/login/2fa', { challengeId: step1.body.challengeId, code: wrong(loginCode) });
    expect(bad.status).toBe(401);
    const ok = await c.post('/auth/login/2fa', { challengeId: step1.body.challengeId, code: loginCode });
    expect(ok.status).toBe(200);
    expect(ok.body.me.id).toBe(user.id);

    // Код привязан к попытке входа: для другой попытки он не подходит
    const c2 = new Client(app);
    const other = await c2.post('/auth/login', { username: user.username, password });
    expect((await c2.post('/auth/login/2fa', { challengeId: other.body.challengeId, code: loginCode })).status).toBe(401);
  });

  it('после сброса пароля при включённой 2FA автоматического входа нет', async () => {
    const { client, user, email, password } = await verifiedUser();
    await client.post('/security/2fa/email/send', { action: 'enable', password });
    await client.post('/security/2fa/email/confirm', { action: 'enable', code: codeOf(lastMail(email, 'подтверждение действия').text) });
    const anon = new Client(app);
    await anon.post('/auth/password/forgot', { login: user.username });
    // Отправка в фоне — дожидаемся письма
    await new Promise((r) => setTimeout(r, 20));
    const code = codeOf(lastMail(email, 'восстановление').text);
    const reset = await anon.post('/auth/password/reset', { login: user.username, code, newPassword: 'fresh-passphrase-for-test' });
    expect(reset.body.status).toBe('login_required');
    expect(anon.cookies.has('omni_sid')).toBe(false);
  });
});

describe('почта: оповещения и режимы', () => {
  it('вход с нового устройства — письмо на подтверждённую почту', async () => {
    const { user, email, password } = await verifiedUser();
    const c = new Client(app);
    await c.request('POST', '/api/v1/auth/login', { username: user.username, password }, { 'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0) Safari/604.1' });
    await new Promise((r) => setTimeout(r, 20));
    expect(lastMail(email).subject).toContain('Новый вход');
  });

  it('в production без настроек почты тестового ящика нет, письма выключены', async () => {
    const prod = await buildApp(
      loadConfig({
        NODE_ENV: 'production',
        DATA_DIR: mkdtempSync(path.join(tmpdir(), 'omni-prod-')),
        APP_SECRET: 'prod-secret-prod-secret-prod-secret-0123456789',
        PUBLIC_ORIGIN: 'https://omni.example',
        LOG_LEVEL: 'silent',
      }),
    );
    await prod.ready();
    const cfg = await prod.inject({ method: 'GET', url: '/api/v1/auth/config' });
    expect(cfg.json().mail).toEqual({ enabled: false, dev: false });
    const box = await prod.inject({ method: 'GET', url: '/api/v1/dev/mail' });
    expect(box.statusCode).toBe(404);
    await prod.close();
  });
});

describe('самопроверка Brevo при запуске', () => {
  afterEach(() => vi.unstubAllGlobals());
  const brevo = async (account: Response, senders: unknown) => {
    vi.stubGlobal('fetch', async (url: string) => (String(url).endsWith('/account') ? account : new Response(JSON.stringify(senders))));
    const dir = mkdtempSync(path.join(tmpdir(), 'omni-mail-'));
    const config = loadConfig({ NODE_ENV: 'test', DATA_DIR: dir, APP_SECRET: 'test-secret-test-secret-test-secret-0123456789', BREVO_API_KEY: 'xkeysib-test', MAIL_FROM: 'SpaceUp <Me@Gmail.com>' });
    const a = await buildApp(config);
    a.ctx.services.mail.logger = { info: () => undefined, warn: () => undefined, error: () => undefined };
    const health = await a.ctx.services.mail.verify();
    await a.close();
    return health;
  };

  it('ключ принят и отправитель подтверждён — ok', async () => {
    expect(await brevo(new Response('{}'), { senders: [{ email: 'me@gmail.com', active: true }] })).toBe('ok');
  });
  it('отправитель не подтверждён', async () => {
    expect(await brevo(new Response('{}'), { senders: [{ email: 'me@gmail.com', active: false }] })).toBe('sender_not_verified');
  });
  it('неверный ключ и блокировка по IP различаются', async () => {
    expect(await brevo(new Response('{"code":"unauthorized","message":"Key not found"}', { status: 401 }), {})).toBe('bad_key');
    expect(await brevo(new Response('{"code":"unauthorized","message":"We have detected you are using an unrecognised IP address"}', { status: 401 }), {})).toBe('ip_blocked');
  });
});
