/**
 * Поиск: строка сверху, недавние запросы и «Интересное» плиткой, пока ничего
 * не введено; с запросом — люди (в том числе по номеру), каналы, группы,
 * сообщества, темы, публикации и свои сообщения.
 */
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Clock, Hash, Megaphone, Search, Users, X } from 'lucide-react';
import { looksLikePhone, type Hashtag, type MessageSearchHit, type Post, type SearchResults, type UserSummary } from '@omni/shared';
import { api } from '../../shared/api/client';
import { flatPages, useCursorList } from '../../shared/api/query';
import { useDebounced } from '../../shared/hooks';
import { chatTime, cn, compactNumber, members, plural } from '../../shared/lib/format';
import { Avatar, EmptyState, ListSkeleton, LoadMore, Verified } from '../../shared/ui';
import { FollowButton } from '../feed';
import { PostCard } from '../posts/PostCard';
import { GridSkeleton, Tile } from '../profile/PhotoGrid';
import '../profile/photo-grid.css';
import './explore.css';

// ─── Недавнее (только на этом устройстве) ─────────────────────────────────

type Recent = { kind: 'q'; q: string } | { kind: 'user'; user: UserSummary } | { kind: 'tag'; tag: string };
const RECENT_KEY = 'sunnet-recent-search';
const recentId = (r: Recent) => (r.kind === 'q' ? `q:${r.q}` : r.kind === 'tag' ? `t:${r.tag}` : `u:${r.user.id}`);

function loadRecent(): Recent[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') as unknown;
    return Array.isArray(v) ? (v as Recent[]).slice(0, 20) : [];
  } catch {
    return [];
  }
}

function useRecent() {
  const [items, setItems] = useState<Recent[]>(loadRecent);
  const save = (list: Recent[]) => {
    setItems(list);
    try {
      localStorage.setItem(RECENT_KEY, JSON.stringify(list));
    } catch {
      // Хранилище недоступно — недавнее живёт до перезагрузки
    }
  };
  return {
    items,
    add: (r: Recent) => save([r, ...items.filter((x) => recentId(x) !== recentId(r))].slice(0, 20)),
    remove: (r: Recent) => save(items.filter((x) => recentId(x) !== recentId(r))),
    clear: () => save([]),
  };
}

// ─── Подсветка совпадений ────────────────────────────────────────────────

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

function Section({ title, more, children }: { title: string; more?: () => void; children: React.ReactNode }) {
  return (
    <section className="sx-section">
      <div className="sx-section__head">
        <h2>{title}</h2>
        {more && (
          <button type="button" onClick={more}>
            Показать все
          </button>
        )}
      </div>
      {children}
    </section>
  );
}

/** «Интересное»: публикации с фото и видео плиткой, крупная плитка — каждая пятая. */
function ExploreGrid() {
  const list = useCursorList<Post>(['explore', 'trending'], '/feed/trending?kind=all', { limit: 30 });
  const items = flatPages(list.data).filter((p) => (p.repostOf && !p.text ? p.repostOf : p).media.some((m) => m.kind === 'image' || m.kind === 'video'));
  if (list.isLoading) return <GridSkeleton count={12} />;
  if (!items.length) return null;
  return (
    <>
      <div className="sx-grid">
        {items.map((p, i) => (
          <Tile key={p.id} p={p} className={cn(i % 10 === 2 && 'sx-grid__big', i % 10 === 5 && 'sx-grid__big sx-grid__big--left')} />
        ))}
      </div>
      <LoadMore hasMore={!!list.hasNextPage} loading={list.isFetchingNextPage} onLoad={() => void list.fetchNextPage()} />
    </>
  );
}

type Filter = 'all' | 'users' | 'channels' | 'groups' | 'spaces' | 'tags' | 'posts' | 'messages';

