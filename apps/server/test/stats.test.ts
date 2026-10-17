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

describe('статистика', () => {
  it('подписчики: ряд растёт и падает, последняя точка совпадает с профилем', async () => {
    const star = await registerUser(app);
    const a = await registerUser(app);
    const b = await registerUser(app);
    await a.client.post(`/users/${star.user.id}/follow`);
    await b.client.post(`/users/${star.user.id}/follow`);
    await b.client.del(`/users/${star.user.id}/follow`);
    await a.client.get(`/users/${star.user.username}`);
    const s = await star.client.get('/stats/overview?days=7');
    expect(s.status).toBe(200);
    expect(s.body.days).toHaveLength(7);
    expect(s.body.followers.total).toBe(1);
    expect(s.body.followers.series.at(-1)).toBe(1);
    expect(s.body.followers.gained.at(-1)).toBe(2);
    expect(s.body.followers.lost.at(-1)).toBe(1);
    expect(s.body.followers.series[0]).toBe(0);
    expect(s.body.profileViews.total).toBe(1);
  });

  it('каналы: подписки, отписки и просмотры по дням — только для владельца и админов', async () => {
    const owner = await registerUser(app);
    const reader = await registerUser(app);
    const ch = await owner.client.post('/chats/channel', { title: 'Статистика', isPublic: true });
    await reader.client.post(`/chats/${ch.body.id}/join`);
    const post = await owner.client.post(`/chats/${ch.body.id}/messages`, { clientId: 'stats-post-0001', text: 'Пост' });
    await reader.client.post(`/chats/${ch.body.id}/views`, { messageIds: [post.body.id] });
    const o = await owner.client.get('/stats/overview?days=30');
    const c = o.body.channels.find((x: { chat: { id: string } }) => x.chat.id === ch.body.id);
    expect(c.subscribers.at(-1)).toBe(2);
    expect(c.joins.at(-1)).toBe(1);
    expect(c.views.at(-1)).toBe(1);
    expect(c.posts).toBe(1);
    const d = await owner.client.get(`/stats/channels/${ch.body.id}?days=7`);
    expect(d.body.topPosts[0].id).toBe(post.body.id);
    expect((await reader.client.get(`/stats/channels/${ch.body.id}`)).status).toBe(403);
    expect((await owner.client.get('/stats/overview?days=5')).status).toBe(400);
  });
});
