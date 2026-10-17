/** Скрытые слова и #теги: такие публикации не попадают в ленты. */
import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Hash, X } from 'lucide-react';
import { LIMITS, type MutedWord } from '@omni/shared';
import { api, errorMessage } from '../../shared/api/client';
import { queryClient } from '../../shared/api/query';
import { toast } from '../../shared/stores/ui';
import { Button, EmptyState, ListSkeleton, Notice, PageHeader } from '../../shared/ui';
import './social.css';

const key = ['muted-words'] as const;
const DURATIONS = [
  { h: 0, label: 'Навсегда' },
  { h: 24, label: 'На сутки' },
  { h: 168, label: 'На неделю' },
  { h: 720, label: 'На месяц' },
];

export function MutedWordsPage() {
  const q = useQuery({ queryKey: key, queryFn: () => api.get<{ items: MutedWord[] }>('/me/muted-words') });
  const [word, setWord] = useState('');
  const [hours, setHours] = useState(0);
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: key });
    void queryClient.invalidateQueries({ queryKey: ['feed'] });
  };
  const add = useMutation({
    mutationFn: () => api.post<MutedWord>('/me/muted-words', { word: word.trim(), durationHours: hours }),
    onSuccess: () => {
      setWord('');
      refresh();
    },
    onError: (e) => toast({ text: errorMessage(e), kind: 'error' }),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/me/muted-words/${id}`),
    onSuccess: refresh,
    onError: (e) => toast({ text: errorMessage(e), kind: 'error' }),
  });
  const items = q.data?.items ?? [];
  return (
    <div className="scroll">
      <div className="page">
        <PageHeader title="Скрытые слова" subtitle="Публикации с этими словами и #тегами не появятся в ваших лентах и списках" icon={<Hash size={22} />} />
        <form
          className="card col gap-3"
          style={{ padding: 16 }}
          onSubmit={(e) => {
            e.preventDefault();
            if (word.trim()) add.mutate();
          }}
        >
          <div className="row gap-2">
            <input className="input grow" value={word} onChange={(e) => setWord(e.target.value)} maxLength={LIMITS.mutedWordMax} placeholder="Слово, фраза или #тег" aria-label="Слово" />
            <Button type="submit" disabled={!word.trim()} loading={add.isPending}>
              Скрыть
            </Button>
          </div>
          <div className="row wrap gap-2">
            {DURATIONS.map((d) => (
              <button key={d.h} type="button" className={`chip${hours === d.h ? ' chip--active' : ''}`} onClick={() => setHours(d.h)}>
                {d.label}
              </button>
            ))}
          </div>
        </form>
        <div style={{ marginTop: 16 }}>
          {q.isLoading ? (
            <ListSkeleton rows={2} />
          ) : items.length === 0 ? (
            <div className="card">
              <EmptyState icon={<Hash size={26} />} title="Ничего не скрыто" text="Например: «спойлер», «#политика», название сериала" />
            </div>
          ) : (
            <div className="row wrap gap-2">
              {items.map((w) => (
                <span key={w.id} className="muted-word">
                  {w.word}
                  {w.until && <small>до {new Date(w.until).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}</small>}
                  <button type="button" className="icon-btn icon-btn--sm" aria-label={`Показывать «${w.word}»`} onClick={() => remove.mutate(w.id)}>
                    <X size={14} />
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>
        <div style={{ marginTop: 16 }}>
          <Notice>Регистр не важен, а слово скрывает и его формы с тем же началом: «спойлер» скроет и «спойлеры». Ваши собственные публикации и личные сообщения не фильтруются.</Notice>
        </div>
      </div>
    </div>
  );
}
