/**
 * Реестр команд консоли администратора. Каждая команда: имя вида «раздел.действие»,
 * пример, кому доступна и обработчик. Права проверяет консоль ДО вызова обработчика,
 * каждый вызов (и неудачный тоже) пишется в журнал admin_audit.
 *
 * Чего здесь нет намеренно: тайного входа в чужой аккаунт, чтения личных переписок
 * и паролей. Это нарушает закон о персональных данных и доверие пользователей.
 * Команды работают с учётной записью, публичным контентом, жалобами и статистикой.
 */
import type { Ctx as AppContext } from '../../context.js';
import { newId } from '../../lib/ids.js';

export type Role = 'user' | 'moderator' | 'admin';
export interface Parsed {
  name: string;
  pos: string[];
  named: Record<string, string>;
}
export interface UserRow {
  id: string;
  username: string;
  display_name: string;
  role: Role;
  verified: number;
  blocked_until: number | null;
  blocked_reason: string | null;
  created_at: number;
  last_seen_at: number | null;
  email: string | null;
}
export interface Run {
  ctx: AppContext;
  actor: { userId: string; role: Role };
  cmd: Parsed;
  user: (nick: string | undefined) => UserRow | undefined;
}
export interface Result {
  ok: boolean;
  lines: string[];
  target?: string | null;
}
export interface Command {
  name: string;
  usage: string;
  text: string;
  role: Role[];
  run: (r: Run) => Result | Promise<Result>;
}

const MOD: Role[] = ['moderator', 'admin'];
const ADM: Role[] = ['admin'];
const ok = (lines: string[] | string, target: string | null = null): Result => ({ ok: true, lines: Array.isArray(lines) ? lines : [lines], target });
const fail = (line: string, target: string | null = null): Result => ({ ok: false, lines: [line], target });
const when = (ms: number | null | undefined) => (ms ? new Date(ms).toISOString().slice(0, 16).replace('T', ' ') : '—');
const DAY = 86_400_000;

/** 30m, 12h, 7d, 2w → миллисекунды. */
export function parseDuration(v: string | undefined): number | null {
  const m = /^(\d{1,4})\s*(m|h|d|w)$/i.exec((v ?? '').trim());
  if (!m) return null;
  const unit = { m: 60_000, h: 3_600_000, d: DAY, w: 7 * DAY }[m[2]!.toLowerCase() as 'm' | 'h' | 'd' | 'w'];
  return Number(m[1]) * unit;
}
const limitArg = (v: string | undefined, d = 20, max = 100) => Math.min(max, Math.max(1, Number.parseInt(v ?? '', 10) || d));

/** Команда над пользователем: находит его, не даёт модератору трогать администратора. */
function onUser(name: string, usage: string, text: string, role: Role[], fn: (u: UserRow, r: Run) => Result | Promise<Result>, opts: { notSelf?: string } = {}): Command {
  return {
    name,
    usage,
    text,
    role,
    run: (r) => {
      const u = r.user(r.cmd.pos[0]);
      if (!u) return fail(`Пользователь «${r.cmd.pos[0] ?? ''}» не найден`);
      if (u.role === 'admin' && r.actor.role !== 'admin') return fail('Нельзя: это администратор', u.id);
      if (opts.notSelf && u.id === r.actor.userId) return fail(opts.notSelf, u.id);
      return fn(u, r);
    },
  };
}

/** Скрыть/вернуть запись по id в таблице с deleted_at (посты, комментарии, истории, сообщения в публичных каналах). */
function softDelete(name: string, table: 'posts' | 'comments' | 'stories', label: string, restore = false): Command {
  return {
    name,
    usage: `/${name}("id")`,
    text: restore ? `Вернуть ${label}` : `Удалить ${label} (можно вернуть)`,
    role: MOD,
    run: ({ ctx, cmd }) => {
      const id = cmd.pos[0] ?? '';
      const row = ctx.db.get<{ id: string }>(`SELECT id FROM ${table} WHERE id = :id`, { id });
      if (!row) return fail(`Не найдено: ${id}`);
      ctx.db.run(`UPDATE ${table} SET deleted_at = ${restore ? 'NULL' : ':now'} WHERE id = :id`, restore ? { id } : { id, now: Date.now() });
      return ok(`${label}: ${restore ? 'возвращено' : 'удалено'} (${id})`, id);
    },
  };
}

