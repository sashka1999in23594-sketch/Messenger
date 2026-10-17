import { memo } from 'react';
import { Link } from 'react-router';
import { tokenizeText } from '@omni/shared';
import { cn } from '../lib/format';

/**
 * Безопасный рендер пользовательского текста: никакого HTML — только React-узлы.
 * Ссылки — только http(s), открываются в новой вкладке без передачи referrer/opener.
 */
export const RichText = memo(function RichText({ text, className }: { text: string; className?: string }) {
  const tokens = tokenizeText(text);
  return (
    <span className={cn('rich pre-wrap', className)}>
      {tokens.map((t, i) => {
        switch (t.type) {
          case 'url': {
            let label = t.value;
            try {
              const u = new URL(t.href);
              label = (u.host + u.pathname + u.search).replace(/\/$/, '');
              if (label.length > 48) label = `${label.slice(0, 47)}…`;
            } catch {
              /* оставляем как есть */
            }
            return (
              <a key={i} href={t.href} target="_blank" rel="noopener noreferrer nofollow ugc">
                {label}
              </a>
            );
          }
          case 'hashtag':
            return (
              <Link key={i} className="hashtag" to={`/tag/${encodeURIComponent(t.tag)}`} onClick={(e) => e.stopPropagation()}>
                {t.value}
              </Link>
            );
          case 'mention':
            return (
              <Link key={i} className="mention" to={`/u/${t.username}`} onClick={(e) => e.stopPropagation()}>
                {t.value}
              </Link>
            );
          default:
            return <span key={i}>{t.value}</span>;
        }
      })}
    </span>
  );
});
