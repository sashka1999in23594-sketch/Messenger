/** Истории: полоса, просмотр, создание, архив, «Актуальное», близкие друзья. */
import { useState } from 'react';
import { Archive, Eye, Plus } from 'lucide-react';
import { Avatar, ButtonLink, EmptyState, PageHeader } from '../../shared/ui';
import { useStories } from './api';
import { StoryViewer } from './StoryViewer';
import './stories.css';

export { StoriesBar } from './StoriesBar';
export { StoryViewer } from './StoryViewer';
export { HighlightsRow } from './Highlights';
export { NewStoryPage } from './NewStory';
export { ArchivePage } from './Archive';
export { CloseFriendsPage } from './CloseFriends';
export { useStories } from './api';

export function StoriesPage() {
  const q = useStories();
  const [open, setOpen] = useState<number | null>(null);
  const groups = q.data?.items ?? [];
  return (
    <div className="scroll">
      <div className="page page--wide">
        <PageHeader
          title="Истории"
          subtitle="Исчезают через 24 часа"
          icon={<Eye size={22} />}
          actions={
            <>
              <ButtonLink to="/stories/archive" variant="ghost" size="sm" icon={<Archive size={16} />}>
                Архив
              </ButtonLink>
              <ButtonLink to="/stories/new" size="sm" icon={<Plus size={16} />}>
                Новая
              </ButtonLink>
            </>
          }
        />
        {groups.length === 0 && !q.isLoading && <EmptyState icon={<Eye size={28} />} title="Нет активных историй" text="Подпишитесь на друзей или опубликуйте свою" />}
        <div className="story-archive" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 12 }}>
          {groups.map((gr, i) => {
            const first = gr.stories.find((s) => !s.viewed) ?? gr.stories[0]!;
            return (
              <button key={gr.author.id} type="button" className="story-thumb" onClick={() => setOpen(i)} style={{ borderRadius: 'var(--radius-lg)' }}>
                {first.media.kind === 'video' ? <img src={first.media.posterUrl ?? ''} alt="" loading="lazy" /> : <img src={first.media.url} alt="" loading="lazy" />}
                <span className="story-thumb__date" style={{ background: 'none', padding: 0 }}>
                  <Avatar src={gr.author.avatarUrl} name={gr.author.displayName} id={gr.author.id} size={42} ring={gr.hasUnseen ? 'unseen' : 'seen'} />
                </span>
                <span className="story-canvas__caption" style={{ fontSize: 'var(--fs-sm)', bottom: 10, textAlign: 'left' }}>
                  {gr.author.displayName}
                </span>
              </button>
            );
          })}
        </div>
      </div>
      {open !== null && <StoryViewer groups={groups} startIndex={open} onClose={() => setOpen(null)} />}
    </div>
  );
}
