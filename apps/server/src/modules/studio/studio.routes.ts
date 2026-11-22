/**
 * Студия: предпросмотр проекта, публикация по уникальной ссылке, проверка
 * (по согласию автора), запуск в песочнице и отдельные отзываемые разрешения.
 */
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { randomToken } from '../../lib/crypto.js';
import { newId } from '../../lib/ids.js';
import { badRequest, notFound, parse } from '../../lib/errors.js';
import { requireAuth } from '../../http/request.js';
import { buildHtml, projectSchema, RUNTIME_CSP } from './runtime.js';

export const PERMISSIONS = ['notifications', 'files', 'camera', 'microphone', 'screen'] as const;
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
}
