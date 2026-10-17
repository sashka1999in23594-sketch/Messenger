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
