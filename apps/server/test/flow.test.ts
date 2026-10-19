import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SYSTEM_USER_ID } from '@omni/shared';
import { currentStep, totpAt } from '../src/lib/totp.js';
import { Client, createTestApp, registerUser, testPhone } from './helpers.js';

let app: FastifyInstance;
beforeAll(async () => {
  app = await createTestApp();
});
afterAll(async () => {
  await app.close();
});

const codeOf = (text: string) => /(\d{6})/.exec(text)?.[1] ?? '';
/** Последнее письмо адресату из тестового ящика. */
const lastMail = (to: string) => app.ctx.services.mail.outbox.find((m) => m.to === to)?.text ?? '';
/** Последнее сообщение Sunnet в служебном чате пользователя. */
const lastSystem = (userId: string) =>
  app.ctx.db.value<string>(
    'SELECT text FROM messages WHERE chat_id = :c AND sender_id = :s ORDER BY seq DESC LIMIT 1',
    { c: app.ctx.services.system.chatId(userId), s: SYSTEM_USER_ID },
  ) ?? '';
/** Попытку можно «состарить», чтобы проверить паузу перед повторной отправкой. */
const ageFlow = () => app.ctx.db.run('UPDATE auth_flows SET sent_at = sent_at - 31000');

async function userWithEmail() {
  const r = await registerUser(app);
  return { ...r, email: `${r.user.username}@example.com` };
}

