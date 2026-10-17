/** Сетка публикаций профиля: фото, видео и кометы плиткой 3×N. */
import { Link } from 'react-router';
import { Copy, Play } from 'lucide-react';
import type { Post } from '@omni/shared';
import './photo-grid.css';

export function PhotoGrid({ posts }: { posts: Post[] }) {
  return (
    <div className="photo-grid">
      {posts.map((p) => {
        const m = p.media[0];
        const href = p.kind === 'video' ? `/watch/${p.id}` : p.kind === 'short' ? `/comets?start=${p.id}` : `/post/${p.id}`;
        return (
          <Link key={p.id} to={href} aria-label={p.text || 'Публикация'}>
            {m && <img src={m.kind === 'image' ? m.url : (m.posterUrl ?? '')} alt="" loading="lazy" decoding="async" />}
            {p.media.length > 1 && <Copy size={18} className="photo-grid__badge" />}
            {(p.kind === 'video' || p.kind === 'short') && <Play size={18} className="photo-grid__badge" fill="currentColor" />}
          </Link>
        );
      })}
    </div>
  );
}