export function SearchPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const [q, setQ] = useState(params.get('q') ?? '');
  const [focused, setFocused] = useState(false);
  const [filter, setFilter] = useState<Filter>('all');
  const input = useRef<HTMLInputElement>(null);
  const recent = useRecent();
  const debounced = useDebounced(q.trim(), 300);
  useEffect(() => {
    const next = new URLSearchParams(params);
    if (debounced) next.set('q', debounced);
    else next.delete('q');
    setParams(next, { replace: true });
    setFilter('all');
  }, [debounced]); // eslint-disable-line react-hooks/exhaustive-deps

  const phone = looksLikePhone(debounced);
  const res = useQuery({
    queryKey: ['search', debounced],
    queryFn: () => api.get<SearchResults>(`/search?q=${encodeURIComponent(debounced)}&type=all&limit=20`),
    enabled: debounced.length > 0,
  });
  const msgs = useQuery({
    queryKey: ['search-messages', debounced],
    queryFn: () => api.get<{ items: MessageSearchHit[] }>(`/messages/search?q=${encodeURIComponent(debounced)}`),
    enabled: debounced.length > 1 && !phone,
  });
  const trends = useQuery({ queryKey: ['trends'], queryFn: () => api.get<{ items: Hashtag[] }>('/hashtags/trending?days=30'), enabled: !debounced });
  const r = res.data;
  const hits = msgs.data?.items ?? [];
  const channels = r?.chats.filter((c) => c.type === 'channel') ?? [];
  const groups = r?.chats.filter((c) => c.type !== 'channel') ?? [];
  const tags = r?.hashtags ?? [];
  const empty = r && !r.users.length && !r.posts.length && !r.chats.length && !r.spaces.length && !tags.length && !hits.length;
  const show = (f: Filter) => filter === 'all' || filter === f;
  const limit = (f: Filter, n: number) => (filter === f ? 999 : n);
  const remember = () => debounced && recent.add({ kind: 'q', q: debounced });

  const counts: [Filter, string, number][] = [
    ['users', 'Люди', r?.users.length ?? 0],
    ['channels', 'Каналы', channels.length],
    ['groups', 'Группы', groups.length],
    ['spaces', 'Сообщества', r?.spaces.length ?? 0],
    ['tags', 'Темы', tags.length],
    ['posts', 'Публикации', r?.posts.length ?? 0],
    ['messages', 'Сообщения', hits.length],
  ];
  const typing = focused || !!q;

  return (
    <div className="pk-root">
      <div className="scroll">
        <div className="sx">
          <div className="sx-bar">
            <label className={cn('sx-field', focused && 'sx-field--focus')}>
              <Search size={18} className="sx-field__icon" />
              <input
                ref={input}
                placeholder="Люди, каналы, темы, номер телефона"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onFocus={() => setFocused(true)}
                onBlur={() => setTimeout(() => setFocused(false), 150)}
                onKeyDown={(e) => e.key === 'Enter' && (remember(), (e.target as HTMLInputElement).blur())}
                autoFocus={!matchMedia('(pointer: coarse)').matches}
                aria-label="Поиск"
                enterKeyHint="search"
                type="search"
              />
              {q && (
                <button type="button" className="sx-field__clear" onClick={() => (setQ(''), input.current?.focus())} aria-label="Очистить">
                  <X size={14} strokeWidth={3} />
                </button>
              )}
            </label>
            {typing && (
              <button
                type="button"
                className="sx-cancel"
                onClick={() => {
                  setQ('');
                  input.current?.blur();
                  setFocused(false);
                }}
              >
                Отмена
              </button>
            )}
          </div>

          {!debounced ? (
            <>
              {recent.items.length > 0 && (focused || !q) && (
                <Section title="Недавнее">
                  <div className="sx-recent">
                    {recent.items.slice(0, focused ? 12 : 6).map((it) => (
                      <div key={recentId(it)} className="sx-row">
                        <button
                          type="button"
                          className="sx-row__main"
                          onClick={() => (it.kind === 'q' ? setQ(it.q) : it.kind === 'tag' ? navigate(`/tag/${encodeURIComponent(it.tag)}`) : navigate(`/u/${it.user.username}`))}
                        >
                          {it.kind === 'user' ? (
                            <Avatar src={it.user.avatarUrl} name={it.user.displayName} id={it.user.id} size={44} />
                          ) : (
                            <span className="sx-row__icon">{it.kind === 'tag' ? <Hash size={20} /> : <Clock size={20} />}</span>
                          )}
                          <span className="sx-row__text">
                            {it.kind === 'user' ? (
                              <>
                                <b className="row gap-1" style={{ display: 'flex' }}>
                                  <span className="ellipsis">{it.user.displayName}</span>
                                  {it.user.verified && <Verified size={14} />}
                                </b>
                                <span>@{it.user.username}</span>
                              </>
                            ) : (
                              <b className="ellipsis">{it.kind === 'tag' ? `#${it.tag}` : it.q}</b>
                            )}
                          </span>
                        </button>
                        <button type="button" className="pk-icon sx-row__x" onClick={() => recent.remove(it)} aria-label="Убрать из недавнего">
                          <X size={18} />
                        </button>
                      </div>
                    ))}
                  </div>
                  <button type="button" className="sx-clear-all" onClick={recent.clear}>
                    Очистить историю поиска
                  </button>
                </Section>
              )}
              {!!trends.data?.items.length && (
                <Section title="Популярные темы">
                  <div className="sx-tags">
                    {trends.data.items.slice(0, 12).map((h) => (
                      <Link key={h.tag} to={`/tag/${encodeURIComponent(h.tag)}`} className="sx-tag" onClick={() => recent.add({ kind: 'tag', tag: h.tag })}>
                        #{h.tag}
                        <span>{compactNumber(h.count)}</span>
                      </Link>
                    ))}
                  </div>
                </Section>
              )}
              <Section title="Интересное">
                <ExploreGrid />
              </Section>
            </>
          ) : res.isLoading ? (
            <ListSkeleton rows={6} avatar={44} />
          ) : empty ? (
            <EmptyState
              icon={<Search size={28} />}
              title="Ничего не найдено"
              text={phone ? 'Человек с таким номером не найден или скрыл возможность поиска по номеру' : `По запросу «${debounced}» ничего нет. Проверьте написание или попробуйте другие слова`}
            />
          ) : (
            r && (
              <div className="sx-results">
                <div className="pk-chips sx-filters" role="tablist">
                  {(['all', ...counts.filter(([, , n]) => n > 0).map(([f]) => f)] as Filter[]).map((f) => (
                    <button key={f} type="button" role="tab" aria-selected={filter === f} className={cn('pk-chip', filter === f && 'pk-chip--on')} onClick={() => setFilter(f)}>
                      {f === 'all' ? 'Все' : counts.find(([x]) => x === f)![1]}
                    </button>
                  ))}
                </div>
                {show('users') && r.users.length > 0 && (
                  <Section title="Люди" more={filter === 'all' && r.users.length > 4 ? () => setFilter('users') : undefined}>
                    {r.users.slice(0, limit('users', 4)).map((u) => (
                      <div key={u.id} className="sx-row">
                        <Link to={`/u/${u.username}`} className="sx-row__main" onClick={() => recent.add({ kind: 'user', user: u })}>
                          <Avatar src={u.avatarUrl} name={u.displayName} id={u.id} size={48} />
                          <span className="sx-row__text">
                            <b className="row gap-1" style={{ display: 'flex' }}>
                              <span className="ellipsis">{u.displayName}</span>
                              {u.verified && <Verified size={14} />}
                            </b>
                            <span>@{u.username}</span>
                          </span>
                        </Link>
                        <FollowButton user={u} />
                      </div>
                    ))}
                  </Section>
                )}
                {show('channels') && channels.length > 0 && (
                  <Section title="Каналы" more={filter === 'all' && channels.length > 3 ? () => setFilter('channels') : undefined}>
                    {channels.slice(0, limit('channels', 3)).map((c) => (
                      <Link key={c.id} className="sx-row sx-row__main" to={`/channels/${c.id}`} onClick={remember}>
                        <Avatar src={c.avatarUrl} name={c.title} id={c.id} size={48} />
                        <span className="sx-row__text">
                          <b className="ellipsis">{c.title}</b>
                          <span>
                            {c.handle ? `@${c.handle} · ` : ''}
                            {members(c.memberCount, 'channel')}
                          </span>
                        </span>
                        <Megaphone size={18} className="faint" />
                      </Link>
                    ))}
                  </Section>
                )}
                {show('groups') && groups.length > 0 && (
                  <Section title="Группы" more={filter === 'all' && groups.length > 3 ? () => setFilter('groups') : undefined}>
                    {groups.slice(0, limit('groups', 3)).map((c) => (
                      <Link key={c.id} className="sx-row sx-row__main" to={`/chats/${c.id}`} onClick={remember}>
                        <Avatar src={c.avatarUrl} name={c.title} id={c.id} size={48} />
                        <span className="sx-row__text">
                          <b className="ellipsis">{c.title}</b>
                          <span>
                            {c.handle ? `@${c.handle} · ` : ''}
                            {members(c.memberCount, 'group')}
                          </span>
                        </span>
                      </Link>
                    ))}
                  </Section>
                )}
                {show('spaces') && r.spaces.length > 0 && (
                  <Section title="Сообщества" more={filter === 'all' && r.spaces.length > 3 ? () => setFilter('spaces') : undefined}>
                    {r.spaces.slice(0, limit('spaces', 3)).map((c) => (
                      <Link key={c.id} className="sx-row sx-row__main" to={`/communities/${c.id}`} onClick={remember}>
                        <Avatar src={c.avatarUrl} name={c.name} id={c.id} size={48} />
                        <span className="sx-row__text">
                          <b className="ellipsis">{c.name}</b>
                          <span>{members(c.memberCount)}</span>
                        </span>
                        <Users size={18} className="faint" />
                      </Link>
                    ))}
                  </Section>
                )}
                {show('tags') && tags.length > 0 && (
                  <Section title="Темы">
                    {tags.slice(0, limit('tags', 5)).map((h) => (
                      <Link key={h.tag} className="sx-row sx-row__main" to={`/tag/${encodeURIComponent(h.tag)}`} onClick={() => recent.add({ kind: 'tag', tag: h.tag })}>
                        <span className="sx-row__icon">
                          <Hash size={20} />
                        </span>
                        <span className="sx-row__text">
                          <b className="ellipsis">#{h.tag}</b>
                          <span>
                            {compactNumber(h.count)} {plural(h.count, 'публикация', 'публикации', 'публикаций')}
                          </span>
                        </span>
                      </Link>
                    ))}
                  </Section>
                )}
                {show('messages') && hits.length > 0 && (
                  <Section title="Сообщения" more={filter === 'all' && hits.length > 4 ? () => setFilter('messages') : undefined}>
                    {hits.slice(0, limit('messages', 4)).map(({ message: m, chat }) => (
                      <Link key={m.id} className="sx-row sx-row__main" to={`/chats/${chat.id}?m=${m.seq}`} onClick={remember}>
                        <Avatar src={chat.avatarUrl} name={chat.title} id={chat.id} size={48} />
                        <span className="sx-row__text">
                          <span className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
                            <b className="ellipsis">{chat.title}</b>
                            <span className="xs faint" style={{ flex: '0 0 auto' }}>
                              {chatTime(m.createdAt)}
                            </span>
                          </span>
                          <span className="clamp-2" style={{ whiteSpace: 'normal' }}>
                            {m.sender && chat.type !== 'direct' && <b>{m.sender.displayName.split(' ')[0]}: </b>}
                            <Snippet text={m.text ?? ''} q={debounced} />
                          </span>
                        </span>
                      </Link>
                    ))}
                  </Section>
                )}
                {show('posts') && r.posts.length > 0 && (
                  <Section title="Публикации" more={filter === 'all' && r.posts.length > 3 ? () => setFilter('posts') : undefined}>
                    <div className="pk-flat">
                      {r.posts.slice(0, limit('posts', 3)).map((p) => (
                        <PostCard key={p.id} post={p} />
                      ))}
                    </div>
                  </Section>
                )}
              </div>
            )
          )}
        </div>
      </div>
    </div>
  );
}
