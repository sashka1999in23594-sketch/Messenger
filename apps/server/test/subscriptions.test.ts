import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { rollForward } from '../src/modules/subscriptions/subscriptions.routes.js';
import { createTestApp, registerUser } from './helpers.js';

let app: FastifyInstance;
beforeAll(async () => {
  app = await createTestApp();
});
afterAll(async () => {
  await app.close();
});

describe('подписки', () => {
  it('переносит прошедшую дату платежа на следующий период', () => {
    const today = new Date('2026-11-21T10:00:00Z');
    expect(rollForward('2026-10-24', 'month', today)).toBe('2026-11-24');
    expect(rollForward('2026-11-25', 'month', today)).toBe('2026-11-25');
    expect(rollForward('2025-12-01', 'year', today)).toBe('2026-12-01');
    expect(rollForward('2026-11-14', 'week', today)).toBe('2026-11-21');
  });

  it('считает сумму в месяц и не показывает чужие подписки', async () => {
    const a = await registerUser(app);
    const b = await registerUser(app);
    await a.client.post('/subscriptions', { name: 'Wink', price: 349, period: 'month', nextPayment: '2030-01-24', manageUrl: 'https://wink.ru' });
    const y = await a.client.post('/subscriptions', { name: 'Яндекс Плюс', price: 2400, period: 'year', nextPayment: '2030-02-01' });
    const list = (await a.client.get('/subscriptions')).body;
    expect(list.items).toHaveLength(2);
    expect(list.monthlyRub).toBe(549);
    expect((await b.client.get('/subscriptions')).body.items).toHaveLength(0);
    expect((await b.client.del(`/subscriptions/${y.body.id}`)).status).toBe(404);
    expect((await a.client.post('/subscriptions', { name: 'x', price: 1, period: 'month', nextPayment: '2030-01-01', manageUrl: 'javascript:alert(1)' })).status).toBe(400);
  });
});
