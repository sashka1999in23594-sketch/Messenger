import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, registerUser } from './helpers.js';

let app: FastifyInstance;
beforeAll(async () => {
  app = await createTestApp();
});
afterAll(async () => {
  await app.close();
});

const WEBM = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(64, 1)]);

describe('прямые эфиры', () => {
  it('эфир: старт, зрители, чат, завершение; заблокированный не видит', async () => {
    const host = await registerUser(app);
    const fan = await registerUser(app);
    const hater = await registerUser(app);
    await host.client.post(`/users/${hater.user.id}/block`);
    const s = await host.client.post('/live', { title: 'Собираем Sunnet', description: 'Отвечаю на вопросы' });
    expect(s.status).toBe(201);
    expect(s.body.status).toBe('live');
    expect((await fan.client.get('/live')).body.live.map((x: { id: string }) => x.id)).toContain(s.body.id);
    expect((await hater.client.get('/live')).body.live.map((x: { id: string }) => x.id)).not.toContain(s.body.id);
    expect((await hater.client.post(`/live/${s.body.id}/join`)).status).toBe(404);

    const j = await fan.client.post(`/live/${s.body.id}/join`);
    expect(j.status).toBe(200);
    expect(j.body.peer).toMatch(/^[\w-]{8,}$/);
    expect(j.body.stream.viewers).toBe(1);
    const msg = await fan.client.post(`/live/${s.body.id}/chat`, { text: 'Привет из чата!' });
    expect(msg.status).toBe(201);
    expect((await host.client.get(`/live/${s.body.id}`)).body.chat.at(-1).text).toBe('Привет из чата!');
    // Завершить может только ведущий
    expect((await fan.client.post(`/live/${s.body.id}/end`)).status).toBe(403);
    const ended = await host.client.post(`/live/${s.body.id}/end`);
    expect(ended.body).toMatchObject({ status: 'ended', peakViewers: 1, totalViewers: 1 });
    expect((await fan.client.post(`/live/${s.body.id}/chat`, { text: 'ещё тут?' })).status).toBe(400);
    expect((await fan.client.post(`/live/${s.body.id}/join`)).status).toBe(400);
  });
});

describe('премьеры', () => {
  it('видео скрыто до начала, напоминание приходит в момент премьеры', async () => {
    const author = await registerUser(app);
    const fan = await registerUser(app);
    const media = await author.client.upload(WEBM, 'film.webm', '?duration=60');
    expect(media.status).toBe(201);
    const tooSoon = await author.client.post('/posts', { kind: 'video', title: 'Фильм', mediaIds: [media.body.id], premiereAt: new Date(Date.now() + 60_000).toISOString() });
    expect(tooSoon.status).toBe(400);
    const at = new Date(Date.now() + 3600_000).toISOString();
    const post = await author.client.post('/posts', { kind: 'video', title: 'Фильм', mediaIds: [media.body.id], premiereAt: at });
    expect(post.status).toBe(201);
    expect(post.body.media[0].url).not.toBe('');
    const seen = await fan.client.get(`/posts/${post.body.id}`);
    expect(seen.body.premiereAt).toBe(at);
    expect(seen.body.media[0].url).toBe('');
    expect((await fan.client.get('/premieres')).body.items.map((p: { id: string }) => p.id)).toContain(post.body.id);
    expect((await fan.client.post(`/premieres/${post.body.id}/remind`, { on: true })).status).toBe(200);
    const room = await fan.client.post(`/premieres/${post.body.id}/join`);
    expect(room.body.watching).toBe(1);
    expect((await fan.client.post(`/premieres/${post.body.id}/chat`, { text: 'Ждём!' })).status).toBe(201);

    // Премьера началась: видео доступно, напоминание пришло
    app.ctx.db.run('UPDATE posts SET premiere_at = :t WHERE id = :id', { t: Date.now() - 1000, id: post.body.id });
    expect(app.ctx.services.posts.firePremiereReminders()).toBe(1);
    expect((await fan.client.get(`/posts/${post.body.id}`)).body.media[0].url).not.toBe('');
    const n = await fan.client.get('/notifications');
    expect(n.body.items[0].preview).toContain('премьера начинается');
  });
});
