import { useEffect, useMemo, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import { usePrefs } from '../stores/prefs';
import { cn } from '../lib/format';

/** [эмодзи, группа, ключевые слова по-русски] — генерируется scripts/generate-emoji.mjs */
type EmojiRow = [string, number, string];

const GROUPS: { id: number; icon: string; label: string }[] = [
  { id: 0, icon: '😀', label: 'Смайлы и эмоции' },
  { id: 1, icon: '👋', label: 'Люди и жесты' },
  { id: 3, icon: '🐻', label: 'Животные и природа' },
  { id: 4, icon: '🍔', label: 'Еда и напитки' },
  { id: 5, icon: '✈️', label: 'Путешествия и места' },
  { id: 6, icon: '⚽', label: 'Занятия' },
  { id: 7, icon: '💡', label: 'Предметы' },
  { id: 8, icon: '❤️', label: 'Символы' },
  { id: 9, icon: '🏳️', label: 'Флаги' },
];

let cache: Promise<EmojiRow[]> | null = null;
/** Набор эмодзи загружается отдельным файлом только при первом открытии панели. */
function loadEmoji(): Promise<EmojiRow[]> {
  cache ??= import('../emoji/emoji-ru.json').then((m) => m.default as EmojiRow[]);
  return cache;
}

export function EmojiPicker({ onPick, onClose, autoFocus }: { onPick: (emoji: string) => void; onClose?: () => void; autoFocus?: boolean }) {
  const [all, setAll] = useState<EmojiRow[] | null>(null);
  const [q, setQ] = useState('');
  const [active, setActive] = useState(-1);
  const recent = usePrefs((s) => s.recentEmoji ?? []);
  const pushEmoji = usePrefs((s) => s.pushEmoji);
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void loadEmoji().then(setAll);
  }, []);

  const query = q.trim().toLowerCase();
  const found = useMemo(() => {
    if (!all || !query) return null;
    const words = query.split(/\s+/);
    return all.filter(([e, , kw]) => e === query || words.every((w) => kw.includes(w))).slice(0, 160);
  }, [all, query]);

  const pick = (e: string) => {
    pushEmoji(e);
    onPick(e);
  };
  const jump = (id: number) => {
    setActive(id);
    scroller.current?.querySelector(`[data-group="${id}"]`)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  };

  const cell = (e: string, key: string) => (
    <button key={key} type="button" className="emoji-picker__cell" onClick={() => pick(e)} aria-label={e}>
      {e}
    </button>
  );

  return (
    <div className="emoji-picker" role="dialog" aria-label="Выбор эмодзи">
      <div className="emoji-picker__top">
        <div className="input-group grow">
          <Search size={16} className="input-group__icon" />
          <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Поиск: сердце, смех, кот…" autoFocus={autoFocus} aria-label="Поиск эмодзи" />
        </div>
        {onClose && (
          <button type="button" className="icon-btn icon-btn--sm" onClick={onClose} aria-label="Закрыть">
            <X size={18} />
          </button>
        )}
      </div>
      {!query && (
        <div className="emoji-picker__tabs" role="tablist">
          {recent.length > 0 && (
            <button type="button" className={cn('emoji-picker__tab', active === -1 && 'emoji-picker__tab--on')} onClick={() => jump(-1)} title="Недавние">
              🕘
            </button>
          )}
          {GROUPS.map((g) => (
            <button key={g.id} type="button" className={cn('emoji-picker__tab', active === g.id && 'emoji-picker__tab--on')} onClick={() => jump(g.id)} title={g.label}>
              {g.icon}
            </button>
          ))}
        </div>
      )}
      <div className="emoji-picker__scroll" ref={scroller}>
        {!all && <div className="center-fill">Загрузка…</div>}
        {found && (found.length ? <div className="emoji-picker__grid">{found.map(([e]) => cell(e, e))}</div> : <div className="center-fill small">Ничего не нашлось</div>)}
        {all && !found && (
          <>
            {recent.length > 0 && (
              <section data-group={-1}>
                <div className="emoji-picker__label">Недавние</div>
                <div className="emoji-picker__grid">{recent.map((e) => cell(e, `r${e}`))}</div>
              </section>
            )}
            {GROUPS.map((g) => (
              <section key={g.id} data-group={g.id} className="emoji-picker__section">
                <div className="emoji-picker__label">{g.label}</div>
                <div className="emoji-picker__grid">{all.filter((r) => r[1] === g.id).map(([e]) => cell(e, e))}</div>
              </section>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
