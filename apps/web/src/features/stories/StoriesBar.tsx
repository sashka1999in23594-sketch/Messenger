/** Полоса историй: в ленте, фото и над списком чатов (compact). */
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Plus } from 'lucide-react';
import { useMe } from '../../shared/stores/session';
import { cn } from '../../shared/lib/format';
import { Avatar } from '../../shared/ui';
import { useStories } from './api';
import { StoryViewer } from './StoryViewer';
import './stories.css';

export function StoriesBar({ compact, hideEmpty }: { compact?: boolean; hideEmpty?: boolean }) {
  const me = useMe();
  const q = useStories();
  const navigate = useNavigate();
  const [open, setOpen] = useState<number | null>(null);
  const groups = q.data?.items ?? [];
  const hasOwn = groups[0]?.author.id === me.id;
  const size = compact ? 52 : 64;
  if (hideEmpty && !groups.some((gr) => gr.author.id !== me.id)) return null;
  return (
    <>
      <div className={cn('stories-bar', compact && 'stories-bar--compact')} aria-label="Истории" style={{ '--chip-size': `${size}px` } as React.CSSProperties}>
        {!hasOwn && (
          <button type="button" className="story-chip" onClick={() => navigate('/stories/new')}>
            <Avatar src={me.avatarUrl} name={me.displayName} id={me.id} size={size} />
            <span className="story-chip__add">
              <Plus size={13} />
            </span>
            <span className="story-chip__name">Ваша история</span>
          </button>
        )}
        {groups.map((gr, i) => {
          const close = gr.stories.some((s) => s.audience === 'close' && !s.viewed);
          return (
            <button key={gr.author.id} type="button" className="story-chip" onClick={() => setOpen(i)}>
              <Avatar src={gr.author.avatarUrl} name={gr.author.displayName} id={gr.author.id} size={size} ring={gr.hasUnseen ? (close ? 'close' : 'unseen') : 'seen'} />
              <span className="story-chip__name">{gr.author.id === me.id ? 'Вы' : gr.author.displayName.split(' ')[0]}</span>
            </button>
          );
        })}
      </div>
      {open !== null && <StoryViewer groups={groups} startIndex={open} onClose={() => setOpen(null)} />}
    </>
  );
}
