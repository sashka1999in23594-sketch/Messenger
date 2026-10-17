import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, FileText, Play, X } from 'lucide-react';
import type { MediaItem } from '@omni/shared';
import { cn, duration, fileSize } from '../lib/format';
import { IconButton } from './Button';

export function MediaGrid({ media, className, onOpen }: { media: MediaItem[]; className?: string; onOpen?: (index: number) => void }) {
  const [open, setOpen] = useState<number | null>(null);
  if (!media.length) return null;
  const files = media.filter((m) => m.kind === 'file' || m.kind === 'audio');
  const visual = media.filter((m) => m.kind === 'image' || m.kind === 'video');
  const shown = visual.slice(0, 4);
  const handleOpen = (i: number) => (onOpen ? onOpen(i) : setOpen(i));
  return (
    <>
      {shown.length > 0 && (
        <div className={cn('media-grid', `media-grid--${shown.length}`, className)} onClick={(e) => e.stopPropagation()}>
          {shown.map((m, i) => (
            <button key={m.id} className="media-grid__item" onClick={() => handleOpen(i)} aria-label="Открыть">
              {m.kind === 'image' ? (
                <img
                  src={m.url}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  style={shown.length === 1 && m.width && m.height ? { aspectRatio: `${m.width} / ${m.height}` } : undefined}
                />
              ) : (
                <>
                  <img src={m.posterUrl ?? ''} alt="" loading="lazy" />
                  <span className="media-grid__more" style={{ background: 'rgba(0,0,0,.25)' }}>
                    <Play size={40} fill="#fff" />
                  </span>
                  {m.durationSec ? (
                    <span className="tag" style={{ position: 'absolute', right: 8, bottom: 8, background: 'rgba(0,0,0,.65)', color: '#fff' }}>
                      {duration(m.durationSec)}
                    </span>
                  ) : null}
                </>
              )}
              {i === 3 && visual.length > 4 && <span className="media-grid__more">+{visual.length - 4}</span>}
            </button>
          ))}
        </div>
      )}
      {files.map((f) =>
        f.kind === 'audio' ? (
          <audio key={f.id} controls src={f.url} style={{ width: '100%', marginTop: 6 }} preload="none" />
        ) : (
          <a key={f.id} className="list-item card" href={f.url} download style={{ marginTop: 6 }} onClick={(e) => e.stopPropagation()}>
            <span className="list-item__icon">
              <FileText size={18} />
            </span>
            <span className="list-item__body">
              <span className="list-item__title ellipsis" style={{ display: 'block' }}>
                {f.name ?? 'Файл'}
              </span>
              <span className="list-item__sub">{fileSize(f.size)}</span>
            </span>
          </a>
        ),
      )}
      {open !== null && <Lightbox items={visual} index={open} onClose={() => setOpen(null)} />}
    </>
  );
}

export function Lightbox({ items, index, onClose }: { items: MediaItem[]; index: number; onClose: () => void }) {
  const [i, setI] = useState(index);
  const touchX = useRef(0);
  const go = useCallback((d: number) => setI((v) => (v + d + items.length) % items.length), [items.length]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight') go(1);
      if (e.key === 'ArrowLeft') go(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go, onClose]);
  const m = items[i];
  if (!m) return null;
  return createPortal(
    <div
      className="lightbox"
      onClick={(e) => e.target === e.currentTarget && onClose()}
      onTouchStart={(e) => (touchX.current = e.touches[0]?.clientX ?? 0)}
      onTouchEnd={(e) => {
        const dx = (e.changedTouches[0]?.clientX ?? 0) - touchX.current;
        if (Math.abs(dx) > 50) go(dx < 0 ? 1 : -1);
      }}
    >
      {m.kind === 'video' ? <video src={m.url} poster={m.posterUrl ?? undefined} controls autoPlay playsInline /> : <img src={m.url} alt="" />}
      {items.length > 1 && <div className="lightbox__counter">{`${i + 1} / ${items.length}`}</div>}
      <IconButton label="Закрыть" className="lightbox__close" onClick={onClose}>
        <X />
      </IconButton>
      {items.length > 1 && (
        <>
          <IconButton label="Предыдущее" className="lightbox__nav lightbox__nav--prev" onClick={() => go(-1)}>
            <ChevronLeft />
          </IconButton>
          <IconButton label="Следующее" className="lightbox__nav lightbox__nav--next" onClick={() => go(1)}>
            <ChevronRight />
          </IconButton>
        </>
      )}
    </div>,
    document.body,
  );
}
