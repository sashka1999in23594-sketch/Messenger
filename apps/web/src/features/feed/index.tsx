import { Fragment, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Bookmark, CheckCircle2, Flame, Hash, Heart, ImagePlus, Newspaper, TrendingUp, X } from 'lucide-react';
import type { Hashtag, Post, UserSummary } from '@omni/shared';
import { api, errorMessage } from '../../shared/api/client';
import { flatPages, qk, queryClient, useCursorList } from '../../shared/api/query';
import { useMe } from '../../shared/stores/session';
import { toast, useCrumb } from '../../shared/stores/ui';
import { compactNumber, plural } from '../../shared/lib/format';
import { Avatar, Button, EmptyState, ErrorState, IconButton, ListSkeleton, LoadMore, UserRow } from '../../shared/ui';
import { CommentsSection } from '../posts/Comments';
import { PostCard, PostSkeleton } from '../posts/PostCard';
import { ComposeSheet, PostComposer } from '../posts/PostComposer';
import { useHiddenPosts } from '../posts/hidden';
import { StoriesBar } from '../stories';
import { CollectionsStrip } from '../social/collections-strip';
import { UnderlineTabs, usePullToRefresh } from '../misc/kit';
import '../posts/posts.css';

/** Лента публикаций с бесконечной подгрузкой. В ленты встраивается блок рекомендаций. */
export function PostList({
  queryKey,
  path,
  empty,
  suggestAfter,
  endNote,
}: {
  queryKey: readonly unknown[];
  path: string;
  empty?: React.ReactNode;
  /** После какой публикации показать «Рекомендации для вас» (только на узком экране) */
  suggestAfter?: number;
  /** Подпись в конце ленты */
  endNote?: boolean;
}) {
  const list = useCursorList<Post>(queryKey, path, { limit: 20 });
  const hidden = useHiddenPosts((s) => s.ids);
  const items = flatPages(list.data).filter((p) => !hidden.includes(p.id));
  if (list.isLoading)
    return (
      <>
        <PostSkeleton media={false} />
        <PostSkeleton />
      </>
    );
  if (list.error) return <ErrorState error={list.error} onRetry={() => void list.refetch()} />;
  if (!items.length) return <>{empty ?? <EmptyState icon={<Newspaper size={28} />} title="Пока пусто" text="Подпишитесь на интересных людей — их публикации появятся здесь" />}</>;
  return (
    <>
      {items.map((p, i) => (
        <Fragment key={p.id}>
          <PostCard post={p} />
          {suggestAfter !== undefined && i === suggestAfter && <SuggestStrip />}
        </Fragment>
      ))}
      <LoadMore hasMore={!!list.hasNextPage} loading={list.isFetchingNextPage} onLoad={() => void list.fetchNextPage()} />
      {endNote && !list.hasNextPage && (
        <div className="feed-end">
          <span className="feed-end__icon">
            <CheckCircle2 size={28} />
          </span>
          <b>Вы всё посмотрели</b>
          <span>Новые публикации появятся здесь — потяните ленту вниз, чтобы обновить</span>
        </div>
      )}
    </>
  );
}

export function TrendsBox({ limit = 8 }: { limit?: number }) {
  const q = useQuery({ queryKey: ['trends'], queryFn: () => api.get<{ items: Hashtag[] }>('/hashtags/trending?days=30') });
  return (
    <div className="panel">
      <div className="panel__title row">
        <TrendingUp size={14} /> Актуальные темы
      </div>
      {q.data?.items.slice(0, limit).map((h, i) => (
        <Link key={h.tag} to={`/tag/${encodeURIComponent(h.tag)}`} className="trend">
          <span className="trend__rank">{i + 1}</span>
          <span className="col grow" style={{ gap: 0 }}>
            <span className="trend__tag">#{h.tag}</span>
            <span className="trend__count">
              {compactNumber(h.count)} {plural(h.count, 'публикация', 'публикации', 'публикаций')}
            </span>
          </span>
        </Link>
      ))}
      {q.data?.items.length === 0 && <div className="panel__footer">Пока нет трендов</div>}
      <div className="panel__footer">
        <Link to="/feed/hashtags">Все темы →</Link>
      </div>
    </div>
  );
}