describe('пошаговый вход', () => {
  it('аккаунт не найден', async () => {
    const c = new Client(app);
    const r = await c.post('/auth/flow/start', { login: 'nobody-here@example.com' });
    expect(r.status).toBe(404);
    expect(r.body.error.message).toBe('Аккаунт не найден');
  });

  it('почта → код (в письмо и в чат Sunnet) → пароль с подсказкой → вход', async () => {
    const { user, email, password } = await userWithEmail();
    app.ctx.db.run("UPDATE users SET password_hint = 'любимая книга' WHERE id = :id", { id: user.id });
    const c = new Client(app);

    const start = await c.post('/auth/flow/start', { login: email.toUpperCase() });
    expect(start.status).toBe(200);
    expect(start.body).toMatchObject({ step: 'code', emailSent: true, accountSent: true, limited: false, user: null });
    const code = codeOf(lastMail(email));
    expect(lastSystem(user.id)).toContain(code);
    expect(lastSystem(user.id)).toMatch(/IP-адрес/);

    const wrong = await c.post('/auth/flow/code', { flow: start.body.flow, code: code === '000000' ? '111111' : '000000' });
    expect(wrong.status).toBe(400);
    expect(wrong.body.error.message).toMatch(/Осталось попыток: 4/);

    // Подсказку до проверки кода не узнать
    expect((await c.post('/auth/flow/hint', { flow: start.body.flow })).status).toBe(400);
    const ok = await c.post('/auth/flow/code', { flow: start.body.flow, code });
    expect(ok.body).toMatchObject({ step: 'password', hasHint: true, user: { id: user.id } });
    expect((await c.post('/auth/flow/hint', { flow: start.body.flow })).body.hint).toBe('любимая книга');

    const bad = await c.post('/auth/flow/password', { flow: start.body.flow, password: 'wrong-password-123' });
    expect(bad.status).toBe(401);
    const done = await c.post('/auth/flow/password', { flow: start.body.flow, password });
    expect(done.body.status).toBe('ok');
    expect((await c.get('/auth/session')).body.me.id).toBe(user.id);
    // Попытка одноразовая
    expect((await c.post('/auth/flow/password', { flow: start.body.flow, password })).status).toBe(410);
  });

  it('вход по номеру телефона', async () => {
    const phone = testPhone();
    const c0 = new Client(app);
    const reg = await c0.post('/auth/register', { username: `ph_${Date.now().toString(36)}`, displayName: 'Телефон', email: `ph${Date.now()}@example.com`, phone, password: 'correct-horse-battery-staple' });
    expect(reg.status).toBe(201);
    const r = await new Client(app).post('/auth/flow/start', { login: `8${phone.slice(2)}` });
    expect(r.body.step).toBe('code');
  });

  it('«Отправить снова» — один раз через 30 с; лимит 2 кода за 30 минут, дальше только в аккаунт', async () => {
    const { user, email } = await userWithEmail();
    const c = new Client(app);
    const start = await c.post('/auth/flow/start', { login: email });
    expect(start.body.resendIn).toBeGreaterThan(25);

    const early = await c.post('/auth/flow/resend', { flow: start.body.flow });
    expect(early.status).toBe(429);
    ageFlow();
    const again = await c.post('/auth/flow/resend', { flow: start.body.flow });
    expect(again.body).toMatchObject({ emailSent: true, resendIn: null, limited: true });
    ageFlow();
    expect((await c.post('/auth/flow/resend', { flow: start.body.flow })).status).toBe(429);

    // Новая попытка в течение 30 минут: на почту больше не отправляем
    const mailsBefore = app.ctx.services.mail.outbox.filter((m) => m.to === email).length;
    const next = await new Client(app).post('/auth/flow/start', { login: email });
    expect(next.body).toMatchObject({ emailSent: false, limited: true });
    expect(next.body.limitResetIn).toBeGreaterThan(0);

    // «Отправить только в аккаунт» — код приходит в чат Sunnet, письма нет
    const onlyAccount = await new Client(app).post('/auth/flow/resend', { flow: next.body.flow, to: 'account' });
    expect(onlyAccount.body).toMatchObject({ accountSent: true, emailSent: false });
    expect(app.ctx.services.mail.outbox.filter((m) => m.to === email).length).toBe(mailsBefore);
    const code = codeOf(lastSystem(user.id));
    expect((await new Client(app).post('/auth/flow/code', { flow: next.body.flow, code })).body.step).toBe('password');
  });

  it('«Забыли пароль?»: два кода (почта + чат Sunnet) → новый пароль, повтор и подсказка', async () => {
    const { user, email, client: oldDevice } = await userWithEmail();
    const c = new Client(app);
    const start = await c.post('/auth/flow/start', { login: email });
    await c.post('/auth/flow/code', { flow: start.body.flow, code: codeOf(lastMail(email)) });

    const forgot = await c.post('/auth/flow/forgot', { flow: start.body.flow });
    expect(forgot.body).toMatchObject({ step: 'reset_codes', needsAccountCode: true });
    const emailCode = codeOf(lastMail(email));
    const accountCode = codeOf(lastSystem(user.id));
    expect(emailCode).not.toBe(accountCode);

    const wrong = await c.post('/auth/flow/reset-codes', { flow: start.body.flow, emailCode, accountCode: emailCode });
    expect(wrong.status).toBe(400);
    expect(wrong.body.error.fields.accountCode).toBeTruthy();
    const ok = await c.post('/auth/flow/reset-codes', { flow: start.body.flow, emailCode, accountCode });
    expect(ok.body.step).toBe('reset_password');

    const mismatch = await c.post('/auth/flow/reset-password', { flow: start.body.flow, password: 'new-strong-password-42', repeat: 'другой', passwordHint: 'про кота' });
    expect(mismatch.body.error.fields.repeat).toBe('Пароли не совпадают');
    const leak = await c.post('/auth/flow/reset-password', { flow: start.body.flow, password: 'new-strong-password-42', repeat: 'new-strong-password-42', passwordHint: 'new-strong-password-42' });
    expect(leak.body.error.fields.passwordHint).toBeTruthy();
    const done = await c.post('/auth/flow/reset-password', { flow: start.body.flow, password: 'new-strong-password-42', repeat: 'new-strong-password-42', passwordHint: 'про кота' });
    expect(done.body.status).toBe('ok');
    expect(done.body.me.passwordHint).toBe('про кота');
    // Старые устройства вышли
    expect((await oldDevice.get('/auth/session')).body.me).toBeNull();
  });

  it('сброс пароля не отменяет код из приложения-аутентификатора', async () => {
    const { user, email, client: oldDevice, password } = await userWithEmail();
    const setup = await oldDevice.post('/security/2fa/setup', { password });
    const secret: string = setup.body.secret;
    expect((await oldDevice.post('/security/2fa/enable', { code: totpAt(secret, currentStep()) })).status).toBe(200);

    const c = new Client(app);
    const start = await c.post('/auth/flow/start', { login: email });
    await c.post('/auth/flow/code', { flow: start.body.flow, code: codeOf(lastMail(email)) });
    await c.post('/auth/flow/forgot', { flow: start.body.flow });
    await c.post('/auth/flow/reset-codes', { flow: start.body.flow, emailCode: codeOf(lastMail(email)), accountCode: codeOf(lastSystem(user.id)) });
    const reset = await c.post('/auth/flow/reset-password', { flow: start.body.flow, password: 'new-strong-password-43', repeat: 'new-strong-password-43', passwordHint: 'про собаку' });
    expect(reset.body).toMatchObject({ status: 'step', step: 'totp' });
    expect((await c.get('/auth/session')).body.me).toBeNull();
    const done = await c.post('/auth/flow/totp', { flow: start.body.flow, code: totpAt(secret, currentStep() + 1) });
    expect(done.body.status).toBe('ok');
  });

  it('сброс пароля — не больше 4 раз в час', async () => {
    const { user, email } = await userWithEmail();
    const now = Date.now();
    for (let i = 0; i < 4; i++) {
      app.ctx.db.run("INSERT INTO code_sends (id, subject, kind, created_at) VALUES (:id, :u, 'reset', :t)", { id: `rs${now}${i}${user.id}`, u: user.id, t: now - 1000 });
    }
    const c = new Client(app);
    const start = await c.post('/auth/flow/start', { login: email });
    await c.post('/auth/flow/code', { flow: start.body.flow, code: codeOf(lastMail(email)) });
    const r = await c.post('/auth/flow/forgot', { flow: start.body.flow });
    expect(r.status).toBe(429);
    expect(r.body.error.message).toMatch(/4 раза в час/);
  });
});

