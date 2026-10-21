/** Сетка публикаций профиля 3×N: фото, видео, Reels и заметки-плитки. */
import { Link } from 'react-router';
import { Clapperboard, Copy, Heart, MessageCircle, Pin, Play } from 'lucide-react';
import type { Post } from '@omni/shared';
import { cn, compactNumber, duration } from '../../shared/lib/format';
import { postHref } from '../posts/PostMedia';
import './photo-grid.css';

export function Tile({ p, tall, className }: { p: Post; tall?: boolean; className?: string }) {
  const shown = p.repostOf && !p.text ? p.repostOf : p;
  const m = shown.media.find((x) => x.kind === 'image' || x.kind === 'video');
  const img = m ? (m.kind === 'image' ? m.url : (m.posterUrl ?? undefined)) : undefined;
  const isVideo = shown.kind === 'video' || shown.kind === 'short' || m?.kind === 'video';
  return (
    <Link to={postHref(shown)} className={cn('pg-tile', !img && 'pg-tile--text', tall && 'pg-tile--tall', className)} aria-label={shown.title || shown.text || 'Публикация'}>
      {img ? (
        <img src={img} alt="" loading="lazy" decoding="async" draggable={false} />
      ) : (
        <span className="pg-tile__text">{shown.title || shown.text}</span>
      )}
      <span className="pg-tile__badges">
        {p.pinned && <Pin size={16} fill="currentColor" aria-label="Закреплено" />}
        {shown.kind === 'short' ? (
          !tall && <Clapperboard size={17} aria-label="Reels" />
        ) : isVideo ? (
          <Play size={16} fill="currentColor" aria-label="Видео" />
        ) : shown.media.length > 1 ? (
          <Copy size={16} aria-label="Несколько фото" />
        ) : null}
      </span>
      {tall && (
        <span className="pg-tile__views">
          <Play size={13} fill="currentColor" /> {compactNumber(shown.stats.views)}
        </span>
      )}
      {!tall && shown.kind === 'video' && m?.durationSec ? <span className="pg-tile__time">{duration(m.durationSec)}</span> : null}
      <span className="pg-tile__hover" aria-hidden>
        <span>
          <Heart size={18} fill="currentColor" /> {compactNumber(shown.stats.likes)}
        </span>
        <span>
          <MessageCircle size={18} fill="currentColor" /> {compactNumber(shown.stats.comments)}
        </span>
      </span>
    </Link>
  );
}

/** tall — вертикальные плитки 9:16 (Reels), иначе квадратные. */
export function PhotoGrid({ posts, tall }: { posts: Post[]; tall?: boolean }) {
  return (
    <div className={cn('photo-grid', tall && 'photo-grid--tall')}>
      {posts.map((p) => (
        <Tile key={p.id} p={p} tall={tall} />
      ))}
    </div>
  );
}

/** Заглушка сетки при загрузке. */
export function GridSkeleton({ count = 9, tall }: { count?: number; tall?: boolean }) {
  return (
    <div className={cn('photo-grid', tall && 'photo-grid--tall')} aria-hidden>
      {Array.from({ length: count }, (_, i) => (
        <span key={i} className="pg-tile skeleton" style={{ borderRadius: 0 }} />
      ))}
    </div>
  );
}
