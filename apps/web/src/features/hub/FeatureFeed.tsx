/**
 * Бесконечная лента возможностей в левой панели окна. Подгружается порциями
 * при прокрутке; порядок — из rankFeatures (интересы человека + открытия).
 */
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { ArrowUpRight, Compass, Sparkles, Wrench } from 'lucide-react';
import { openPath } from '../desktop/fx';
import { catalogById, CATEGORIES } from './catalog';
import { rankFeatures, useTaste, type Feature } from './discover';
import { AppGlyph } from './AppGlyph';

const PAGE = 18;
const catEmoji = new Map(CATEGORIES.map((c) => [c.id, c.emoji]));

export function openFeature(f: Feature) {
  useTaste.getState().open(f);
  if ('path' in f.to) openPath(f.to.path);
  else openPath(`/orbit?app=${f.to.app}`);
}

export function FeatureFeed({ filter = '' }: { filter?: string }) {
  const w = useTaste((s) => s.w);
  // Порядок фиксируется на время показа панели — пункты не прыгают под курсором
  const list = useMemo(() => rankFeatures(useTaste.getState(), filter), [filter, Object.keys(w).length]);
  const [count, setCount] = useState(PAGE);
  const sentinel = useRef<HTMLDivElement>(null);

  useEffect(() => setCount(PAGE), [filter]);
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver((e) => {
      if (e[0]?.isIntersecting) setCount((c) => c + PAGE);
    }, { rootMargin: '200px' });
    io.observe(el);
    return () => io.disconnect();
  }, [list]);

  const shown = list.slice(0, count);
  useEffect(() => {
    useTaste.getState().seen(shown.slice(-PAGE).map((f) => f.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [count, filter]);

  return (
    <div className="feed-fx" aria-label="Возможности Sunnet">
      <div className="feed-fx__head">
        <Sparkles size={14} /> {filter ? 'Найдено в возможностях' : 'Возможности для вас'}
        <span className="feed-fx__count">{list.length}</span>
      </div>
      {shown.map((f, i) => (
        <button
          key={f.id}
          type="button"
          className="feed-fx__item"
          style={{ '--i': i % PAGE } as CSSProperties}
          onClick={() => openFeature(f)}
          title={f.sub}
        >
          {f.kind === 'service' ? (
            <AppGlyph app={catalogById.get((f.to as { app: string }).app)!} size={28} />
          ) : (
            <span className={`feed-fx__icon feed-fx__icon--${f.kind}`}>{f.kind === 'tool' ? <Wrench size={15} /> : <Compass size={15} />}</span>
          )}
          <span className="feed-fx__text">
            <span className="feed-fx__title ellipsis">{f.title}</span>
            <span className="feed-fx__sub ellipsis">
              {catEmoji.get(f.cat)} {f.sub}
            </span>
          </span>
          <ArrowUpRight size={14} className="feed-fx__go" />
        </button>
      ))}
      <div ref={sentinel} className="feed-fx__more">
        {count < list.length ? <span className="feed-fx__dots"><i /><i /><i /></span> : <span>Это всё на сегодня — завтра лента обновится ✨</span>}
      </div>
    </div>
  );
}