export function FollowButton({ user, size = 'sm' }: { user: UserSummary; size?: 'sm' | 'md' }) {
  const follow = useMutation({
    mutationFn: () => api.post<{ status: 'accepted' | 'pending' }>(`/users/${user.id}/follow`),
    onSuccess: (r) => {
      toast({ text: r.status === 'pending' ? 'Заявка отправлена' : `Вы подписались на ${user.displayName}`, kind: 'success' });
      void queryClient.invalidateQueries({ queryKey: ['suggestions'] });
      void queryClient.invalidateQueries({ queryKey: qk.user(user.username) });
    },
    onError: (e) => toast({ text: errorMessage(e), kind: 'error' }),
  });
  return (
    <Button
      size={size}
      pill
      variant={follow.isSuccess ? 'secondary' : 'primary'}
      loading={follow.isPending}
      disabled={follow.isSuccess}
      onClick={(e) => (e.preventDefault(), e.stopPropagation(), follow.mutate())}
    >
      {follow.isSuccess ? (follow.data.status === 'pending' ? 'Заявка' : 'Вы подписаны') : 'Подписаться'}
    </Button>
  );
}

export function WhoToFollow({ limit = 5 }: { limit?: number }) {
  const q = useQuery({ queryKey: ['suggestions'], queryFn: () => api.get<{ items: UserSummary[] }>('/users/suggestions') });
  if (!q.data?.items.length) return null;
  return (
    <div className="panel">
      <div className="panel__title">Кого почитать</div>
      {q.data.items.slice(0, limit).map((u) => (
        <UserRow key={u.id} user={u} action={<FollowButton user={u} />} />
      ))}
    </div>
  );
}

/** «Рекомендации для вас» — карточки людей с горизонтальной прокруткой (в ленте на телефоне). */
function SuggestStrip() {
  const q = useQuery({ queryKey: ['suggestions'], queryFn: () => api.get<{ items: UserSummary[] }>('/users/suggestions') });
  const [closed, setClosed] = useState<string[]>([]);
  const items = (q.data?.items ?? []).filter((u) => !closed.includes(u.id));
  if (!items.length) return null;
  return (
    <section className="feed-suggest" aria-label="Рекомендации">
      <div className="pk-group-title">
        <span>Рекомендации для вас</span>
        <Link to="/contacts/suggestions">Все</Link>
      </div>
      <div className="feed-suggest__row">
        {items.slice(0, 12).map((u) => (
          <div key={u.id} className="suggest-card">
            <button type="button" className="pk-icon suggest-card__x" aria-label="Скрыть" onClick={() => setClosed((c) => [...c, u.id])}>
              <X size={16} />
            </button>
            <Link to={`/u/${u.username}`} className="suggest-card__link">
              <Avatar src={u.avatarUrl} name={u.displayName} id={u.id} size={76} />
              <span className="suggest-card__name">{u.displayName}</span>
              <span className="suggest-card__sub">@{u.username}</span>
            </Link>
            <FollowButton user={u} />
          </div>
        ))}
      </div>
    </section>
  );
}

const MODES = { '': 'for-you', following: 'following', latest: 'latest', trending: 'trending' } as const;

/** В день рождения на главной — поздравление (закрывается до следующего года). */
function BirthdayBanner() {
  const me = useMe();
  const key = `birthday-${me.id}-${new Date().getFullYear()}`;
  const [hidden, setHidden] = useState(() => {
    try {
      return localStorage.getItem(key) === '1';
    } catch {
      return false;
    }
  });
  if (!me.birthdayToday || hidden) return null;
  return (
    <div className="birthday-banner" role="status">
      <span className="birthday-banner__icon" aria-hidden>
        🎂
      </span>
      <div className="col" style={{ gap: 2, minWidth: 0 }}>
        <b>С днём рождения, {me.displayName}!</b>
        <span className="small muted">Команда Sunnet поздравляет вас. Загляните в чаты — там наверняка уже ждут поздравления.</span>
      </div>
      <IconButton
        label="Скрыть"
        size="sm"
        onClick={() => {
          setHidden(true);
          try {
            localStorage.setItem(key, '1');
          } catch {
            // Хранилище недоступно — просто скрываем до перезагрузки
          }
        }}
      >
        <X size={16} />
      </IconButton>
    </div>
  );
}

