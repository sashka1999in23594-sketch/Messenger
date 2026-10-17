/** Архив своих историй (включая истёкшие) и сборка «Актуального». */
import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Archive as ArchiveIcon, Check, Plus, Star } from 'lucide-react';
import type { Story, StoryGroup } from '@omni/shared';
import { flatPages, useCursorList } from '../../shared/api/query';
import { useMe } from '../../shared/stores/session';
import { cn } from '../../shared/lib/format';
import { Button, ButtonLink, EmptyState, LoadMore, PageHeader } from '../../shared/ui';
import { archiveKey } from './api';
import { HighlightEditor, StoryThumbMedia } from './highlight-dialogs';
import { HighlightsRow } from './Highlights';
import { StoryViewer } from './StoryViewer';
import './stories.css';

const monthLabel = (iso: string) => new Date(iso).toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' });

export function ArchivePage() {
  const me = useMe();
  const [params, setParams] = useSearchParams();
  const list = useCursorList<Story>(archiveKey, '/me/stories/archive', { limit: 60 });
  const stories = flatPages(list.data);
  const [selecting, setSelecting] = useState(params.get('select') === '1');
  const [picked, setPicked] = useState<string[]>([]);
  const [editor, setEditor] = useState(false);
  const [open, setOpen] = useState<string | null>(params.get('story'));

  // Ссылка из уведомления (?story=) открывает нужную историю
  useEffect(() => {
    const id = params.get('story');
    if (id) setOpen(id);
  }, [params]);

  const months = useMemo(() => {
    const out: { label: string; items: Story[] }[] = [];
    for (const s of stories) {
      const label = monthLabel(s.createdAt);
      const last = out.at(-1);
      if (last?.label === label) last.items.push(s);
      else out.push({ label, items: [s] });
    }
    return out;
  }, [stories]);

  const group: StoryGroup[] = stories.length ? [{ author: stories[0]!.author, stories: [...stories].reverse(), hasUnseen: false }] : [];
  const pickedStories = stories.filter((s) => picked.includes(s.id)).reverse();

  return (
    <div className="scroll">
      <div className="page page--wide">
        <PageHeader
          title="Архив историй"
          subtitle="Видите только вы. Отсюда истории можно вернуть в профиль через «Актуальное»"
          icon={<ArchiveIcon size={22} />}
          actions={
            <>
              <Button variant={selecting ? 'secondary' : 'ghost'} size="sm" icon={<Star size={16} />} onClick={() => (setSelecting(!selecting), setPicked([]))}>
                {selecting ? 'Отмена' : 'В Актуальное'}
              </Button>
              <ButtonLink to="/stories/new" size="sm" icon={<Plus size={16} />}>
                Новая
              </ButtonLink>
            </>
          }
        />
        <div className="panel__title" style={{ padding: '4px 0 8px' }}>
          Актуальное в профиле
        </div>
        <HighlightsRow userId={me.id} own />

        {list.isLoading ? null : stories.length === 0 ? (
          <EmptyState
            icon={<ArchiveIcon size={28} />}
            title="Архив пуст"
            text="Все ваши истории автоматически сохраняются здесь — даже после того, как исчезнут из ленты"
            action={<ButtonLink to="/stories/new">Первая история</ButtonLink>}
          />
        ) : (
          months.map((m) => (
            <section key={m.label}>
              <h3 className="archive-month">{m.label}</h3>
              <div className="story-archive">
                {m.items.map((s) => {
                  const d = new Date(s.createdAt);
                  const on = picked.includes(s.id);
                  return (
                    <button
                      key={s.id}
                      type="button"
                      className={cn('story-thumb', on && 'story-thumb--selected')}
                      onClick={() => (selecting ? setPicked((p) => (on ? p.filter((x) => x !== s.id) : [...p, s.id])) : setOpen(s.id))}
                      aria-pressed={selecting ? on : undefined}
                    >
                      <StoryThumbMedia story={s} />
                      <span className="story-thumb__date">
                        <b>{d.getDate()}</b>
                        {d.toLocaleDateString('ru-RU', { month: 'short' }).replace('.', '')}
                      </span>
                      {!s.expired && <span className="story-thumb__live">Сейчас</span>}
                      {s.audience === 'close' && (
                        <span className="story-thumb__close">
                          <Star size={10} fill="currentColor" />
                        </span>
                      )}
                      {selecting && <span className="story-thumb__check">{on && <Check size={14} />}</span>}
                    </button>
                  );
                })}
              </div>
            </section>
          ))
        )}
        <LoadMore hasMore={!!list.hasNextPage} loading={list.isFetchingNextPage} onLoad={() => void list.fetchNextPage()} />

        {selecting && (
          <div className="archive-bar">
            <span className="grow">{picked.length ? `Выбрано: ${picked.length}` : 'Выберите истории для подборки'}</span>
            <Button disabled={!picked.length} onClick={() => setEditor(true)}>
              Создать подборку
            </Button>
          </div>
        )}
      </div>
      {editor && (
        <HighlightEditor
          stories={pickedStories}
          onClose={() => setEditor(false)}
          onDone={() => {
            setSelecting(false);
            setPicked([]);
          }}
        />
      )}
      {open && group.length > 0 && (
        <StoryViewer
          groups={group}
          startStoryId={open}
          onClose={() => {
            setOpen(null);
            if (params.has('story')) setParams({}, { replace: true });
          }}
        />
      )}
      <p className="small muted" style={{ textAlign: 'center', padding: 16 }}>
        Список близких друзей — в <Link to="/settings/privacy/close-friends">настройках приватности</Link>
      </p>
    </div>
  );
}
