/**
 * Подписки пользователя на сторонние сервисы. Sunnet не списывает и не хранит
 * платёжные данные — только то, что человек сам указал: цену, период, дату платежа
 * и ссылку на страницу управления подпиской у сервиса.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { newId } from '../../lib/ids.js';
import { notFound, parse } from '../../lib/errors.js';
import { requireAuth } from '../../http/request.js';

interface Row {
  id: string;
  name: string;
  price_cents: number;
  currency: string;
  period: 'week' | 'month' | 'year';
  next_payment: string;
  manage_url: string | null;
}

const body = z.object({
  name: z.string().trim().min(1).max(80),
  price: z.number().min(0).max(1_000_000),
  currency: z.enum(['RUB', 'USD', 'EUR']).default('RUB'),
  period: z.enum(['week', 'month', 'year']),
  nextPayment: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Дата в формате ГГГГ-ММ-ДД'),
  manageUrl: z.string().max(500).url().refine((u) => u.startsWith('https://'), 'Только https').nullish(),
});

/** Если дата платежа прошла — переносим её на следующий период (подписка продлилась). */
export function rollForward(date: string, period: Row['period'], today = new Date()): string {
  const d = new Date(`${date}T00:00:00Z`);
  const t = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  for (let i = 0; d.getTime() < t && i < 600; i++) {
    if (period === 'week') d.setUTCDate(d.getUTCDate() + 7);
    else if (period === 'month') d.setUTCMonth(d.getUTCMonth() + 1);
    else d.setUTCFullYear(d.getUTCFullYear() + 1);
  }
  return d.toISOString().slice(0, 10);
}

export async function subscriptionsRoutes(app: FastifyInstance): Promise<void> {
  const { db } = app.ctx;
  const dto = (r: Row) => ({ id: r.id, name: r.name, price: r.price_cents / 100, currency: r.currency, period: r.period, nextPayment: rollForward(r.next_payment, r.period), manageUrl: r.manage_url });

  app.get('/subscriptions', async (req) => {
    const { userId } = requireAuth(req);
    const items = db.all<Row>('SELECT * FROM subscriptions WHERE user_id = :u', { u: userId }).map(dto);
    items.sort((a, b) => a.nextPayment.localeCompare(b.nextPayment));
    const perMonth = (s: (typeof items)[number]) => (s.period === 'month' ? s.price : s.period === 'year' ? s.price / 12 : (s.price * 52) / 12);
    const monthlyRub = Math.round(items.filter((s) => s.currency === 'RUB').reduce((a, s) => a + perMonth(s), 0));
    return { items, monthlyRub };
  });
  app.post('/subscriptions', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req, reply) => {
    const { userId } = requireAuth(req);
    const b = parse(body, req.body);
    const id = newId();
    db.run(
      'INSERT INTO subscriptions (id, user_id, name, price_cents, currency, period, next_payment, manage_url, created_at) VALUES (:id, :u, :n, :p, :c, :per, :next, :url, :now)',
      { id, u: userId, n: b.name, p: Math.round(b.price * 100), c: b.currency, per: b.period, next: b.nextPayment, url: b.manageUrl ?? null, now: Date.now() },
    );
    return reply.status(201).send(dto(db.get<Row>('SELECT * FROM subscriptions WHERE id = :id', { id })!));
  });
  app.put<{ Params: { id: string } }>('/subscriptions/:id', async (req) => {
    const { userId } = requireAuth(req);
    const b = parse(body, req.body);
    const n = db.run('UPDATE subscriptions SET name = :n, price_cents = :p, currency = :c, period = :per, next_payment = :next, manage_url = :url WHERE id = :id AND user_id = :u', {
      n: b.name,
      p: Math.round(b.price * 100),
      c: b.currency,
      per: b.period,
      next: b.nextPayment,
      url: b.manageUrl ?? null,
      id: req.params.id,
      u: userId,
    }).changes;
    if (!n) throw notFound();
    return dto(db.get<Row>('SELECT * FROM subscriptions WHERE id = :id', { id: req.params.id })!);
  });
  app.delete<{ Params: { id: string } }>('/subscriptions/:id', async (req) => {
    const { userId } = requireAuth(req);
    if (!db.run('DELETE FROM subscriptions WHERE id = :id AND user_id = :u', { id: req.params.id, u: userId }).changes) throw notFound();
    return { ok: true };
  });
}
