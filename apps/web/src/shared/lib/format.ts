/** Форматирование для русского интерфейса: время, числа, склонения, длительность. */

export function plural(n: number, one: string, few: string, many: string): string {
  const abs = Math.abs(n) % 100;
  const last = abs % 10;
  if (abs > 10 && abs < 20) return many;
  if (last > 1 && last < 5) return few;
  if (last === 1) return one;
  return many;
}

export function compactNumber(n: number): string {
  if (n < 1000) return String(n);
  if (n < 10_000) return `${(n / 1000).toFixed(1).replace('.0', '').replace('.', ',')} тыс.`;
  if (n < 1_000_000) return `${Math.floor(n / 1000)} тыс.`;
  return `${(n / 1_000_000).toFixed(1).replace('.0', '').replace('.', ',')} млн`;
}

const rtf = new Intl.RelativeTimeFormat('ru', { numeric: 'auto' });
const timeFmt = new Intl.DateTimeFormat('ru', { hour: '2-digit', minute: '2-digit' });
const dayFmt = new Intl.DateTimeFormat('ru', { day: 'numeric', month: 'short' });
const dayYearFmt = new Intl.DateTimeFormat('ru', { day: 'numeric', month: 'short', year: 'numeric' });
const fullFmt = new Intl.DateTimeFormat('ru', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const weekdayFmt = new Intl.DateTimeFormat('ru', { weekday: 'short' });

export function timeAgo(iso: string): string {
  const diff = (Date.now() - Date.parse(iso)) / 1000;
  if (diff < 45) return 'только что';
  if (diff < 3600) return rtf.format(-Math.round(diff / 60), 'minute');
  if (diff < 86400) return rtf.format(-Math.round(diff / 3600), 'hour');
  if (diff < 7 * 86400) return rtf.format(-Math.round(diff / 86400), 'day');
  const d = new Date(iso);
  return d.getFullYear() === new Date().getFullYear() ? dayFmt.format(d) : dayYearFmt.format(d);
}

/** Короткое время для списка чатов: сегодня — часы, на неделе — день недели, иначе дата. */
export function chatTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return timeFmt.format(d);
  if (now.getTime() - d.getTime() < 6 * 86400_000) return weekdayFmt.format(d);
  return d.getFullYear() === now.getFullYear() ? dayFmt.format(d) : dayYearFmt.format(d);
}

export const clockTime = (iso: string) => timeFmt.format(new Date(iso));
export const fullDate = (iso: string) => fullFmt.format(new Date(iso));

export function dayLabel(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const yesterday = new Date(now.getTime() - 86400_000);
  if (d.toDateString() === now.toDateString()) return 'Сегодня';
  if (d.toDateString() === yesterday.toDateString()) return 'Вчера';
  return d.getFullYear() === now.getFullYear()
    ? new Intl.DateTimeFormat('ru', { day: 'numeric', month: 'long' }).format(d)
    : new Intl.DateTimeFormat('ru', { day: 'numeric', month: 'long', year: 'numeric' }).format(d);
}

export function lastSeen(p: { online: boolean; lastSeenAt: string | null } | null | undefined): string {
  if (!p) return 'был(а) недавно';
  if (p.online) return 'в сети';
  if (!p.lastSeenAt) return 'был(а) давно';
  const diff = (Date.now() - Date.parse(p.lastSeenAt)) / 1000;
  if (diff < 60) return 'был(а) только что';
  if (diff < 3600) return `был(а) ${Math.round(diff / 60)} ${plural(Math.round(diff / 60), 'минуту', 'минуты', 'минут')} назад`;
  if (diff < 86400) return `был(а) в ${clockTime(p.lastSeenAt)}`;
  return `был(а) ${dayFmt.format(new Date(p.lastSeenAt))}`;
}

export function duration(sec: number | null | undefined): string {
  if (!sec || !Number.isFinite(sec)) return '0:00';
  const s = Math.round(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${r}` : `${m}:${r}`;
}

export function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} КБ`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 / 1024).toFixed(1)} МБ`;
  return `${(bytes / 1024 ** 3).toFixed(2)} ГБ`;
}

export const views = (n: number) => `${compactNumber(n)} ${plural(n, 'просмотр', 'просмотра', 'просмотров')}`;
export const members = (n: number, kind: 'group' | 'channel' = 'group') =>
  kind === 'channel'
    ? `${compactNumber(n)} ${plural(n, 'подписчик', 'подписчика', 'подписчиков')}`
    : `${compactNumber(n)} ${plural(n, 'участник', 'участника', 'участников')}`;

export function cn(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

/** Случайный идентификатор (для clientId сообщений и deviceId). */
export function randomId(bytes = 16): string {
  const arr = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...arr)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Цвет-заглушка аватара, стабильный для id. */
export function hueFor(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h % 360;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '?') + (parts[1]?.[0] ?? '')).toUpperCase();
}

const EMOJI_ONLY = /^(?:\p{Extended_Pictographic}(?:️|\p{Emoji_Modifier}|‍\p{Extended_Pictographic}️?)*|\p{Regional_Indicator}{2}|\s)+$/u;

/** Сообщение только из 1–3 эмодзи показывается крупно, без «пузыря». */
export function isJumboEmoji(text: string | null | undefined): boolean {
  if (!text || text.length > 40 || !EMOJI_ONLY.test(text)) return false;
  const count = [...new Intl.Segmenter('ru', { granularity: 'grapheme' }).segment(text.trim())].filter((s) => s.segment.trim()).length;
  return count >= 1 && count <= 3;
}

/** Короткое описание сообщения для списков и уведомлений. */
export function messageLabel(kind: string, text: string | null | undefined): string {
  switch (kind) {
    case 'voice':
      return '🎤 Голосовое сообщение';
    case 'round':
      return '📹 Видеосообщение';
    case 'poll':
      return `📊 ${text ?? 'Опрос'}`;
    case 'call':
      return `📞 ${text ?? 'Звонок'}`;
    case 'encrypted':
      return '🔒 Зашифрованное сообщение';
    case 'media':
      return text || '📎 Вложение';
    default:
      return text ?? '';
  }
}

/** Что делает собеседник: «печатает…», «записывает голосовое…» */
export function activityLabel(activity: string, name?: string): string {
  const who = name ? `${name} ` : '';
  if (activity === 'voice') return `${who}записывает голосовое…`;
  if (activity === 'round') return `${who}записывает видео…`;
  return `${who}печатает…`;
}
