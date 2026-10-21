/** Полоса историй: в ленте и над списком чатов (compact). */
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Plus } from 'lucide-react';
import type { UserSummary } from '@omni/shared';
import { useMe } from '../../shared/stores/session';
import { cn } from '../../shared/lib/format';
import { Avatar } from '../../shared/ui';
import { useStories } from './api';
import { StoryViewer } from './StoryViewer';
import './stories.css';

type Ring = 'unseen' | 'seen' | 'close' | null;

/** Аватар в кольце историй: цветное — есть новые, серое — всё просмотрено. Между кольцом и фото — прозрачный зазор. */
export function StoryRing({ user, size, ring, className }: { user: UserSummary; size: number; ring: Ring; className?: string }) {
  return (
    <span className={cn('st-ring', ring && `st-ring--${ring}`, className)} style={{ width: size, height: size }}>
      <Avatar src={user.avatarUrl} name={user.displayName} id={user.id} size={size - 10} />
    </span>
  );
}

export function StoriesBar({ compact, hideEmpty }: { compact?: boolean; hideEmpty?: boolean }) {
  const me = useMe();
  const q = useStories();
  const navigate = useNavigate();
  const [open, setOpen] = useState<number | null>(null);
  const groups = q.data?.items ?? [];
  const ownIndex = groups.findIndex((gr) => gr.author.id === me.id);
  const own = ownIndex >= 0 ? groups[ownIndex] : null;
  const size = compact ? 58 : 72;
  if (hideEmpty && !groups.some((gr) => gr.author.id !== me.id)) return null;
  return (
    <>
      <div className={cn('stories-bar', compact && 'stories-bar--compact')} aria-label="Истории" style={{ '--chip-size': `${size}px` } as React.CSSProperties}>
        <div className="story-chip story-chip--own">
          <button
            type="button"
            className="story-chip__hit"
            onClick={() => (own ? setOpen(ownIndex) : navigate('/stories/new'))}
            aria-label={own ? 'Смотреть вашу историю' : 'Добавить историю'}
          >
            <StoryRing user={me} size={size} ring={own ? (own.hasUnseen ? 'unseen' : 'seen') : null} />
            <span className="story-chip__name">Ваша история</span>
          </button>
          <button type="button" className="story-chip__add" onClick={() => navigate('/stories/new')} aria-label="Новая история">
            <Plus size={14} strokeWidth={3} />
          </button>
        </div>
        {q.isLoading &&
          Array.from({ length: 6 }, (_, i) => (
            <span key={i} className="story-chip" aria-hidden>
              <span className="skeleton" style={{ width: size, height: size, borderRadius: '50%', display: 'block' }} />
              <span className="skeleton" style={{ width: size * 0.7, height: 9, display: 'block', marginTop: 4 }} />
            </span>
          ))}
        {groups.map((gr, i) => {
          if (gr.author.id === me.id) return null;
          const close = gr.stories.some((s) => s.audience === 'close' && !s.viewed);
          return (
            <button key={gr.author.id} type="button" className={cn('story-chip', !gr.hasUnseen && 'story-chip--seen')} onClick={() => setOpen(i)} aria-label={`История: ${gr.author.displayName}`}>
              <StoryRing user={gr.author} size={size} ring={gr.hasUnseen ? (close ? 'close' : 'unseen') : 'seen'} />
              <span className="story-chip__name">{gr.author.displayName.split(' ')[0]}</span>
            </button>
          );
        })}
      </div>
      {open !== null && <StoryViewer groups={groups} startIndex={open} onClose={() => setOpen(null)} />}
    </>
  );
}
