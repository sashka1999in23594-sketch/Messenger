/**
 * Медиа публикации: карусель во всю ширину с точками и счётчиком,
 * двойное касание — «Нравится» с большим сердцем, одно — просмотр.
 * Видео и Reels — обложка с длительностью, открываются в своём разделе.
 */
import { useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { ChevronLeft, ChevronRight, Clapperboard, Heart, Play } from 'lucide-react';
import type { MediaItem, Post } from '@omni/shared';
import { cn, duration } from '../../shared/lib/format';
import { Lightbox, MediaGrid } from '../../shared/ui';

const ratioOf = (m: MediaItem | undefined) => (m?.width && m.height ? m.width / m.height : 1);
/** Как в Instagram: от вертикального 4:5 до горизонтального 1,91:1 */
const clampRatio = (r: number) => Math.min(1.91, Math.max(0.8, r));

export const postHref = (p: Post) => (p.kind === 'video' ? `/watch/${p.id}` : p.kind === 'short' ? `/reels?start=${p.id}` : `/post/${p.id}`);

function HeartBurst({ show }: { show: number }) {
  if (!show) return null;
  return (
    <span key={show} className="pc-burst" aria-hidden>
      <Heart size={96} fill="currentColor" strokeWidth={0} />
    </span>
  );
}

/** Различает одно и двойное касание: одно срабатывает с небольшой задержкой. */
function useTaps(single: () => void, double: () => void) {
  const last = useRef(0);
  const timer = useRef<number | undefined>(undefined);
  return (e: React.MouseEvent) => {
    e.stopPropagation();
    const now = Date.now();
    if (now - last.current < 300) {
      window.clearTimeout(timer.current);
      last.current = 0;
      double();
    } else {
      last.current = now;
      timer.current = window.setTimeout(single, 300);
    }
  };
}

function VideoTile({ post, onLike }: { post: Post; onLike: () => void }) {
  const navigate = useNavigate();
  const m = post.media[0];
  const [burst, setBurst] = useState(0);
  const short = post.kind === 'short';
  const tap = useTaps(
    () => navigate(postHref(post)),
    () => {
      onLike();
      setBurst(Date.now());
    },
  );
  return (
    <div className={cn('pc-media', 'pc-media--video', short && 'pc-media--short')} style={{ aspectRatio: short ? '4 / 5' : '16 / 9' }} onClick={tap}>
      {m?.posterUrl ? <img src={m.posterUrl} alt="" loading="lazy" decoding="async" draggable={false} /> : <span className="pc-media__blank" />}
      <span className="pc-media__play">
        <Play size={30} fill="currentColor" />
      </span>
      {short && (
        <span className="pc-media__badge">
          <Clapperboard size={14} /> Reels
        </span>
      )}
      {m?.durationSec ? <span className="pc-media__time">{duration(m.durationSec)}</span> : null}
      <HeartBurst show={burst} />
    </div>
  );
}

function Carousel({ items, onLike }: { items: MediaItem[]; onLike: () => void }) {
  const track = useRef<HTMLDivElement>(null);
  const [idx, setIdx] = useState(0);
  const [open, setOpen] = useState<number | null>(null);
  const [burst, setBurst] = useState(0);
  const ratio = clampRatio(ratioOf(items[0]));
  const tap = useTaps(
    () => setOpen(Math.round((track.current?.scrollLeft ?? 0) / (track.current?.clientWidth || 1))),
    () => {
      onLike();
      setBurst(Date.now());
    },
  );
  const go = (d: number) => {
    const el = track.current;
    if (el) el.scrollBy({ left: d * el.clientWidth, behavior: 'smooth' });
  };
  const many = items.length > 1;
  return (
    <div className="pc-carousel" onClick={(e) => e.stopPropagation()}>
      <div className="pc-media" style={{ aspectRatio: String(ratio) }}>
        <div
          ref={track}
          className="pc-carousel__track"
          onScroll={(e) => setIdx(Math.round(e.currentTarget.scrollLeft / (e.currentTarget.clientWidth || 1)))}
          onClick={tap}
        >
          {items.map((m, i) => (
            <div key={m.id} className="pc-carousel__slide" aria-label={many ? `${i + 1} из ${items.length}` : undefined}>
              <img src={m.kind === 'image' ? m.url : (m.posterUrl ?? undefined)} alt="" loading={i ? 'lazy' : 'eager'} decoding="async" draggable={false} />
              {m.kind === 'video' && (
                <span className="pc-media__play">
                  <Play size={30} fill="currentColor" />
                </span>
              )}
            </div>
          ))}
        </div>
        {many && <span className="pc-carousel__count">{`${idx + 1}/${items.length}`}</span>}
        {many && idx > 0 && (
          <button type="button" className="pc-carousel__nav pc-carousel__nav--prev" onClick={() => go(-1)} aria-label="Предыдущее">
            <ChevronLeft size={18} />
          </button>
        )}
        {many && idx < items.length - 1 && (
          <button type="button" className="pc-carousel__nav pc-carousel__nav--next" onClick={() => go(1)} aria-label="Следующее">
            <ChevronRight size={18} />
          </button>
        )}
        <HeartBurst show={burst} />
      </div>
      {many && (
        <div className="pc-dots" aria-hidden>
          {items.map((m, i) => (
            <span key={m.id} className={cn(i === idx && 'pc-dots--on')} />
          ))}
        </div>
      )}
      {open !== null && <Lightbox items={items} index={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

export function PostMedia({ post, onLike }: { post: Post; onLike: () => void }) {
  const visual = post.media.filter((m) => m.kind === 'image' || m.kind === 'video');
  const files = post.media.filter((m) => m.kind === 'file' || m.kind === 'audio');
  return (
    <>
      {(post.kind === 'video' || post.kind === 'short') && visual.length ? (
        <VideoTile post={post} onLike={onLike} />
      ) : visual.length ? (
        <Carousel items={visual} onLike={onLike} />
      ) : null}
      {files.length > 0 && (
        <div className="pc-files" onClick={(e) => e.stopPropagation()}>
          <MediaGrid media={files} />
        </div>
      )}
    </>
  );
}

/** Маленькая обложка (цитата, уведомления). */
export function MediaThumb({ post, size = 56 }: { post: Post; size?: number }) {
  const m = post.media.find((x) => x.kind === 'image' || x.kind === 'video');
  if (!m) return null;
  return (
    <span className="pc-thumb" style={{ width: size, height: size }}>
      <img src={m.kind === 'image' ? m.url : (m.posterUrl ?? undefined)} alt="" loading="lazy" />
      {m.kind === 'video' && <Play size={14} fill="currentColor" className="pc-thumb__play" />}
    </span>
  );
}