describe('вход по QR-коду', () => {
  it('новое устройство показывает QR, вошедшее подтверждает, дальше — пароль', async () => {
    const { user, client: phone, password } = await userWithEmail();
    const desktop = new Client(app);
    const qr = await desktop.post('/auth/qr', {});
    expect(qr.body.token).toBeTruthy();
    expect((await desktop.post(`/auth/qr/${qr.body.token}/poll`, { secret: qr.body.secret })).body.status).toBe('pending');
    // Чужой секрет ничего не даёт
    expect((await desktop.post(`/auth/qr/${qr.body.token}/poll`, { secret: 'x'.repeat(32) })).body.status).toBe('expired');

    const info = await phone.get(`/auth/qr/${qr.body.token}`);
    expect(info.body.os).toBeTruthy();
    expect((await new Client(app).get(`/auth/qr/${qr.body.token}`)).status).toBe(401);
    expect((await phone.post(`/auth/qr/${qr.body.token}/approve`)).body.ok).toBe(true);
    expect(lastSystem(user.id)).toMatch(/разрешили вход по QR/);

    const poll = await desktop.post(`/auth/qr/${qr.body.token}/poll`, { secret: qr.body.secret });
    expect(poll.body).toMatchObject({ status: 'approved', state: { step: 'password', user: { id: user.id } } });
    // Повторно подтверждение не выдаётся
    expect((await desktop.post(`/auth/qr/${qr.body.token}/poll`, { secret: qr.body.secret })).body.status).toBe('expired');
    const done = await desktop.post('/auth/flow/password', { flow: poll.body.state.flow, password });
    expect(done.body.status).toBe('ok');
  });
});

