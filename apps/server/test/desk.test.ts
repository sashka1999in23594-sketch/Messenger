import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, PNG_1x1, registerUser } from './helpers.js';

let app: FastifyInstance;
beforeAll(async () => {
  app = await createTestApp();
});
afterAll(async () => {
  await app.close();
});

describe('рабочий стол = облако', () => {
  it('создаёт папку и файл, двигает значок, кладёт в папку, корзина и восстановление', async () => {
    const { client } = await registerUser(app);
    const folder = await client.post('/desk/items', { kind: 'folder', name: 'Учёба', x: 0, y: 0 });
    expect(folder.status).toBe(201);
    const up = await client.upload(PNG_1x1, 'фото.png');
    const file = await client.post('/desk/items', { kind: 'file', name: 'фото.png', mediaId: up.body.id, x: 0, y: 1 });
    expect(file.status).toBe(201);
    expect(file.body.media.url).toBeTruthy();
    expect((await client.patch(`/desk/items/${file.body.id}`, { x: 3, y: 2 })).body.x).toBe(3);
    expect((await client.patch(`/desk/items/${file.body.id}`, { parentId: folder.body.id })).body.parentId).toBe(folder.body.id);
    // Папку нельзя положить в саму себя
    expect((await client.patch(`/desk/items/${folder.body.id}`, { parentId: folder.body.id })).status).toBe(404);
    // Навсегда — только из корзины
    expect((await client.del(`/desk/items/${file.body.id}?forever=1`)).status).toBe(404);
    expect((await client.del(`/desk/items/${file.body.id}`)).status).toBe(200);
    expect((await client.get('/desk/items')).body.items.map((i: { id: string }) => i.id)).not.toContain(file.body.id);
    expect((await client.get('/desk/items?trash=1')).body.items).toHaveLength(1);
    expect((await client.post(`/desk/items/${file.body.id}/restore`)).status).toBe(200);
    expect((await client.get('/desk/items')).body.items).toHaveLength(2);
  });

  it('чужие элементы и чужие файлы недоступны', async () => {
    const a = await registerUser(app);
    const b = await registerUser(app);
    const item = await a.client.post('/desk/items', { kind: 'folder', name: 'Личное' });
    expect((await b.client.patch(`/desk/items/${item.body.id}`, { name: 'взлом' })).status).toBe(404);
    expect((await b.client.del(`/desk/items/${item.body.id}`)).status).toBe(404);
    const up = await a.client.upload(PNG_1x1, 'a.png');
    expect((await b.client.post('/desk/items', { kind: 'file', name: 'a.png', mediaId: up.body.id })).status).toBe(404);
  });

  it('ярлыки — только https', async () => {
    const { client } = await registerUser(app);
    expect((await client.post('/desk/items', { kind: 'link', name: 'X', url: 'javascript:alert(1)' })).status).toBe(400);
    expect((await client.post('/desk/items', { kind: 'link', name: 'Telegram', url: 'https://web.telegram.org' })).status).toBe(201);
  });
});
