/**
 * Браузер Sunnet: поиск и загрузки в облако.
 * — Поиск: результаты Википедии (открытый API) и самого Sunnet (люди, сообщества, посты).
 * — «Скачать в облако»: сервер сам забирает файл по https-ссылке. Защита от SSRF:
 *   только https и стандартный порт, все адреса хоста проверяются (никаких локальных
 *   и внутренних сетей), не больше 3 перенаправлений с повторной проверкой, лимит
 *   размера; тип файла определяет сервис медиа по содержимому (программы не принимаются).
 */
import { lookup } from 'node:dns/promises';
import { lookup as lookupCb, type LookupAddress } from 'node:dns';
import { request as httpsRequest } from 'node:https';
import type { IncomingMessage } from 'node:http';
import { isIP } from 'node:net';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { badRequest, parse } from '../../lib/errors.js';
import { requireAuth } from '../../http/request.js';

const MAX_BYTES = 50 * 1024 * 1024;

/** Внутренние и служебные адреса, куда сервер ходить не должен. */
export function isPrivateAddress(ip: string): boolean {
  const v = ip.replace(/^::ffff:/i, '');
  if (isIP(v) === 4) {
    const [a, b] = v.split('.').map(Number) as [number, number];
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const s = v.toLowerCase();
  return s === '::1' || s === '::' || s.startsWith('fc') || s.startsWith('fd') || s.startsWith('fe80') || s.startsWith('ff');
}

export async function assertPublicUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw badRequest('Неверная ссылка');
  }
  if (url.protocol !== 'https:') throw badRequest('Скачивать можно только по https');
  if (url.port && url.port !== '443') throw badRequest('Нестандартный порт не поддерживается');
  if (url.username || url.password) throw badRequest('Ссылки с логином и паролем не поддерживаются');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addrs = isIP(host) ? [{ address: host }] : await lookup(host, { all: true }).catch(() => []);
  if (!addrs.length) throw badRequest('Сайт не найден');
  if (addrs.some((a) => isPrivateAddress(a.address))) throw badRequest('Эта ссылка ведёт во внутреннюю сеть — скачивание запрещено');
  return url;
}

/**
 * GET по https, где IP проверяется в момент соединения (через lookup сокета), — так
 * сайт не сможет подменить адрес между проверкой и скачиванием (DNS rebinding).
 */
export function safeGet(url: URL): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => {
    const req = httpsRequest(
      url,
      {
        method: 'GET',
        headers: { 'User-Agent': 'SunnetBrowser/1.0' },
        timeout: 30_000,
        lookup: (host, opts, cb) =>
          lookupCb(host, { ...opts, all: true }, (err, addrs) => {
            if (err) return cb(err, '', 4);
            const list = addrs as unknown as LookupAddress[];
            const bad = list.find((a) => isPrivateAddress(a.address));
            if (bad || !list.length) return cb(new Error('PRIVATE_ADDRESS'), '', 4);
            const first = list[0]!;
            // Node просит либо один адрес, либо список — отдаём в том виде, в каком спросили
            if ((opts as { all?: boolean }).all) (cb as unknown as (e: null, a: LookupAddress[]) => void)(null, list);
            else cb(null, first.address, first.family);
          }),
      },
      resolve,
    );
    req.on('timeout', () => req.destroy(new Error('TIMEOUT')));
    req.on('error', reject);
    req.end();
  });
}

export async function browserRoutes(app: FastifyInstance): Promise<void> {
  const { services } = app.ctx;

  app.get('/browser/search', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (req) => {
    const { userId } = requireAuth(req);
    const { q } = parse(z.object({ q: z.string().trim().min(1).max(200) }), req.query);
    const sunnet = services.search.search(userId, q, 'all', 5);
    let web: { title: string; url: string; snippet: string; source: string }[] = [];
    try {
      const api = `https://ru.wikipedia.org/w/api.php?action=query&list=search&format=json&utf8=1&srlimit=10&srsearch=${encodeURIComponent(q)}`;
      const res = await fetch(api, { headers: { 'User-Agent': 'SunnetBrowser/1.0' }, signal: AbortSignal.timeout(8000) });
      const data = (await res.json()) as { query?: { search?: { title: string; snippet: string }[] } };
      web = (data.query?.search ?? []).map((r) => ({
        title: r.title,
        url: `https://ru.wikipedia.org/wiki/${encodeURIComponent(r.title.replace(/ /g, '_'))}`,
        snippet: r.snippet.replace(/<[^>]+>/g, '').replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&#039;/g, "'"),
        source: 'Википедия',
      }));
    } catch {
      /* Википедия недоступна — покажем то, что нашлось в Sunnet */
    }
    return {
      web,
      sunnet: {
        users: sunnet.users.slice(0, 5).map((u) => ({ username: u.username, displayName: u.displayName })),
        spaces: sunnet.spaces.slice(0, 5).map((s) => ({ id: s.id, name: s.name, kind: s.kind })),
        posts: sunnet.posts.slice(0, 5).map((p) => ({ id: p.id, text: p.text.slice(0, 200), author: p.author.username })),
      },
    };
  });

  app.post('/browser/download', { config: { rateLimit: { max: 10, timeWindow: '10 minutes' } } }, async (req) => {
    const { userId } = requireAuth(req);
    const b = parse(z.object({ url: z.string().max(2000) }), req.body);
    let url = await assertPublicUrl(b.url);
    let res: IncomingMessage | null = null;
    for (let hop = 0; hop < 4; hop++) {
      res = await safeGet(url).catch((e: Error) => {
        throw badRequest(e.message === 'PRIVATE_ADDRESS' ? 'Эта ссылка ведёт во внутреннюю сеть — скачивание запрещено' : 'Сайт не ответил');
      });
      const loc = res.headers.location;
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && loc) {
        res.resume();
        if (hop === 3) throw badRequest('Слишком много перенаправлений');
        url = await assertPublicUrl(new URL(loc, url).toString());
        continue;
      }
      break;
    }
    if (!res || !res.statusCode || res.statusCode >= 400) {
      res?.resume();
      throw badRequest(`Сайт вернул ошибку ${res?.statusCode ?? ''}`.trim());
    }
    const len = Number(res.headers['content-length'] ?? 0);
    if (len > MAX_BYTES) {
      res.destroy();
      throw badRequest('Файл больше 50 МБ');
    }
    // Ограничение размера: обрываем, если сайт прислал больше заявленного
    let seen = 0;
    const limited = res.on('data', (c: Buffer) => {
      seen += c.length;
      if (seen > MAX_BYTES) res!.destroy(new Error('Файл больше 50 МБ'));
    });
    const name = decodeURIComponent(url.pathname.split('/').pop() || 'файл').slice(0, 120);
    try {
      const media = await services.media.store(userId, limited, { originalName: name });
      return { media, name };
    } catch (e) {
      throw badRequest(e instanceof Error && /тип|формат|не поддерж/i.test(e.message) ? 'Такой тип файла нельзя сохранить: разрешены картинки, видео, звук, PDF и ZIP' : e instanceof Error ? e.message : 'Не удалось сохранить файл');
    }
  });
}
