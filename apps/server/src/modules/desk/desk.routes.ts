/**
 * Рабочий стол = облако пользователя. Только свои записи: каждый запрос проверяет
 * владельца. Удаление — в корзину; окончательно стирается только из корзины и
 * только по одному элементу, чтобы ни один сбой или скрипт не снёс всё разом.
 * Файлы загружаются обычным /media (проверка сигнатуры: картинки, видео, аудио,
 * PDF, ZIP — исполняемые файлы не принимаются) и прикрепляются к значку здесь.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { newId } from '../../lib/ids.js';
import { badRequest, notFound, parse } from '../../lib/errors.js';
import { requireAuth } from '../../http/request.js';

interface Row {
  id: string;
  parent_id: string | null;
  kind: 'folder' | 'file' | 'project' | 'link';
  name: string;
  media_id: string | null;
  url: string | null;
  x: number | null;
  y: number | null;
  trashed_at: number | null;
  updated_at: number;
}

const name = z.string().trim().min(1).max(120);
/** Ярлык: сайт по https или раздел самого Sunnet («/servers»), но не «//чужой-хост». */
const httpsUrl = z
  .string()
  .max(500)
  .refine((u) => (u.startsWith('https://') && z.string().url().safeParse(u).success) || /^\/(?!\/)[\w\-/?=&.%]*$/.test(u), 'Только https-ссылки или разделы Sunnet');
const MAX_PROJECT_BYTES = 512 * 1024;
const prefsSchema = z.object({
  dock: z.array(z.string().max(40)).max(40).optional(),
  iconSize: z.enum(['s', 'm', 'l']).optional(),
  sort: z.enum(['manual', 'name', 'kind', 'date']).optional(),
});
const MAX_ITEMS = 5000;

