/**
 * Подключённые мессенджеры: Telegram (MTProto, вход своим номером) и WhatsApp
 * Business (официальный Cloud API: токен и номер из Meta for Developers).
 * Ключи сеансов шифруются; переписки отдаются только владельцу.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { SecretBox } from '../../lib/crypto.js';
import { newId } from '../../lib/ids.js';
import { AppError, badRequest, notFound, parse } from '../../lib/errors.js';
import { requireAuth } from '../../http/request.js';
import * as tg from './telegram.js';
import type { BridgeChat, BridgeMessage } from './telegram.js';

type Service = 'telegram' | 'whatsapp';
interface Link {
  id: string;
  account: string;
  secret_enc: string;
  ext_id: string | null;
}
const GRAPH = 'https://graph.facebook.com/v21.0';
const strict = { config: { rateLimit: { max: 8, timeWindow: '10 minutes' } } };
const normal = { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } };

export async function bridgeRoutes(app: FastifyInstance): Promise<void> {
  const { db, config } = app.ctx;
  const box = new SecretBox(config.secret, 'messenger-bridge');
  const cfg = config.telegram;

  const link = (userId: string, service: Service) => db.get<Link>('SELECT id, account, secret_enc, ext_id FROM bridge_links WHERE user_id = :u AND service = :s', { u: userId, s: service });
  const save = (userId: string, service: Service, account: string, secret: string, extId: string | null = null) => {
    db.run('DELETE FROM bridge_links WHERE user_id = :u AND service = :s', { u: userId, s: service });
    db.run('INSERT INTO bridge_links (id, user_id, service, account, secret_enc, ext_id, created_at) VALUES (:id, :u, :s, :a, :e, :x, :now)', {
      id: newId(),
      u: userId,
      s: service,
      a: account,
      e: box.seal(secret),
      x: extId,
      now: Date.now(),
    });
  };
  const needTg = () => {
    if (!cfg) throw new AppError(503, 'SERVICE_UNAVAILABLE' as never, 'Подключение Telegram ещё не настроено на сервере: нужны TELEGRAM_API_ID и TELEGRAM_API_HASH');
    return cfg;
  };
  const tgSession = (userId: string) => {
    const l = link(userId, 'telegram');
    if (!l) throw notFound('Telegram не подключён');
    return box.open(l.secret_enc);
  };
  const tgFail = (e: unknown): never => {
    throw badRequest(tg.tgError(e));
  };

  app.get('/bridge/status', async (req) => {
    const { userId } = requireAuth(req);
    const t = link(userId, 'telegram');
    const w = link(userId, 'whatsapp');
    return {
      telegram: { available: !!cfg, connected: !!t, account: t?.account ?? null },
      whatsapp: { available: true, connected: !!w, account: w?.account ?? null },
    };
  });

  // ─── Telegram: номер → код → (облачный пароль) ───
  app.post('/bridge/telegram/start', strict, async (req) => {
    const { userId } = requireAuth(req);
    const { phone } = parse(z.object({ phone: z.string().trim().regex(/^\+?\d{10,15}$/, 'Номер в формате +79991234567') }), req.body);
    await tg.startLogin(needTg(), userId, phone.startsWith('+') ? phone : `+${phone}`).catch(tgFail);
    return { status: 'code' };
  });
  app.post('/bridge/telegram/code', strict, async (req) => {
    const { userId } = requireAuth(req);
    const { code } = parse(z.object({ code: z.string().trim().regex(/^\d{4,8}$/, 'Код — это цифры из Telegram') }), req.body);
    needTg();
    const r = await tg.submitCode(userId, code).catch(tgFail);
    if (!r) return { status: 'password' };
    save(userId, 'telegram', r.name, r.session);
    return { status: 'connected', account: r.name };
  });
  app.post('/bridge/telegram/password', strict, async (req) => {
    const { userId } = requireAuth(req);
    const { password } = parse(z.object({ password: z.string().min(1).max(256) }), req.body);
    const r = await tg.submitPassword(needTg(), userId, password).catch(tgFail);
    save(userId, 'telegram', r.name, r.session);
    return { status: 'connected', account: r.name };
  });

  // ─── WhatsApp Business ───
  app.post('/bridge/whatsapp/connect', strict, async (req) => {
    const { userId } = requireAuth(req);
    const b = parse(z.object({ token: z.string().min(20).max(1000), phoneNumberId: z.string().regex(/^\d{5,30}$/) }), req.body);
    const res = await fetch(`${GRAPH}/${b.phoneNumberId}?fields=display_phone_number,verified_name`, { headers: { Authorization: `Bearer ${b.token}` }, signal: AbortSignal.timeout(15_000) }).catch(() => null);
    if (!res?.ok) throw badRequest('Meta не приняла токен или номер. Проверьте их в Meta for Developers → WhatsApp → API Setup');
    const info = (await res.json()) as { display_phone_number?: string; verified_name?: string };
    if (db.get("SELECT 1 FROM bridge_links WHERE service = 'whatsapp' AND ext_id = :x AND user_id != :u", { x: b.phoneNumberId, u: userId })) throw badRequest('Этот номер уже подключён другим аккаунтом');
    save(userId, 'whatsapp', info.verified_name ?? info.display_phone_number ?? 'WhatsApp Business', JSON.stringify(b), b.phoneNumberId);
    return { status: 'connected', account: info.verified_name ?? info.display_phone_number };
  });

  app.delete<{ Params: { service: string } }>('/bridge/:service', normal, async (req) => {
    const { userId } = requireAuth(req);
    const service = parse(z.enum(['telegram', 'whatsapp']), req.params.service);
    if (service === 'telegram') await tg.logout(userId);
    db.run('DELETE FROM bridge_links WHERE user_id = :u AND service = :s', { u: userId, s: service });
    if (service === 'whatsapp') db.run("DELETE FROM bridge_messages WHERE user_id = :u AND service = 'whatsapp'", { u: userId });
    return { ok: true };
  });

  // ─── Общий список чатов подключённых мессенджеров ───
  app.get('/bridge/chats', normal, async (req) => {
    const { userId } = requireAuth(req);
    const chats: BridgeChat[] = [];
    const errors: { service: Service; text: string }[] = [];
    if (link(userId, 'telegram') && cfg) {
      try {
        chats.push(...(await tg.listChats(cfg, userId, tgSession(userId))));
      } catch (e) {
        errors.push({ service: 'telegram', text: tg.tgError(e) });
      }
    }
    if (link(userId, 'whatsapp')) {
      const rows = db.all<{ chat_id: string; chat_name: string; text: string; created_at: number; unread: number }>(
        `SELECT m.chat_id, m.chat_name, m.text, m.created_at,
                (SELECT COUNT(*) FROM bridge_messages u WHERE u.user_id = m.user_id AND u.chat_id = m.chat_id AND u.outgoing = 0 AND u.read_at IS NULL) AS unread
         FROM bridge_messages m
         WHERE m.user_id = :u AND m.service = 'whatsapp'
           AND m.created_at = (SELECT MAX(created_at) FROM bridge_messages x WHERE x.user_id = m.user_id AND x.chat_id = m.chat_id)`,
        { u: userId },
      );
      chats.push(...rows.map((r) => ({ id: `wa:${r.chat_id}`, service: 'whatsapp' as const, title: r.chat_name, kind: 'user' as const, lastText: r.text.slice(0, 200), lastAt: new Date(r.created_at).toISOString(), unread: r.unread })));
    }
    chats.sort((a, b) => (b.lastAt ?? '').localeCompare(a.lastAt ?? ''));
    return { chats, errors };
  });

  const splitId = (id: string) => {
    const m = /^(tg|wa):([\w-]{1,40})$/.exec(id);
    if (!m) throw notFound();
    return { service: (m[1] === 'tg' ? 'telegram' : 'whatsapp') as Service, chatId: m[2]! };
  };

  app.get<{ Params: { id: string } }>('/bridge/chats/:id/messages', normal, async (req) => {
    const { userId } = requireAuth(req);
    const { service, chatId } = splitId(req.params.id);
    if (service === 'telegram') return { messages: await tg.messages(needTg(), userId, tgSession(userId), chatId).catch(tgFail) };
    if (!link(userId, 'whatsapp')) throw notFound();
    const rows = db.all<{ id: string; text: string; outgoing: number; created_at: number; chat_name: string }>(
      "SELECT id, text, outgoing, created_at, chat_name FROM bridge_messages WHERE user_id = :u AND service = 'whatsapp' AND chat_id = :c ORDER BY created_at DESC LIMIT 100",
      { u: userId, c: chatId },
    );
    db.run("UPDATE bridge_messages SET read_at = :now WHERE user_id = :u AND chat_id = :c AND read_at IS NULL", { now: Date.now(), u: userId, c: chatId });
    return { messages: rows.reverse().map((r): BridgeMessage => ({ id: r.id, text: r.text, outgoing: !!r.outgoing, at: new Date(r.created_at).toISOString(), author: r.outgoing ? null : r.chat_name })) };
  });

  app.post<{ Params: { id: string } }>('/bridge/chats/:id/messages', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req) => {
    const { userId } = requireAuth(req);
    const { service, chatId } = splitId(req.params.id);
    const { text } = parse(z.object({ text: z.string().trim().min(1).max(4000) }), req.body);
    if (service === 'telegram') {
      await tg.send(needTg(), userId, tgSession(userId), chatId, text).catch(tgFail);
      return { ok: true };
    }
    const l = link(userId, 'whatsapp');
    if (!l) throw notFound();
    const { token, phoneNumberId } = JSON.parse(box.open(l.secret_enc)) as { token: string; phoneNumberId: string };
    const res = await fetch(`${GRAPH}/${phoneNumberId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', to: chatId, type: 'text', text: { body: text } }),
      signal: AbortSignal.timeout(15_000),
    }).catch(() => null);
    // WhatsApp разрешает свободный ответ только в течение 24 часов после сообщения клиента
    if (!res?.ok) throw badRequest('WhatsApp не принял сообщение. Свободный ответ возможен в течение 24 часов после сообщения клиента');
    const name = db.get<{ chat_name: string }>('SELECT chat_name FROM bridge_messages WHERE user_id = :u AND chat_id = :c LIMIT 1', { u: userId, c: chatId })?.chat_name ?? chatId;
    db.run("INSERT INTO bridge_messages (id, user_id, service, chat_id, chat_name, outgoing, text, created_at, read_at) VALUES (:id, :u, 'whatsapp', :c, :n, 1, :t, :now, :now)", {
      id: newId(),
      u: userId,
      c: chatId,
      n: name,
      t: text,
      now: Date.now(),
    });
    return { ok: true };
  });

  // ─── Вебхук WhatsApp: проверка подписи X-Hub-Signature-256 по «сырому» телу ───
  await app.register(async (hook) => {
    hook.removeContentTypeParser('application/json');
    hook.addContentTypeParser('application/json', { parseAs: 'string', bodyLimit: 1024 * 1024 }, (_req, body, done) => done(null, body));
    hook.get('/bridge/whatsapp/webhook', async (req, reply) => {
      const q = req.query as Record<string, string>;
      if (config.whatsappVerifyToken && q['hub.mode'] === 'subscribe' && q['hub.verify_token'] === config.whatsappVerifyToken) return reply.type('text/plain').send(q['hub.challenge'] ?? '');
      return reply.status(403).send('forbidden');
    });
    hook.post('/bridge/whatsapp/webhook', { config: { rateLimit: { max: 600, timeWindow: '1 minute' } } }, async (req, reply) => {
      const raw = String(req.body ?? '');
      const appSecret = process.env.WHATSAPP_APP_SECRET;
      const sig = String(req.headers['x-hub-signature-256'] ?? '');
      if (!appSecret) return reply.status(503).send('not configured');
      const want = Buffer.from(`sha256=${createHmac('sha256', appSecret).update(raw).digest('hex')}`);
      if (want.length !== sig.length || !timingSafeEqual(want, Buffer.from(sig))) return reply.status(401).send('bad signature');
      type Change = { value?: { metadata?: { phone_number_id?: string }; contacts?: { wa_id?: string; profile?: { name?: string } }[]; messages?: { from?: string; timestamp?: string; type?: string; text?: { body?: string } }[] } };
      const payload = JSON.parse(raw) as { entry?: { changes?: Change[] }[] };
      for (const entry of payload.entry ?? []) {
        for (const ch of entry.changes ?? []) {
          const v = ch.value;
          const owner = db.get<{ user_id: string }>("SELECT user_id FROM bridge_links WHERE service = 'whatsapp' AND ext_id = :x", { x: v?.metadata?.phone_number_id ?? '' });
          if (!owner) continue;
          for (const m of v?.messages ?? []) {
            if (!m.from) continue;
            const name = v?.contacts?.find((c) => c.wa_id === m.from)?.profile?.name ?? `+${m.from}`;
            const text = m.type === 'text' ? (m.text?.body ?? '') : 'Вложение (откройте в WhatsApp Business)';
            db.run("INSERT INTO bridge_messages (id, user_id, service, chat_id, chat_name, outgoing, text, created_at) VALUES (:id, :u, 'whatsapp', :c, :n, 0, :t, :at)", {
              id: newId(),
              u: owner.user_id,
              c: m.from.replace(/\D/g, '').slice(0, 20),
              n: name.slice(0, 120),
              t: text.slice(0, 4000),
              at: Number(m.timestamp) * 1000 || Date.now(),
            });
          }
        }
      }
      return reply.send({ ok: true });
    });
  });
}