/** Строка «Что нового?» — открывает редактор в шторке. */
function ComposeEntry() {
  const me = useMe();
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="feed-compose">
        <Link to="/profile" aria-label="Мой профиль">
          <Avatar src={me.avatarUrl} name={me.displayName} id={me.id} size={40} />
        </Link>
        <button type="button" className="feed-compose__field" onClick={() => setOpen(true)}>
          <b>{me.displayName}</b>
          <span>Что нового?</span>
        </button>
        <button type="button" className="pk-icon" style={{ color: 'var(--text-2)' }} onClick={() => setOpen(true)} aria-label="Добавить фото или видео">
          <ImagePlus size={22} />
        </button>
        <button type="button" className="feed-compose__btn" onClick={() => setOpen(true)}>
          Опубликовать
        </button>
      </div>
      {open && <ComposeSheet onClose={() => setOpen(false)} />}
    </>
  );
}

export function FeedPage({ mode }: { mode: keyof typeof MODES }) {
  const apiMode = MODES[mode];
  const scroller = useRef<HTMLDivElement>(null);
  const { pathname } = useLocation();
  const { indicator } = usePullToRefresh(scroller, () =>
    Promise.all([queryClient.resetQueries({ queryKey: qk.feed(apiMode, 'all') }), queryClient.invalidateQueries({ queryKey: qk.stories })]),
  );
  return (
    <div className="pk-root">
      <div className="scroll" ref={scroller}>
        {indicator}
        <div className="feed-layout">
          <div className="feed-col">
            <div
              className="feed-top"
              onClickCapture={(e) => {
                // Нажатие на открытую вкладку — наверх, как в Instagram
                const a = (e.target as HTMLElement).closest('a');
                if (a && a.getAttribute('href') === pathname) scroller.current?.scrollTo({ top: 0, behavior: 'smooth' });
              }}
            >
              <UnderlineTabs
                tabs={[
                  { to: '/home', label: 'Для вас', end: true },
                  { to: '/home/following', label: 'Подписки' },
                  { to: '/home/latest', label: 'Свежее' },
                  { to: '/home/popular', label: 'Популярное' },
                ]}
              />
            </div>
            <BirthdayBanner />
            <div className="feed-stories">
              <StoriesBar />
            </div>
            <ComposeEntry />
            <PostList queryKey={qk.feed(apiMode, 'all')} path={`/feed/${apiMode}?kind=all`} suggestAfter={2} endNote />
          </div>
          <aside>
            <TrendsBox />
            <WhoToFollow />
          </aside>
        </div>
      </div>
    </div>
  );
}

export function ComposePage() {
  const navigate = useNavigate();
  return (
    <div className="pk-root">
      <div className="scroll">
        <div className="feed-col" style={{ paddingTop: 'var(--space-4)' }}>
          <div className="feed-head">
            <h1>Новая публикация</h1>
          </div>
          <PostComposer autoFocus onDone={(p) => navigate(`/post/${p.id}`)} />
        </div>
      </div>
    </div>
  );
}

