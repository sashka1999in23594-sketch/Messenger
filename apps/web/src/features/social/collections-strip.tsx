/** Полоса коллекций на странице «Закладки». */
import { useState } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import type { Collection } from '@omni/shared';
import { api } from '../../shared/api/client';
import { cn } from '../../shared/lib/format';
import { CollectionForm, collectionsKey } from './dialogs';
import './social.css';

export function CollectionsStrip() {
  const q = useQuery({ queryKey: collectionsKey, queryFn: () => api.get<{ items: Collection[] }>('/me/collections') });
  const [creating, setCreating] = useState(false);
  return (
    <>
      <div className="collections-strip" aria-label="Коллекции">
        {(q.data?.items ?? []).map((c) => (
          <Link key={c.id} to={`/feed/collections/${c.id}`} className={cn('collection-card', c.cover && 'collection-card--cover')}>
            {c.cover && <img src={c.cover.kind === 'video' ? (c.cover.posterUrl ?? '') : c.cover.url} alt="" loading="lazy" />}
            {!c.cover && <span className="collection-card__emoji">{c.emoji}</span>}
            <span className="bold ellipsis">
              {c.cover ? `${c.emoji} ` : ''}
              {c.name}
            </span>
            <span className="xs" style={{ opacity: 0.8 }}>
              {c.count} сохранено
            </span>
          </Link>
        ))}
        <button type="button" className="collection-card collection-card--new" onClick={() => setCreating(true)}>
          <Plus size={22} />
          <span className="small">Новая коллекция</span>
        </button>
      </div>
      {creating && <CollectionForm onClose={() => setCreating(false)} />}
    </>
  );
}
