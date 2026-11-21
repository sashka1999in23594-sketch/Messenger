/**
 * Серверы пользователей. Sunnet ничего не оплачивает за пользователя: он сам
 * выбирает, где размещать (свой компьютер через Sunnet Connect, Render, VPS).
 * Перед запуском — проверка компонентов: связь, почта, база данных, хранилище.
 * Если чего-то не хватает — понятная инструкция, а не ошибка.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { randomToken, SecretBox, sha256 } from '../../lib/crypto.js';
import { newId } from '../../lib/ids.js';
import { notFound, parse } from '../../lib/errors.js';
import { requireAuth } from '../../http/request.js';

interface Row {
  id: string;
  owner_id: string;
  space_id: string;
  name: string;
  hosting: 'connect' | 'render' | 'vps';
  access: 'open' | 'closed' | 'invite' | 'link' | 'request';
  endpoint: string | null;
  needs: string;
  mail_enc: string | null;
  heartbeat_at: number | null;
  heartbeat: string | null;
  created_at: number;
}
interface Heartbeat {
  host?: string;
  os?: string;
  cpuLoad?: number;
  memFreeMb?: number;
  memTotalMb?: number;
  diskFreeGb?: number;
  latencyMs?: number;
  version?: string;
  problems?: string[];
}

/** Сколько секунд без сигнала считаем компьютер отключённым. */
const ONLINE_MS = 90_000;

const HOSTING_HELP: Record<Row['hosting'], string> = {
  connect: 'Установите Sunnet Connect на компьютер, запустите и введите код подключения. Компьютер должен быть включён и не уходить в сон.',
  render: 'Создайте Web Service на render.com из шаблона Sunnet, в Environment добавьте SUNNET_CONNECT_CODE и укажите адрес сервиса здесь.',
  vps: 'На своём VPS установите Node.js 22 и запустите Sunnet Connect как службу (systemd). Откройте исходящий доступ к sunnet и укажите адрес.',
};

