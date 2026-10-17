/** Статус и ссылки профиля: окно статуса и редактор ссылок (используются в профиле и настройках). */
import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Link2, Plus, Trash2 } from 'lucide-react';
import { LIMITS, type Me, type ProfileLink } from '@omni/shared';
import { api, ApiError, errorMessage } from '../../shared/api/client';
import { queryClient } from '../../shared/api/query';
import { useMe, useSession } from '../../shared/stores/session';
import { toast } from '../../shared/stores/ui';
import { cn } from '../../shared/lib/format';
import { Button, Input, Modal } from '../../shared/ui';

const STATUS_EMOJI = ['🚀', '💻', '🎧', '📸', '✈️', '🏖️', '🤒', '🍿', '📚', '🏋️', '🎮', '☕', '🔕', '❤️', '🎉', '🧘'];
const PRESETS = [
  { emoji: '💻', text: 'Работаю' },
  { emoji: '🔕', text: 'Не беспокоить' },
  { emoji: '✈️', text: 'В отпуске' },
  { emoji: '🤒', text: 'Болею' },
  { emoji: '🎧', text: 'Слушаю музыку' },
];
const DURATIONS = [
  { h: 0, label: 'Не снимать' },
  { h: 1, label: '1 час' },
  { h: 4, label: '4 часа' },
  { h: 24, label: 'Сутки' },
  { h: 168, label: 'Неделя' },
];

const refreshMe = (me: Me) => {
  useSession.getState().patchMe({ status: me.status, links: me.links });
  void queryClient.invalidateQueries({ queryKey: ['user'] });
};

export function StatusDialog({ onClose }: { onClose: () => void }) {
  const me = useMe();
  const [emoji, setEmoji] = useState(me.status?.emoji ?? '💻');
  const [text, setText] = useState(me.status?.text ?? '');
  const [hours, setHours] = useState(0);
  const save = useMutation({
    mutationFn: () => api.put<Me>('/me/status', { emoji, text: text.trim(), durationHours: hours }),
    onSuccess: (m) => {
      refreshMe(m);
      onClose();
    },
    onError: (e) => toast({ text: errorMessage(e), kind: 'error' }),
  });
  const clear = useMutation({
    mutationFn: () => api.del<Me>('/me/status'),
    onSuccess: (m) => {
      refreshMe(m);
      onClose();
    },
  });
  return (
    <Modal
      open
      onClose={onClose}
      title="Статус"
      footer={
        <>
          {me.status && (
            <Button variant="ghost" onClick={() => clear.mutate()} style={{ marginRight: 'auto' }}>
              Убрать статус
            </Button>
          )}
          <Button loading={save.isPending} onClick={() => save.mutate()}>
            Сохранить
          </Button>
        </>
      }
    >
      <div className="col gap-3">
        <div className="row wrap gap-1">
          {STATUS_EMOJI.map((e) => (
            <button key={e} type="button" className={cn('emoji-pick', emoji === e && 'emoji-pick--on')} onClick={() => setEmoji(e)} aria-label={`Эмодзи ${e}`}>
              {e}
            </button>
          ))}
        </div>
        <Input label="Текст" value={text} maxLength={LIMITS.statusTextMax} onChange={(e) => setText(e.target.value)} placeholder="Чем заняты?" />
        <div className="row wrap gap-2">
          {PRESETS.map((p) => (
            <button key={p.text} type="button" className="chip" onClick={() => (setEmoji(p.emoji), setText(p.text))}>
              {p.emoji} {p.text}
            </button>
          ))}
        </div>
        <div className="field">
          <span className="field__label">Снять через</span>
          <div className="row wrap gap-2">
            {DURATIONS.map((d) => (
              <button key={d.h} type="button" className={cn('chip', hours === d.h && 'chip--active')} onClick={() => setHours(d.h)}>
                {d.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </Modal>
  );
}

export function LinksEditor() {
  const me = useMe();
  const [links, setLinks] = useState<ProfileLink[]>(me.links.length ? me.links : []);
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => api.put<Me>('/me/links', { links: links.filter((l) => l.url.trim()) }),
    onSuccess: (m) => {
      setError(null);
      refreshMe(m);
      setLinks(m.links);
      toast({ text: 'Ссылки сохранены', kind: 'success' });
    },
    onError: (e) => setError(e instanceof ApiError && e.fields ? Object.values(e.fields)[0]! : errorMessage(e)),
  });
  return (
    <div className="col gap-2" style={{ padding: 16 }}>
      {links.map((l, i) => (
        <div key={i} className="row gap-2">
          <input
            className="input"
            style={{ maxWidth: 160 }}
            placeholder="Название"
            value={l.title}
            maxLength={LIMITS.linkTitleMax}
            onChange={(e) => setLinks((list) => list.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))}
            aria-label="Название ссылки"
          />
          <input
            className="input grow"
            placeholder="https://"
            value={l.url}
            onChange={(e) => setLinks((list) => list.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)))}
            aria-label="Адрес ссылки"
          />
          <button type="button" className="icon-btn" aria-label="Убрать ссылку" onClick={() => setLinks((list) => list.filter((_, j) => j !== i))}>
            <Trash2 size={18} />
          </button>
        </div>
      ))}
      {error && <div className="field__error">{error}</div>}
      <div className="row gap-2">
        {links.length < LIMITS.profileLinksMax && (
          <Button variant="ghost" size="sm" icon={<Plus size={16} />} onClick={() => setLinks((l) => [...l, { title: '', url: '' }])}>
            Добавить ссылку
          </Button>
        )}
        <span className="grow" />
        <Button size="sm" icon={<Link2 size={16} />} loading={save.isPending} onClick={() => save.mutate()}>
          Сохранить ссылки
        </Button>
      </div>
    </div>
  );
}