export async function deskRoutes(app: FastifyInstance): Promise<void> {
  const { db, services } = app.ctx;
  const limit = { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } };

  const toDto = (r: Row) => {
    const media = r.media_id ? services.media.items([r.media_id]).get(r.media_id) ?? null : null;
    return { id: r.id, parentId: r.parent_id, kind: r.kind, name: r.name, url: r.url, media, x: r.x, y: r.y, trashed: !!r.trashed_at, updatedAt: new Date(r.updated_at).toISOString() };
  };
  const own = (userId: string, id: string) => {
    const r = db.get<Row>('SELECT * FROM desk_items WHERE id = :id AND user_id = :u', { id, u: userId });
    if (!r) throw notFound();
    return r;
  };

  app.get('/desk/items', async (req) => {
    const { userId } = requireAuth(req);
    const q = parse(z.object({ trash: z.enum(['0', '1']).default('0') }), req.query);
    const rows = db.all<Row>(`SELECT * FROM desk_items WHERE user_id = :u AND trashed_at IS ${q.trash === '1' ? 'NOT NULL' : 'NULL'} ORDER BY created_at`, { u: userId });
    return { items: rows.map(toDto) };
  });

  app.post('/desk/items', limit, async (req, reply) => {
    const { userId } = requireAuth(req);
    const b = parse(
      z.object({
        kind: z.enum(['folder', 'file', 'project', 'link']),
        name,
        parentId: z.string().max(40).nullish(),
        mediaId: z.string().max(40).nullish(),
        url: httpsUrl.nullish(),
        x: z.number().int().min(0).max(200).nullish(),
        y: z.number().int().min(0).max(200).nullish(),
      }),
      req.body,
    );
    const count = db.get<{ n: number }>('SELECT COUNT(*) AS n FROM desk_items WHERE user_id = :u', { u: userId })!.n;
    if (count >= MAX_ITEMS) throw badRequest('На столе слишком много элементов');
    if (b.parentId && own(userId, b.parentId).kind !== 'folder') throw notFound();
    // Файл можно прикрепить только свой
    if (b.mediaId && !db.get('SELECT 1 FROM media WHERE id = :id AND owner_id = :u', { id: b.mediaId, u: userId })) throw notFound();
    if (b.kind === 'file' && !b.mediaId) throw notFound();
    if (b.kind === 'link' && !b.url) throw notFound();
    const now = Date.now();
    const id = newId(now);
    db.run(
      `INSERT INTO desk_items (id, user_id, parent_id, kind, name, media_id, url, x, y, created_at, updated_at)
       VALUES (:id, :u, :p, :k, :n, :m, :url, :x, :y, :now, :now)`,
      { id, u: userId, p: b.parentId ?? null, k: b.kind, n: b.name, m: b.mediaId ?? null, url: b.kind === 'link' ? b.url : null, x: b.x ?? null, y: b.y ?? null, now },
    );
    return reply.status(201).send(toDto(own(userId, id)));
  });

  app.patch<{ Params: { id: string } }>('/desk/items/:id', limit, async (req) => {
    const { userId } = requireAuth(req);
    const item = own(userId, req.params.id);
    const b = parse(
      z.object({ name: name.optional(), x: z.number().int().min(0).max(200).optional(), y: z.number().int().min(0).max(200).optional(), parentId: z.string().max(40).nullable().optional() }),
      req.body,
    );
    if (b.parentId) {
      if (b.parentId === item.id || own(userId, b.parentId).kind !== 'folder') throw notFound();
      // Нельзя положить папку внутрь самой себя
      let cur: string | null = b.parentId;
      for (let i = 0; cur && i < 50; i++) {
        if (cur === item.id) throw notFound();
        cur = db.get<{ parent_id: string | null }>('SELECT parent_id FROM desk_items WHERE id = :id', { id: cur })?.parent_id ?? null;
      }
    }
    db.run(
      `UPDATE desk_items SET name = COALESCE(:n, name), x = COALESCE(:x, x), y = COALESCE(:y, y),
       parent_id = CASE WHEN :setParent = 1 THEN :p ELSE parent_id END, updated_at = :now WHERE id = :id`,
      { n: b.name ?? null, x: b.x ?? null, y: b.y ?? null, setParent: b.parentId !== undefined ? 1 : 0, p: b.parentId ?? null, now: Date.now(), id: item.id },
    );
    return toDto(own(userId, item.id));
  });

  /** В корзину (по умолчанию) или навсегда — только из корзины. */
  app.delete<{ Params: { id: string } }>('/desk/items/:id', limit, async (req) => {
    const { userId } = requireAuth(req);
    const item = own(userId, req.params.id);
    const forever = (req.query as { forever?: string }).forever === '1';
    if (forever) {
      if (!item.trashed_at) throw notFound();
      db.run('DELETE FROM desk_items WHERE id = :id', { id: item.id });
    } else db.run('UPDATE desk_items SET trashed_at = :now, updated_at = :now WHERE id = :id', { now: Date.now(), id: item.id });
    return { ok: true };
  });

  /** Настройки стола (док, значки) — общие для всех устройств. */
  app.get('/desk/prefs', async (req) => {
    const { userId } = requireAuth(req);
    const raw = db.get<{ desk_prefs: string | null }>('SELECT desk_prefs FROM users WHERE id = :id', { id: userId })?.desk_prefs;
    try {
      return { prefs: raw ? prefsSchema.parse(JSON.parse(raw)) : {} };
    } catch {
      return { prefs: {} };
    }
  });
  app.put('/desk/prefs', limit, async (req) => {
    const { userId } = requireAuth(req);
    const prefs = parse(prefsSchema, req.body);
    db.run('UPDATE users SET desk_prefs = :p WHERE id = :id', { p: JSON.stringify(prefs), id: userId });
    return { prefs };
  });

  /** Содержимое проекта Студии (экраны, элементы, скрипты). */
  app.get<{ Params: { id: string } }>('/desk/items/:id/data', async (req) => {
    const { userId } = requireAuth(req);
    const item = own(userId, req.params.id);
    if (item.kind !== 'project') throw notFound();
    const raw = db.get<{ data: string | null }>('SELECT data FROM desk_items WHERE id = :id', { id: item.id })?.data;
    return { data: raw ? (JSON.parse(raw) as unknown) : null, updatedAt: new Date(item.updated_at).toISOString() };
  });
  app.put<{ Params: { id: string } }>('/desk/items/:id/data', { config: { rateLimit: { max: 240, timeWindow: '1 minute' } } }, async (req) => {
    const { userId } = requireAuth(req);
    const item = own(userId, req.params.id);
    if (item.kind !== 'project') throw notFound();
    const { data } = parse(z.object({ data: z.record(z.string(), z.unknown()) }), req.body);
    const json = JSON.stringify(data);
    if (json.length > MAX_PROJECT_BYTES) throw badRequest('Проект больше 512 КБ — вынесите картинки в ресурсы');
    const now = Date.now();
    db.run('UPDATE desk_items SET data = :d, updated_at = :now WHERE id = :id', { d: json, now, id: item.id });
    return { ok: true, updatedAt: new Date(now).toISOString() };
  });

  app.post<{ Params: { id: string } }>('/desk/items/:id/restore', limit, async (req) => {
    const { userId } = requireAuth(req);
    const item = own(userId, req.params.id);
    db.run('UPDATE desk_items SET trashed_at = NULL, updated_at = :now WHERE id = :id', { now: Date.now(), id: item.id });
    return toDto(own(userId, item.id));
  });
}