/** Счётчик строк — для раздела stats.* */
function counter(name: string, label: string, sql: string, extra?: string): Command {
  return {
    name,
    usage: `/${name}()`,
    text: `Сколько ${label}`,
    role: MOD,
    run: ({ ctx }) => {
      const all = ctx.db.get<{ n: number }>(`SELECT count(*) AS n FROM ${sql}`)?.n ?? 0;
      const day = extra ? (ctx.db.get<{ n: number }>(`SELECT count(*) AS n FROM ${sql} ${sql.includes('WHERE') ? 'AND' : 'WHERE'} ${extra} > :since`, { since: Date.now() - DAY })?.n ?? 0) : null;
      return ok(`${label}: ${all}${day !== null ? ` · за сутки +${day}` : ''}`);
    },
  };
}

export const COMMANDS: Command[] = [
  // ── Пользователи ──
  onUser('user.find', '/user.find("ник")', 'Кто это: имя, роль, блокировка', MOD, (u) => {
    const blocked = u.blocked_until && u.blocked_until > Date.now() ? `заблокирован до ${when(u.blocked_until)} (${u.blocked_reason ?? 'без причины'})` : 'не заблокирован';
    return ok([`@${u.username} · ${u.display_name} · роль ${u.role}${u.verified ? ' · галочка ✓' : ''}`, `Зарегистрирован ${when(u.created_at).slice(0, 10)} · ${blocked}`], u.id);
  }),
  onUser('user.info', '/user.info("ник")', 'Подробно: активность, посты, подписчики, сеансы', MOD, (u, { ctx }) => {
    const n = (sql: string) => ctx.db.get<{ n: number }>(sql, { id: u.id })?.n ?? 0;
    return ok(
      [
        `@${u.username} · ${u.display_name} · ${u.role}${u.verified ? ' · ✓' : ''}`,
        `Был в сети: ${when(u.last_seen_at)} · зарегистрирован ${when(u.created_at)}`,
        `Посты: ${n('SELECT count(*) n FROM posts WHERE author_id = :id AND deleted_at IS NULL')} · комментарии: ${n('SELECT count(*) n FROM comments WHERE author_id = :id AND deleted_at IS NULL')}`,
        `Подписчики: ${n('SELECT count(*) n FROM follows WHERE followee_id = :id')} · подписки: ${n('SELECT count(*) n FROM follows WHERE follower_id = :id')}`,
        `Активные сеансы: ${n('SELECT count(*) n FROM sessions WHERE user_id = :id AND revoked_at IS NULL AND expires_at > ' + Date.now())}`,
        `Жалобы на него: ${n("SELECT count(*) n FROM reports WHERE entity_type = 'user' AND entity_id = :id")}`,
      ],
      u.id,
    );
  }),
  {
    name: 'user.search',
    usage: '/user.search("часть ника или имени")',
    text: 'Поиск пользователей',
    role: MOD,
    run: ({ ctx, cmd }) => {
      const q = `%${(cmd.pos[0] ?? '').replace(/[%_]/g, '')}%`;
      const rows = ctx.db.all<UserRow>('SELECT username, display_name, role, verified FROM users WHERE deleted_at IS NULL AND (username LIKE :q OR display_name LIKE :q) ORDER BY created_at LIMIT 25', { q });
      return ok(rows.length ? rows.map((u) => `@${u.username} · ${u.display_name} · ${u.role}${u.verified ? ' ✓' : ''}`) : ['Никого не нашлось']);
    },
  },
  {
    name: 'user.recent',
    usage: '/user.recent(20)',
    text: 'Последние регистрации',
    role: MOD,
    run: ({ ctx, cmd }) => {
      const rows = ctx.db.all<UserRow>('SELECT username, display_name, created_at FROM users WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT :n', { n: limitArg(cmd.pos[0]) });
      return ok(rows.map((u) => `${when(u.created_at)} · @${u.username} · ${u.display_name}`));
    },
  },
  {
    name: 'user.online',
    usage: '/user.online()',
    text: 'Кто был в сети за последние 5 минут',
    role: MOD,
    run: ({ ctx }) => {
      const rows = ctx.db.all<UserRow>('SELECT username FROM users WHERE last_seen_at > :t ORDER BY last_seen_at DESC LIMIT 100', { t: Date.now() - 5 * 60_000 });
      return ok(rows.length ? [`В сети: ${rows.length}`, rows.map((u) => `@${u.username}`).join(', ')] : ['Сейчас никого']);
    },
  },
  {
    name: 'user.blocked',
    usage: '/user.blocked()',
    text: 'Кто сейчас заблокирован',
    role: MOD,
    run: ({ ctx }) => {
      const rows = ctx.db.all<UserRow>('SELECT username, blocked_until, blocked_reason FROM users WHERE blocked_until > :now ORDER BY blocked_until LIMIT 100', { now: Date.now() });
      return ok(rows.length ? rows.map((u) => `@${u.username} до ${when(u.blocked_until)} · ${u.blocked_reason ?? 'без причины'}`) : ['Заблокированных нет']);
    },
  },
  {
    name: 'user.staff',
    usage: '/user.staff()',
    text: 'Администраторы и модераторы',
    role: MOD,
    run: ({ ctx }) => {
      const rows = ctx.db.all<UserRow>("SELECT username, role FROM users WHERE role IN ('admin', 'moderator') AND deleted_at IS NULL ORDER BY role, username");
      return ok(rows.map((u) => `${u.role === 'admin' ? '★' : '☆'} @${u.username} · ${u.role}`));
    },
  },
  onUser(
    'user.block',
    '/user.block("ник", duration: 7d, reason: "спам")',
    'Заблокировать на срок (m, h, d, w) и завершить сеансы',
    MOD,
    (u, { ctx, cmd }) => {
      const ms = parseDuration(cmd.named.duration ?? cmd.pos[1]);
      if (!ms) return fail('Укажите срок: duration: 30m, 12h, 7d или 2w', u.id);
      const until = Date.now() + ms;
      ctx.db.run('UPDATE users SET blocked_until = :until, blocked_reason = :r WHERE id = :id', { until, r: cmd.named.reason ?? null, id: u.id });
      ctx.db.run('UPDATE sessions SET revoked_at = :now WHERE user_id = :id AND revoked_at IS NULL', { now: Date.now(), id: u.id });
      return ok(`@${u.username} заблокирован до ${when(until)} UTC`, u.id);
    },
    { notSelf: 'Себя заблокировать нельзя' },
  ),
  onUser('user.unblock', '/user.unblock("ник")', 'Снять блокировку', MOD, (u, { ctx }) => {
    ctx.db.run('UPDATE users SET blocked_until = NULL, blocked_reason = NULL WHERE id = :id', { id: u.id });
    return ok(`@${u.username} разблокирован`, u.id);
  }),
  onUser('user.logout', '/user.logout("ник")', 'Завершить все сеансы', ADM, (u, { ctx }) => {
    const n = ctx.db.run('UPDATE sessions SET revoked_at = :now WHERE user_id = :id AND revoked_at IS NULL', { now: Date.now(), id: u.id }).changes;
    return ok(`Завершено сеансов: ${n}`, u.id);
  }),
  onUser('user.sessions', '/user.sessions("ник")', 'Устройства и последние входы (без IP-адресов)', ADM, (u, { ctx }) => {
    const rows = ctx.db.all<{ device_name: string | null; user_agent: string | null; last_seen_at: number | null; revoked_at: number | null }>(
      'SELECT device_name, user_agent, last_seen_at, revoked_at FROM sessions WHERE user_id = :id ORDER BY last_seen_at DESC LIMIT 15',
      { id: u.id },
    );
    return ok(rows.length ? rows.map((s) => `${s.revoked_at ? '✕' : '●'} ${s.device_name ?? (s.user_agent ?? 'устройство').slice(0, 40)} · ${when(s.last_seen_at)}`) : ['Сеансов нет'], u.id);
  }),
  onUser(
    'user.warn',
    '/user.warn("ник", "текст")',
    'Предупреждение пользователю в уведомления',
    MOD,
    (u, { ctx, cmd }) => {
      const text = (cmd.pos[1] ?? cmd.named.text ?? '').slice(0, 280);
      if (!text) return fail('Напишите текст предупреждения', u.id);
      ctx.services.notifications.notify({ userId: u.id, type: 'app_message', link: '/help', preview: `Администрация Sunnet: ${text}` });
      return ok(`@${u.username} получил предупреждение`, u.id);
    },
    { notSelf: 'Себе предупреждение не нужно' },
  ),
  onUser('user.rename', '/user.rename("ник", "Новое имя")', 'Сменить отображаемое имя (оскорбительное и т. п.)', MOD, (u, { ctx, cmd }) => {
    const name = (cmd.pos[1] ?? '').trim().slice(0, 64);
    if (!name) return fail('Укажите новое имя', u.id);
    ctx.db.run('UPDATE users SET display_name = :n, updated_at = :now WHERE id = :id', { n: name, now: Date.now(), id: u.id });
    return ok(`@${u.username}: имя теперь «${name}»`, u.id);
  }),
  onUser('user.clearbio', '/user.clearbio("ник")', 'Очистить описание профиля', MOD, (u, { ctx }) => {
    ctx.db.run("UPDATE users SET bio = '', status_text = NULL, status_emoji = NULL WHERE id = :id", { id: u.id });
    return ok(`@${u.username}: описание и статус очищены`, u.id);
  }),
  onUser('user.unlock', '/user.unlock("ник")', 'Снять временную блокировку входа после неверных паролей', ADM, (u, { ctx }) => {
    ctx.db.run('UPDATE users SET failed_logins = 0, locked_until = NULL WHERE id = :id', { id: u.id });
    return ok(`@${u.username}: вход снова доступен`, u.id);
  }),
  onUser('user.posts', '/user.posts("ник", 10)', 'Последние публичные посты', MOD, (u, { ctx, cmd }) => {
    const rows = ctx.db.all<{ id: string; text: string; created_at: number; deleted_at: number | null }>(
      "SELECT id, text, created_at, deleted_at FROM posts WHERE author_id = :id AND visibility = 'public' ORDER BY created_at DESC LIMIT :n",
      { id: u.id, n: limitArg(cmd.pos[1], 10, 50) },
    );
    return ok(rows.length ? rows.map((p) => `${p.deleted_at ? '✕ ' : ''}${p.id} · ${when(p.created_at)} · ${p.text.slice(0, 70)}`) : ['Постов нет'], u.id);
  }),
  onUser('user.wipe_posts', '/user.wipe_posts("ник")', 'Скрыть все посты пользователя (спам-атака)', ADM, (u, { ctx }) => {
    const n = ctx.db.run('UPDATE posts SET deleted_at = :now WHERE author_id = :id AND deleted_at IS NULL', { now: Date.now(), id: u.id }).changes;
    return ok(`@${u.username}: скрыто постов — ${n}`, u.id);
  }),

  // ── Значки и роли ──
  onUser('badge.give', '/badge.give("ник", "verified")', 'Выдать галочку', ADM, (u, { ctx, cmd }) => {
    if ((cmd.pos[1] ?? 'verified') !== 'verified') return fail('Пока есть только значок "verified"', u.id);
    ctx.db.run('UPDATE users SET verified = 1 WHERE id = :id', { id: u.id });
    return ok(`@${u.username}: галочка выдана`, u.id);
  }),
  onUser('badge.take', '/badge.take("ник", "verified")', 'Снять галочку', ADM, (u, { ctx, cmd }) => {
    if ((cmd.pos[1] ?? 'verified') !== 'verified') return fail('Пока есть только значок "verified"', u.id);
    ctx.db.run('UPDATE users SET verified = 0 WHERE id = :id', { id: u.id });
    return ok(`@${u.username}: галочка снята`, u.id);
  }),
  {
    name: 'badge.list',
    usage: '/badge.list()',
    text: 'У кого есть галочка',
    role: MOD,
    run: ({ ctx }) => ok(ctx.db.all<UserRow>('SELECT username FROM users WHERE verified = 1 AND deleted_at IS NULL ORDER BY username LIMIT 200').map((u) => `✓ @${u.username}`)),
  },
  onUser('role.grant', '/role.grant("ник", "moderator")', 'Роль: user, moderator, admin', ADM, (u, { ctx, actor, cmd }) => {
    const role = cmd.pos[1] as Role;
    if (!['user', 'moderator', 'admin'].includes(role)) return fail('Роль: "user", "moderator" или "admin"', u.id);
    if (u.id === actor.userId && role !== 'admin') return fail('Нельзя понизить самого себя', u.id);
    ctx.db.run('UPDATE users SET role = :role WHERE id = :id', { role, id: u.id });
    return ok(`@${u.username} теперь ${role}`, u.id);
  }),

  // ── Контент ──
  {
    name: 'post.find',
    usage: '/post.find("id")',
    text: 'Пост: автор, текст, счётчики',
    role: MOD,
    run: ({ ctx, cmd }) => {
      const p = ctx.db.get<{ id: string; text: string; username: string; like_count: number; comment_count: number; view_count: number; created_at: number; deleted_at: number | null; visibility: string }>(
        'SELECT p.id, p.text, u.username, p.like_count, p.comment_count, p.view_count, p.created_at, p.deleted_at, p.visibility FROM posts p JOIN users u ON u.id = p.author_id WHERE p.id = :id',
        { id: cmd.pos[0] ?? '' },
      );
      if (!p) return fail('Пост не найден');
      return ok([`@${p.username} · ${when(p.created_at)} · ${p.visibility}${p.deleted_at ? ' · УДАЛЁН' : ''}`, p.text.slice(0, 300), `♥ ${p.like_count} · 💬 ${p.comment_count} · 👁 ${p.view_count}`], p.id);
    },
  },
  softDelete('post.delete', 'posts', 'пост'),
  softDelete('post.restore', 'posts', 'пост', true),
  {
    name: 'post.lock',
    usage: '/post.lock("id")',
    text: 'Закрыть комментарии к посту',
    role: MOD,
    run: ({ ctx, cmd }) => {
      const n = ctx.db.run('UPDATE posts SET comments_disabled = 1 WHERE id = :id', { id: cmd.pos[0] ?? '' }).changes;
      return n ? ok('Комментарии закрыты', cmd.pos[0]) : fail('Пост не найден');
    },
  },
  {
    name: 'post.unlock',
    usage: '/post.unlock("id")',
    text: 'Открыть комментарии к посту',
    role: MOD,
    run: ({ ctx, cmd }) => {
      const n = ctx.db.run('UPDATE posts SET comments_disabled = 0 WHERE id = :id', { id: cmd.pos[0] ?? '' }).changes;
      return n ? ok('Комментарии открыты', cmd.pos[0]) : fail('Пост не найден');
    },
  },
  {
    name: 'post.top',
    usage: '/post.top(10)',
    text: 'Самые популярные посты за неделю',
    role: MOD,
    run: ({ ctx, cmd }) =>
      ok(
        ctx.db
          .all<{ id: string; text: string; username: string; like_count: number; view_count: number }>(
            "SELECT p.id, p.text, u.username, p.like_count, p.view_count FROM posts p JOIN users u ON u.id = p.author_id WHERE p.deleted_at IS NULL AND p.visibility = 'public' AND p.created_at > :t ORDER BY p.like_count DESC, p.view_count DESC LIMIT :n",
            { t: Date.now() - 7 * DAY, n: limitArg(cmd.pos[0], 10, 50) },
          )
          .map((p) => `♥ ${p.like_count} · @${p.username} · ${p.id} · ${p.text.slice(0, 60)}`),
      ),
  },
  softDelete('comment.delete', 'comments', 'комментарий'),
  softDelete('comment.restore', 'comments', 'комментарий', true),
  softDelete('story.delete', 'stories', 'история'),
  {
    name: 'hashtag.top',
    usage: '/hashtag.top(15)',
    text: 'Популярные хэштеги',
    role: MOD,
    run: ({ ctx, cmd }) =>
      ok(ctx.db.all<{ tag: string; n: number }>('SELECT tag, count(*) n FROM post_hashtags GROUP BY tag ORDER BY n DESC LIMIT :n', { n: limitArg(cmd.pos[0], 15, 50) }).map((h) => `#${h.tag} · ${h.n}`)),
  },

  // ── Чаты и каналы (только публичные сведения, без чтения переписки) ──
  {
    name: 'chat.find',
    usage: '/chat.find("@канал или id")',
    text: 'Канал или группа: владелец, участники, режим',
    role: MOD,
    run: ({ ctx, cmd }) => {
      const key = (cmd.pos[0] ?? '').replace(/^@/, '');
      const c = ctx.db.get<{ id: string; type: string; title: string; handle: string | null; is_public: number; owner_id: string | null; slow_mode_sec: number }>(
        'SELECT id, type, title, handle, is_public, owner_id, slow_mode_sec FROM chats WHERE id = :k OR lower(handle) = lower(:k)',
        { k: key },
      );
      if (!c) return fail('Не найдено');
      if (c.type === 'direct' || c.type === 'secret') return fail('Личные переписки закрыты для администрации');
      const members = ctx.db.get<{ n: number }>('SELECT count(*) n FROM chat_members WHERE chat_id = :id', { id: c.id })?.n ?? 0;
      const owner = c.owner_id ? ctx.db.get<{ username: string }>('SELECT username FROM users WHERE id = :id', { id: c.owner_id })?.username : null;
      return ok([`${c.title} · ${c.type}${c.handle ? ` · @${c.handle}` : ''} · ${c.is_public ? 'публичный' : 'закрытый'}`, `Владелец: ${owner ? `@${owner}` : '—'} · участников: ${members} · медленный режим: ${c.slow_mode_sec || 'нет'}`], c.id);
    },
  },
  {
    name: 'chat.slowmode',
    usage: '/chat.slowmode("@канал", 30)',
    text: 'Медленный режим в публичной группе (секунды, 0 — выкл.)',
    role: MOD,
    run: ({ ctx, cmd }) => {
      const sec = Math.min(3600, Math.max(0, Number.parseInt(cmd.pos[1] ?? '', 10) || 0));
      const key = (cmd.pos[0] ?? '').replace(/^@/, '');
      const n = ctx.db.run("UPDATE chats SET slow_mode_sec = :s WHERE (id = :k OR lower(handle) = lower(:k)) AND type NOT IN ('direct', 'secret')", { s: sec, k: key }).changes;
      return n ? ok(`Медленный режим: ${sec ? `${sec} с` : 'выключен'}`, key) : fail('Публичная группа не найдена');
    },
  },
  {
    name: 'chat.top',
    usage: '/chat.top(10)',
    text: 'Крупнейшие публичные каналы и группы',
    role: MOD,
    run: ({ ctx, cmd }) =>
      ok(
        ctx.db
          .all<{ title: string; handle: string | null; n: number }>(
            'SELECT c.title, c.handle, count(m.user_id) n FROM chats c JOIN chat_members m ON m.chat_id = c.id WHERE c.is_public = 1 GROUP BY c.id ORDER BY n DESC LIMIT :n',
            { n: limitArg(cmd.pos[0], 10, 50) },
          )
          .map((c) => `${c.n} · ${c.title}${c.handle ? ` @${c.handle}` : ''}`),
      ),
  },

  // ── Жалобы ──
  {
    name: 'report.list',
    usage: '/report.list(20)',
    text: 'Открытые жалобы',
    role: MOD,
    run: ({ ctx, cmd }) => {
      const rows = ctx.db.all<{ id: string; entity_type: string; entity_id: string; reason: string; created_at: number }>(
        "SELECT id, entity_type, entity_id, reason, created_at FROM reports WHERE status = 'open' ORDER BY created_at LIMIT :n",
        { n: limitArg(cmd.pos[0]) },
      );
      return ok(rows.length ? rows.map((r) => `${r.id} · ${when(r.created_at)} · ${r.entity_type} ${r.entity_id} · ${r.reason}`) : ['Открытых жалоб нет']);
    },
  },
  ...(['resolve', 'reject'] as const).map(
    (kind): Command => ({
      name: `report.${kind}`,
      usage: `/report.${kind}("id")`,
      text: kind === 'resolve' ? 'Жалоба обоснована — закрыть' : 'Жалоба не подтвердилась — отклонить',
      role: MOD,
      run: ({ ctx, actor, cmd }) => {
        const n = ctx.db.run("UPDATE reports SET status = :s, resolved_at = :now, resolved_by = :by WHERE id = :id AND status = 'open'", {
          s: kind === 'resolve' ? 'resolved' : 'rejected',
          now: Date.now(),
          by: actor.userId,
          id: cmd.pos[0] ?? '',
        }).changes;
        return n ? ok(`Жалоба ${kind === 'resolve' ? 'закрыта' : 'отклонена'}`, cmd.pos[0]) : fail('Открытая жалоба не найдена');
      },
    }),
  ),
  {
    name: 'report.stats',
    usage: '/report.stats()',
    text: 'Жалобы по статусам и типам',
    role: MOD,
    run: ({ ctx }) =>
      ok(ctx.db.all<{ status: string; entity_type: string; n: number }>('SELECT status, entity_type, count(*) n FROM reports GROUP BY status, entity_type ORDER BY status').map((r) => `${r.status} · ${r.entity_type}: ${r.n}`)),
  },

  // ── Приложения Студии ──
  {
    name: 'app.pending',
    usage: '/app.pending()',
    text: 'Приложения на проверке',
    role: MOD,
    run: ({ ctx }) => {
      const rows = ctx.db.all<{ slug: string; name: string; version: number }>("SELECT slug, name, version FROM studio_apps WHERE review = 'pending' ORDER BY updated_at LIMIT 50");
      return ok(rows.length ? rows.map((r) => `${r.slug} · ${r.name} · v${r.version}`) : ['Очередь проверки пуста']);
    },
  },
  ...(['verify', 'reject'] as const).map(
    (kind): Command => ({
      name: `app.${kind}`,
      usage: kind === 'verify' ? '/app.verify("ссылка")' : '/app.reject("ссылка", reason: "…")',
      text: kind === 'verify' ? 'Проверено: в каталог со значком' : 'Отклонить проверку',
      role: ADM,
      run: ({ ctx, cmd }) => {
        const row = ctx.db.get<{ id: string; name: string }>('SELECT id, name FROM studio_apps WHERE slug = :s', { s: cmd.pos[0] ?? '' });
        if (!row) return fail(`Приложение «${cmd.pos[0] ?? ''}» не найдено`);
        ctx.db.run('UPDATE studio_apps SET review = :r WHERE id = :id', { r: kind === 'verify' ? 'verified' : 'rejected', id: row.id });
        return ok(`«${row.name}»: ${kind === 'verify' ? 'проверено, в каталоге' : 'проверка отклонена'}`, row.id);
      },
    }),
  ),
  {
    name: 'app.list',
    usage: '/app.list()',
    text: 'Все опубликованные приложения Студии',
    role: MOD,
    run: ({ ctx }) =>
      ok(ctx.db.all<{ slug: string; name: string; review: string; version: number }>('SELECT slug, name, review, version FROM studio_apps ORDER BY updated_at DESC LIMIT 100').map((a) => `${a.review === 'verified' ? '✓' : '·'} ${a.slug} · ${a.name} · v${a.version} · ${a.review}`)),
  },
  {
    name: 'app.unverify',
    usage: '/app.unverify("ссылка")',
    text: 'Снять отметку «проверено»',
    role: ADM,
    run: ({ ctx, cmd }) => {
      const n = ctx.db.run("UPDATE studio_apps SET review = 'none' WHERE slug = :s", { s: cmd.pos[0] ?? '' }).changes;
      return n ? ok('Отметка снята', cmd.pos[0]) : fail('Приложение не найдено');
    },
  },

  // ── Серверы пользователей ──
  {
    name: 'server.list',
    usage: '/server.list()',
    text: 'Серверы пользователей и их связь',
    role: MOD,
    run: ({ ctx }) =>
      ok(
        ctx.db
          .all<{ name: string; hosting: string; heartbeat_at: number | null; username: string }>('SELECT s.name, s.hosting, s.heartbeat_at, u.username FROM hosted_servers s JOIN users u ON u.id = s.owner_id ORDER BY s.created_at DESC LIMIT 100')
          .map((s) => `${s.heartbeat_at && s.heartbeat_at > Date.now() - 5 * 60_000 ? '●' : '○'} ${s.name} · ${s.hosting} · @${s.username}`),
      ),
  },

  // ── Статистика ──
  counter('stats.users', 'пользователей', 'users WHERE deleted_at IS NULL', 'created_at'),
  counter('stats.posts', 'постов', 'posts WHERE deleted_at IS NULL', 'created_at'),
  counter('stats.comments', 'комментариев', 'comments WHERE deleted_at IS NULL', 'created_at'),
  counter('stats.messages', 'сообщений', 'messages WHERE deleted_at IS NULL', 'created_at'),
  counter('stats.chats', 'чатов, групп и каналов', 'chats'),
  counter('stats.stories', 'историй', 'stories WHERE deleted_at IS NULL', 'created_at'),
  counter('stats.media', 'файлов', 'media WHERE deleted_at IS NULL', 'created_at'),
  counter('stats.reports', 'открытых жалоб', "reports WHERE status = 'open'", 'created_at'),
  counter('stats.sessions', 'активных сеансов', 'sessions WHERE revoked_at IS NULL', 'created_at'),
  counter('stats.servers', 'серверов пользователей', 'hosted_servers', 'created_at'),
  counter('stats.apps', 'приложений Студии', 'studio_apps', 'created_at'),
  counter('stats.communities', 'сообществ и компаний', 'spaces', 'created_at'),
  counter('stats.cloud', 'файлов и папок в облаках', 'desk_items', 'created_at'),
  {
    name: 'stats.all',
    usage: '/stats.all()',
    text: 'Сводка по всей платформе',
    role: MOD,
    run: async (r) => {
      const lines: string[] = [];
      for (const c of COMMANDS.filter((x) => x.name.startsWith('stats.') && x.name !== 'stats.all' && x.name !== 'stats.storage')) lines.push(...(await c.run(r)).lines);
      return ok(lines);
    },
  },
  {
    name: 'stats.storage',
    usage: '/stats.storage()',
    text: 'Объём файлов по типам',
    role: ADM,
    run: ({ ctx }) =>
      ok(ctx.db.all<{ kind: string; n: number; bytes: number }>('SELECT kind, count(*) n, coalesce(sum(size), 0) bytes FROM media WHERE deleted_at IS NULL GROUP BY kind').map((m) => `${m.kind}: ${m.n} шт · ${(m.bytes / 1048576).toFixed(1)} МБ`)),
  },

  // ── Система ──
  {
    name: 'system.health',
    usage: '/system.health()',
    text: 'Состояние сервера: память, время работы, база',
    role: ADM,
    run: ({ ctx }) => {
      const mem = process.memoryUsage();
      const t0 = Date.now();
      ctx.db.get('SELECT 1');
      return ok([`Работает ${(process.uptime() / 3600).toFixed(1)} ч · Node ${process.version}`, `Память: ${(mem.rss / 1048576).toFixed(0)} МБ · куча ${(mem.heapUsed / 1048576).toFixed(0)} МБ`, `База отвечает за ${Date.now() - t0} мс`]);
    },
  },
  {
    name: 'system.announce',
    usage: '/system.announce("текст")',
    text: 'Объявление всем в уведомления (до 500 последних активных)',
    role: ADM,
    run: ({ ctx, cmd }) => {
      const text = (cmd.pos[0] ?? '').slice(0, 280);
      if (!text) return fail('Напишите текст объявления');
      const rows = ctx.db.all<{ id: string }>('SELECT id FROM users WHERE deleted_at IS NULL ORDER BY last_seen_at DESC LIMIT 500');
      for (const u of rows) ctx.services.notifications.notify({ userId: u.id, type: 'app_message', link: '/', preview: `Sunnet: ${text}` });
      return ok(`Объявление отправлено: ${rows.length}`);
    },
  },

  // ── Журнал и справка ──
  {
    name: 'audit.show',
    usage: '/audit.show(20)',
    text: 'Последние команды консоли',
    role: ADM,
    run: ({ ctx, cmd }) => {
      const rows = ctx.db.all<{ command: string; result: string; created_at: number; username: string }>(
        'SELECT a.command, a.result, a.created_at, u.username FROM admin_audit a JOIN users u ON u.id = a.actor_id ORDER BY a.created_at DESC LIMIT :n',
        { n: limitArg(cmd.pos[0]) },
      );
      return ok(rows.length ? rows.map((r) => `${when(r.created_at)} @${r.username}: ${r.command} → ${r.result}`) : ['Журнал пуст']);
    },
  },
  onUser('audit.user', '/audit.user("ник")', 'Что делали с этим пользователем', ADM, (u, { ctx }) => {
    const rows = ctx.db.all<{ command: string; result: string; created_at: number; username: string }>(
      'SELECT a.command, a.result, a.created_at, u.username FROM admin_audit a JOIN users u ON u.id = a.actor_id WHERE a.target_id = :id ORDER BY a.created_at DESC LIMIT 30',
      { id: u.id },
    );
    return ok(rows.length ? rows.map((r) => `${when(r.created_at)} @${r.username}: ${r.command}`) : ['Записей нет'], u.id);
  }),
  {
    name: 'help.all',
    usage: '/help.all()',
    text: 'Список команд',
    role: MOD,
    run: ({ actor }) => ok(COMMANDS.filter((c) => c.role.includes(actor.role)).map((c) => `${c.usage} — ${c.text}`)),
  },
  {
    name: 'help.find',
    usage: '/help.find("блок")',
    text: 'Найти команду по слову',
    role: MOD,
    run: ({ actor, cmd }) => {
      const q = (cmd.pos[0] ?? '').toLowerCase();
      const found = COMMANDS.filter((c) => c.role.includes(actor.role) && (c.name.includes(q) || c.text.toLowerCase().includes(q)));
      return ok(found.length ? found.map((c) => `${c.usage} — ${c.text}`) : ['Ничего не нашлось']);
    },
  },
];

/**
 * Владелец платформы. Если среди настоящих пользователей (не демо @example.com и
 * не служебный аккаунт) ещё нет администратора — им становится самый первый
 * зарегистрированный. Так первый человек на новом сервере сразу получает консоль.
 */
export function ensureOwner(ctx: Pick<AppContext, 'db'>): string | null {
  const real = "deleted_at IS NULL AND username NOT IN ('sunnet', 'sunnet_official') AND (email IS NULL OR email NOT LIKE '%@example.com')";
  if (ctx.db.get(`SELECT 1 FROM users WHERE role = 'admin' AND ${real}`)) return null;
  const first = ctx.db.get<{ id: string; username: string }>(`SELECT id, username FROM users WHERE ${real} ORDER BY created_at LIMIT 1`);
  if (!first) return null;
  ctx.db.run("UPDATE users SET role = 'admin' WHERE id = :id", { id: first.id });
  ctx.db.run('INSERT INTO admin_audit (id, actor_id, command, target_id, result, created_at) VALUES (:id, :a, :c, :a, :r, :now)', {
    id: newId(),
    a: first.id,
    c: 'system.owner',
    r: 'ok: первый пользователь назначен администратором',
    now: Date.now(),
  });
  return first.username;
}
