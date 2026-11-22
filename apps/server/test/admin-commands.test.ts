import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { COMMANDS } from '../src/modules/admin/commands.js';
import { Client, createTestApp, registerUser, testPhone } from './helpers.js';

let app: FastifyInstance;
beforeAll(async () => {
  app = await createTestApp();
});
afterAll(async () => {
  await app.close();
});

describe('владелец платформы', () => {
  it('первый настоящий пользователь сразу становится администратором, второй — нет', async () => {
    const first = new Client(app);
    const r1 = await first.post('/auth/register', { username: 'sashka', displayName: 'Саша', email: 'sashka@mail.test', phone: testPhone(), password: 'correct-horse-battery-staple' });
    expect(r1.status).toBe(201);
    const second = new Client(app);
    await second.post('/auth/register', { username: 'later', displayName: 'Позже', email: 'later@mail.test', phone: testPhone(), password: 'correct-horse-battery-staple' });
    const role = (u: string) => app.ctx.db.get<{ role: string }>('SELECT role FROM users WHERE username = :u', { u })?.role;
    expect(role('sashka')).toBe('admin');
    expect(role('later')).toBe('user');
    const help = await first.post('/admin/console', { command: '/help.all()' });
    expect(help.body.ok).toBe(true);
    expect(help.body.lines.length).toBe(COMMANDS.length);
  });
});

describe('команды консоли', () => {
  it('сводка, поиск команд, подробности о пользователе и массовое скрытие постов', async () => {
    const admin = await registerUser(app);
    app.ctx.db.run("UPDATE users SET role = 'admin' WHERE id = :id", { id: admin.user.id });
    const spammer = await registerUser(app);
    await spammer.client.post('/posts', { kind: 'note', text: 'спам 1' });
    await spammer.client.post('/posts', { kind: 'note', text: 'спам 2' });
    const run = async (command: string) => (await admin.client.post('/admin/console', { command })).body as { ok: boolean; lines: string[] };

    const stats = await run('/stats.all()');
    expect(stats.ok).toBe(true);
    expect(stats.lines.some((l) => l.startsWith('пользователей:'))).toBe(true);
    expect((await run('/help.find("блок")')).lines.some((l) => l.includes('user.block'))).toBe(true);
    expect((await run(`/user.info("${spammer.user.username}")`)).lines.join(' ')).toContain('Посты: 2');
    expect((await run(`/user.wipe_posts("${spammer.user.username}")`)).lines[0]).toContain('скрыто постов — 2');
    expect((await run(`/user.posts("${spammer.user.username}")`)).lines.every((l) => l.startsWith('✕'))).toBe(true);
  });

  it('личные переписки закрыты даже для администратора', async () => {
    const admin = await registerUser(app);
    app.ctx.db.run("UPDATE users SET role = 'admin' WHERE id = :id", { id: admin.user.id });
    const bob = await registerUser(app);
    const chat = await admin.client.post('/chats/direct', { userId: bob.user.id });
    const id = chat.body?.id ?? chat.body?.chat?.id;
    expect(id).toBeTruthy();
    const res = (await admin.client.post('/admin/console', { command: `/chat.find("${id}")` })).body;
    expect(res.ok).toBe(false);
    expect(res.lines[0]).toContain('закрыты');
  });

  it('модератору недоступны команды администратора', async () => {
    const mod = await registerUser(app);
    app.ctx.db.run("UPDATE users SET role = 'moderator' WHERE id = :id", { id: mod.user.id });
    const res = (await mod.client.post('/admin/console', { command: '/system.announce("привет")' })).body;
    expect(res.ok).toBe(false);
  });
});
