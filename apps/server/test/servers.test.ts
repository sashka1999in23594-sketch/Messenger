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

describe('серверы и Sunnet Connect', () => {
  it('создаёт сервер, показывает что не готово, оживает от сигнала Connect', async () => {
    const { client } = await registerUser(app);
    const r = await client.post('/servers', { name: 'Клуб фотографов', hosting: 'connect', access: 'invite', needs: { mail: true, database: true, storage: true } });
    expect(r.status).toBe(201);
    expect(r.body.connectCode).toMatch(/^[A-Z0-9-]{10,40}$/);
    expect(r.body.ready).toBe(false);
    expect(r.body.checks.find((c: { id: string }) => c.id === 'mail').ok).toBe(false);
    // Сигнал от Sunnet Connect — без cookie и CSRF, по коду
    const hb = await app.inject({ method: 'POST', url: '/api/v1/connect/heartbeat', headers: { 'content-type': 'application/json' }, payload: JSON.stringify({ code: r.body.connectCode, host: 'DESKTOP-SASHA', diskFreeGb: 120, latencyMs: 40 }) });
    expect(hb.statusCode).toBe(200);
    const after = (await client.get(`/servers/${r.body.id}`)).body;
    expect(after.online).toBe(true);
    expect(after.checks.find((c: { id: string }) => c.id === 'host').ok).toBe(true);
    // Почта: настроили — пункт проверки зелёный
    const mail = await client.put(`/servers/${r.body.id}/mail`, { host: 'smtp.yandex.ru', port: 465, user: 'club@yandex.ru', password: 'app-password' });
    expect(mail.body.ready).toBe(true);
    // Новый код — старый перестаёт работать
    await client.post(`/servers/${r.body.id}/code`);
    const old = await app.inject({ method: 'POST', url: '/api/v1/connect/heartbeat', headers: { 'content-type': 'application/json' }, payload: JSON.stringify({ code: r.body.connectCode }) });
    expect(old.statusCode).toBe(404);
  });

  it('чужой сервер недоступен', async () => {
    const a = await registerUser(app);
    const b = await registerUser(app);
    const r = await a.client.post('/servers', { name: 'Тайный клуб', hosting: 'vps', access: 'closed' });
    expect((await b.client.get(`/servers/${r.body.id}`)).status).toBe(404);
    expect((await b.client.del(`/servers/${r.body.id}`)).status).toBe(404);
  });
});
