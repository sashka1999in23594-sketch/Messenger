/**
 * Разбор текста: хэштеги, упоминания, ссылки. Используется сервером (индексация
 * хэштегов, уведомления об упоминаниях) и клиентом (безопасный рендер без HTML).
 */

const HASHTAG_RE = /(^|[^\p{L}\p{N}_&])#([\p{L}\p{N}_]{1,64})/gu;
const MENTION_RE = /(^|[^\p{L}\p{N}_@])@([a-z0-9_]{3,32})/giu;
const TOKEN_RE =
  /(https?:\/\/[^\s<>"'`]+[^\s<>"'`.,;:!?)\]}»])|(^|[^\p{L}\p{N}_&])#([\p{L}\p{N}_]{1,64})|(^|[^\p{L}\p{N}_@])@([a-z0-9_]{3,32})/giu;

export function extractHashtags(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(HASHTAG_RE)) {
    const tag = m[2];
    if (tag && !/^\d+$/.test(tag)) out.add(tag.toLowerCase());
    if (out.size >= 30) break;
  }
  return [...out];
}

export function extractMentions(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(MENTION_RE)) {
    if (m[2]) out.add(m[2].toLowerCase());
    if (out.size >= 30) break;
  }
  return [...out];
}

export type TextToken =
  | { type: 'text'; value: string }
  | { type: 'url'; value: string; href: string }
  | { type: 'hashtag'; value: string; tag: string }
  | { type: 'mention'; value: string; username: string };

/** Разбивает текст на токены. Только http/https ссылки становятся ссылками. */
export function tokenizeText(text: string): TextToken[] {
  const tokens: TextToken[] = [];
  let last = 0;
  const push = (value: string) => {
    if (!value) return;
    const prev = tokens[tokens.length - 1];
    if (prev && prev.type === 'text') prev.value += value;
    else tokens.push({ type: 'text', value });
  };
  for (const m of text.matchAll(TOKEN_RE)) {
    const start = m.index ?? 0;
    push(text.slice(last, start));
    if (m[1]) {
      tokens.push({ type: 'url', value: m[1], href: m[1] });
    } else if (m[3] !== undefined) {
      push(m[2] ?? '');
      tokens.push({ type: 'hashtag', value: `#${m[3]}`, tag: m[3].toLowerCase() });
    } else if (m[5] !== undefined) {
      push(m[4] ?? '');
      tokens.push({ type: 'mention', value: `@${m[5]}`, username: m[5].toLowerCase() });
    }
    last = start + m[0].length;
  }
  push(text.slice(last));
  return tokens;
}

/** Короткий превью-текст (для списков чатов, уведомлений). */
export function excerpt(text: string | null | undefined, max = 120): string {
  if (!text) return '';
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/**
 * Номер телефона в формате E.164: «+79991234567». Пробелы, скобки и дефисы
 * игнорируются; российский «8…» превращается в «+7…». null — не похоже на номер.
 */
export function normalizePhone(raw: string): string | null {
  let s = raw.trim().replace(/[\s()\-.]/g, '');
  if (/^8\d{10}$/.test(s)) s = `+7${s.slice(1)}`;
  else if (/^7\d{10}$/.test(s)) s = `+${s}`;
  else if (/^\d{10,15}$/.test(s)) s = `+${s}`;
  return /^\+[1-9]\d{9,14}$/.test(s) ? s : null;
}

/** Похоже ли на номер телефона (для поиска) */
export function looksLikePhone(raw: string): boolean {
  return /^\+?[\d\s()\-.]{10,20}$/.test(raw.trim()) && (raw.match(/\d/g)?.length ?? 0) >= 10;
}

/** «+79991234567» → «+7 999 123-45-67» (для российских), иначе как есть */
export function formatPhone(e164: string): string {
  const m = /^\+7(\d{3})(\d{3})(\d{2})(\d{2})$/.exec(e164);
  return m ? `+7 ${m[1]} ${m[2]}-${m[3]}-${m[4]}` : e164;
}

/** Невидимые «хвосты» эмодзи: селекторы вариантов, модификаторы цвета кожи, клавиша-рамка, теги флагов. */
const EMOJI_JOINERS = /[\u{FE00}-\u{FE0F}\u{20E3}\u{1F3FB}-\u{1F3FF}\u{E0020}-\u{E007F}\u200D]/gu;

/**
 * Имя при вводе и вставке: остаются буквы любых алфавитов, цифры, пробел и
 * одиночные . ' ’ - _ — эмодзи и «самодельные» смайлики вроде :) не проходят.
 */
export function sanitizeName(raw: string, max = 64): string {
  return raw
    .replace(EMOJI_JOINERS, '')
    .replace(/[^\p{L}\p{M}\p{N} .'’\-_]/gu, '')
    .replace(/([.'’\-_])[.'’\-_]+/g, '$1')
    .replace(/ {2,}/g, ' ')
    .replace(/^[ .'’\-_]+/, '')
    .slice(0, max);
}

/** @имя при вводе и вставке: только латиница, цифры и _ (регистр не важен). */
export function sanitizeUsername(raw: string, max = 32): string {
  return raw
    .toLowerCase()
    .replace(/^@+/, '')
    .replace(/[^a-z0-9_]/g, '')
    .slice(0, max);
}

/** Есть ли в строке эмодзи или их невидимые части. */
export function hasEmojiParts(raw: string): boolean {
  EMOJI_JOINERS.lastIndex = 0;
  return EMOJI_JOINERS.test(raw) || /\p{Extended_Pictographic}/u.test(raw);
}