export function PostPage() {
  const { id = '' } = useParams();
  const [params] = useSearchParams();
  const { hash } = useLocation();
  const highlight = params.get('comment');
  const input = useRef<HTMLTextAreaElement>(null);
  const q = useQuery({ queryKey: qk.post(id), queryFn: () => api.get<Post>(`/posts/${id}`) });
  useCrumb(q.data ? (q.data.title ?? `Публикация @${q.data.author.username}`) : null);
  useEffect(() => {
    if (!q.data) return;
    void api.post(`/posts/${id}/view`, { progressSec: 0 }).catch(() => undefined);
  }, [id, q.data?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (highlight) setTimeout(() => document.getElementById(`comment-${highlight}`)?.scrollIntoView({ block: 'center' }), 600);
    else if (hash === '#comments' && q.data) setTimeout(() => document.getElementById('comments')?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 300);
  }, [highlight, hash, !!q.data]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="pk-root">
      <div className="scroll">
        <div className="feed-layout">
          <div className="feed-col" style={{ paddingTop: 'var(--space-4)' }}>
            {q.isLoading ? (
              <PostSkeleton />
            ) : q.error || !q.data ? (
              <ErrorState error={q.error} onRetry={() => void q.refetch()} />
            ) : (
              <>
                <PostCard post={q.data} detail onComment={() => input.current?.focus()} />
                <div className="post-page__comments">
                  <CommentsSection
                    postId={q.data.id}
                    postAuthorId={q.data.author.id}
                    count={q.data.stats.comments}
                    disabled={q.data.commentsDisabled}
                    highlightId={highlight}
                    inputRef={input}
                    inputAtBottom
                  />
                </div>
              </>
            )}
          </div>
          <aside>
            <WhoToFollow />
            <TrendsBox limit={5} />
          </aside>
        </div>
      </div>
    </div>
  );
}

export function HashtagsPage() {
  const q = useQuery({ queryKey: ['trends', 'all'], queryFn: () => api.get<{ items: Hashtag[] }>('/hashtags/trending?days=90') });
  return (
    <div className="pk-root">
      <div className="scroll">
        <div className="feed-col">
          <div className="feed-head">
            <span className="feed-head__icon">
              <Hash size={24} />
            </span>
            <div>
              <h1>Темы</h1>
            </div>
          </div>
          {q.isLoading ? (
            <ListSkeleton />
          ) : (
            <div className="pk-flat">
              {q.data?.items.map((h, i) => (
                <Link key={h.tag} to={`/tag/${encodeURIComponent(h.tag)}`} className="trend">
                  <span className="trend__rank">{i < 3 ? <Flame size={18} /> : i + 1}</span>
                  <span className="col grow" style={{ gap: 0 }}>
                    <span className="trend__tag">#{h.tag}</span>
                    <span className="trend__count">
                      {compactNumber(h.count)} {plural(h.count, 'публикация', 'публикации', 'публикаций')}
                    </span>
                  </span>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function TagPage() {
  const { tag = '' } = useParams();
  useCrumb(`#${tag}`);
  return (
    <div className="pk-root">
      <div className="scroll">
        <div className="feed-col">
          <div className="feed-head">
            <span className="feed-head__icon">
              <Hash size={24} />
            </span>
            <div style={{ minWidth: 0 }}>
              <h1 className="ellipsis">#{tag}</h1>
            </div>
          </div>
          <PostList queryKey={['tag-posts', tag]} path={`/hashtags/${encodeURIComponent(tag)}/posts`} />
        </div>
      </div>
    </div>
  );
}

export function SavedPostsPage({ kind }: { kind: 'bookmarks' | 'liked' }) {
  const title = kind === 'bookmarks' ? 'Закладки' : 'Понравилось';
  return (
    <div className="pk-root">
      <div className="scroll">
        <div className="feed-col">
          <div className="feed-head">
            <span className="feed-head__icon">{kind === 'bookmarks' ? <Bookmark size={22} /> : <Heart size={22} />}</span>
            <div>
              <h1>{title}</h1>
              <p>{kind === 'bookmarks' ? 'Видны только вам' : 'Лайки видны только вам'}</p>
            </div>
          </div>
          {kind === 'bookmarks' && <CollectionsStrip />}
          <PostList
            queryKey={['saved-posts', kind]}
            path={kind === 'bookmarks' ? '/me/bookmarks?kind=all' : '/me/liked?kind=all'}
            empty={
              <EmptyState
                icon={kind === 'bookmarks' ? <Bookmark size={26} /> : <Heart size={26} />}
                title="Здесь пока пусто"
                text={kind === 'bookmarks' ? 'Нажмите на закладку под публикацией, чтобы сохранить её' : 'Публикации, которые вам понравились, появятся здесь'}
              />
            }
          />
        </div>
      </div>
    </div>
  );
}
