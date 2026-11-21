/**
 * Telegram через официальный клиентский протокол MTProto (библиотека GramJS).
 * Пользователь входит своим номером: код приходит в Telegram, при включённом
 * облачном пароле — ещё и пароль. Ключ сеанса хранится только зашифрованным.
 * Клиенты держатся в памяти и отключаются после 10 минут без запросов.
 */
import type { TelegramClient as TC } from 'telegram';

export interface TgConfig {
  apiId: number;
  apiHash: string;
}

export interface BridgeChat {
  id: string;
  service: 'telegram' | 'whatsapp';
  title: string;
  kind: 'user' | 'group' | 'channel';
  lastText: string;
  lastAt: string | null;
  unread: number;
}
export interface BridgeMessage {
  id: string;
  text: string;
  outgoing: boolean;
  at: string;
  author: string | null;
}

interface Live {
  client: TC;
  lastUse: number;
  peers: Map<string, unknown>;
}

const IDLE_MS = 10 * 60_000;
const live = new Map<string, Live>();
/** Вход в процессе: клиент без сохранённого сеанса и хэш кода. */
const pending = new Map<string, { client: TC; phone: string; hash: string; at: number }>();

async function lib() {
  const tg = await import('telegram');
  const sessions = await import('telegram/sessions/index.js');
  return { TelegramClient: tg.TelegramClient, Api: tg.Api, StringSession: sessions.StringSession };
}

async function makeClient(cfg: TgConfig, session = ''): Promise<TC> {
  const { TelegramClient, StringSession } = await lib();
  const client = new TelegramClient(new StringSession(session), cfg.apiId, cfg.apiHash, { connectionRetries: 3, deviceModel: 'Sunnet', appVersion: '1.7', systemVersion: 'Sunnet' });
  client.setLogLevel('error' as never);
  await client.connect();
  return client;
}

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of live) if (now - v.lastUse > IDLE_MS) (live.delete(k), void v.client.disconnect().catch(() => undefined));
  for (const [k, v] of pending) if (now - v.at > IDLE_MS) (pending.delete(k), void v.client.disconnect().catch(() => undefined));
}, 60_000).unref?.();

/** Человеческие сообщения вместо кодов ошибок Telegram. */
export function tgError(e: unknown): string {
  const m = String((e as { errorMessage?: string; message?: string })?.errorMessage ?? (e as Error)?.message ?? e);
  if (m.includes('PHONE_NUMBER_INVALID')) return 'Неверный номер телефона';
  if (m.includes('PHONE_CODE_INVALID')) return 'Неверный код';
  if (m.includes('PHONE_CODE_EXPIRED')) return 'Код устарел — запросите новый';
  if (m.includes('PASSWORD_HASH_INVALID')) return 'Неверный облачный пароль';
  if (m.includes('FLOOD_WAIT')) return 'Telegram просит подождать перед новой попыткой';
  if (m.includes('PHONE_NUMBER_BANNED')) return 'Этот номер заблокирован в Telegram';
  return 'Telegram не ответил. Попробуйте ещё раз';
}

export async function startLogin(cfg: TgConfig, userId: string, phone: string) {
  const old = pending.get(userId);
  if (old) void old.client.disconnect().catch(() => undefined);
  const client = await makeClient(cfg);
  const { phoneCodeHash } = await client.sendCode({ apiId: cfg.apiId, apiHash: cfg.apiHash }, phone);
  pending.set(userId, { client, phone, hash: phoneCodeHash, at: Date.now() });
}

/** Ввод кода. Возвращает ключ сеанса или null, если нужен облачный пароль. */
export async function submitCode(userId: string, code: string): Promise<{ session: string; name: string } | null> {
  const p = pending.get(userId);
  if (!p) throw new Error('PHONE_CODE_EXPIRED');
  const { Api } = await lib();
  try {
    await p.client.invoke(new Api.auth.SignIn({ phoneNumber: p.phone, phoneCodeHash: p.hash, phoneCode: code }));
  } catch (e) {
    if (String((e as { errorMessage?: string }).errorMessage ?? e).includes('SESSION_PASSWORD_NEEDED')) return null;
    throw e;
  }
  return finish(userId, p.client);
}

