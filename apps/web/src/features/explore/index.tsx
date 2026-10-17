import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Camera, Clapperboard, Compass, Hash, History, Megaphone, MessageCircle, Search, SquarePlay, TrendingUp, UserPlus, Users, X } from 'lucide-react';
import type { ChatSummary, Hashtag, MessageSearchHit, SearchResults, UserSummary } from '@omni/shared';
import { api } from '../../shared/api/client';
import { useDebounced } from '../../shared/hooks';
import { usePrefs } from '../../shared/stores/prefs';
import { chatTime, cn, members } from '../../shared/lib/format';
import { Avatar, EmptyState, ListSkeleton, PageHeader, UserRow } from '../../shared/ui';
import { FollowButton, TrendsBox } from '../feed';
import './explore.css';
import { PostCard } from '../posts/PostCard';
import { FollowListPage } from '../profile';

const TYPES = [
  { id: 'all', label: 'Всё' },
  { id: 'users', label: 'Люди' },
  { id: 'posts', label: 'Публикации' },
  { id: 'chats', label: 'Каналы' },
  { id: 'communities', label: 'Сообщества' },
  { id: 'hashtags', label: 'Хэштеги' },
  { id: 'messages', label: 'Сообщения' },
] as const;

/** Фрагмент вокруг первого совпадения с подсветкой найденных слов */
function Snippet({ text, q }: { text: string; q: string }) {
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
  const lower = text.toLowerCase();
  const first = Math.min(...terms.map((t) => lower.indexOf(t)).filter((i) => i >= 0), text.length);
  const start = first > 60 ? first - 40 : 0;
  const cut = (start ? '…' : '') + text.slice(start, start + 200) + (text.length > start + 200 ? '…' : '');
  const re = new RegExp(`(${terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi');
  return (
    <>
      {cut.split(re).map((part, i) => (i % 2 ? <mark key={i} className="search-mark">{part}</mark> : part))}
    </>
  );
}

function MessageHits({ hits, q }: { hits: MessageSearchHit[]; q: string }) {
  return (
    <>
      {hits.map(({ message: m, chat }) => (
        <Link key={m.id} className="list-item" to={`/chats/${chat.id}?m=${m.seq}`}>
          <Avatar src={chat.avatarUrl} name={chat.title} id={chat.id} size={44} />
          <span className="list-item__body">
            <span className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
              <span className="list-item__title ellipsis">{chat.title}</span>
              <span className="xs faint" style={{ flex: '0 0 auto' }}>
                {chatTime(m.createdAt)}
              </span>
            </span>
            <span className="list-item__sub clamp-2">
              {m.sender && chat.type !== 'direct' && <b>{m.sender.displayName.split(' ')[0]}: </b>}
              <Snippet text={m.text ?? ''} q={q} />
            </span>
          </span>
        </Link>
      ))}
    </>
  );
}

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
    // Запоминаем осмысленные запросы (не короче 2 символов)
    if (debounced.length >= 2) {
      const { recentSearches = [], set } = usePrefs.getState();
      const t = window.setTimeout(() => set({ recentSearches: [debounced, ...recentSearches.filter((x) => x !== debounced && !debounced.startsWith(x))].slice(0, 10) }), 1500);
      return () => window.clearTimeout(t);
    }
  }, [debounced]); // eslint-disable-line react-hooks/exhaustive-deps
  const res = useQuery({
    queryKey: ['search', debounced, type],
    queryFn: () => api.get<SearchResults>(`/search?q=${encodeURIComponent(debounced)}&type=${type}&limit=${type === 'all' ? 6 : 30}`),
    enabled: debounced.length > 0 && type !== 'messages',
  });
  const withMessages = type === 'all' || type === 'messages';
  const msgs = useQuery({
    queryKey: ['search-messages', debounced],
    queryFn: () => api.get<{ items: MessageSearchHit[] }>(`/messages/search?q=${encodeURIComponent(debounced)}`),
    enabled: debounced.length > 1 && withMessages,
  });
  const hits = withMessages ? (msgs.data?.items ?? []) : [];
  const r = type === 'messages' ? undefined : res.data;
  const empty =
    type === 'messages'
      ? msgs.data && !hits.length
      : r && !r.users.length && !r.posts.length && !r.chats.length && !r.communities.length && !r.hashtags.length && !hits.length;
  return (
    <div className="scroll">
      <div className="page">
        <div className="input-group" style={{ marginBottom: 12 }}>
          <Search size={18} className="input-group__icon" />
          <input className="input" style={{ minHeight: 50, fontSize: 'var(--fs-lg)', borderRadius: 999 }} placeholder="Люди, публикации, каналы, #теги и сообщения" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
        </div>
        <div className="chips" style={{ marginBottom: 16 }}>
          {TYPES.map((t) => (
            <button key={t.id} className={cn('chip', type === t.id && 'chip--active')} onClick={() => setParams({ q: debounced, type: t.id })}>
              {t.label}
            </button>
          ))}
        </div>
        {!debounced ? (
          <ExploreHome onSearch={setQ} />
        ) : (type === 'messages' ? msgs.isLoading : res.isLoading) ? (
          <ListSkeleton />
        ) : empty ? (
          <EmptyState icon={<Search size={28} />} title={`По запросу «${debounced}» ничего нет`} text="Проверьте написание или попробуйте другие слова" />
        ) : (
          (r || hits.length > 0) && (
            <div className="col gap-4">
              {hits.length > 0 && (
                <div className="panel">
                  <div className="panel__title row">
                    <MessageCircle size={14} /> Сообщения в ваших чатах
                  </div>
                  <MessageHits hits={type === 'all' ? hits.slice(0, 5) : hits} q={debounced} />
                  {type === 'all' && hits.length > 5 && (
                    <button type="button" className="list-item muted small" style={{ justifyContent: 'center' }} onClick={() => setParams({ q: debounced, type: 'messages' })}>
                      Все совпадения в сообщениях ({hits.length})
                    </button>
                  )}
                </div>
              )}
              {r && r.users.length > 0 && (
                <div className="panel">
                  <div className="panel__title">Люди</div>
                  {r.users.map((u) => (
                    <UserRow key={u.id} user={u} action={<FollowButton user={u} />} />
                  ))}
                </div>
              )}
              {r && r.hashtags.length > 0 && (
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
              {r && r.chats.length > 0 && (
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
              {r && r.communities.length > 0 && (
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
              {r && r.posts.length > 0 && (
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

const CATEGORIES = [
  { to: '/explore/people', label: 'Люди', icon: <UserPlus size={20} />, tile: 'tile-blue' },
  { to: '/chats/discover', label: 'Каналы', icon: <Megaphone size={20} />, tile: 'tile-violet' },
  { to: '/communities/discover', label: 'Сообщества', icon: <Users size={20} />, tile: 'tile-orange' },
  { to: '/video/trending', label: 'Видео', icon: <SquarePlay size={20} />, tile: 'tile-red' },
  { to: '/shorts/trending', label: 'Клипы', icon: <Clapperboard size={20} />, tile: 'tile-pink' },
  { to: '/photos/explore', label: 'Фото', icon: <Camera size={20} />, tile: 'tile-teal' },
  { to: '/explore/trends', label: 'Тренды', icon: <TrendingUp size={20} />, tile: 'tile-green' },
  { to: '/feed/hashtags', label: 'Хэштеги', icon: <Hash size={20} />, tile: 'tile-indigo' },
];

/** Стартовый экран поиска: категории, недавнее, каналы, теги и люди */
function ExploreHome({ onSearch }: { onSearch: (q: string) => void }) {
  const recent = usePrefs((s) => s.recentSearches ?? []);
  const setPrefs = usePrefs((s) => s.set);
  const channels = useQuery({ queryKey: ['discover-chats', ''], queryFn: () => api.get<{ items: ChatSummary[] }>('/chats/discover') });
  const tags = useQuery({ queryKey: ['trends'], queryFn: () => api.get<{ items: Hashtag[] }>('/hashtags/trending?days=30') });
  const people = useQuery({ queryKey: ['suggestions'], queryFn: () => api.get<{ items: UserSummary[] }>('/users/suggestions') });
  const maxTag = Math.max(1, ...(tags.data?.items ?? []).map((t) => t.count));
  return (
    <div className="col gap-5">
      <div className="explore-cats">
        {CATEGORIES.map((c) => (
          <Link key={c.to} to={c.to} className="explore-cat">
            <span className={cn('list-item__icon', c.tile)}>{c.icon}</span>
            {c.label}
          </Link>
        ))}
      </div>

      {recent.length > 0 && (
        <section>
          <div className="explore-head">
            <History size={16} /> Недавние запросы
            <button type="button" className="explore-head__action" onClick={() => setPrefs({ recentSearches: [] })}>
              Очистить
            </button>
          </div>
          <div className="row wrap gap-2">
            {recent.map((r) => (
              <span key={r} className="chip explore-recent">
                <button type="button" onClick={() => onSearch(r)}>
                  {r}
                </button>
                <button type="button" aria-label={`Удалить «${r}»`} onClick={() => setPrefs({ recentSearches: recent.filter((x) => x !== r) })}>
                  <X size={12} />
                </button>
              </span>
            ))}
          </div>
        </section>
      )}

      {!!channels.data?.items.length && (
        <section>
          <div className="explore-head">
            <Megaphone size={16} /> Популярные каналы и группы
            <Link to="/chats/discover" className="explore-head__action">
              Все
            </Link>
          </div>
          <div className="explore-channels">
            {channels.data.items.slice(0, 8).map((c) => (
              <Link key={c.id} to={`/chats/${c.id}`} className="explore-channel">
                <Avatar src={c.avatarUrl} name={c.title} id={c.id} size={56} />
                <b className="ellipsis">{c.title}</b>
                <span className="xs muted">{members(c.memberCount, c.type === 'channel' ? 'channel' : 'group')}</span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {!!tags.data?.items.length && (
        <section>
          <div className="explore-head">
            <Hash size={16} /> О чём говорят
          </div>
          <div className="explore-tags">
            {tags.data.items.slice(0, 24).map((t) => (
              <Link key={t.tag} to={`/tag/${encodeURIComponent(t.tag)}`} className="explore-tag" style={{ fontSize: `calc(var(--fs-sm) * ${(0.9 + (t.count / maxTag) * 0.8).toFixed(2)})` }}>
                #{t.tag}
                <span>{t.count}</span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {!!people.data?.items.length && (
        <section>
          <div className="explore-head">
            <Compass size={16} /> Кого почитать
            <Link to="/explore/people" className="explore-head__action">
              Все
            </Link>
          </div>
          <div className="explore-people">
            {people.data.items.slice(0, 8).map((u) => (
              <div key={u.id} className="explore-person">
                <Link to={`/u/${u.username}`} className="col center" style={{ gap: 6, color: 'inherit' }}>
                  <Avatar src={u.avatarUrl} name={u.displayName} id={u.id} size={64} />
                  <b className="ellipsis" style={{ maxWidth: '100%' }}>
                    {u.displayName}
                  </b>
                  <span className="xs muted">@{u.username}</span>
                </Link>
                <FollowButton user={u} />
              </div>
            ))}
          </div>
        </section>
      )}
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

