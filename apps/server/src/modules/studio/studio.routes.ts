/**
 * Студия: предпросмотр проекта, публикация по уникальной ссылке, проверка
 * (по согласию автора), запуск в песочнице и отдельные отзываемые разрешения.
 */
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { randomToken } from '../../lib/crypto.js';
import { newId } from '../../lib/ids.js';
import { badRequest, forbidden, notFound, parse } from '../../lib/errors.js';
import { requireAuth } from '../../http/request.js';
import { buildHtml, projectSchema, RUNTIME_CSP } from './runtime.js';
import { assertPublicUrl, safeGet } from '../browser/browser.routes.js';
import { createProviderPayment, fetchProviderStatus, type Method } from './payments.js';

export const PERMISSIONS = ['notifications', 'files', 'camera', 'microphone', 'screen', 'profile', 'internet', 'payments'] as const;
export type Permission = (typeof PERMISSIONS)[number];

interface AppRow {
  id: string;
  owner_id: string;
  project_id: string | null;
  slug: string;
  name: string;
  version: number;
  data: string;
  permissions: string;
  review: 'none' | 'pending' | 'verified' | 'rejected';
  updated_at: number;
}

const slugify = (name: string) =>
  name
    .toLowerCase()
    .replace(/[а-яё]/g, (c) => 'abvgdeejzijklmnoprstufhccss_y_eua'['абвгдеёжзийклмнопрстуфхцчшщъыьэюя'.indexOf(c)] ?? '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'app';

export async function studioRoutes(app: FastifyInstance): Promise<void> {
  const { db } = app.ctx;
  const limit = { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } };

  const sendHtml = (reply: FastifyReply, html: string) =>
    reply
      .header('Content-Security-Policy', RUNTIME_CSP)
      .header('X-Frame-Options', 'SAMEORIGIN')
      .header('Cross-Origin-Resource-Policy', 'same-origin')
      .header('Cache-Control', 'no-store')
      .type('text/html; charset=utf-8')
      .send(html);

  const appMeta = (r: AppRow) => {
    const owner = db.get<{ username: string; display_name: string; verified: number }>('SELECT username, display_name, verified FROM users WHERE id = :id', { id: r.owner_id });
    return {
      slug: r.slug,
      name: r.name,
      version: r.version,
      review: r.review,
      permissions: JSON.parse(r.permissions) as Permission[],
      owner: owner ? { username: owner.username, displayName: owner.display_name, verified: !!owner.verified } : null,
      updatedAt: new Date(r.updated_at).toISOString(),
    };
  };
  const bySlug = (slug: string) => {
    const r = db.get<AppRow>('SELECT * FROM studio_apps WHERE slug = :s', { s: slug });
    if (!r) throw notFound('Приложение не найдено');
    return r;
  };
  const projectData = (userId: string, projectId: string) => {
    const r = db.get<{ data: string | null; name: string }>("SELECT data, name FROM desk_items WHERE id = :id AND user_id = :u AND kind = 'project'", { id: projectId, u: userId });
    if (!r) throw notFound('Проект не найден');
    const parsed = projectSchema.safeParse(r.data ? JSON.parse(r.data) : null);
    if (!parsed.success) throw badRequest('В проекте ошибка — откройте его в Студии и сохраните заново');
    return { project: parsed.data, name: r.name };
  };

  /** Предпросмотр своего проекта (последнее сохранение). */
  app.get<{ Params: { id: string } }>('/studio/preview/:id', async (req, reply) => {
    const { userId } = requireAuth(req);
    return sendHtml(reply, buildHtml(projectData(userId, req.params.id).project));
  });

  app.post('/studio/publish', limit, async (req) => {
    const { userId } = requireAuth(req);
    const b = parse(
      z.object({ projectId: z.string().max(40), review: z.boolean().default(false), permissions: z.array(z.enum(PERMISSIONS)).max(PERMISSIONS.length).default([]) }),
      req.body,
    );
    const { project, name } = projectData(userId, b.projectId);
    const now = Date.now();
    const existing = db.get<AppRow>('SELECT * FROM studio_apps WHERE project_id = :p AND owner_id = :u', { p: b.projectId, u: userId });
    const perms = JSON.stringify([...new Set(b.permissions)]);
    if (existing) {
      // Новая версия снова требует проверки, если автор её просит; старая галочка «проверено» снимается
      db.run('UPDATE studio_apps SET name = :n, data = :d, permissions = :p, version = version + 1, review = :r, updated_at = :now WHERE id = :id', {
        n: name,
        d: JSON.stringify(project),
        p: perms,
        r: b.review ? 'pending' : 'none',
        now,
        id: existing.id,
      });
      return appMeta(bySlug(existing.slug));
    }
    const slug = `${slugify(name)}-${randomToken(3).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 5) || 'x'}`;
    db.run(
      `INSERT INTO studio_apps (id, owner_id, project_id, slug, name, data, permissions, review, created_at, updated_at)
       VALUES (:id, :u, :p, :slug, :n, :d, :perms, :r, :now, :now)`,
      { id: newId(now), u: userId, p: b.projectId, slug, n: name, d: JSON.stringify(project), perms, r: b.review ? 'pending' : 'none', now },
    );
    return appMeta(bySlug(slug));
  });

  app.get('/studio/mine', async (req) => {
    const { userId } = requireAuth(req);
    return { items: db.all<AppRow>('SELECT * FROM studio_apps WHERE owner_id = :u ORDER BY updated_at DESC', { u: userId }).map(appMeta) };
  });

  /** Каталог проверенных приложений Студии. */
  app.get('/studio/verified', async (req) => {
    requireAuth(req);
    return { items: db.all<AppRow>("SELECT * FROM studio_apps WHERE review = 'verified' ORDER BY updated_at DESC LIMIT 200").map(appMeta) };
  });

  app.get<{ Params: { slug: string } }>('/studio/apps/:slug', async (req) => {
    const { userId } = requireAuth(req);
    const r = bySlug(req.params.slug);
    const grants = db
      .all<{ permission: string }>('SELECT permission FROM app_grants WHERE user_id = :u AND app_id = :a AND revoked_at IS NULL', { u: userId, a: r.id })
      .map((g) => g.permission);
    return { app: appMeta(r), granted: grants };
  });

  app.get<{ Params: { slug: string } }>('/studio/run/:slug', async (req, reply) => {
    requireAuth(req);
    const r = bySlug(req.params.slug);
    return sendHtml(reply, buildHtml(projectSchema.parse(JSON.parse(r.data))));
  });

  /** Выдать или отозвать одно разрешение. Только из списка, который приложение заявило. */
  app.post<{ Params: { slug: string } }>('/studio/apps/:slug/grants', limit, async (req) => {
    const { userId } = requireAuth(req);
    const r = bySlug(req.params.slug);
    const b = parse(z.object({ permission: z.enum(PERMISSIONS), grant: z.boolean() }), req.body);
    const declared = JSON.parse(r.permissions) as string[];
    if (b.grant && !declared.includes(b.permission)) throw badRequest('Приложение не заявляло это разрешение');
    const now = Date.now();
    db.run('UPDATE app_grants SET revoked_at = :now WHERE user_id = :u AND app_id = :a AND permission = :p AND revoked_at IS NULL', { now, u: userId, a: r.id, p: b.permission });
    if (b.grant) db.run('INSERT INTO app_grants (id, user_id, app_id, permission, granted_at) VALUES (:id, :u, :a, :p, :now)', { id: newId(now), u: userId, a: r.id, p: b.permission, now });
    return { ok: true };
  });

  /** Уведомление от приложения в общий центр — только если пользователь выдал «Уведомления». */
  app.post<{ Params: { slug: string } }>('/studio/apps/:slug/notify', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req) => {
    const { userId } = requireAuth(req);
    const r = bySlug(req.params.slug);
    const { text } = parse(z.object({ text: z.string().trim().min(1).max(300) }), req.body);
    const ok = db.get("SELECT 1 FROM app_grants WHERE user_id = :u AND app_id = :a AND permission = 'notifications' AND revoked_at IS NULL", { u: userId, a: r.id });
    if (!ok) throw badRequest('Приложению не разрешено присылать уведомления');
    app.ctx.services.notifications.notify({ userId, type: 'app_message', link: `/app/${r.slug}`, preview: `${r.name}: ${text}` });
    return { ok: true };
  });

  /** История разрешений всех приложений — для центра безопасности. */
  app.get('/studio/grants', async (req) => {
    const { userId } = requireAuth(req);
    const rows = db.all<{ permission: string; granted_at: number; revoked_at: number | null; slug: string; name: string }>(
      `SELECT g.permission, g.granted_at, g.revoked_at, a.slug, a.name FROM app_grants g JOIN studio_apps a ON a.id = g.app_id
       WHERE g.user_id = :u ORDER BY g.granted_at DESC LIMIT 200`,
      { u: userId },
    );
    return {
      items: rows.map((g) => ({ permission: g.permission, app: { slug: g.slug, name: g.name }, grantedAt: new Date(g.granted_at).toISOString(), revokedAt: g.revoked_at ? new Date(g.revoked_at).toISOString() : null })),
    };
  });

  // ─── Хранилище приложения: своё у каждого приложения и у каждого пользователя ───
  const granted = (userId: string, appId: string, permission: string) =>
    !!db.get('SELECT 1 FROM app_grants WHERE user_id = :u AND app_id = :a AND permission = :p AND revoked_at IS NULL', { u: userId, a: appId, p: permission });
  const keyParam = z.string().min(1).max(100);

  app.get<{ Params: { slug: string } }>('/studio/apps/:slug/kv', async (req) => {
    const { userId } = requireAuth(req);
    const r = bySlug(req.params.slug);
    return { keys: db.all<{ key: string }>('SELECT key FROM studio_kv WHERE app_id = :a AND user_id = :u ORDER BY key LIMIT 500', { a: r.id, u: userId }).map((k) => k.key) };
  });
  app.get<{ Params: { slug: string; key: string } }>('/studio/apps/:slug/kv/:key', async (req) => {
    const { userId } = requireAuth(req);
    const r = bySlug(req.params.slug);
    const row = db.get<{ value: string }>('SELECT value FROM studio_kv WHERE app_id = :a AND user_id = :u AND key = :k', { a: r.id, u: userId, k: parse(keyParam, req.params.key) });
    return { value: row ? (JSON.parse(row.value) as unknown) : null };
  });
  app.put<{ Params: { slug: string; key: string } }>('/studio/apps/:slug/kv/:key', { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } }, async (req) => {
    const { userId } = requireAuth(req);
    const r = bySlug(req.params.slug);
    const key = parse(keyParam, req.params.key);
    const { value } = parse(z.object({ value: z.string().max(10_000) }), req.body);
    try {
      JSON.parse(value);
    } catch {
      throw badRequest('Значение должно быть JSON');
    }
    const count = db.get<{ n: number }>('SELECT count(*) n FROM studio_kv WHERE app_id = :a AND user_id = :u', { a: r.id, u: userId })?.n ?? 0;
    const exists = db.get('SELECT 1 FROM studio_kv WHERE app_id = :a AND user_id = :u AND key = :k', { a: r.id, u: userId, k: key });
    if (!exists && count >= 200) throw badRequest('В хранилище приложения не больше 200 ключей');
    db.run(
      `INSERT INTO studio_kv (app_id, user_id, key, value, updated_at) VALUES (:a, :u, :k, :v, :now)
       ON CONFLICT (app_id, user_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      { a: r.id, u: userId, k: key, v: value, now: Date.now() },
    );
    return { ok: true };
  });
  app.delete<{ Params: { slug: string; key: string } }>('/studio/apps/:slug/kv/:key', async (req) => {
    const { userId } = requireAuth(req);
    const r = bySlug(req.params.slug);
    db.run('DELETE FROM studio_kv WHERE app_id = :a AND user_id = :u AND key = :k', { a: r.id, u: userId, k: parse(keyParam, req.params.key) });
    return { ok: true };
  });

  // ─── Интернет для приложений: только GET, только публичные https-адреса, до 1 МБ ───
  app.post('/studio/net', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (req) => {
    const { userId } = requireAuth(req);
    const b = parse(z.object({ url: z.string().max(2000), slug: z.string().max(80).optional(), projectId: z.string().max(40).optional() }), req.body);
    if (b.slug) {
      const r = bySlug(b.slug);
      if (!(JSON.parse(r.permissions) as string[]).includes('internet') || !granted(userId, r.id, 'internet')) throw forbidden('Приложению не разрешён доступ в интернет');
    } else if (!b.projectId || !db.get("SELECT 1 FROM desk_items WHERE id = :id AND user_id = :u AND kind = 'project'", { id: b.projectId, u: userId })) {
      throw forbidden('Нет доступа');
    }
    let url = await assertPublicUrl(b.url);
    for (let hop = 0; hop < 4; hop++) {
      const res = await safeGet(url).catch(() => {
        throw badRequest('Сайт не ответил');
      });
      const loc = res.headers.location;
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && loc) {
        res.resume();
        url = await assertPublicUrl(new URL(loc, url).toString());
        continue;
      }
      const type = String(res.headers['content-type'] ?? '');
      if (!/^(text\/|application\/(json|xml|rss|atom|javascript))/i.test(type)) {
        res.destroy();
        throw badRequest('Приложения получают только текст и JSON');
      }
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const c of res) {
        size += (c as Buffer).length;
        if (size > 1_048_576) {
          res.destroy();
          throw badRequest('Ответ больше 1 МБ');
        }
        chunks.push(c as Buffer);
      }
      return { status: res.statusCode ?? 0, contentType: type.slice(0, 100), text: Buffer.concat(chunks).toString('utf8') };
    }
    throw badRequest('Слишком много перенаправлений');
  });

  // ─── Платежи: СБП и карты ───
  const payRow = (id: string) =>
    db.get<{ id: string; payer_id: string; app_id: string; amount_kop: number; description: string; method: Method; provider: string; provider_id: string | null; status: string }>(
      'SELECT * FROM studio_payments WHERE id = :id',
      { id },
    );

  app.post('/studio/pay', { config: { rateLimit: { max: 20, timeWindow: '10 minutes' } } }, async (req) => {
    const { userId } = requireAuth(req);
    const b = parse(
      z.object({ slug: z.string().max(80), amount: z.number().min(1).max(100_000), description: z.string().trim().min(1).max(128), method: z.enum(['sbp', 'card']) }),
      req.body,
    );
    const r = bySlug(b.slug);
    if (!(JSON.parse(r.permissions) as string[]).includes('payments')) throw forbidden('Приложение не заявило приём платежей');
    const id = newId();
    const amountKop = Math.round(b.amount * 100);
    const now = Date.now();
    const config = app.ctx.config;
    if (!config.yookassa) {
      db.run(
        "INSERT INTO studio_payments (id, app_id, payer_id, amount_kop, description, method, provider, status, created_at) VALUES (:id, :a, :u, :k, :d, :m, 'test', 'pending', :now)",
        { id, a: r.id, u: userId, k: amountKop, d: b.description, m: b.method, now },
      );
      return { id, test: true, confirmationUrl: null };
    }
    const created = await createProviderPayment(config, { id, amountKop, description: `${r.name}: ${b.description}`, method: b.method, returnUrl: `${config.publicOrigin}/app/${r.slug}?paid=${id}` }).catch((e: Error) => {
      throw badRequest(e.message);
    });
    db.run(
      "INSERT INTO studio_payments (id, app_id, payer_id, amount_kop, description, method, provider, provider_id, status, created_at) VALUES (:id, :a, :u, :k, :d, :m, 'yookassa', :pid, :st, :now)",
      { id, a: r.id, u: userId, k: amountKop, d: b.description, m: b.method, pid: created.providerId, st: created.status, now },
    );
    return { id, test: false, confirmationUrl: created.confirmationUrl };
  });

  /** Статус платежа: для ЮKassa — всегда свежий, от самого платёжного сервиса. */
  app.get<{ Params: { id: string } }>('/studio/payments/:id', async (req) => {
    const { userId } = requireAuth(req);
    const p = payRow(req.params.id);
    if (!p || p.payer_id !== userId) throw notFound('Платёж не найден');
    if (p.provider === 'yookassa' && p.status === 'pending' && p.provider_id && app.ctx.config.yookassa) {
      const st = await fetchProviderStatus(app.ctx.config, p.provider_id).catch(() => 'pending' as const);
      if (st !== 'pending') db.run('UPDATE studio_payments SET status = :s, paid_at = :t WHERE id = :id', { s: st, t: st === 'succeeded' ? Date.now() : null, id: p.id });
      return { status: st };
    }
    return { status: p.status };
  });

  /** Тестовый режим (без ключей ЮKassa): подтвердить или отменить в окне Sunnet. Деньги не списываются. */
  app.post<{ Params: { id: string } }>('/studio/payments/:id/test', async (req) => {
    const { userId } = requireAuth(req);
    const { ok } = parse(z.object({ ok: z.boolean() }), req.body);
    const p = payRow(req.params.id);
    if (!p || p.payer_id !== userId || p.provider !== 'test' || p.status !== 'pending') throw notFound('Платёж не найден');
    db.run('UPDATE studio_payments SET status = :s, paid_at = :t WHERE id = :id', { s: ok ? 'succeeded' : 'canceled', t: ok ? Date.now() : null, id: p.id });
    return { status: ok ? 'succeeded' : 'canceled' };
  });

  /** Уведомление ЮKassa: телу не верим — перепроверяем статус запросом к API. */
  app.post('/studio/payments/yookassa', { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } }, async (req) => {
    const pid = (req.body as { object?: { id?: unknown } } | null)?.object?.id;
    if (typeof pid !== 'string' || pid.length > 80 || !app.ctx.config.yookassa) return { ok: true };
    const p = db.get<{ id: string; status: string }>('SELECT id, status FROM studio_payments WHERE provider_id = :p', { p: pid });
    if (!p || p.status !== 'pending') return { ok: true };
    const st = await fetchProviderStatus(app.ctx.config, pid).catch(() => 'pending' as const);
    if (st !== 'pending') db.run('UPDATE studio_payments SET status = :s, paid_at = :t WHERE id = :id', { s: st, t: st === 'succeeded' ? Date.now() : null, id: p.id });
    return { ok: true };
  });

  /** Мои платежи в приложениях — для истории в настройках. */
  app.get('/studio/payments', async (req) => {
    const { userId } = requireAuth(req);
    const rows = db.all<{ id: string; amount_kop: number; description: string; method: string; status: string; created_at: number; name: string; slug: string }>(
      'SELECT p.id, p.amount_kop, p.description, p.method, p.status, p.created_at, a.name, a.slug FROM studio_payments p JOIN studio_apps a ON a.id = p.app_id WHERE p.payer_id = :u ORDER BY p.created_at DESC LIMIT 100',
      { u: userId },
    );
    return { items: rows.map((r) => ({ id: r.id, amount: r.amount_kop / 100, description: r.description, method: r.method, status: r.status, createdAt: new Date(r.created_at).toISOString(), app: { name: r.name, slug: r.slug } })) };
  });
}
