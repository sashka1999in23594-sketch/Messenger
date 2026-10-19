import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Bookmark, Flame, Hash, Heart, Newspaper, PenLine, TrendingUp, X } from 'lucide-react';
import type { Hashtag, Post, UserSummary } from '@omni/shared';
import { api, errorMessage } from '../../shared/api/client';
import { flatPages, qk, queryClient, useCursorList } from '../../shared/api/query';
import { useMe } from '../../shared/stores/session';
import { toast, useCrumb } from '../../shared/stores/ui';
import { compactNumber, plural } from '../../shared/lib/format';
import { Button, EmptyState, ErrorState, IconButton, ListSkeleton, Loading, LoadMore, PageHeader, TabLinks, UserRow } from '../../shared/ui';
import { CommentsSection } from '../posts/Comments';
import { PostCard } from '../posts/PostCard';
import { PostComposer } from '../posts/PostComposer';
import { StoriesBar } from '../stories';
import { CollectionsStrip } from '../social/collections-strip';
import '../posts/posts.css';

export function PostList({ queryKey, path, empty }: { queryKey: readonly unknown[]; path: string; empty?: React.ReactNode }) {
  const list = useCursorList<Post>(queryKey, path, { limit: 20 });
  const items = flatPages(list.data);
  if (list.isLoading) return <ListSkeleton rows={5} avatar={44} />;
  if (list.error) return <ErrorState error={list.error} onRetry={() => void list.refetch()} />;
  if (!items.length) return <>{empty ?? <EmptyState icon={<Newspaper size={28} />} title="Пока пусто" text="Подпишитесь на интересных людей — их публикации появятся здесь" />}</>;
  return (
    <>
      {items.map((p) => (
        <PostCard key={p.id} post={p} />
      ))}
      <LoadMore hasMore={!!list.hasNextPage} loading={list.isFetchingNextPage} onLoad={() => void list.fetchNextPage()} />
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
    <Button size={size} pill loading={follow.isPending} disabled={follow.isSuccess} onClick={(e) => (e.stopPropagation(), follow.mutate())}>
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

export function FeedPage({ mode }: { mode: keyof typeof MODES }) {
  const apiMode = MODES[mode];
  return (
    <div className="scroll">
      <div className="feed-layout">
        <div className="feed-col">
          <div className="feed-tabs">
            <TabLinks
              tabs={[
                { to: '/home', label: 'Для вас', end: true },
                { to: '/home/following', label: 'Подписки' },
                { to: '/home/latest', label: 'Свежее' },
                { to: '/home/popular', label: 'Популярное' },
              ]}
            />
          </div>
          <BirthdayBanner />
          <StoriesBar />
          <PostComposer />
          <PostList queryKey={qk.feed(apiMode, 'all')} path={`/feed/${apiMode}?kind=all`} />
        </div>
        <aside>
          <TrendsBox />
          <WhoToFollow />
        </aside>
      </div>
    </div>
  );
}

export function ComposePage() {
  const navigate = useNavigate();
  return (
    <div className="scroll">
      <div className="page">
        <PageHeader title="Новая публикация" icon={<PenLine size={22} />} subtitle="Ctrl+Enter — опубликовать" />
        <PostComposer autoFocus onDone={(p) => navigate(`/post/${p.id}`)} />
      </div>
    </div>
  );
}

export function PostPage() {
  const { id = '' } = useParams();
  const [params] = useSearchParams();
  const highlight = params.get('comment');
  const q = useQuery({ queryKey: qk.post(id), queryFn: () => api.get<Post>(`/posts/${id}`) });
  useCrumb(q.data ? (q.data.title ?? `Публикация @${q.data.author.username}`) : null);
  useEffect(() => {
    if (!q.data) return;
    void api.post(`/posts/${id}/view`, { progressSec: 0 }).catch(() => undefined);
  }, [id, q.data?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (highlight) setTimeout(() => document.getElementById(`comment-${highlight}`)?.scrollIntoView({ block: 'center' }), 600);
  }, [highlight]);
  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const post = q.data;
  return (
    <div className="scroll">
      <div className="feed-layout">
        <div className="feed-col" style={{ paddingTop: 'var(--space-4)' }}>
          <PostCard post={post} detail />
          <div className="card card--pad">
            <CommentsSection postId={post.id} postAuthorId={post.author.id} count={post.stats.comments} disabled={post.commentsDisabled} highlightId={highlight} />
          </div>
        </div>
        <aside>
          <WhoToFollow />
          <TrendsBox limit={5} />
        </aside>
      </div>
    </div>
  );
}

export function HashtagsPage() {
  const q = useQuery({ queryKey: ['trends', 'all'], queryFn: () => api.get<{ items: Hashtag[] }>('/hashtags/trending?days=90') });
  return (
    <div className="scroll">
      <div className="page">
        <PageHeader title="Темы и хэштеги" subtitle="О чём говорят сейчас" icon={<Hash size={22} />} />
        {q.isLoading ? (
          <ListSkeleton />
        ) : (
          <div className="card">
            {q.data?.items.map((h, i) => (
              <Link key={h.tag} to={`/tag/${encodeURIComponent(h.tag)}`} className="list-item">
                <span className="list-item__icon">{i < 3 ? <Flame size={18} /> : <Hash size={18} />}</span>
                <span className="list-item__body">
                  <span className="list-item__title" style={{ display: 'block' }}>
                    #{h.tag}
                  </span>
                  <span className="list-item__sub">
                    {h.count} {plural(h.count, 'публикация', 'публикации', 'публикаций')}
                  </span>
                </span>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function TagPage() {
  const { tag = '' } = useParams();
  useCrumb(`#${tag}`);
  return (
    <div className="scroll">
      <div className="feed-col page" style={{ maxWidth: 700 }}>
        <PageHeader title={`#${tag}`} subtitle="Публикации с этим хэштегом" icon={<Hash size={22} />} />
        <PostList queryKey={['tag-posts', tag]} path={`/hashtags/${encodeURIComponent(tag)}/posts`} />
      </div>
    </div>
  );
}

export function SavedPostsPage({ kind }: { kind: 'bookmarks' | 'liked' }) {
  const title = kind === 'bookmarks' ? 'Закладки' : 'Понравилось';
  return (
    <div className="scroll">
      <div className="feed-col page" style={{ maxWidth: 700 }}>
        <PageHeader
          title={title}
          subtitle={kind === 'bookmarks' ? 'Видны только вам' : 'Лайки видны только вам'}
          icon={kind === 'bookmarks' ? <Bookmark size={22} /> : <Heart size={22} />}
        />
        {kind === 'bookmarks' && <CollectionsStrip />}
        <PostList
          queryKey={['saved-posts', kind]}
          path={kind === 'bookmarks' ? '/me/bookmarks?kind=all' : '/me/liked?kind=all'}
          empty={<EmptyState icon={kind === 'bookmarks' ? <Bookmark size={26} /> : <Heart size={26} />} title="Здесь пока пусто" text={kind === 'bookmarks' ? 'Нажмите на закладку под публикацией, чтобы сохранить её' : 'Публикации, которые вам понравились, появятся здесь'} />}
        />
      </div>
    </div>
  );
}
