/**
 * Консоль администратора: команды вида /user.block("ник", duration: 7d, reason: "спам").
 * Каждая команда проверяет роль вызывающего и записывается в журнал admin_audit —
 * без исключений, включая неудачные попытки. Тайного входа в чужой аккаунт нет:
 * это противоречит закону о персональных данных и доверию пользователей.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { newId } from '../../lib/ids.js';
import { notFound, parse } from '../../lib/errors.js';
import { requireAuth } from '../../http/request.js';
import { COMMANDS, ensureOwner, setRegistry, type Command, type Parsed, type Role, type UserRow } from './commands.js';
import { entityCommands } from './entities.js';
import { runScript } from './script.js';

export { parseDuration } from './commands.js';

/** Разбор «/ns.cmd("a", key: value)». Возвращает null, если строка не похожа на команду. */
export function parseCommand(input: string): Parsed | null {
  const m = /^\/?([a-z]+\.[a-z_]+)\s*\((.*)\)\s*;?\s*$/i.exec(input.trim());
  if (!m) return null;
  const args: string[] = [];
  let cur = '';
  let quote: string | null = null;
  for (const ch of m[2]!) {
    if (quote) {
      if (ch === quote) quote = null;
      else cur += ch;
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === ',') {
      args.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  if (quote) return null;
  if (cur.trim()) args.push(cur.trim());
  const pos: string[] = [];
  const named: Record<string, string> = {};
  for (const a of args) {
    const kv = /^([a-z]+)\s*:\s*(.+)$/i.exec(a);
    if (kv) named[kv[1]!.toLowerCase()] = kv[2]!.trim();
    else pos.push(a);
  }
  return { name: m[1]!.toLowerCase(), pos, named };
}

export async function adminRoutes(app: FastifyInstance): Promise<void> {
  const { db, config } = app.ctx;

  // Владельцы из ADMIN_USERNAMES получают роль admin при старте сервера; если никого
  // не указали — администратором становится первый зарегистрированный пользователь
  // Демо-аккаунты (@example.com) прав администратора не имеют
  db.run("UPDATE users SET role = 'user', owner = 0 WHERE (role = 'admin' OR owner = 1) AND email LIKE '%@example.com'");
  const owner = ensureOwner(app.ctx, config.adminUsernames);
  if (owner) app.log.info(`Администратор платформы: @${owner} (первый зарегистрированный)`);


  const audit = (actorId: string, command: string, targetId: string | null, result: string) =>
    db.run('INSERT INTO admin_audit (id, actor_id, command, target_id, result, created_at) VALUES (:id, :a, :c, :t, :r, :now)', {
      id: newId(),
      a: actorId,
      c: command.slice(0, 500),
      t: targetId,
      r: result.slice(0, 500),
      now: Date.now(),
    });

  const findUser = (nick: string | undefined) =>
    nick
      ? db.get<UserRow>(
          'SELECT id, username, display_name, role, verified, blocked_until, blocked_reason, created_at, last_seen_at, email FROM users WHERE lower(username) = :u AND deleted_at IS NULL',
          { u: nick.toLowerCase().replace(/^@/, '') },
        )
      : undefined;

  /** Консоль есть только у владельца. Остальным — 404, как будто её не существует. */
  const requireOwner = (req: Parameters<typeof requireAuth>[0]) => {
    const a = requireAuth(req);
    const row = db.get<{ owner: number; role: Role }>('SELECT owner, role FROM users WHERE id = :id AND deleted_at IS NULL', { id: a.userId });
    if (!row?.owner) throw notFound('Страница не найдена');
    return { userId: a.userId, role: 'admin' as Role };
  };

  // Полный набор: ручные команды + семейства по сущностям (ручные важнее при совпадении имён)
  const all = new Map<string, Command>();
  for (const c of entityCommands(app.ctx)) all.set(c.name, c);
  for (const c of COMMANDS) all.set(c.name, c);
  const list = [...all.values()].sort((a, b) => a.name.localeCompare(b.name));
  setRegistry(list);
  app.log.info(`Консоль: ${list.length} команд`);

  app.get('/admin/console/commands', async (req) => {
    requireOwner(req);
    return { role: 'owner', count: list.length, commands: list.map(({ name, usage, text }) => ({ name, usage, text })) };
  });

  /** Выполнить команду или целый скрипт на языке «Луч». */
  app.post('/admin/console', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (req) => {
    const auth = requireOwner(req);
    const { command } = parse(z.object({ command: z.string().min(1).max(5000) }), req.body);
    const res = await runScript(command, {
      commands: all,
      base: { ctx: app.ctx, actor: { userId: auth.userId, role: auth.role }, user: findUser },
      onCall: (name, r) => audit(auth.userId, `${name}`, r.target ?? null, `${r.ok ? 'ok' : 'fail'}: ${r.lines[0] ?? ''}`),
    });
    audit(auth.userId, command, null, `${res.ok ? 'ok' : 'fail'}: скрипт`);
    return { ok: res.ok, lines: res.out.map((l) => l.text), out: res.out };
  });
}
