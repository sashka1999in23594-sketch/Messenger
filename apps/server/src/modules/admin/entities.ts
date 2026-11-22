/**
 * Семейства команд по сущностям платформы: user.count(), post.week(), channel.top("member_count"),
 * server.growth(14), payment.recent(10)… Для каждой сущности — одинаковые глаголы, поэтому язык
 * консоли легко запомнить: выучил один раздел — знаешь все.
 *
 * Безопасность: колонки берутся только из белого списка и сверяются с базой (PRAGMA) при запуске;
 * пароли, токены, IP-адреса, ключи, тексты личных сообщений и почта сюда не попадают никогда.
 * SQL собирается только из имён этого файла, значения пользователя — только параметрами.
 */
import type { Ctx } from '../../context.js';
import type { Command, Result } from './commands.js';

const DAY = 86_400_000;

interface Entity {
  /** Имя раздела в консоли */
  name: string;
  /** Как называется во множественном числе (для вывода) */
  label: string;
  table: string;
  /** Колонка времени создания */
  time: string;
  /** Колонка автора/владельца — для .by("ник") */
  owner?: string;
  /** Ключ для .find("…") */
  key?: string;
  /** Безопасные поля для вывода */
  fields: string[];
  /** Числовые поля для .top() */
  numeric?: string[];
  /** Колонка мягкого удаления */
  deleted?: string;
  /** Постоянное условие (например, только публичные каналы) */
  where?: string;
  /** Только счётчики — содержимое не показывается (сообщения) */
  countOnly?: boolean;
}

