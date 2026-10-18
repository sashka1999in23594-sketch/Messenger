import { useEffect, type ReactNode } from 'react';
import { Link } from 'react-router';

/** Заголовок вкладки для страницы сайта помощи. */
export function useDocumentTitle(title: string) {
  useEffect(() => {
    const prev = document.title;
    document.title = title;
    return () => {
      document.title = prev;
    };
  }, [title]);
}

/** Шапка страницы: надзаголовок, h1, вводный абзац. */
export function PageHead({
  eyebrow,
  title,
  lead,
  children,
}: {
  eyebrow: string;
  title: string;
  lead?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <header className="help-head">
      <p className="help-eyebrow">{eyebrow}</p>
      <h1>{title}</h1>
      {lead && <p className="help-lead">{lead}</p>}
      {children}
    </header>
  );
}

export interface TocItem {
  id: string;
  title: string;
}

/** Оглавление документа: ссылки на разделы этой же страницы. */
export function Toc({ items, label = 'Содержание' }: { items: TocItem[]; label?: string }) {
  return (
    <nav className="help-toc" aria-labelledby="help-toc-title">
      <p className="help-toc__title" id="help-toc-title">
        {label}
      </p>
      <ol>
        {items.map((it, i) => (
          <li key={it.id}>
            <Link to={{ hash: it.id }} className="help-toc__link">
              <span className="help-toc__num">{i + 1}.</span> {it.title}
            </Link>
          </li>
        ))}
      </ol>
    </nav>
  );
}

/** Раздел документа с номером и якорем. */
export function DocSection({
  id,
  n,
  title,
  children,
}: {
  id: string;
  n: number;
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="help-doc__section" id={id} aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`}>
        <span className="help-doc__num">{n}.</span> {title}
      </h2>
      {children}
    </section>
  );
}

/** Русское множественное число: plural(5, ['ответ', 'ответа', 'ответов']). */
export function plural(n: number, forms: [string, string, string]): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return forms[0];
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return forms[1];
  return forms[2];
}
