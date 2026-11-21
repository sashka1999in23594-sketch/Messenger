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

type Role = 'user' | 'moderator' | 'admin';
interface Parsed {
  name: string;
  pos: string[];
  named: Record<string, string>;
}

/** Разбор «/ns.cmd("a", key: value)». Возвращает null, если строка не похожа на команду. */
export function parseCommand(input: string): Parsed | null {
  const m = /^\/?([a-z]+\.[a-z]+)\s*\((.*)\)\s*;?\s*$/i.exec(input.trim());
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

/** 30m, 12h, 7d, 2w → миллисекунды. */
export function parseDuration(v: string | undefined): number | null {
  const m = /^(\d{1,4})\s*(m|h|d|w)$/i.exec((v ?? '').trim());
  if (!m) return null;
  const unit = { m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 }[m[2]!.toLowerCase() as 'm' | 'h' | 'd' | 'w'];
  return Number(m[1]) * unit;
}

const COMMANDS: { name: string; usage: string; role: Role[]; text: string }[] = [
  { name: 'user.find', usage: '/user.find("ник")', role: ['moderator', 'admin'], text: 'Кто это: имя, роль, блокировка' },
  { name: 'user.block', usage: '/user.block("ник", duration: 7d, reason: "спам")', role: ['moderator', 'admin'], text: 'Заблокировать на срок (m, h, d, w)' },
  { name: 'user.unblock', usage: '/user.unblock("ник")', role: ['moderator', 'admin'], text: 'Снять блокировку' },
  { name: 'user.logout', usage: '/user.logout("ник")', role: ['admin'], text: 'Завершить все сеансы' },
  { name: 'badge.give', usage: '/badge.give("ник", "verified")', role: ['admin'], text: 'Выдать галочку' },
  { name: 'badge.take', usage: '/badge.take("ник", "verified")', role: ['admin'], text: 'Снять галочку' },
  { name: 'role.grant', usage: '/role.grant("ник", "moderator")', role: ['admin'], text: 'Роль: user, moderator, admin' },
  { name: 'app.pending', usage: '/app.pending()', role: ['moderator', 'admin'], text: 'Приложения на проверке' },
  { name: 'app.verify', usage: '/app.verify("ссылка")', role: ['admin'], text: 'Проверено: в каталог со значком' },
  { name: 'app.reject', usage: '/app.reject("ссылка", reason: "…")', role: ['admin'], text: 'Отклонить проверку' },
  { name: 'audit.show', usage: '/audit.show()', role: ['admin'], text: 'Последние 20 команд' },
  { name: 'help.all', usage: '/help.all()', role: ['moderator', 'admin'], text: 'Список команд' },
];

export async function adminRoutes(app: FastifyInstance): Promise<void> {
  const { db, config } = app.ctx;

  // Владельцы из ADMIN_USERNAMES получают роль admin при старте сервера
  if (config.adminUsernames.length) {
    for (const u of config.adminUsernames) db.run("UPDATE users SET role = 'admin' WHERE lower(username) = :u", { u });
  }

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
      ? db.get<{ id: string; username: string; display_name: string; role: Role; verified: number; blocked_until: number | null; blocked_reason: string | null; created_at: number }>(
          'SELECT id, username, display_name, role, verified, blocked_until, blocked_reason, created_at FROM users WHERE lower(username) = :u AND deleted_at IS NULL',
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

    if (cmd.name === 'help.all') return done(true, COMMANDS.filter((c) => c.role.includes(auth.role)).map((c) => `${c.usage} — ${c.text}`));
    if (cmd.name === 'audit.show') {
      const rows = db.all<{ command: string; result: string; created_at: number; username: string }>(
        'SELECT a.command, a.result, a.created_at, u.username FROM admin_audit a JOIN users u ON u.id = a.actor_id ORDER BY a.created_at DESC LIMIT 20',
      );
      return done(true, rows.length ? rows.map((r) => `${new Date(r.created_at).toISOString().slice(0, 16).replace('T', ' ')} @${r.username}: ${r.command} → ${r.result}`) : ['Журнал пуст']);
    }

    if (cmd.name === 'app.pending') {
      const rows = db.all<{ slug: string; name: string; version: number }>("SELECT slug, name, version FROM studio_apps WHERE review = 'pending' ORDER BY updated_at LIMIT 50");
      return done(true, rows.length ? rows.map((r) => `${r.slug} · ${r.name} · v${r.version}`) : ['Очередь проверки пуста']);
    }
    if (cmd.name === 'app.verify' || cmd.name === 'app.reject') {
      const appRow = db.get<{ id: string; name: string }>('SELECT id, name FROM studio_apps WHERE slug = :s', { s: cmd.pos[0] ?? '' });
      if (!appRow) return done(false, [`Приложение «${cmd.pos[0] ?? ''}» не найдено`]);
      db.run('UPDATE studio_apps SET review = :r WHERE id = :id', { r: cmd.name === 'app.verify' ? 'verified' : 'rejected', id: appRow.id });
      return done(true, [`«${appRow.name}»: ${cmd.name === 'app.verify' ? 'проверено, в каталоге' : 'проверка отклонена'}`], appRow.id);
    }

    const u = findUser(cmd.pos[0]);
    if (!u) return done(false, [`Пользователь «${cmd.pos[0] ?? ''}» не найден`]);
    const self = u.id === auth.userId;
    // Модератор не может трогать администраторов; никто не блокирует сам себя
    if (u.role === 'admin' && auth.role !== 'admin') return done(false, ['Нельзя: это администратор'], u.id);

    switch (cmd.name) {
      case 'user.find': {
        const blocked = u.blocked_until && u.blocked_until > Date.now() ? `заблокирован до ${new Date(u.blocked_until).toISOString().slice(0, 16).replace('T', ' ')} (${u.blocked_reason ?? 'без причины'})` : 'не заблокирован';
        return done(true, [`@${u.username} · ${u.display_name} · роль ${u.role}${u.verified ? ' · галочка ✓' : ''}`, `Зарегистрирован ${new Date(u.created_at).toISOString().slice(0, 10)} · ${blocked}`], u.id);
      }
      case 'user.block': {
        if (self) return done(false, ['Себя заблокировать нельзя'], u.id);
        const ms = parseDuration(cmd.named.duration ?? cmd.pos[1]);
        if (!ms) return done(false, ['Укажите срок: duration: 30m, 12h, 7d или 2w'], u.id);
        const until = Date.now() + ms;
        db.run('UPDATE users SET blocked_until = :until, blocked_reason = :r WHERE id = :id', { until, r: cmd.named.reason ?? null, id: u.id });
        return done(true, [`@${u.username} заблокирован до ${new Date(until).toISOString().slice(0, 16).replace('T', ' ')} UTC`], u.id);
      }
      case 'user.unblock':
        db.run('UPDATE users SET blocked_until = NULL, blocked_reason = NULL WHERE id = :id', { id: u.id });
        return done(true, [`@${u.username} разблокирован`], u.id);
      case 'user.logout': {
        const n = db.run('UPDATE sessions SET revoked_at = :now WHERE user_id = :id AND revoked_at IS NULL', { now: Date.now(), id: u.id }).changes;
        return done(true, [`Завершено сеансов: ${n}`], u.id);
      }
      case 'badge.give':
      case 'badge.take': {
        if ((cmd.pos[1] ?? 'verified') !== 'verified') return done(false, ['Пока есть только значок "verified"'], u.id);
        db.run('UPDATE users SET verified = :v WHERE id = :id', { v: cmd.name === 'badge.give' ? 1 : 0, id: u.id });
        return done(true, [`@${u.username}: галочка ${cmd.name === 'badge.give' ? 'выдана' : 'снята'}`], u.id);
      }
      case 'role.grant': {
        const role = cmd.pos[1] as Role;
        if (!['user', 'moderator', 'admin'].includes(role)) return done(false, ['Роль: "user", "moderator" или "admin"'], u.id);
        if (self && role !== 'admin') return done(false, ['Нельзя понизить самого себя'], u.id);
        db.run('UPDATE users SET role = :role WHERE id = :id', { role, id: u.id });
        return done(true, [`@${u.username} теперь ${role}`], u.id);
      }
    }
    return done(false, ['Команда не выполнена']);
  });
}