const ENTITIES: Entity[] = [
  { name: 'user', label: 'пользователей', table: 'users', time: 'created_at', key: 'username', fields: ['username', 'display_name', 'role', 'verified', 'created_at', 'last_seen_at', 'blocked_until'], deleted: 'deleted_at' },
  { name: 'post', label: 'постов', table: 'posts', time: 'created_at', owner: 'author_id', key: 'id', fields: ['id', 'kind', 'text', 'visibility', 'like_count', 'comment_count', 'repost_count', 'view_count', 'created_at'], numeric: ['like_count', 'comment_count', 'repost_count', 'view_count'], deleted: 'deleted_at', where: "visibility = 'public'" },
  { name: 'video', label: 'видео', table: 'posts', time: 'created_at', owner: 'author_id', key: 'id', fields: ['id', 'title', 'like_count', 'view_count', 'created_at'], numeric: ['like_count', 'view_count', 'comment_count'], deleted: 'deleted_at', where: "kind = 'video' AND visibility = 'public'" },
  { name: 'reel', label: 'Reels', table: 'posts', time: 'created_at', owner: 'author_id', key: 'id', fields: ['id', 'text', 'like_count', 'view_count', 'created_at'], numeric: ['like_count', 'view_count', 'comment_count'], deleted: 'deleted_at', where: "kind = 'short' AND visibility = 'public'" },
  { name: 'comment', label: 'комментариев', table: 'comments', time: 'created_at', owner: 'author_id', key: 'id', fields: ['id', 'post_id', 'text', 'like_count', 'reply_count', 'created_at'], numeric: ['like_count', 'reply_count'], deleted: 'deleted_at' },
  { name: 'story', label: 'историй', table: 'stories', time: 'created_at', owner: 'author_id', key: 'id', fields: ['id', 'text', 'audience', 'created_at', 'expires_at'], deleted: 'deleted_at', where: "audience = 'all' OR audience IS NULL" },
  { name: 'channel', label: 'публичных каналов', table: 'chats', time: 'created_at', owner: 'owner_id', key: 'handle', fields: ['id', 'title', 'handle', 'member_count', 'created_at'], numeric: ['member_count'], deleted: 'deleted_at', where: "type = 'channel' AND is_public = 1" },
  { name: 'group', label: 'публичных групп', table: 'chats', time: 'created_at', owner: 'owner_id', key: 'handle', fields: ['id', 'title', 'handle', 'member_count', 'slow_mode_sec', 'created_at'], numeric: ['member_count'], deleted: 'deleted_at', where: "type = 'group' AND is_public = 1" },
  { name: 'community', label: 'сообществ', table: 'spaces', time: 'created_at', owner: 'owner_id', key: 'slug', fields: ['id', 'name', 'slug', 'member_count', 'is_public', 'created_at'], numeric: ['member_count'], deleted: 'deleted_at', where: "kind = 'community'" },
  { name: 'company', label: 'компаний', table: 'spaces', time: 'created_at', owner: 'owner_id', key: 'slug', fields: ['id', 'name', 'slug', 'member_count', 'is_public', 'created_at'], numeric: ['member_count'], deleted: 'deleted_at', where: "kind = 'company'" },
  { name: 'server', label: 'серверов пользователей', table: 'hosted_servers', time: 'created_at', owner: 'owner_id', key: 'id', fields: ['id', 'name', 'hosting', 'access', 'created_at', 'heartbeat_at'] },
  { name: 'app', label: 'приложений Студии', table: 'studio_apps', time: 'created_at', owner: 'owner_id', key: 'slug', fields: ['slug', 'name', 'version', 'review', 'created_at', 'updated_at'], numeric: ['version'] },
  { name: 'payment', label: 'платежей', table: 'studio_payments', time: 'created_at', owner: 'payer_id', key: 'id', fields: ['id', 'amount_kop', 'method', 'provider', 'status', 'description', 'created_at', 'paid_at'], numeric: ['amount_kop'] },
  { name: 'report', label: 'жалоб', table: 'reports', time: 'created_at', owner: 'reporter_id', key: 'id', fields: ['id', 'entity_type', 'entity_id', 'reason', 'status', 'created_at'] },
  { name: 'file', label: 'файлов', table: 'media', time: 'created_at', owner: 'owner_id', key: 'id', fields: ['id', 'kind', 'mime', 'size', 'width', 'height', 'duration_sec', 'created_at'], numeric: ['size', 'duration_sec'], deleted: 'deleted_at' },
  { name: 'stream', label: 'трансляций', table: 'live_streams', time: 'started_at', owner: 'owner_id', key: 'id', fields: ['id', 'title', 'status', 'peak_viewers', 'total_viewers', 'started_at', 'ended_at'], numeric: ['peak_viewers', 'total_viewers'] },
  { name: 'playlist', label: 'плейлистов', table: 'playlists', time: 'created_at', owner: 'owner_id', key: 'id', fields: ['id', 'title', 'is_public', 'created_at'], where: 'is_public = 1' },
  { name: 'call', label: 'звонков', table: 'call_rooms', time: 'created_at', owner: 'owner_id', key: 'id', fields: ['id', 'video', 'status', 'created_at', 'ended_at'] },
  { name: 'session', label: 'сеансов', table: 'sessions', time: 'created_at', owner: 'user_id', key: 'id', fields: ['id', 'device_name', 'created_at', 'last_seen_at', 'expires_at', 'revoked_at'] },
  { name: 'notification', label: 'уведомлений', table: 'notifications', time: 'created_at', owner: 'user_id', key: 'id', fields: ['id', 'type', 'entity_type', 'read_at', 'created_at'] },
  { name: 'cloud', label: 'файлов и папок рабочих столов', table: 'desk_items', time: 'created_at', owner: 'user_id', key: 'id', fields: ['id', 'kind', 'name', 'created_at', 'trashed_at'], deleted: 'trashed_at' },
  { name: 'subscription', label: 'подписок на сервисы', table: 'subscriptions', time: 'created_at', owner: 'user_id', key: 'id', fields: ['id', 'name', 'price_cents', 'currency', 'period', 'created_at'], numeric: ['price_cents'] },
  { name: 'bridge', label: 'подключённых мессенджеров', table: 'bridge_links', time: 'created_at', owner: 'user_id', key: 'id', fields: ['id', 'service', 'created_at'] },
  { name: 'follow', label: 'подписок', table: 'follows', time: 'created_at', owner: 'follower_id', fields: ['follower_id', 'followee_id', 'status', 'created_at'] },
  { name: 'like', label: 'лайков', table: 'post_likes', time: 'created_at', owner: 'user_id', fields: ['post_id', 'created_at'] },
  { name: 'bookmark', label: 'закладок', table: 'bookmarks', time: 'created_at', owner: 'user_id', fields: ['post_id', 'created_at'] },
  { name: 'hashtag', label: 'использований хэштегов', table: 'post_hashtags', time: 'created_at', fields: ['tag', 'post_id', 'created_at'] },
  { name: 'poll', label: 'опросов', table: 'polls', time: 'created_at', owner: 'creator_id', key: 'id', fields: ['id', 'question', 'multiple', 'anonymous', 'closed_at', 'created_at'] },
  { name: 'invite', label: 'приглашений в чаты', table: 'chat_invites', time: 'created_at', owner: 'creator_id', fields: ['title', 'uses', 'usage_limit', 'expires_at', 'revoked_at', 'created_at'], numeric: ['uses'] },
  { name: 'draft', label: 'черновиков', table: 'post_drafts', time: 'created_at', owner: 'author_id', key: 'id', fields: ['id', 'publish_at', 'created_at', 'updated_at'] },
  { name: 'security', label: 'событий безопасности', table: 'security_events', time: 'created_at', owner: 'user_id', key: 'id', fields: ['id', 'type', 'created_at'] },
  { name: 'view', label: 'просмотров', table: 'view_history', time: 'viewed_at', owner: 'user_id', fields: ['post_id', 'progress_sec', 'viewed_at'], numeric: ['progress_sec'] },
  // Личные сообщения: только числа, содержимое закрыто
  { name: 'message', label: 'сообщений', table: 'messages', time: 'created_at', owner: 'sender_id', fields: [], deleted: 'deleted_at', countOnly: true },
];

