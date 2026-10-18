/** «Актуальное» в профиле: кружки подборок, просмотр и редактирование своих. */
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Pencil, Plus, Star } from 'lucide-react';
import type { Story, StoryGroup, StoryHighlight, UserSummary } from '@omni/shared';
import { api, errorMessage } from '../../shared/api/client';
import { toast } from '../../shared/stores/ui';
import { useHighlights } from './api';
import { HighlightEditor } from './highlight-dialogs';
import { StoryViewer } from './StoryViewer';
import './stories.css';

type Loaded = { highlight: StoryHighlight; author: UserSummary; stories: Story[] };

export function HighlightsRow({ userId, own }: { userId: string; own?: boolean }) {
  const q = useHighlights(userId);
  const navigate = useNavigate();
  const [viewing, setViewing] = useState<StoryGroup[] | null>(null);
  const [editing, setEditing] = useState<Loaded | null>(null);
  const items = q.data?.items ?? [];
  if (!own && !items.length) return null;

  const load = async (h: StoryHighlight) => api.get<Loaded>(`/highlights/${h.id}`);
  const open = async (h: StoryHighlight) => {
    try {
      const r = await load(h);
      if (!r.stories.length) return toast('В подборке пока нет доступных историй');
      setViewing([{ author: r.author, stories: r.stories, hasUnseen: false }]);
    } catch (e) {
      toast({ text: errorMessage(e), kind: 'error' });
    }
  };

  return (
    <>
      <div className="highlights" aria-label="Актуальное">
        {own && (
          <button type="button" className="highlight" onClick={() => navigate('/stories/archive?select=1')}>
            <span className="highlight__cover">
              <span>
                <Plus size={24} />
              </span>
            </span>
            <span className="highlight__title">Новое</span>
          </button>
        )}
        {items.map((h) => (
          <div key={h.id} className="highlight" style={{ position: 'relative' }}>
            <button type="button" className="col center" style={{ gap: 6, width: '100%' }} onClick={() => void open(h)} aria-label={`Актуальное: ${h.title}`}>
              <span className="highlight__cover">
                {h.cover ? (
                  <img src={h.cover.kind === 'video' ? (h.cover.posterUrl ?? undefined) : h.cover.url} alt="" loading="lazy" />
                ) : (
                  <span>
                    <Star size={22} />
                  </span>
                )}
              </span>
              <span className="highlight__title">{h.title}</span>
            </button>
            {own && (
              <button
                type="button"
                className="icon-btn icon-btn--sm"
                style={{ position: 'absolute', top: -2, right: 0, background: 'var(--bg-elevated)', boxShadow: 'var(--shadow-sm)' }}
                aria-label={`Изменить «${h.title}»`}
                onClick={async () => {
                  try {
                    setEditing(await load(h));
                  } catch (e) {
                    toast({ text: errorMessage(e), kind: 'error' });
                  }
                }}
              >
                <Pencil size={13} />
              </button>
            )}
          </div>
        ))}
      </div>
      {viewing && <StoryViewer groups={viewing} startStoryId={viewing[0]!.stories[0]!.id} onClose={() => setViewing(null)} />}
      {editing && <HighlightEditor highlight={editing.highlight} stories={editing.stories} onClose={() => setEditing(null)} />}
    </>
  );
}
