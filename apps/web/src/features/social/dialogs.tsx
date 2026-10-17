/** Окна соцфункций: в коллекцию, в список, «кто оценил». Без зависимостей от карточек постов. */
import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Check, Heart, Plus } from 'lucide-react';
import { LIMITS, type Collection, type Post, type UserList, type UserSummary } from '@omni/shared';
import { api, errorMessage } from '../../shared/api/client';
import { flatPages, queryClient, useCursorList } from '../../shared/api/query';
import { toast } from '../../shared/stores/ui';
import { cn } from '../../shared/lib/format';
import { Button, EmptyState, Input, ListSkeleton, LoadMore, Modal, UserRow } from '../../shared/ui';
import './social.css';

export const collectionsKey = ['collections'] as const;
export const listsKey = ['lists'] as const;

const EMOJI = ['🔖', '💡', '📚', '🍳', '✈️', '🎵', '🎮', '💼', '❤️', '🔥', '🧠', '🛠️'];

export function EmojiRow({ value, onChange, options = EMOJI }: { value: string; onChange: (e: string) => void; options?: string[] }) {
  return (
    <div className="row wrap gap-1">
      {options.map((e) => (
        <button key={e} type="button" className={cn('emoji-pick', value === e && 'emoji-pick--on')} onClick={() => onChange(e)} aria-label={`Значок ${e}`}>
          {e}
        </button>
      ))}
    </div>
  );
}

/** Создать коллекцию (и сразу положить туда публикацию, если она есть) */
export function CollectionForm({ initial, onClose, onSaved }: { initial?: Collection; onClose: () => void; onSaved?: (c: Collection) => void }) {
  const [name, setName] = useState(initial?.name ?? '');
  const [emoji, setEmoji] = useState(initial?.emoji ?? '🔖');
  const save = useMutation({
    mutationFn: () => (initial ? api.put<Collection>(`/me/collections/${initial.id}`, { name, emoji }) : api.post<Collection>('/me/collections', { name, emoji })),
    onSuccess: (c) => {
      void queryClient.invalidateQueries({ queryKey: collectionsKey });
      onSaved?.(c);
      onClose();
    },
    onError: (e) => toast({ text: errorMessage(e), kind: 'error' }),
  });
  return (
    <Modal
      open
      onClose={onClose}
      title={initial ? 'Изменить коллекцию' : 'Новая коллекция'}
      footer={
        <Button disabled={!name.trim()} loading={save.isPending} onClick={() => save.mutate()}>
          {initial ? 'Сохранить' : 'Создать'}
        </Button>
      }
    >
      <div className="col gap-3">
        <Input label="Название" value={name} maxLength={LIMITS.listNameMax} onChange={(e) => setName(e.target.value)} placeholder="Рецепты, Почитать позже…" autoFocus />
        <EmojiRow value={emoji} onChange={setEmoji} />
      </div>
    </Modal>
  );
}

export function CollectionPickerDialog({ post, onClose }: { post: Post; onClose: () => void }) {
  const key = [...collectionsKey, post.id];
  const q = useQuery({ queryKey: key, queryFn: () => api.get<{ items: Collection[] }>(`/me/collections?postId=${post.id}`) });
  const [creating, setCreating] = useState(false);
  const toggle = useMutation({
    mutationFn: (c: Collection) => (c.hasPost ? api.del<Collection>(`/me/collections/${c.id}/items/${post.id}`) : api.post<Collection>(`/me/collections/${c.id}/items`, { postId: post.id })),
    onSuccess: (_, c) => {
      void queryClient.invalidateQueries({ queryKey: collectionsKey });
      toast({ text: c.hasPost ? `Убрано из «${c.name}»` : `Сохранено в «${c.name}»`, kind: 'success' });
    },
    onError: (e) => toast({ text: errorMessage(e), kind: 'error' }),
  });
  if (creating)
    return (
      <CollectionForm
        onClose={onClose}
        onSaved={(c) => void api.post(`/me/collections/${c.id}/items`, { postId: post.id }).then(() => toast({ text: `Сохранено в «${c.name}»`, kind: 'success' }))}
      />
    );
  const items = q.data?.items ?? [];
  return (
    <Modal open onClose={onClose} title="Сохранить в коллекцию">
      <div className="col gap-2">
        {q.isLoading ? (
          <ListSkeleton rows={2} />
        ) : (
          items.map((c) => (
            <button key={c.id} type="button" className={cn('pick-row', c.hasPost && 'pick-row--on')} onClick={() => toggle.mutate(c)} disabled={toggle.isPending}>
              <span className="collection-icon">{c.cover ? <img src={c.cover.kind === 'video' ? (c.cover.posterUrl ?? '') : c.cover.url} alt="" /> : c.emoji}</span>
              <span className="grow">
                <b>
                  {c.emoji} {c.name}
                </b>
                <span className="xs muted" style={{ display: 'block' }}>
                  {c.count} сохранено
                </span>
              </span>
              <span className="pick-row__check">{c.hasPost && <Check size={14} />}</span>
            </button>
          ))
        )}
        {!q.isLoading && !items.length && <p className="small muted">Коллекции помогают разложить закладки по темам.</p>}
        <Button variant="secondary" icon={<Plus size={18} />} onClick={() => setCreating(true)}>
          Новая коллекция
        </Button>
      </div>
    </Modal>
  );
}

