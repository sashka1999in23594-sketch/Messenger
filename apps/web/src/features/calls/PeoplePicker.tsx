/**
 * Выбор людей для звонка: недавние чаты и подписки, поиск по имени и ввод
 * @имени пользователя. Выбранные — чипами сверху, до 49 собеседников.
 */
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AtSign, Check, Search, X } from 'lucide-react';
import { MAX_ROOM_MEMBERS, SYSTEM_USER_ID, type ChatSummary, type Paginated, type SearchResults, type UserSummary } from '@omni/shared';
import { api } from '../../shared/api/client';
import { useDebounced } from '../../shared/hooks';
import { useMe } from '../../shared/stores/session';
import { cn } from '../../shared/lib/format';
import { Avatar, Spinner } from '../../shared/ui';

export interface Picked {
  users: UserSummary[];
  /** Имена, введённые вручную (проверит сервер) */
  usernames: string[];
}

const USERNAME = /^@?[a-z0-9_.]{3,32}$/i;

export function PeoplePicker({ value, onChange, exclude = [] }: { value: Picked; onChange: (p: Picked) => void; exclude?: string[] }) {
  const me = useMe();
  const [q, setQ] = useState('');
  const term = useDebounced(q.trim(), 250);
  const max = MAX_ROOM_MEMBERS - 1 - exclude.length;

  const chats = useQuery({
    queryKey: ['call-people', 'chats'],
    queryFn: () => api.get<Paginated<ChatSummary>>('/chats?limit=60'),
    staleTime: 60_000,
  });
  const following = useQuery({
    queryKey: ['call-people', 'following', me.id],
    queryFn: () => api.get<{ items: UserSummary[] }>(`/users/${me.id}/following?limit=100`),
    staleTime: 5 * 60_000,
  });
  const found = useQuery({
    queryKey: ['call-people', 'search', term],
    queryFn: () => api.get<SearchResults>(`/search?type=users&limit=20&q=${encodeURIComponent(term.replace(/^@/, ''))}`),
    enabled: term.replace(/^@/, '').length >= 2,
    staleTime: 30_000,
  });

  // Сначала недавние собеседники, потом подписки — без повторов
  const suggestions = useMemo(() => {
    const seen = new Set<string>([me.id, SYSTEM_USER_ID, ...exclude]);
    const out: UserSummary[] = [];
    const push = (u: UserSummary | null | undefined) => {
      if (!u || seen.has(u.id)) return;
      seen.add(u.id);
      out.push(u);
    };
    for (const c of chats.data?.items ?? []) if (c.type === 'direct' || c.type === 'secret') push(c.peer);
    for (const u of following.data?.items ?? []) push(u);
    return out;
  }, [chats.data, following.data, me.id, exclude]);

  const lower = term.toLowerCase().replace(/^@/, '');
  const list = term
    ? [
        ...suggestions.filter((u) => u.displayName.toLowerCase().includes(lower) || u.username.toLowerCase().includes(lower)),
        ...(found.data?.users ?? []).filter((u) => u.id !== me.id && u.id !== SYSTEM_USER_ID && !exclude.includes(u.id) && !suggestions.some((s) => s.id === u.id)),
      ]
    : suggestions;

  const picked = new Set(value.users.map((u) => u.id));
  const count = value.users.length + value.usernames.length;
  const toggle = (u: UserSummary) => {
    if (picked.has(u.id)) onChange({ ...value, users: value.users.filter((x) => x.id !== u.id) });
    else if (count < max) onChange({ ...value, users: [...value.users, u] });
  };
  const typed = term.replace(/^@/, '').toLowerCase();
  const canAddName = USERNAME.test(term) && !list.some((u) => u.username.toLowerCase() === typed) && !value.usernames.includes(typed);
  const addName = () => {
    if (!canAddName || count >= max) return;
    onChange({ ...value, usernames: [...value.usernames, typed] });
    setQ('');
  };

  return (
    <div className="pp">
      {count > 0 && (
        <div className="pp__chips" aria-label="Выбраны">
          {value.users.map((u) => (
            <button key={u.id} type="button" className="pp__chip" onClick={() => toggle(u)} aria-label={`Убрать ${u.displayName}`}>
              <Avatar src={u.avatarUrl} name={u.displayName} id={u.id} size={22} />
              {u.displayName.split(' ')[0]}
              <X size={14} />
            </button>
          ))}
          {value.usernames.map((n) => (
            <button key={n} type="button" className="pp__chip" onClick={() => onChange({ ...value, usernames: value.usernames.filter((x) => x !== n) })} aria-label={`Убрать @${n}`}>
              <AtSign size={14} />
              {n}
              <X size={14} />
            </button>
          ))}
        </div>
      )}
      <label className="pp__search">
        <Search size={17} />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addName())}
          placeholder="Имя или @username"
          aria-label="Найти человека или ввести имя пользователя"
          autoComplete="off"
        />
      </label>
      <p className="pp__count">
        Выбрано {count} из {max}
      </p>
      <div className="pp__list" role="listbox" aria-multiselectable="true" aria-label="Люди">
        {canAddName && (
          <button type="button" className="pp__row" onClick={addName}>
            <span className="pp__at">
              <AtSign size={20} />
            </span>
            <span className="pp__text">
              <b>Позвать @{typed}</b>
              <span>По имени пользователя</span>
            </span>
          </button>
        )}
        {list.map((u) => (
          <button key={u.id} type="button" role="option" aria-selected={picked.has(u.id)} className={cn('pp__row', picked.has(u.id) && 'is-on')} onClick={() => toggle(u)}>
            <Avatar src={u.avatarUrl} name={u.displayName} id={u.id} size={42} />
            <span className="pp__text">
              <b>{u.displayName}</b>
              <span>@{u.username}</span>
            </span>
            <span className="pp__check">{picked.has(u.id) && <Check size={15} strokeWidth={3} />}</span>
          </button>
        ))}
        {(chats.isLoading || following.isLoading || found.isFetching) && (
          <div className="pp__empty">
            <Spinner />
          </div>
        )}
        {!list.length && !canAddName && !chats.isLoading && !following.isLoading && !found.isFetching && (
          <p className="pp__empty">{term ? 'Никого не нашли — введите точное имя пользователя' : 'Здесь появятся ваши собеседники и подписки'}</p>
        )}
      </div>
    </div>
  );
}
