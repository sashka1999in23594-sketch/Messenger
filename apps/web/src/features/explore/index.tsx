import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Hash, Search, TrendingUp } from 'lucide-react';
import type { SearchResults } from '@omni/shared';
import { api } from '../../shared/api/client';
import { useDebounced } from '../../shared/hooks';
import { cn, members } from '../../shared/lib/format';
import { Avatar, EmptyState, ListSkeleton, PageHeader, UserRow } from '../../shared/ui';
import { FollowButton, TrendsBox, WhoToFollow } from '../feed';
import { PostCard } from '../posts/PostCard';
import { FollowListPage } from '../profile';

const TYPES = [
  { id: 'all', label: 'Всё' },
  { id: 'users', label: 'Люди' },
  { id: 'posts', label: 'Публикации' },
  { id: 'chats', label: 'Каналы' },
  { id: 'communities', label: 'Сообщества' },
  { id: 'hashtags', label: 'Хэштеги' },
] as const;

export function SearchPage() {
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState(params.get('q') ?? '');
  const type = params.get('type') ?? 'all';
  const debounced = useDebounced(q.trim(), 300);
  useEffect(() => {
    const next = new URLSearchParams(params);
    if (debounced) next.set('q', debounced);
    else next.delete('q');
    setParams(next, { replace: true });
  }, [debounced]); // eslint-disable-line react-hooks/exhaustive-deps
  const res = useQuery({
    queryKey: ['search', debounced, type],
    queryFn: () => api.get<SearchResults>(`/search?q=${encodeURIComponent(debounced)}&type=${type}&limit=${type === 'all' ? 6 : 30}`),
    enabled: debounced.length > 0,
  });
  const r = res.data;
  const empty = r && !r.users.length && !r.posts.length && !r.chats.length && !r.communities.length && !r.hashtags.length;
  return (
    <div className="scroll">
      <div className="page">
        <div className="input-group" style={{ marginBottom: 12 }}>
          <Search size={18} className="input-group__icon" />
          <input className="input" style={{ minHeight: 50, fontSize: 'var(--fs-lg)', borderRadius: 999 }} placeholder="Поиск людей, публикаций, каналов, #тегов" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
        </div>
        <div className="chips" style={{ marginBottom: 16 }}>
          {TYPES.map((t) => (
            <button key={t.id} className={cn('chip', type === t.id && 'chip--active')} onClick={() => setParams({ q: debounced, type: t.id })}>
              {t.label}
            </button>
          ))}
        </div>
        {!debounced ? (
          <div className="col gap-4">
            <TrendsBox />
            <WhoToFollow />
          </div>
        ) : res.isLoading ? (
          <ListSkeleton />
        ) : empty ? (
          <EmptyState icon={<Search size={28} />} title={`По запросу «${debounced}» ничего нет`} text="Проверьте написание или попробуйте другие слова" />
        ) : (
          r && (
            <div className="col gap-4">
              {r.users.length > 0 && (
                <div className="panel">
                  <div className="panel__title">Люди</div>
                  {r.users.map((u) => (
                    <UserRow key={u.id} user={u} action={<FollowButton user={u} />} />
                  ))}
                </div>
              )}
              {r.hashtags.length > 0 && (
                <div className="panel">
                  <div className="panel__title">Хэштеги</div>
                  {r.hashtags.map((h) => (
                    <Link key={h.tag} className="list-item" to={`/tag/${encodeURIComponent(h.tag)}`}>
                      <span className="list-item__icon">
                        <Hash size={18} />
                      </span>
                      <span className="list-item__body">#{h.tag}</span>
                      <span className="list-item__end">{h.count}</span>
                    </Link>
                  ))}
                </div>
              )}
              {r.chats.length > 0 && (
                <div className="panel">
                  <div className="panel__title">Каналы и группы</div>
                  {r.chats.map((c) => (
                    <Link key={c.id} className="list-item" to={`/chats/${c.id}`}>
                      <Avatar src={c.avatarUrl} name={c.title} id={c.id} size={44} />
                      <span className="list-item__body">
                        <span className="list-item__title" style={{ display: 'block' }}>
                          {c.title}
                        </span>
                        <span className="list-item__sub">{members(c.memberCount, c.type === 'channel' ? 'channel' : 'group')}</span>
                      </span>
                    </Link>
                  ))}
                </div>
              )}
              {r.communities.length > 0 && (
                <div className="panel">
                  <div className="panel__title">Сообщества</div>
                  {r.communities.map((c) => (
                    <Link key={c.id} className="list-item" to={`/c/${c.slug}`}>
                      <Avatar src={c.avatarUrl} name={c.name} id={c.id} size={44} />
                      <span className="list-item__body">
                        <span className="list-item__title" style={{ display: 'block' }}>
                          {c.name}
                        </span>
                        <span className="list-item__sub">{members(c.memberCount)}</span>
                      </span>
                    </Link>
                  ))}
                </div>
              )}
              {r.posts.length > 0 && (
                <div className="panel">
                  <div className="panel__title">Публикации</div>
                  {r.posts.map((p) => (
                    <PostCard key={p.id} post={p} />
                  ))}
                </div>
              )}
            </div>
          )
        )}
      </div>
    </div>
  );
}

export function TrendsPage() {
  return (
    <div className="scroll">
      <div className="page">
        <PageHeader title="Тренды" subtitle="Самые обсуждаемые темы за месяц" icon={<TrendingUp size={22} />} />
        <TrendsBox limit={30} />
      </div>
    </div>
  );
}

export function PeoplePage() {
  return <FollowListPage which="suggestions" />;
}

