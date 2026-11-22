import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, createTestApp, registerUser } from './helpers.js';

let app: FastifyInstance;
beforeAll(async () => {
  app = await createTestApp();
});
afterAll(async () => {
  await app.close();
});

const project = (text = 'Привет') => ({
  screens: [{ id: 's1', name: 'Главная', elements: [{ id: 'e1', type: 'button', name: 'Кнопка', x: 10, y: 10, w: 120, h: 44, text }] }],
  scripts: [{ id: 'c1', name: 'main', code: 'screen.find("Кнопка").onClick(() => sunnet.notify("ок"))' }],
});

async function newProject(client: Client, text?: string) {
  const p = await client.post('/desk/items', { kind: 'project', name: 'Проект №1' });
  expect(p.status).toBe(201);
  expect((await client.put(`/desk/items/${p.body.id}/data`, { data: project(text) })).status).toBe(200);
  return p.body.id as string;
}

describe('Студия', () => {
  it('сохраняет проект и отдаёт предпросмотр в песочнице без доступа к cookie', async () => {
    const { client } = await registerUser(app);
    const id = await newProject(client, '<img src=x onerror=alert(1)>');
    expect((await client.get(`/desk/items/${id}/data`)).body.data.screens).toHaveLength(1);
    const res = await client.get(`/studio/preview/${id}`);
    expect(res.status).toBe(200);
    expect(String(res.headers['content-security-policy'])).toContain('sandbox allow-scripts');
    expect(String(res.headers['content-security-policy'])).toContain("connect-src 'none'");
    // Текст элемента экранирован — не превращается в HTML
    expect(String(res.body)).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  it('чужой проект не открыть и не опубликовать', async () => {
    const a = await registerUser(app);
    const b = await registerUser(app);
    const id = await newProject(a.client);
    expect((await b.client.get(`/studio/preview/${id}`)).status).toBe(404);
    expect((await b.client.post('/studio/publish', { projectId: id })).status).toBe(404);
  });

  it('публикация даёт ссылку; разрешения — только заявленные, отзыв пишется в историю', async () => {
    const author = await registerUser(app);
    const user = await registerUser(app);
    const id = await newProject(author.client);
    const pub = await author.client.post('/studio/publish', { projectId: id, review: true, permissions: ['notifications'] });
    expect(pub.status).toBe(200);
    expect(pub.body.review).toBe('pending');
    const slug = pub.body.slug as string;
    expect((await user.client.get(`/studio/apps/${slug}`)).body.granted).toEqual([]);
    expect((await user.client.post(`/studio/apps/${slug}/grants`, { permission: 'camera', grant: true })).status).toBe(400);
    expect((await user.client.post(`/studio/apps/${slug}/grants`, { permission: 'notifications', grant: true })).status).toBe(200);
    expect((await user.client.get(`/studio/apps/${slug}`)).body.granted).toEqual(['notifications']);
    await user.client.post(`/studio/apps/${slug}/grants`, { permission: 'notifications', grant: false });
    expect((await user.client.get(`/studio/apps/${slug}`)).body.granted).toEqual([]);
    const hist = (await user.client.get('/studio/grants')).body.items;
    expect(hist[0].revokedAt).toBeTruthy();
    // Уведомление от приложения: без разрешения — нельзя, с разрешением — в центр уведомлений
    expect((await user.client.post(`/studio/apps/${slug}/notify`, { text: 'Привет' })).status).toBe(400);
    await user.client.post(`/studio/apps/${slug}/grants`, { permission: 'notifications', grant: true });
    expect((await user.client.post(`/studio/apps/${slug}/notify`, { text: 'Привет' })).status).toBe(200);
    const notes = (await user.client.get('/notifications')).body.items;
    expect(notes[0]).toMatchObject({ type: 'app_message', link: `/app/${slug}` });
    await user.client.post(`/studio/apps/${slug}/grants`, { permission: 'notifications', grant: false });
    const run = await user.client.get(`/studio/run/${slug}`);
    expect(String(run.headers['content-security-policy'])).toContain('sandbox allow-scripts');
    // Без входа запустить нельзя
    expect((await new Client(app).get(`/studio/run/${slug}`)).status).toBe(401);
  });

  it('админ проверяет приложение, и оно попадает в каталог', async () => {
    const author = await registerUser(app);
    const admin = await registerUser(app);
    app.ctx.db.run("UPDATE users SET role = 'admin' WHERE id = :id", { id: admin.user.id });
    const id = await newProject(author.client);
    const { slug } = (await author.client.post('/studio/publish', { projectId: id, review: true })).body;
    expect((await admin.client.post('/admin/console', { command: '/app.pending()' })).body.lines.join()).toContain(slug);
    expect((await admin.client.post('/admin/console', { command: `/app.verify("${slug}")` })).body.ok).toBe(true);
    expect((await author.client.get('/studio/verified')).body.items.map((a: { slug: string }) => a.slug)).toContain(slug);
  });

  it('настройки стола синхронизируются и проверяются', async () => {
    const { client } = await registerUser(app);
    expect((await client.put('/desk/prefs', { dock: ['home', 'messenger'], iconSize: 'l' })).status).toBe(200);
    expect((await client.get('/desk/prefs')).body.prefs).toEqual({ dock: ['home', 'messenger'], iconSize: 'l' });
    expect((await client.put('/desk/prefs', { iconSize: 'xxl' })).status).toBe(400);
    // Ярлык на раздел Sunnet — можно, на чужой хост через // — нельзя
    expect((await client.post('/desk/items', { kind: 'link', name: 'Серверы', url: '/servers' })).status).toBe(201);
    expect((await client.post('/desk/items', { kind: 'link', name: 'x', url: '//evil.example' })).status).toBe(400);
  });
});
