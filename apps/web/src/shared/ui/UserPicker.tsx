/** Выбор человека: без запроса — контакты и рекомендации, с запросом — поиск. */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check, Search } from 'lucide-react';
import type { UserSummary } from '@omni/shared';
import { api } from '../api/client';
import { useDebounced } from '../hooks';
import { useMe } from '../stores/session';
import { Avatar } from './Avatar';
import { Spinner } from './Feedback';
import { UserName } from './Misc';

export function UserPicker({ multiple, onPick, picked = [], exclude = [] }: { multiple?: boolean; onPick: (u: UserSummary) => void; picked?: string[]; exclude?: string[] }) {
  const [q, setQ] = useState('');
  const debounced = useDebounced(q.trim(), 250);
  const me = useMe();
  // Без запроса показываем контакты (подписки), затем рекомендации
  const suggestions = useQuery({
    queryKey: ['picker-contacts', me.id],
    queryFn: async () => {
      const [following, suggested] = await Promise.all([
        api.get<{ items: UserSummary[] }>(`/users/${me.id}/following?limit=50`),
        api.get<{ items: UserSummary[] }>('/users/suggestions'),
      ]);
      const seen = new Set<string>();
      return { items: [...following.items, ...suggested.items].filter((u) => !seen.has(u.id) && seen.add(u.id)) };
    },
  });
  const search = useQuery({
    queryKey: ['user-search', debounced],
    queryFn: () => api.get<{ users: UserSummary[] }>(`/search?type=users&limit=20&q=${encodeURIComponent(debounced)}`),
    enabled: debounced.length > 0,
  });
  const users = (debounced ? search.data?.users : suggestions.data?.items) ?? [];
  return (
    <div className="col">
      <div className="input-group">
        <Search size={16} className="input-group__icon" />
        <input className="input" placeholder="Имя или @username" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {!debounced && <div className="section-nav__group-label" style={{ paddingLeft: 4 }}>Контакты и рекомендации</div>}
      {(search.isFetching || suggestions.isLoading) && <Spinner />}
      {users
        .filter((u) => !exclude.includes(u.id))
        .map((u) => {
          const on = picked.includes(u.id);
          return (
            <button key={u.id} className="list-item" style={{ borderRadius: 12, paddingLeft: 8 }} onClick={() => onPick(u)}>
              <Avatar src={u.avatarUrl} name={u.displayName} id={u.id} size={42} />
              <span className="list-item__body">
                <UserName user={u} />
                <span className="list-item__sub" style={{ display: 'block' }}>
                  @{u.username}
                </span>
              </span>
              {multiple && (
                <span className={on ? 'badge' : 'badge badge--muted'} style={{ opacity: on ? 1 : 0.25 }}>
                  <Check size={12} />
                </span>
              )}
            </button>
          );
        })}
      {debounced && search.data && users.length === 0 && <div className="muted small" style={{ padding: 12 }}>Никого не нашли</div>}
    </div>
  );
}
