import { Fragment, type ReactNode } from 'react';
import { Link } from 'react-router';
import { HELP_BASE } from './links';

/**
 * Мини-разметка ответов: **жирный**, `код`, [текст](/путь | #якорь | mailto:… | https://…).
 * Ответы хранятся строками — по ним же работает поиск.
 */
export type Block =
  | string
  | { list: string[]; ordered?: boolean }
  | { note: string; tone?: 'info' | 'warn' };

const INLINE = /\*\*(.+?)\*\*|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)/g;

function InlineLink({ href, children }: { href: string; children: ReactNode }) {
  if (href.startsWith('mailto:')) return <a href={href}>{children}</a>;
  if (/^https?:\/\//.test(href))
    return (
      <a href={href} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    );
  // Якорь «#id» ведёт к вопросу на главной странице помощи
  return <Link to={href.startsWith('#') ? `${HELP_BASE}${href}` : href}>{children}</Link>;
}

export function Inline({ text }: { text: string }) {
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(INLINE)) {
    const at = m.index;
    if (at > last) out.push(text.slice(last, at));
    if (m[1] !== undefined) out.push(<strong key={at}>{m[1]}</strong>);
    else if (m[2] !== undefined) out.push(<code key={at}>{m[2]}</code>);
    else if (m[3] !== undefined && m[4] !== undefined)
      out.push(
        <InlineLink key={at} href={m[4]}>
          {m[3]}
        </InlineLink>,
      );
    last = at + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return <>{out}</>;
}

export function Blocks({ blocks }: { blocks: Block[] }) {
  return (
    <>
      {blocks.map((b, i) => {
        if (typeof b === 'string')
          return (
            <p key={i}>
              <Inline text={b} />
            </p>
          );
        if ('list' in b) {
          const items = b.list.map((t, j) => (
            <li key={j}>
              <Inline text={t} />
            </li>
          ));
          return b.ordered ? <ol key={i}>{items}</ol> : <ul key={i}>{items}</ul>;
        }
        return (
          <p key={i} className={`help-note help-note--${b.tone ?? 'info'}`}>
            <Inline text={b.note} />
          </p>
        );
      })}
    </>
  );
}

/** Текст без разметки — для поиска. */
export function plainText(blocks: Block[]): string {
  const strip = (s: string) => s.replace(INLINE, (_m, b, c, t) => b ?? c ?? t ?? '');
  return blocks
    .map((b) =>
      typeof b === 'string' ? strip(b) : 'list' in b ? b.list.map(strip).join(' ') : strip(b.note),
    )
    .join(' ');
}

/** Нормализация для поиска: регистр и «ё» не важны (длина строки не меняется). */
export function normalize(s: string): string {
  return s.toLowerCase().replace(/ё/g, 'е');
}

/** Подсвечивает найденные слова в заголовке вопроса. */
export function Highlight({ text, words }: { text: string; words: string[] }) {
  if (!words.length) return <>{text}</>;
  const norm = normalize(text);
  const marks: Array<[number, number]> = [];
  for (const w of words) {
    let from = 0;
    for (;;) {
      const at = norm.indexOf(w, from);
      if (at < 0) break;
      marks.push([at, at + w.length]);
      from = at + w.length;
    }
  }
  if (!marks.length) return <>{text}</>;
  // Сливаем пересекающиеся диапазоны
  marks.sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [];
  for (const m of marks) {
    const prev = merged[merged.length - 1];
    if (prev && m[0] <= prev[1]) prev[1] = Math.max(prev[1], m[1]);
    else merged.push([m[0], m[1]]);
  }
  let last = 0;
  return (
    <>
      {merged.map(([s, e]) => {
        const before = text.slice(last, s);
        last = e;
        return (
          <Fragment key={s}>
            {before}
            <mark>{text.slice(s, e)}</mark>
          </Fragment>
        );
      })}
      {text.slice(last)}
    </>
  );
}
