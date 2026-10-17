/** Поиск: строка сверху, результаты снизу — люди (в том числе по номеру), каналы, группы, публикации и сообщения. */
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Search, X } from 'lucide-react';
import { looksLikePhone, type MessageSearchHit, type SearchResults } from '@omni/shared';
import { api } from '../../shared/api/client';
import { useDebounced } from '../../shared/hooks';
import { chatTime, members } from '../../shared/lib/format';
import { Avatar, EmptyState, ListSkeleton, UserRow } from '../../shared/ui';
import { FollowButton } from '../feed';
import { PostCard } from '../posts/PostCard';
import './explore.css';

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

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="search-section">
      <h2 className="search-section__title">{title}</h2>
      <div className="search-section__body">{children}</div>
    </section>
  );
}

export function SearchPage() {
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState(params.get('q') ?? '');
  const debounced = useDebounced(q.trim(), 300);
  useEffect(() => {
    const next = new URLSearchParams(params);
    if (debounced) next.set('q', debounced);
    else next.delete('q');
    setParams(next, { replace: true });
  }, [debounced]); // eslint-disable-line react-hooks/exhaustive-deps

  const phone = looksLikePhone(debounced);
  const res = useQuery({
    queryKey: ['search', debounced],
    queryFn: () => api.get<SearchResults>(`/search?q=${encodeURIComponent(debounced)}&type=all&limit=8`),
    enabled: debounced.length > 0,
  });
  const msgs = useQuery({
    queryKey: ['search-messages', debounced],
    queryFn: () => api.get<{ items: MessageSearchHit[] }>(`/messages/search?q=${encodeURIComponent(debounced)}`),
    enabled: debounced.length > 1 && !phone,
  });
  const r = res.data;
  const hits = msgs.data?.items ?? [];
  const empty = r && !r.users.length && !r.posts.length && !r.chats.length && !r.spaces.length && !hits.length;

  return (
    <div className="scroll">
      <div className="search-page">
        <div className="search-bar">
          <Search size={20} className="search-bar__icon" />
          <input
            className="search-bar__input"
            placeholder="Имя, @username, номер телефона, канал или слово"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            autoFocus
            aria-label="Поиск"
            enterKeyHint="search"
          />
          {q && (
            <button type="button" className="search-bar__clear" onClick={() => setQ('')} aria-label="Очистить">
              <X size={18} />
            </button>
          )}
        </div>

        {!debounced ? (
          <p className="search-hint">Найдите людей по имени, @username или номеру телефона, а ещё каналы, группы, публикации и свои сообщения.</p>
        ) : res.isLoading ? (
          <ListSkeleton rows={5} />
        ) : empty ? (
          <EmptyState icon={<Search size={28} />} title="Ничего не найдено" text={phone ? 'Человек с таким номером не найден или скрыл возможность поиска по номеру' : 'Проверьте написание или попробуйте другие слова'} />
        ) : (
          r && (
            <div className="col gap-4">
              {r.users.length > 0 && (
                <Section title="Люди">
                  {r.users.map((u) => (
                    <UserRow key={u.id} user={u} action={<FollowButton user={u} />} />
                  ))}
                </Section>
              )}
              {r.chats.length > 0 && (
                <Section title="Каналы и группы">
                  {r.chats.map((c) => (
                    <Link key={c.id} className="list-item" to={c.type === 'channel' ? `/channels/${c.id}` : `/chats/${c.id}`}>
                      <Avatar src={c.avatarUrl} name={c.title} id={c.id} size={44} />
                      <span className="list-item__body">
                        <span className="list-item__title" style={{ display: 'block' }}>
                          {c.title}
                        </span>
                        <span className="list-item__sub">
                          {c.handle ? `@${c.handle} · ` : ''}
                          {members(c.memberCount, c.type === 'channel' ? 'channel' : 'group')}
                        </span>
                      </span>
                    </Link>
                  ))}
                </Section>
              )}
              {r.spaces.length > 0 && (
                <Section title="Сообщества">
                  {r.spaces.map((c) => (
                    <Link key={c.id} className="list-item" to={`/communities/${c.id}`}>
                      <Avatar src={c.avatarUrl} name={c.name} id={c.id} size={44} />
                      <span className="list-item__body">
                        <span className="list-item__title" style={{ display: 'block' }}>
                          {c.name}
                        </span>
                        <span className="list-item__sub">{members(c.memberCount)}</span>
                      </span>
                    </Link>
                  ))}
                </Section>
              )}
              {hits.length > 0 && (
                <Section title="Сообщения">
                  {hits.slice(0, 10).map(({ message: m, chat }) => (
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
                          <Snippet text={m.text ?? ''} q={debounced} />
                        </span>
                      </span>
                    </Link>
                  ))}
                </Section>
              )}
              {r.posts.length > 0 && (
                <Section title="Публикации">
                  {r.posts.map((p) => (
                    <PostCard key={p.id} post={p} />
                  ))}
                </Section>
              )}
            </div>
          )
        )}
      </div>
    </div>
  );
}