export function ListForm({ initial, onClose, onSaved }: { initial?: UserList; onClose: () => void; onSaved?: (l: UserList) => void }) {
  const [name, setName] = useState(initial?.name ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [emoji, setEmoji] = useState(initial?.emoji ?? '📋');
  const [isPrivate, setPrivate] = useState(initial?.isPrivate ?? true);
  const save = useMutation({
    mutationFn: () => {
      const body = { name, description, emoji, isPrivate };
      return initial ? api.put<UserList>(`/lists/${initial.id}`, body) : api.post<UserList>('/lists', body);
    },
    onSuccess: (l) => {
      void queryClient.invalidateQueries({ queryKey: listsKey });
      void queryClient.invalidateQueries({ queryKey: ['list', l.id] });
      onSaved?.(l);
      onClose();
    },
    onError: (e) => toast({ text: errorMessage(e), kind: 'error' }),
  });
  return (
    <Modal
      open
      onClose={onClose}
      title={initial ? 'Изменить список' : 'Новый список'}
      footer={
        <Button disabled={!name.trim()} loading={save.isPending} onClick={() => save.mutate()}>
          {initial ? 'Сохранить' : 'Создать'}
        </Button>
      }
    >
      <div className="col gap-3">
        <Input label="Название" value={name} maxLength={LIMITS.listNameMax} onChange={(e) => setName(e.target.value)} placeholder="Разработчики, Друзья, Новости…" autoFocus />
        <Input label="Описание" value={description} maxLength={300} onChange={(e) => setDescription(e.target.value)} />
        <EmojiRow value={emoji} onChange={setEmoji} options={['📋', '🧑‍💻', '👥', '📰', '🎨', '🎵', '⚽', '🎮', '🔬', '💼', '⭐', '❤️']} />
        <label className="row gap-2">
          <input type="checkbox" checked={isPrivate} onChange={(e) => setPrivate(e.target.checked)} />
          <span>
            Закрытый список
            <span className="xs muted" style={{ display: 'block' }}>
              Его видите только вы; открытый можно показать по ссылке
            </span>
          </span>
        </label>
      </div>
    </Modal>
  );
}

/** Добавить человека в свои списки (из профиля) */
export function ListPickerDialog({ user, onClose }: { user: UserSummary; onClose: () => void }) {
  const key = [...listsKey, 'member', user.id];
  const q = useQuery({ queryKey: key, queryFn: () => api.get<{ items: UserList[] }>(`/me/lists?memberOf=${user.id}`) });
  const [creating, setCreating] = useState(false);
  const toggle = useMutation({
    mutationFn: (l: UserList) => (l.hasMember ? api.del(`/lists/${l.id}/members/${user.id}`) : api.post(`/lists/${l.id}/members`, { userIds: [user.id] })),
    onSuccess: (_, l) => {
      void queryClient.invalidateQueries({ queryKey: listsKey });
      toast({ text: l.hasMember ? `Убрано из «${l.name}»` : `${user.displayName} — в «${l.name}»`, kind: 'success' });
    },
    onError: (e) => toast({ text: errorMessage(e), kind: 'error' }),
  });
  if (creating)
    return <ListForm onClose={onClose} onSaved={(l) => void api.post(`/lists/${l.id}/members`, { userIds: [user.id] }).then(() => void queryClient.invalidateQueries({ queryKey: listsKey }))} />;
  const items = q.data?.items ?? [];
  return (
    <Modal open onClose={onClose} title={`${user.displayName} в списки`}>
      <div className="col gap-2">
        {q.isLoading ? (
          <ListSkeleton rows={2} />
        ) : (
          items.map((l) => (
            <button key={l.id} type="button" className={cn('pick-row', l.hasMember && 'pick-row--on')} onClick={() => toggle.mutate(l)} disabled={toggle.isPending}>
              <span className="collection-icon">{l.emoji}</span>
              <span className="grow">
                <b>{l.name}</b>
                <span className="xs muted" style={{ display: 'block' }}>
                  {l.memberCount} в списке{l.isPrivate ? ' · закрытый' : ''}
                </span>
              </span>
              <span className="pick-row__check">{l.hasMember && <Check size={14} />}</span>
            </button>
          ))
        )}
        <Button variant="secondary" icon={<Plus size={18} />} onClick={() => setCreating(true)}>
          Новый список
        </Button>
      </div>
    </Modal>
  );
}

export function LikersDialog({ postId, onClose }: { postId: string; onClose: () => void }) {
  const list = useCursorList<UserSummary>(['likers', postId], `/posts/${postId}/likers`);
  const items = flatPages(list.data);
  return (
    <Modal open onClose={onClose} title="Оценили">
      {list.isLoading ? (
        <ListSkeleton rows={4} />
      ) : items.length ? (
        <div className="col">
          {items.map((u) => (
            <UserRow key={u.id} user={u} />
          ))}
          <LoadMore hasMore={!!list.hasNextPage} loading={list.isFetchingNextPage} onLoad={() => void list.fetchNextPage()} />
        </div>
      ) : (
        <EmptyState icon={<Heart size={26} />} title="Пока никто" />
      )}
    </Modal>
  );
}