describe('пошаговая регистрация', () => {
  it('почта с кодом → данные → аккаунт с подтверждённой почтой и чатом Sunnet', async () => {
    const email = `new${Date.now()}@example.com`;
    const c = new Client(app);
    const start = await c.post('/auth/signup/start', { email });
    expect(start.body.step).toBe('email_code');
    const verified = await c.post('/auth/signup/verify', { flow: start.body.flow, code: codeOf(lastMail(email)) });
    expect(verified.body.step).toBe('details');

    const username = `nu_${Date.now().toString(36)}`;
    const free = await c.get(`/auth/signup/available?username=${username}`);
    expect(free.body.username).toBe(true);
    const base = {
      flow: start.body.flow,
      phone: testPhone(),
      displayName: 'Анна-Мария',
      username,
      birthDate: '2000-05-17',
      gender: 'female',
      password: 'orbit-and-moon-2026',
      repeat: 'orbit-and-moon-2026',
      passwordHint: 'про космос',
    };
    for (const displayName of ['Аня 😀', 'Ваня :)', 'Пётр -_-', '🚀']) {
      const r = await c.post('/auth/signup/complete', { ...base, displayName });
      expect(r.status, displayName).toBe(400);
    }
    expect((await c.post('/auth/signup/complete', { ...base, birthDate: '2020-01-01' })).body.error.fields.birthDate).toMatch(/14 лет/);
    const done = await c.post('/auth/signup/complete', base);
    expect(done.status).toBe(201);
    expect(done.body.me).toMatchObject({ emailVerified: true, birthDate: '2000-05-17', gender: 'female', passwordHint: 'про космос', onboarded: true });
    const chats = await c.get('/chats');
    expect(chats.body.items.some((ch: { system: boolean }) => ch.system)).toBe(true);

    // Почта уже занята
    expect((await new Client(app).post('/auth/signup/start', { email })).status).toBe(409);
  });
});

describe('служебный чат Sunnet', () => {
  it('нельзя писать, удалять, покидать и блокировать Sunnet', async () => {
    const { user, client } = await registerUser(app);
    const chatId = app.ctx.services.system.chatId(user.id);
    const send = await client.post(`/chats/${chatId}/messages`, { clientId: `cid${Date.now()}x`, text: 'привет' });
    expect(send.status).toBe(403);
    expect((await client.del(`/chats/${chatId}`)).status).toBe(403);
    expect((await client.post(`/users/${SYSTEM_USER_ID}/block`)).status).toBe(400);
    const summary = await client.get(`/chats/${chatId}`);
    expect(summary.body).toMatchObject({ system: true, peer: { system: true, displayName: 'Sunnet' } });
  });

  it('эмодзи в имени профиля запрещены', async () => {
    const { client } = await registerUser(app);
    expect((await client.patch('/me/profile', { displayName: 'Котик 🐱' })).status).toBe(400);
    expect((await client.patch('/me/profile', { displayName: "Д'Артаньян" })).status).toBe(200);
  });
});

describe('дни рождения', () => {
  it('поздравление в чате Sunnet и уведомления подписчикам — раз в год', async () => {
    const hero = await registerUser(app);
    const fan = await registerUser(app);
    await fan.client.post(`/users/${hero.user.id}/follow`);
    // 10:00 по Москве в сегодняшний московский день (МСК = UTC+3 круглый год):
    // около полуночи «сегодня» у UTC и у Москвы разное
    const msk = new Date(Date.now() + 3 * 3600_000);
    const tenAm = new Date(Date.UTC(msk.getUTCFullYear(), msk.getUTCMonth(), msk.getUTCDate(), 7));
    const today = `${String(msk.getUTCMonth() + 1).padStart(2, '0')}-${String(msk.getUTCDate()).padStart(2, '0')}`;
    app.ctx.db.run('UPDATE users SET birth_date = :d WHERE id = :id', { d: `1999-${today}`, id: hero.user.id });
    expect(app.ctx.services.birthdays.run(tenAm)).toBeGreaterThanOrEqual(1);
    expect(lastSystem(hero.user.id)).toMatch(/с днём рождения/i);
    const notes = await fan.client.get('/notifications');
    expect(notes.body.items.some((n: { type: string }) => n.type === 'birthday')).toBe(true);
    expect((await hero.client.get('/auth/session')).body.me.birthdayToday).toBe(true);
    // Повторно в этом году не поздравляем
    expect(app.ctx.services.birthdays.run(tenAm)).toBe(0);
  });
});
