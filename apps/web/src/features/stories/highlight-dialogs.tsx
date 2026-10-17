/** Окна «Актуального»: создать/изменить подборку и быстро добавить в неё историю. */
import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Check, Plus, Star, Trash2 } from 'lucide-react';
import { LIMITS, type Story, type StoryHighlight } from '@omni/shared';
import { api, errorMessage } from '../../shared/api/client';
import { useMe } from '../../shared/stores/session';
import { toast } from '../../shared/stores/ui';
import { cn } from '../../shared/lib/format';
import { Button, confirm, Input, ListSkeleton, Modal } from '../../shared/ui';
import { refreshStories, useHighlights } from './api';

export function StoryThumbMedia({ story }: { story: Story }) {
  return story.media.kind === 'video' ? (
    story.media.posterUrl ? <img src={story.media.posterUrl} alt="" loading="lazy" /> : <video src={story.media.url} muted preload="metadata" />
  ) : (
    <img src={story.media.url} alt="" loading="lazy" />
  );
}

/** Создание или изменение подборки. stories — из чего выбирать обложку (выбранные истории). */
export function HighlightEditor({
  highlight,
  stories,
  onClose,
  onDone,
}: {
  highlight?: StoryHighlight;
  stories: Story[];
  onClose: () => void;
  onDone?: () => void;
}) {
  const me = useMe();
  const [title, setTitle] = useState(highlight?.title ?? '');
  const [cover, setCover] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => {
      const body = { title: title.trim(), storyIds: stories.map((s) => s.id), coverStoryId: cover };
      return highlight ? api.put<StoryHighlight>(`/highlights/${highlight.id}`, body) : api.post<StoryHighlight>('/highlights', body);
    },
    onSuccess: () => {
      refreshStories(me.id);
      toast({ text: highlight ? 'Подборка сохранена' : 'Подборка появилась в профиле', kind: 'success' });
      onDone?.();
      onClose();
    },
    onError: (e) => toast({ text: errorMessage(e), kind: 'error' }),
  });
  const remove = async () => {
    if (!highlight) return;
    if (!(await confirm({ title: `Удалить «${highlight.title}»?`, text: 'Истории останутся в архиве.', danger: true, confirmLabel: 'Удалить' }))) return;
    try {
      await api.del(`/highlights/${highlight.id}`);
      refreshStories(me.id);
      onDone?.();
      onClose();
    } catch (e) {
      toast({ text: errorMessage(e), kind: 'error' });
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      title={highlight ? 'Изменить подборку' : 'Новая подборка «Актуального»'}
      footer={
        <>
          {highlight && (
            <Button variant="ghost" icon={<Trash2 size={16} />} onClick={() => void remove()} style={{ marginRight: 'auto', color: 'var(--danger)' }}>
              Удалить
            </Button>
          )}
          <Button variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button disabled={!title.trim() || !stories.length} loading={save.isPending} onClick={() => save.mutate()}>
            {highlight ? 'Сохранить' : 'Создать'}
          </Button>
        </>
      }
    >
      <div className="col gap-3">
        <Input label="Название" value={title} maxLength={LIMITS.highlightTitleMax} onChange={(e) => setTitle(e.target.value)} placeholder="Путешествия, Еда, Работа…" autoFocus />
        <div className="field">
          <span className="field__label">Обложка · историй: {stories.length}</span>
          <div className="cover-pick">
            {stories.map((s, i) => (
              <button key={s.id} type="button" className={cn((cover ?? stories[0]?.id) === s.id && 'cover-pick__on')} onClick={() => setCover(s.id)} aria-label={`Обложка ${i + 1}`}>
                <StoryThumbMedia story={s} />
              </button>
            ))}
          </div>
        </div>
        <p className="small muted">«Актуальное» показывается в профиле и не исчезает через 24 часа. Истории «для близких» в подборке увидят только близкие друзья.</p>
      </div>
    </Modal>
  );
}

/** Из просмотрщика: добавить историю в существующую подборку или создать новую. */
export function AddToHighlightDialog({ story, onClose }: { story: Story; onClose: () => void }) {
  const me = useMe();
  const q = useHighlights(me.id);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const ids = useQuery({
    queryKey: ['highlight-ids', (q.data?.items ?? []).map((h) => h.id).join(',')],
    queryFn: async () => {
      const out: Record<string, string[]> = {};
      for (const h of q.data?.items ?? []) out[h.id] = (await api.get<{ items: string[] }>(`/highlights/${h.id}/story-ids`)).items;
      return out;
    },
    enabled: !!q.data,
  });
  const toggle = async (h: StoryHighlight) => {
    const current = ids.data?.[h.id] ?? [];
    const has = current.includes(story.id);
    const next = has ? current.filter((x) => x !== story.id) : [...current, story.id];
    if (!next.length) return toast('В подборке должна остаться хотя бы одна история');
    setBusy(h.id);
    try {
      await api.put(`/highlights/${h.id}`, { title: h.title, storyIds: next });
      refreshStories(me.id);
      void ids.refetch();
      toast({ text: has ? `Убрано из «${h.title}»` : `Добавлено в «${h.title}»`, kind: 'success' });
    } catch (e) {
      toast({ text: errorMessage(e), kind: 'error' });
    } finally {
      setBusy(null);
    }
  };
  if (creating) return <HighlightEditor stories={[story]} onClose={onClose} />;
  return (
    <Modal open onClose={onClose} title="В Актуальное">
      <div className="col gap-2">
        {q.isLoading ? (
          <ListSkeleton rows={2} />
        ) : (
          (q.data?.items ?? []).map((h) => {
            const on = ids.data?.[h.id]?.includes(story.id);
            return (
              <button key={h.id} type="button" className={cn('pick-row', on && 'pick-row--on')} onClick={() => void toggle(h)} disabled={busy === h.id || !ids.data}>
                <span className="highlight__cover" style={{ width: 44, height: 44, padding: 2 }}>
                  {h.cover ? <img src={h.cover.kind === 'video' ? (h.cover.posterUrl ?? '') : h.cover.url} alt="" /> : <span><Star size={16} /></span>}
                </span>
                <span className="grow">
                  <b>{h.title}</b>
                  <span className="xs muted" style={{ display: 'block' }}>
                    историй: {h.count}
                  </span>
                </span>
                <span className="pick-row__check">{on && <Check size={14} />}</span>
              </button>
            );
          })
        )}
        <Button variant="secondary" icon={<Plus size={18} />} onClick={() => setCreating(true)}>
          Новая подборка
        </Button>
      </div>
    </Modal>
  );
}