const fmtVal = (k: string, v: unknown) => {
  if (v === null || v === undefined) return '—';
  if (/_at$|_until$/.test(k) && typeof v === 'number') return new Date(v).toISOString().slice(0, 16).replace('T', ' ');
  if (k === 'amount_kop' || k === 'price_cents') return `${(Number(v) / 100).toFixed(2)} ₽`;
  if (k === 'size' && typeof v === 'number') return `${(v / 1048576).toFixed(2)} МБ`;
  return String(v).replace(/\s+/g, ' ').slice(0, 80);
};
export const rowLine = (r: Record<string, unknown>) =>
  Object.entries(r)
    .slice(0, 7)
    .map(([k, v]) => `${k}: ${fmtVal(k, v)}`)
    .join(' · ');
const spark = (ns: number[]) => {
  const bars = '▁▂▃▄▅▆▇█';
  const max = Math.max(1, ...ns);
  return ns.map((n) => bars[Math.min(7, Math.round((n / max) * 7))]).join('');
};
const lim = (v: string | undefined, d = 10, max = 200) => Math.min(max, Math.max(1, Number.parseInt(v ?? '', 10) || d));

export function entityCommands(ctx: Ctx): Command[] {
  const { db } = ctx;
  const out: Command[] = [];
  const ok = (lines: string[], rows?: Record<string, unknown>[]): Result => ({ ok: true, lines: lines.length ? lines : ['Пусто'], rows });
  const fail = (line: string): Result => ({ ok: false, lines: [line] });

  for (const e of ENTITIES) {
    let cols: string[];
    try {
      cols = db.all<{ name: string }>(`PRAGMA table_info(${e.table})`).map((c) => c.name);
    } catch {
      continue;
    }
    if (!cols.length || !cols.includes(e.time)) continue;
    const fields = e.fields.filter((f) => cols.includes(f));
    const numeric = (e.numeric ?? []).filter((f) => cols.includes(f));
    const owner = e.owner && cols.includes(e.owner) ? e.owner : undefined;
    const del = e.deleted && cols.includes(e.deleted) ? e.deleted : undefined;
    const base = [e.where ? `(${e.where})` : '', del ? `${del} IS NULL` : ''].filter(Boolean).join(' AND ') || '1 = 1';
    const sel = fields.length ? fields.join(', ') : 'rowid';
    const add = (verb: string, usage: string, text: string, run: Command['run']) => out.push({ name: `${e.name}.${verb}`, usage, text, role: ['admin'], run });
    const countSince = (ms: number) => db.get<{ n: number }>(`SELECT count(*) n FROM ${e.table} WHERE ${base} AND ${e.time} > :t`, { t: Date.now() - ms })?.n ?? 0;
    const listRows = (sql: string, params: Record<string, unknown>) => {
      const rows = db.all<Record<string, unknown>>(sql, params as never);
      return ok(rows.map(rowLine), rows);
    };
    const userId = (nick: string | undefined) => db.get<{ id: string }>('SELECT id FROM users WHERE lower(username) = lower(:u)', { u: (nick ?? '').replace(/^@/, '') })?.id;

    add('count', `/${e.name}.count()`, `Сколько всего ${e.label}`, () => ok([`${e.label}: ${db.get<{ n: number }>(`SELECT count(*) n FROM ${e.table} WHERE ${base}`)?.n ?? 0}`]));
    for (const [verb, ms, word] of [
      ['today', DAY, 'за сутки'],
      ['week', 7 * DAY, 'за неделю'],
      ['month', 30 * DAY, 'за месяц'],
      ['year', 365 * DAY, 'за год'],
    ] as const)
      add(verb, `/${e.name}.${verb}()`, `Новых ${e.label} ${word}`, () => ok([`${e.label} ${word}: +${countSince(ms)}`]));
    add('growth', `/${e.name}.growth(14)`, `Рост ${e.label} по дням, с графиком`, ({ cmd }) => {
      const days = lim(cmd.pos[0], 14, 90);
      const start = Date.now() - days * DAY;
      const rows = db.all<{ d: number; n: number }>(`SELECT CAST((${e.time} - :s) / ${DAY} AS INTEGER) d, count(*) n FROM ${e.table} WHERE ${base} AND ${e.time} > :s GROUP BY d`, { s: start });
      const ns = Array.from({ length: days }, (_, i) => rows.find((r) => r.d === i)?.n ?? 0);
      return ok([`${spark(ns)}  (${days} дн., всего +${ns.reduce((a, b) => a + b, 0)}, максимум ${Math.max(...ns)} в день)`], ns.map((n, i) => ({ day: new Date(start + i * DAY).toISOString().slice(0, 10), n })));
    });
    add('hour', `/${e.name}.hour()`, `Новых ${e.label} за последний час`, () => ok([`${e.label} за час: +${countSince(3_600_000)}`]));
    add('yesterday', `/${e.name}.yesterday()`, `Сколько ${e.label} появилось вчера`, () => {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const n = db.get<{ n: number }>(`SELECT count(*) n FROM ${e.table} WHERE ${base} AND ${e.time} >= :a AND ${e.time} < :b`, { a: today.getTime() - DAY, b: today.getTime() })?.n ?? 0;
      return ok([`${e.label} вчера: ${n}`]);
    });
    add('compare', `/${e.name}.compare()`, `${e.label}: эта неделя против прошлой`, () => {
      const now = Date.now();
      const cur = db.get<{ n: number }>(`SELECT count(*) n FROM ${e.table} WHERE ${base} AND ${e.time} > :a`, { a: now - 7 * DAY })?.n ?? 0;
      const prev = db.get<{ n: number }>(`SELECT count(*) n FROM ${e.table} WHERE ${base} AND ${e.time} > :a AND ${e.time} <= :b`, { a: now - 14 * DAY, b: now - 7 * DAY })?.n ?? 0;
      const pct = prev ? Math.round(((cur - prev) / prev) * 100) : cur ? 100 : 0;
      return ok([`${e.label}: ${cur} за неделю, было ${prev} — ${pct >= 0 ? '▲ +' : '▼ '}${pct}%`]);
    });
    add('weekdays', `/${e.name}.weekdays()`, `${e.label} по дням недели`, () => {
      const names = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
      const rows = db.all<{ d: number; n: number }>(`SELECT CAST(strftime('%w', ${e.time} / 1000, 'unixepoch') AS INTEGER) d, count(*) n FROM ${e.table} WHERE ${base} GROUP BY d`);
      const ns = [1, 2, 3, 4, 5, 6, 0].map((d) => rows.find((r) => r.d === d)?.n ?? 0);
      return ok([`${spark(ns)}  пн…вс`, ...[1, 2, 3, 4, 5, 6, 0].map((d, i) => `${names[d]}: ${ns[i]}`)]);
    });
    add('hours', `/${e.name}.hours()`, `${e.label} по часам суток (UTC)`, () => {
      const rows = db.all<{ h: number; n: number }>(`SELECT CAST(strftime('%H', ${e.time} / 1000, 'unixepoch') AS INTEGER) h, count(*) n FROM ${e.table} WHERE ${base} GROUP BY h`);
      const ns = Array.from({ length: 24 }, (_, h) => rows.find((r) => r.h === h)?.n ?? 0);
      const peak = ns.indexOf(Math.max(...ns));
      return ok([`${spark(ns)}  0…23 ч`, `Пик: ${peak}:00 (${ns[peak]})`]);
    });
    add('months', `/${e.name}.months()`, `${e.label} по месяцам за год`, () => {
      const rows = db.all<{ m: string; n: number }>(`SELECT strftime('%Y-%m', ${e.time} / 1000, 'unixepoch') m, count(*) n FROM ${e.table} WHERE ${base} AND ${e.time} > :t GROUP BY m ORDER BY m`, { t: Date.now() - 365 * DAY });
      return ok(rows.map((r) => `${r.m}: ${r.n}`), rows);
    });
    add('since', `/${e.name}.since("2026-01-01")`, `Сколько ${e.label} с указанной даты`, ({ cmd }) => {
      const t = Date.parse(cmd.pos[0] ?? '');
      if (Number.isNaN(t)) return fail('Дата в формате ГГГГ-ММ-ДД');
      return ok([`${e.label} с ${cmd.pos[0]}: ${db.get<{ n: number }>(`SELECT count(*) n FROM ${e.table} WHERE ${base} AND ${e.time} >= :t`, { t })?.n ?? 0}`]);
    });
    add('between', `/${e.name}.between("2026-01-01", "2026-02-01")`, `Сколько ${e.label} между датами`, ({ cmd }) => {
      const a = Date.parse(cmd.pos[0] ?? '');
      const b = Date.parse(cmd.pos[1] ?? '');
      if (Number.isNaN(a) || Number.isNaN(b)) return fail('Две даты в формате ГГГГ-ММ-ДД');
      return ok([`${e.label} ${cmd.pos[0]} — ${cmd.pos[1]}: ${db.get<{ n: number }>(`SELECT count(*) n FROM ${e.table} WHERE ${base} AND ${e.time} >= :a AND ${e.time} < :b`, { a, b })?.n ?? 0}`]);
    });
    if (owner) {
      add('by', `/${e.name}.by("ник")`, `Сколько ${e.label} у пользователя`, ({ cmd }) => {
        const id = userId(cmd.pos[0]);
        if (!id) return fail(`Пользователь «${cmd.pos[0] ?? ''}» не найден`);
        return ok([`${e.label} у @${(cmd.pos[0] ?? '').replace(/^@/, '')}: ${db.get<{ n: number }>(`SELECT count(*) n FROM ${e.table} WHERE ${base} AND ${owner} = :id`, { id })?.n ?? 0}`]);
      });
      add('leaders', `/${e.name}.leaders(10)`, `У кого больше всего ${e.label}`, ({ cmd }) => {
        const rows = db.all<{ username: string; n: number }>(
          `SELECT u.username, count(*) n FROM ${e.table} x JOIN users u ON u.id = x.${owner} WHERE ${base.replace(/\b(deleted_at|trashed_at|visibility|kind|type|is_public|audience)\b/g, 'x.$1')} GROUP BY x.${owner} ORDER BY n DESC LIMIT :n`,
          { n: lim(cmd.pos[0]) },
        );
        return ok(rows.map((r, i) => `${i + 1}. @${r.username} — ${r.n}`), rows);
      });
    }
    if (e.countOnly) continue;

    add('recent', `/${e.name}.recent(10)`, `Последние ${e.label}`, ({ cmd }) => listRows(`SELECT ${sel} FROM ${e.table} WHERE ${base} ORDER BY ${e.time} DESC LIMIT :n`, { n: lim(cmd.pos[0]) }));
    add('oldest', `/${e.name}.oldest(10)`, `Самые первые ${e.label}`, ({ cmd }) => listRows(`SELECT ${sel} FROM ${e.table} WHERE ${base} ORDER BY ${e.time} ASC LIMIT :n`, { n: lim(cmd.pos[0]) }));
    add('first', `/${e.name}.first()`, `Самая первая запись: ${e.label}`, () => listRows(`SELECT ${sel} FROM ${e.table} WHERE ${base} ORDER BY ${e.time} ASC LIMIT 1`, {}));
    add('last', `/${e.name}.last()`, `Самая свежая запись: ${e.label}`, () => listRows(`SELECT ${sel} FROM ${e.table} WHERE ${base} ORDER BY ${e.time} DESC LIMIT 1`, {}));
    add('random', `/${e.name}.random()`, `Случайная запись: ${e.label}`, () => listRows(`SELECT ${sel} FROM ${e.table} WHERE ${base} ORDER BY random() LIMIT 1`, {}));
    add('fields', `/${e.name}.fields()`, `Какие поля есть у ${e.label}`, () => ok([fields.join(', ') || 'Нет открытых полей']));
    add('export', `/${e.name}.export(50)`, `Выгрузка ${e.label} строками CSV`, ({ cmd }) => {
      const rows = db.all<Record<string, unknown>>(`SELECT ${sel} FROM ${e.table} WHERE ${base} ORDER BY ${e.time} DESC LIMIT :n`, { n: lim(cmd.pos[0], 50, 500) });
      return ok([fields.join(';'), ...rows.map((r) => fields.map((f) => String(r[f] ?? '').replace(/[;\n]/g, ' ')).join(';'))], rows);
    });
    if (e.key && cols.includes(e.key)) {
      const key = e.key;
      add('find', `/${e.name}.find("${key === 'username' ? 'ник' : key}")`, `Найти: ${e.label}`, ({ cmd }) => {
        const v = (cmd.pos[0] ?? '').replace(/^@/, '');
        return listRows(`SELECT ${sel} FROM ${e.table} WHERE ${base} AND lower(${key}) = lower(:v) LIMIT 1`, { v });
      });
    }
    const textCol = ['text', 'title', 'name', 'display_name', 'question', 'tag'].find((c) => fields.includes(c));
    if (textCol) {
      add('search', `/${e.name}.search("слово")`, `Поиск по ${e.label}`, ({ cmd }) =>
        listRows(`SELECT ${sel} FROM ${e.table} WHERE ${base} AND ${textCol} LIKE :q ORDER BY ${e.time} DESC LIMIT 30`, { q: `%${(cmd.pos[0] ?? '').replace(/[%_]/g, '')}%` }),
      );
    }
    if (owner) {
      add('of', `/${e.name}.of("ник", 10)`, `Последние ${e.label} пользователя`, ({ cmd }) => {
        const id = userId(cmd.pos[0]);
        if (!id) return fail(`Пользователь «${cmd.pos[0] ?? ''}» не найден`);
        return listRows(`SELECT ${sel} FROM ${e.table} WHERE ${base} AND ${owner} = :id ORDER BY ${e.time} DESC LIMIT :n`, { id, n: lim(cmd.pos[1]) });
      });
    }
    if (numeric.length) {
      add('top', `/${e.name}.top("${numeric[0]}", 10)`, `Лучшие ${e.label} по полю (${numeric.join(', ')})`, ({ cmd }) => {
        const f = cmd.pos[0] ?? numeric[0]!;
        if (!numeric.includes(f)) return fail(`Можно сортировать по: ${numeric.join(', ')}`);
        return listRows(`SELECT ${sel} FROM ${e.table} WHERE ${base} ORDER BY ${f} DESC LIMIT :n`, { n: lim(cmd.pos[1]) });
      });
      for (const f of numeric) {
        add(`sum_${f}`, `/${e.name}.sum_${f}()`, `Сумма ${f} по всем ${e.label}`, () => ok([`${f}: ${fmtVal(f, db.get<{ s: number }>(`SELECT coalesce(sum(${f}), 0) s FROM ${e.table} WHERE ${base}`)?.s ?? 0)}`]));
        add(`avg_${f}`, `/${e.name}.avg_${f}()`, `Среднее ${f} у ${e.label}`, () => ok([`${f} в среднем: ${(db.get<{ a: number }>(`SELECT coalesce(avg(${f}), 0) a FROM ${e.table} WHERE ${base}`)?.a ?? 0).toFixed(2)}`]));
        add(`min_${f}`, `/${e.name}.min_${f}()`, `Минимум ${f} среди ${e.label}`, () => ok([`${f} минимум: ${fmtVal(f, db.get<{ m: number }>(`SELECT coalesce(min(${f}), 0) m FROM ${e.table} WHERE ${base}`)?.m ?? 0)}`]));
        add(`max_${f}`, `/${e.name}.max_${f}()`, `Максимум ${f} среди ${e.label}`, () => ok([`${f} максимум: ${fmtVal(f, db.get<{ m: number }>(`SELECT coalesce(max(${f}), 0) m FROM ${e.table} WHERE ${base}`)?.m ?? 0)}`]));
      }
    }
    // Разбивка по категориальным полям
    for (const f of ['kind', 'role', 'status', 'type', 'method', 'service', 'hosting', 'review', 'visibility', 'mime', 'period', 'entity_type', 'access'].filter((c) => fields.includes(c))) {
      add(`by_${f}`, `/${e.name}.by_${f}()`, `${e.label}: разбивка по ${f}`, () => {
        const rows = db.all<{ v: string; n: number }>(`SELECT ${f} v, count(*) n FROM ${e.table} WHERE ${base} GROUP BY ${f} ORDER BY n DESC LIMIT 30`);
        return ok(rows.map((r) => `${r.v ?? '—'}: ${r.n}`), rows);
      });
    }
    if (del) add('deleted', `/${e.name}.deleted(10)`, `Удалённые ${e.label}`, ({ cmd }) => listRows(`SELECT ${sel} FROM ${e.table} WHERE ${e.where ? `(${e.where}) AND ` : ''}${del} IS NOT NULL ORDER BY ${del} DESC LIMIT :n`, { n: lim(cmd.pos[0]) }));
  }
  return out;
}