export async function submitPassword(cfg: TgConfig, userId: string, password: string) {
  const p = pending.get(userId);
  if (!p) throw new Error('PHONE_CODE_EXPIRED');
  await p.client.signInWithPassword(
    { apiId: cfg.apiId, apiHash: cfg.apiHash },
    {
      password: async () => password,
      onError: async (e) => {
        throw e;
      },
    },
  );
  return finish(userId, p.client);
}

async function finish(userId: string, client: TC) {
  pending.delete(userId);
  const me = (await client.getMe()) as { firstName?: string; username?: string; phone?: string };
  const session = (client.session as unknown as { save: () => string }).save();
  live.set(userId, { client, lastUse: Date.now(), peers: new Map() });
  return { session, name: me.username ? `@${me.username}` : (me.firstName ?? me.phone ?? 'Telegram') };
}

async function clientFor(cfg: TgConfig, userId: string, session: string): Promise<Live> {
  let l = live.get(userId);
  if (!l) {
    l = { client: await makeClient(cfg, session), lastUse: Date.now(), peers: new Map() };
    live.set(userId, l);
  }
  l.lastUse = Date.now();
  return l;
}

const iso = (sec: number | undefined) => (sec ? new Date(sec * 1000).toISOString() : null);

export async function listChats(cfg: TgConfig, userId: string, session: string): Promise<BridgeChat[]> {
  const l = await clientFor(cfg, userId, session);
  const dialogs = await l.client.getDialogs({ limit: 60 });
  return dialogs.map((d) => {
    const id = String(d.id);
    l.peers.set(id, d.inputEntity);
    return {
      id: `tg:${id}`,
      service: 'telegram' as const,
      title: d.title ?? d.name ?? 'Без названия',
      kind: d.isChannel && !d.isGroup ? ('channel' as const) : d.isGroup ? ('group' as const) : ('user' as const),
      lastText: (d.message?.message ?? (d.message?.media ? 'Вложение' : '')).slice(0, 200),
      lastAt: iso(d.date),
      unread: d.unreadCount ?? 0,
    };
  });
}

async function peer(cfg: TgConfig, userId: string, session: string, chatId: string) {
  const l = await clientFor(cfg, userId, session);
  if (!l.peers.has(chatId)) await listChats(cfg, userId, session);
  const p = l.peers.get(chatId);
  if (!p) throw new Error('Чат не найден');
  return { l, p };
}

export async function messages(cfg: TgConfig, userId: string, session: string, chatId: string): Promise<BridgeMessage[]> {
  const { l, p } = await peer(cfg, userId, session, chatId);
  const list = await l.client.getMessages(p as never, { limit: 50 });
  await l.client.markAsRead(p as never).catch(() => undefined);
  return list
    .map((m) => ({
      id: String(m.id),
      text: m.message || (m.media ? 'Вложение (откройте в Telegram)' : ''),
      outgoing: !!m.out,
      at: iso(m.date) ?? new Date().toISOString(),
      author: m.out ? null : ((m.sender as { firstName?: string; title?: string } | undefined)?.firstName ?? (m.sender as { title?: string } | undefined)?.title ?? null),
    }))
    .reverse();
}

export async function send(cfg: TgConfig, userId: string, session: string, chatId: string, text: string) {
  const { l, p } = await peer(cfg, userId, session, chatId);
  await l.client.sendMessage(p as never, { message: text });
}

export async function logout(userId: string) {
  const l = live.get(userId);
  live.delete(userId);
  if (l) await l.client.invoke(new (await lib()).Api.auth.LogOut()).catch(() => undefined);
  if (l) await l.client.disconnect().catch(() => undefined);
}
