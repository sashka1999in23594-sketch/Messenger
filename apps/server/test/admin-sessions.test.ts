import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseCommand, parseDuration } from '../src/modules/admin/admin.routes.js';
import { Client, createTestApp, registerUser } from './helpers.js';

let app: FastifyInstance;
beforeAll(async () => {
  app = await createTestApp();
});
afterAll(async () => {
  await app.close();
});

describe('сеанс переживает потерю базы', () => {
  it('подписанный токен восстанавливает удалённую строку сеанса', async () => {
    const { client, user } = await registerUser(app);
    expect((await client.get('/auth/session')).body.me.id).toBe(user.id);
    // Имитируем откат базы к копии без этого сеанса (диск Render временный)
    app.ctx.db.run('DELETE FROM sessions WHERE user_id = :id', { id: user.id });
    const again = await client.get('/auth/session');
    expect(again.body.me?.id).toBe(user.id);
  });

  it('поддельная подпись не восстанавливает сеанс', async () => {
    const { client, user } = await registerUser(app);
    app.ctx.db.run('DELETE FROM sessions WHERE user_id = :id', { id: user.id });
    const sid = client.cookies.get('omni_sid')!;
    client.cookies.set('omni_sid', sid.slice(0, -4) + 'AAAA');
    expect((await client.get('/auth/session')).body.me).toBeNull();
  });

  it('смена пароля обнуляет старые подписанные токены', async () => {
    const { client, user } = await registerUser(app);
    const thief = new Client(app);
    thief.cookies.set('omni_sid', client.cookies.get('omni_sid')!);
    app.ctx.db.run("UPDATE users SET password_hash = 'scrypt$changed' WHERE id = :id", { id: user.id });
    app.ctx.db.run('DELETE FROM sessions WHERE user_id = :id', { id: user.id });
    expect((await thief.get('/auth/session')).body.me).toBeNull();
  });
});

describe('консоль администратора', () => {
  it('разбирает команды и сроки', () => {
    expect(parseCommand('/user.block("sashka", duration: 7d)')).toEqual({ name: 'user.block', pos: ['sashka'], named: { duration: '7d' } });
    expect(parseCommand('user.find(\'a, b\')')?.pos).toEqual(['a, b']);
    expect(parseCommand('rm -rf /')).toBeNull();
    expect(parseDuration('7d')).toBe(7 * 86_400_000);
    expect(parseDuration('15m')).toBe(15 * 60_000);
    expect(parseDuration('7 лет')).toBeNull();
  });

  it('обычный пользователь не может вызывать команды', async () => {
    const { client } = await registerUser(app);
    const res = await client.post('/admin/console', { command: '/help.all()' });
    expect(res.status).toBe(403);
  });

  it('админ блокирует на срок, блокировка закрывает сеанс, всё пишется в журнал', async () => {
    const admin = await registerUser(app);
    const victim = await registerUser(app);
    app.ctx.db.run("UPDATE users SET role = 'admin' WHERE id = :id", { id: admin.user.id });
    const res = await admin.client.post('/admin/console', { command: `/user.block("${victim.user.username}", duration: 7d, reason: "спам")` });
    expect(res.body.ok).toBe(true);
    expect((await victim.client.get('/auth/session')).body.me).toBeNull();
    const un = await admin.client.post('/admin/console', { command: `/user.unblock("${victim.user.username}")` });
    expect(un.body.ok).toBe(true);
    const log = await admin.client.post('/admin/console', { command: '/audit.show()' });
    expect(log.body.lines.join('\n')).toContain('user.block');
    const badge = await admin.client.post('/admin/console', { command: `/badge.give("${victim.user.username}", "verified")` });
    expect(badge.body.ok).toBe(true);
  });

  it('модератор не может выдавать роли и трогать админов', async () => {
    const mod = await registerUser(app);
    const admin = await registerUser(app);
    app.ctx.db.run("UPDATE users SET role = 'moderator' WHERE id = :id", { id: mod.user.id });
    app.ctx.db.run("UPDATE users SET role = 'admin' WHERE id = :id", { id: admin.user.id });
    expect((await mod.client.post('/admin/console', { command: `/role.grant("${mod.user.username}", "admin")` })).body.ok).toBe(false);
    expect((await mod.client.post('/admin/console', { command: `/user.block("${admin.user.username}", duration: 1d)` })).body.ok).toBe(false);
  });
});
