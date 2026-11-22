/**
 * Консоль администратора: команды вида /user.block("ник", duration: 7d, reason: "спам").
 * Каждая команда проверяет роль вызывающего и записывается в журнал admin_audit —
 * без исключений, включая неудачные попытки. Тайного входа в чужой аккаунт нет:
 * это противоречит закону о персональных данных и доверию пользователей.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { newId } from '../../lib/ids.js';
import { parse } from '../../lib/errors.js';
import { requireRole } from '../../http/request.js';
import { COMMANDS, ensureOwner, type Parsed, type UserRow } from './commands.js';

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
  if (config.adminUsernames.length) {
    for (const u of config.adminUsernames) db.run("UPDATE users SET role = 'admin' WHERE lower(username) = :u", { u });
  }
  const owner = ensureOwner(app.ctx);
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

  app.get('/admin/console/commands', async (req) => {
    const auth = requireRole(req, 'moderator', 'admin');
    return { role: auth.role, commands: COMMANDS.filter((c) => c.role.includes(auth.role)).map(({ usage, text }) => ({ usage, text })) };
  });

  app.post('/admin/console', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (req) => {
    const auth = requireRole(req, 'moderator', 'admin');
    const { command } = parse(z.object({ command: z.string().min(1).max(500) }), req.body);
    const done = (ok: boolean, lines: string[], target: string | null = null) => {
      audit(auth.userId, command, target, `${ok ? 'ok' : 'fail'}: ${lines[0] ?? ''}`);
      return { ok, lines };
    };
    const cmd = parseCommand(command);
    if (!cmd) return done(false, ['Не понял команду. Формат: /user.block("ник", duration: 7d)']);
    const def = COMMANDS.find((c) => c.name === cmd.name);
    if (!def) return done(false, [`Нет команды ${cmd.name}. Введите /help.all()`]);
    if (!def.role.includes(auth.role)) return done(false, [`Нужны права: ${def.role.join(' или ')}`]);

    const res = await def.run({ ctx: app.ctx, actor: { userId: auth.userId, role: auth.role }, cmd, user: findUser });
    return done(res.ok, res.lines, res.target ?? null);
  });
}