export async function serversRoutes(app: FastifyInstance): Promise<void> {
  const { db, config, services } = app.ctx;
  const box = new SecretBox(config.secret, 'server-mail');

  const dto = (r: Row) => {
    const hb = r.heartbeat ? (JSON.parse(r.heartbeat) as Heartbeat) : null;
    const online = !!r.heartbeat_at && Date.now() - r.heartbeat_at < ONLINE_MS;
    const needs = JSON.parse(r.needs) as { mail?: boolean; database?: boolean; storage?: boolean };
    // Проверка перед запуском: каждый пункт — статус и что сделать
    const checks = [
      {
        id: 'host',
        label: r.hosting === 'connect' ? 'Компьютер подключён через Sunnet Connect' : r.hosting === 'render' ? 'Сервис на Render отвечает' : 'VPS на связи',
        ok: online,
        help: online ? `На связи: ${hb?.host ?? 'устройство'} · задержка ${hb?.latencyMs ?? '—'} мс` : HOSTING_HELP[r.hosting],
      },
      ...(needs.database
        ? [{ id: 'db', label: 'База данных', ok: online, help: online ? 'Встроенная база SQLite на устройстве сервера' : 'База запустится вместе с Sunnet Connect — сначала подключите устройство' }]
        : []),
      ...(needs.mail
        ? [{ id: 'mail', label: 'Почта для приглашений', ok: !!r.mail_enc, help: r.mail_enc ? 'SMTP настроен' : 'Нужен почтовый сервис (Яндекс 360, Mail.ru, Gmail): адрес SMTP, порт, логин и пароль приложения' }]
        : []),
      ...(needs.storage
        ? [{ id: 'storage', label: 'Место для файлов', ok: online && (hb?.diskFreeGb ?? 0) >= 2, help: online ? `Свободно ${hb?.diskFreeGb ?? 0} ГБ (нужно от 2 ГБ)` : 'Проверим, когда устройство подключится' }]
        : []),
      ...(hb?.problems?.length ? [{ id: 'diag', label: 'Диагностика Sunnet Connect', ok: false, help: hb.problems.join(' · ') }] : []),
    ];
    return {
      id: r.id,
      spaceId: r.space_id,
      name: r.name,
      hosting: r.hosting,
      access: r.access,
      endpoint: r.endpoint,
      needs,
      online,
      lastSeen: r.heartbeat_at ? new Date(r.heartbeat_at).toISOString() : null,
      device: hb,
      checks,
      ready: checks.every((c) => c.ok),
    };
  };
  const own = (userId: string, id: string) => {
    const r = db.get<Row>('SELECT * FROM hosted_servers WHERE id = :id AND owner_id = :u', { id, u: userId });
    if (!r) throw notFound('Сервер не найден');
    return r;
  };

  app.post('/servers', { config: { rateLimit: { max: 10, timeWindow: '10 minutes' } } }, async (req, reply) => {
    const { userId } = requireAuth(req);
    const b = parse(
      z.object({
        name: z.string().trim().min(2).max(60),
        description: z.string().trim().max(300).default(''),
        hosting: z.enum(['connect', 'render', 'vps']),
        access: z.enum(['open', 'closed', 'invite', 'link', 'request']),
        endpoint: z.string().max(300).url().refine((u) => u.startsWith('https://'), 'Только https').nullish(),
        needs: z.object({ mail: z.boolean().default(false), database: z.boolean().default(true), storage: z.boolean().default(false) }).default({ mail: false, database: true, storage: false }),
      }),
      req.body,
    );
    // Пространство общения — сообщество с каналами и ролями; открытость — по типу доступа
    const space = services.spaces.create(userId, { kind: 'community', name: b.name, description: b.description, isPublic: b.access === 'open' || b.access === 'link' });
    const code = `${randomToken(4)}-${randomToken(4)}-${randomToken(4)}`.toUpperCase().replace(/[^A-Z0-9-]/g, 'X');
    const id = newId();
    db.run(
      `INSERT INTO hosted_servers (id, owner_id, space_id, name, hosting, access, endpoint, needs, connect_hash, created_at)
       VALUES (:id, :u, :s, :n, :h, :a, :e, :needs, :hash, :now)`,
      { id, u: userId, s: space.id, n: b.name, h: b.hosting, a: b.access, e: b.endpoint ?? null, needs: JSON.stringify(b.needs), hash: sha256(code), now: Date.now() },
    );
    // Код показываем один раз; в базе — только его хэш
    return reply.status(201).send({ ...dto(own(userId, id)), connectCode: code });
  });

  app.get('/servers/mine', async (req) => {
    const { userId } = requireAuth(req);
    return { items: db.all<Row>('SELECT * FROM hosted_servers WHERE owner_id = :u ORDER BY created_at DESC', { u: userId }).map(dto) };
  });

  app.get<{ Params: { id: string } }>('/servers/:id', async (req) => dto(own(requireAuth(req).userId, req.params.id)));

  /** Новый код подключения (старый перестаёт работать). */
  app.post<{ Params: { id: string } }>('/servers/:id/code', { config: { rateLimit: { max: 10, timeWindow: '10 minutes' } } }, async (req) => {
    const r = own(requireAuth(req).userId, req.params.id);
    const code = `${randomToken(4)}-${randomToken(4)}-${randomToken(4)}`.toUpperCase().replace(/[^A-Z0-9-]/g, 'X');
    db.run('UPDATE hosted_servers SET connect_hash = :h, heartbeat_at = NULL WHERE id = :id', { h: sha256(code), id: r.id });
    return { connectCode: code };
  });

  app.put<{ Params: { id: string } }>('/servers/:id/mail', { config: { rateLimit: { max: 10, timeWindow: '10 minutes' } } }, async (req) => {
    const r = own(requireAuth(req).userId, req.params.id);
    const b = parse(z.object({ host: z.string().min(3).max(200), port: z.number().int().min(1).max(65535), user: z.string().min(1).max(200), password: z.string().min(1).max(200) }), req.body);
    db.run('UPDATE hosted_servers SET mail_enc = :m WHERE id = :id', { m: box.seal(JSON.stringify(b)), id: r.id });
    return dto(own(r.owner_id, r.id));
  });

  app.delete<{ Params: { id: string } }>('/servers/:id', async (req) => {
    const r = own(requireAuth(req).userId, req.params.id);
    db.run('DELETE FROM hosted_servers WHERE id = :id', { id: r.id });
    return { ok: true };
  });

  /**
   * Сигнал от Sunnet Connect: код подключения вместо входа (это не браузер, CSRF не нужен).
   * Принимаются только цифры и короткие строки — никаких команд от устройства.
   */
  app.post('/connect/heartbeat', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req) => {
    const b = parse(
      z.object({
        code: z.string().min(10).max(40),
        host: z.string().max(80).optional(),
        os: z.string().max(80).optional(),
        cpuLoad: z.number().min(0).max(1000).optional(),
        memFreeMb: z.number().min(0).optional(),
        memTotalMb: z.number().min(0).optional(),
        diskFreeGb: z.number().min(0).optional(),
        latencyMs: z.number().min(0).max(60_000).optional(),
        version: z.string().max(20).optional(),
        problems: z.array(z.string().max(200)).max(10).optional(),
      }),
      req.body,
    );
    const r = db.get<Row>('SELECT * FROM hosted_servers WHERE connect_hash = :h', { h: sha256(b.code.trim().toUpperCase()) });
    if (!r) throw notFound('Код подключения не найден. Скопируйте его заново в Sunnet → Серверы');
    const { code: _code, ...hb } = b;
    db.run('UPDATE hosted_servers SET heartbeat_at = :now, heartbeat = :hb WHERE id = :id', { now: Date.now(), hb: JSON.stringify(hb), id: r.id });
    // Проверки считаем по свежей записи — с только что полученным сигналом
    const fresh = db.get<Row>('SELECT * FROM hosted_servers WHERE id = :id', { id: r.id })!;
    return { ok: true, server: r.name, checks: dto(fresh).checks.map((c) => ({ label: c.label, ok: c.ok })) };
  });
}
