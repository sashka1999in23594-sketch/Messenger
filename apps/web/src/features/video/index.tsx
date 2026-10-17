import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ChartColumn, Clapperboard, Clock, Eye, Heart, History, ListPlus, ListVideo, Plus, Share2, ThumbsUp, Trash2, Upload, Users } from 'lucide-react';
import type { HistoryEntry, Playlist, Post, PostKind, UserProfile } from '@omni/shared';
import { api, errorMessage } from '../../shared/api/client';
import { flatPages, qk, queryClient, useCursorList } from '../../shared/api/query';
import { useMe } from '../../shared/stores/session';
import { toast, useCrumb } from '../../shared/stores/ui';
import { cn, compactNumber, fullDate, members, plural, timeAgo, views } from '../../shared/lib/format';
import { Avatar, Button, ButtonLink, confirm, EmptyState, ErrorState, Input, Loading, LoadMore, Modal, PageHeader, RichText, Skeleton, Switch, TabLinks, Verified } from '../../shared/ui';
import { CommentsSection } from '../posts/Comments';
import { shareLink, usePostActions } from '../posts/actions';
import { FollowButton } from '../feed';
import { UploadVideoForm, VideoCard } from './components';
import './video.css';

function VideoGrid({ queryKey, path, empty }: { queryKey: readonly unknown[]; path: string; empty?: React.ReactNode }) {
  const list = useCursorList<Post>(queryKey, path, { limit: 24 });
  const items = flatPages(list.data);
  if (list.isLoading)
    return (
      <div className="video-grid">
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="col">
            <Skeleton height={180} radius={16} />
            <Skeleton width="80%" />
            <Skeleton width="50%" />
          </div>
        ))}
      </div>
    );
  if (list.error) return <ErrorState error={list.error} onRetry={() => void list.refetch()} />;
  if (!items.length) return <>{empty ?? <EmptyState icon={<Clapperboard size={28} />} title="Видео пока нет" />}</>;
  return (
    <>
      <div className="video-grid">
        {items.map((p) => (
          <VideoCard key={p.id} post={p} />
        ))}
      </div>
      <LoadMore hasMore={!!list.hasNextPage} loading={list.isFetchingNextPage} onLoad={() => void list.fetchNextPage()} />
    </>
  );
}

export function VideoHome({ mode }: { mode: 'for-you' | 'following' | 'trending' }) {
  const tags = useQuery({ queryKey: ['trends'], queryFn: () => api.get<{ items: { tag: string }[] }>('/hashtags/trending?days=30') });
  return (
    <div className="scroll">
      <div className="page page--wide">
        <div className="row between" style={{ marginBottom: 16, gap: 12 }}>
          <div className="chips" style={{ flex: 1, minWidth: 0 }}>
            <Link to="/video" className={cn('chip', mode === 'for-you' && 'chip--active')}>
              Все
            </Link>
            <Link to="/video/subscriptions" className={cn('chip', mode === 'following' && 'chip--active')}>
              Подписки
            </Link>
            <Link to="/video/trending" className={cn('chip', mode === 'trending' && 'chip--active')}>
              В тренде
            </Link>
            {tags.data?.items.slice(0, 8).map((t) => (
              <Link key={t.tag} to={`/tag/${encodeURIComponent(t.tag)}`} className="chip">
                #{t.tag}
              </Link>
            ))}
          </div>
          <ButtonLink to="/video/upload" size="sm" icon={<Upload size={16} />}>
            Загрузить
          </ButtonLink>
        </div>
        <VideoGrid
          queryKey={qk.feed(mode, 'video')}
          path={`/feed/${mode === 'following' ? 'following' : mode}?kind=video`}
          empty={<EmptyState icon={<Users size={28} />} title={mode === 'following' ? 'Нет новых видео от подписок' : 'Видео пока нет'} text="Подпишитесь на авторов, чтобы видеть их новые видео" />}
        />
      </div>
    </div>
  );
}

function AddToPlaylist({ postId, onClose }: { postId: string; onClose: () => void }) {
  const lists = useQuery({ queryKey: ['playlists'], queryFn: () => api.get<{ items: Playlist[] }>('/me/playlists') });
  const [title, setTitle] = useState('');
  const add = async (id: string) => {
    await api.post(`/playlists/${id}/items`, { postId });
    toast({ text: 'Добавлено в плейлист', kind: 'success' });
    void queryClient.invalidateQueries({ queryKey: ['playlists'] });
    onClose();
  };
  return (
    <Modal open onClose={onClose} title="Сохранить в плейлист">
      {lists.data?.items.map((p) => (
        <button key={p.id} className="list-item" style={{ borderRadius: 12 }} onClick={() => void add(p.id)}>
          <span className="list-item__icon">
            <ListVideo size={18} />
          </span>
          <span className="list-item__body">
            {p.title}
            <span className="list-item__sub" style={{ display: 'block' }}>
              {p.itemCount} {plural(p.itemCount, 'видео', 'видео', 'видео')} · {p.isPublic ? 'открытый' : 'личный'}
            </span>
          </span>
        </button>
      ))}
      <form
        className="row"
        style={{ marginTop: 12 }}
        onSubmit={(e) => {
          e.preventDefault();
          if (!title.trim()) return;
          void api.post<Playlist>('/playlists', { title, isPublic: false }).then((p) => add(p.id));
        }}
      >
        <input className="input" placeholder="Новый плейлист" value={title} onChange={(e) => setTitle(e.target.value)} />
        <Button type="submit" icon={<Plus size={16} />}>
          Создать
        </Button>
      </form>
    </Modal>
  );
}

export function WatchPage() {
  const { id = '' } = useParams();
  const me = useMe();
  const video = useRef<HTMLVideoElement>(null);
  const [playlistOpen, setPlaylistOpen] = useState(false);
  const [descOpen, setDescOpen] = useState(false);
  const q = useQuery({ queryKey: qk.post(id), queryFn: () => api.get<Post>(`/posts/${id}`) });
  const related = useQuery({ queryKey: ['related', id], queryFn: () => api.get<{ items: Post[] }>(`/posts/${id}/related`), enabled: !!q.data });
  const author = useQuery({
    queryKey: qk.user(q.data?.author.username ?? ''),
    queryFn: () => api.get<UserProfile>(`/users/${q.data!.author.username}`),
    enabled: !!q.data,
  });
  useCrumb(q.data?.title);
  const post = q.data;

  // Просмотр и прогресс: при старте и каждые 15 секунд воспроизведения
  useEffect(() => {
    const el = video.current;
    if (!el || !post) return;
    let last = 0;
    const report = () => void api.post(`/posts/${post.id}/view`, { progressSec: el.currentTime }).catch(() => undefined);
    const onTime = () => {
      if (el.currentTime - last > 15) {
        last = el.currentTime;
        report();
      }
    };
    const onPlay = () => {
      if (last === 0) report();
    };
    el.addEventListener('timeupdate', onTime);
    el.addEventListener('play', onPlay);
    el.addEventListener('pause', report);
    return () => {
      el.removeEventListener('timeupdate', onTime);
      el.removeEventListener('play', onPlay);
      el.removeEventListener('pause', report);
    };
  }, [post?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (q.isLoading) return <Loading />;
  if (q.error || !post) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  return <WatchContent post={post} me={me.id} video={video} related={related.data?.items ?? []} author={author.data} playlistOpen={playlistOpen} setPlaylistOpen={setPlaylistOpen} descOpen={descOpen} setDescOpen={setDescOpen} />;
}

function WatchContent({
  post,
  me,
  video,
  related,
  author,
  playlistOpen,
  setPlaylistOpen,
  descOpen,
  setDescOpen,
}: {
  post: Post;
  me: string;
  video: React.RefObject<HTMLVideoElement | null>;
  related: Post[];
  author: UserProfile | undefined;
  playlistOpen: boolean;
  setPlaylistOpen: (v: boolean) => void;
  descOpen: boolean;
  setDescOpen: (v: boolean) => void;
}) {
  const { like, watchLater } = usePostActions(post);
  const m = post.media[0];
  return (
    <div className="scroll">
      <div className="watch">
        <div className="watch__main">
          <div className="player-wrap">
            {/* «Атмосферная подсветка» как в YouTube: размытая обложка за плеером */}
            {m?.posterUrl && <div className="player-ambient" style={{ backgroundImage: `url("${m.posterUrl}")` }} aria-hidden />}
            <div className="player">{m && <video ref={video} src={m.url} poster={m.posterUrl ?? undefined} controls autoPlay playsInline preload="metadata" />}</div>
          </div>
          <h1 className="watch__title">{post.title}</h1>
          <div className="watch__bar">
            <Link to={`/u/${post.author.username}`} className="row" style={{ color: 'inherit', gap: 10 }}>
              <Avatar src={post.author.avatarUrl} name={post.author.displayName} id={post.author.id} size={42} />
              <span className="col" style={{ gap: 0 }}>
                <span className="bold row gap-1">
                  {post.author.displayName} {post.author.verified && <Verified size={14} />}
                </span>
                {author && <span className="small muted">{members(author.stats.followers, 'channel')}</span>}
              </span>
            </Link>
            {author?.relationship && !author.relationship.following && post.author.id !== me && <FollowButton user={post.author} />}
            <span className="grow" />
            <span className="pill-group">
              <Button variant="secondary" size="sm" onClick={() => like.mutate(!post.viewer.liked)} icon={<ThumbsUp size={16} fill={post.viewer.liked ? 'currentColor' : 'none'} />}>
                {compactNumber(post.stats.likes)}
              </Button>
            </span>
            <Button variant="secondary" size="sm" pill icon={<Share2 size={16} />} onClick={() => shareLink(`/watch/${post.id}`)}>
              Поделиться
            </Button>
            <Button variant="secondary" size="sm" pill icon={<Clock size={16} />} onClick={() => watchLater.mutate(!post.viewer.watchLater)}>
              {post.viewer.watchLater ? 'В «Позже»' : 'Смотреть позже'}
            </Button>
            <Button variant="secondary" size="sm" pill icon={<ListPlus size={16} />} onClick={() => setPlaylistOpen(true)}>
              В плейлист
            </Button>
          </div>
          <div className="watch__desc">
            <div className="bold small">
              {views(post.stats.views)} · {timeAgo(post.createdAt)}
            </div>
            <div className={descOpen ? '' : 'clamp-3'}>
              <RichText text={post.text || 'Без описания'} />
            </div>
            {post.text.length > 160 && (
              <button className="btn btn--ghost btn--sm" style={{ paddingLeft: 0 }} onClick={() => setDescOpen(!descOpen)}>
                {descOpen ? 'Свернуть' : 'Ещё'}
              </button>
            )}
            <div className="xs faint" style={{ marginTop: 6 }}>
              Опубликовано {fullDate(post.createdAt)}
            </div>
          </div>
          <div style={{ marginTop: 16 }}>
            <CommentsSection postId={post.id} postAuthorId={post.author.id} count={post.stats.comments} disabled={post.commentsDisabled} />
          </div>
        </div>
        <aside className="watch__side">
          <div className="bold">Похожие видео</div>
          {related.map((r) => (
            <VideoCard key={r.id} post={r} row />
          ))}
          {related.length === 0 && <span className="muted small">Пока нечего предложить</span>}
        </aside>
      </div>
      {playlistOpen && <AddToPlaylist postId={post.id} onClose={() => setPlaylistOpen(false)} />}
    </div>
  );
}

// ─── Библиотека ─────────────────────────────────────────────────────────────

export function HistoryPage() {
  const list = useCursorList<HistoryEntry>(['history', 'video'], '/me/history?kind=all', { limit: 30 });
  const items = flatPages(list.data);
  const clear = async () => {
    if (!(await confirm({ title: 'Очистить историю просмотров?', danger: true, confirmLabel: 'Очистить' }))) return;
    await api.del('/me/history');
    void list.refetch();
  };
  return (
    <div className="scroll">
      <div className="page">
        <PageHeader
          title="История"
          subtitle="Видна только вам"
          icon={<History size={22} />}
          actions={
            items.length > 0 && (
              <Button variant="secondary" size="sm" icon={<Trash2 size={16} />} onClick={() => void clear()}>
                Очистить
              </Button>
            )
          }
        />
        {list.isLoading ? <Loading /> : items.length === 0 ? <EmptyState icon={<History size={28} />} title="История пуста" /> : null}
        <div className="col gap-4">
          {items.map((h) => (
            <div key={h.post.id} className="row" style={{ alignItems: 'flex-start' }}>
              <div className="grow">
                {h.post.kind === 'video' || h.post.kind === 'short' ? (
                  <VideoCard post={h.post} row progressSec={h.progressSec} />
                ) : (
                  <Link to={`/post/${h.post.id}`} className="list-item card">
                    <span className="list-item__body clamp-2">{h.post.title ?? h.post.text}</span>
                  </Link>
                )}
              </div>
              <button
                className="icon-btn icon-btn--sm"
                aria-label="Удалить из истории"
                onClick={() => void api.del(`/me/history/${h.post.id}`).then(() => list.refetch())}
              >
                <Trash2 size={16} />
              </button>
            </div>
          ))}
        </div>
        <LoadMore hasMore={!!list.hasNextPage} loading={list.isFetchingNextPage} onLoad={() => void list.fetchNextPage()} />
      </div>
    </div>
  );
}

export function LibraryList({ kind }: { kind: 'watch-later' | 'liked' }) {
  return (
    <div className="scroll">
      <div className="page page--wide">
        <PageHeader
          title={kind === 'liked' ? 'Понравившиеся видео' : 'Смотреть позже'}
          icon={kind === 'liked' ? <Heart size={22} /> : <Clock size={22} />}
          subtitle="Видно только вам"
        />
        <VideoGrid
          queryKey={['library', kind]}
          path={kind === 'liked' ? '/me/liked?kind=video' : '/me/watch-later'}
          empty={<EmptyState icon={<Clock size={28} />} title="Список пуст" text={kind === 'liked' ? 'Ставьте лайки видео — они соберутся здесь' : 'Нажмите «Смотреть позже» под видео'} />}
        />
      </div>
    </div>
  );
}

export function PlaylistsPage() {
  const lists = useQuery({ queryKey: ['playlists'], queryFn: () => api.get<{ items: Playlist[] }>('/me/playlists') });
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [isPublic, setPublic] = useState(false);
  const create = useMutation({
    mutationFn: () => api.post<Playlist>('/playlists', { title, isPublic }),
    onSuccess: () => {
      setOpen(false);
      setTitle('');
      void lists.refetch();
    },
    onError: (e) => toast({ text: errorMessage(e), kind: 'error' }),
  });
  return (
    <div className="scroll">
      <div className="page page--wide">
        <PageHeader title="Плейлисты" icon={<ListVideo size={22} />} actions={<Button size="sm" icon={<Plus size={16} />} onClick={() => setOpen(true)}>Создать</Button>} />
        {lists.data?.items.length === 0 && <EmptyState icon={<ListVideo size={28} />} title="Нет плейлистов" text="Собирайте видео в подборки" />}
        <div className="video-grid">
          {lists.data?.items.map((p) => (
            <Link key={p.id} to={`/playlist/${p.id}`} className="video-card">
              <div className="video-thumb">
                {p.cover?.posterUrl ?? p.cover?.url ? <img src={p.cover.posterUrl ?? p.cover.url} alt="" /> : null}
                <span className="video-thumb__dur">
                  <ListVideo size={12} style={{ verticalAlign: -2 }} /> {p.itemCount}
                </span>
              </div>
              <span className="video-card__title">{p.title}</span>
              <span className="video-card__meta">{p.isPublic ? 'Открытый' : 'Личный'}</span>
            </Link>
          ))}
        </div>
      </div>
      <Modal open={open} onClose={() => setOpen(false)} title="Новый плейлист" footer={<Button disabled={!title.trim()} loading={create.isPending} onClick={() => create.mutate()}>Создать</Button>}>
        <div className="col gap-3">
          <Input label="Название" value={title} onChange={(e) => setTitle(e.target.value)} />
          <label className="row between">
            Открытый плейлист <Switch checked={isPublic} onChange={setPublic} label="Открытый" />
          </label>
        </div>
      </Modal>
    </div>
  );
}

export function PlaylistPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const me = useMe();
  const q = useQuery({ queryKey: ['playlist', id], queryFn: () => api.get<{ playlist: Playlist; items: Post[] }>(`/playlists/${id}`) });
  useCrumb(q.data?.playlist.title);
  if (q.isLoading) return <Loading />;
  if (!q.data) return <ErrorState error={q.error} />;
  const { playlist, items } = q.data;
  return (
    <div className="scroll">
      <div className="page page--wide">
        <PageHeader
          title={playlist.title}
          subtitle={`${items.length} ${plural(items.length, 'видео', 'видео', 'видео')} · ${playlist.isPublic ? 'открытый' : 'личный'}`}
          icon={<ListVideo size={22} />}
          actions={
            <Button
              variant="danger-ghost"
              size="sm"
              icon={<Trash2 size={16} />}
              onClick={async () => {
                if (!(await confirm({ title: 'Удалить плейлист?', danger: true, confirmLabel: 'Удалить' }))) return;
                await api.del(`/playlists/${id}`);
                navigate('/video/playlists');
              }}
            >
              Удалить
            </Button>
          }
        />
        <div className="col gap-3">
          {items.map((p, i) => (
            <div key={p.id} className="row" style={{ alignItems: 'flex-start' }}>
              <span className="faint" style={{ width: 24, textAlign: 'right', paddingTop: 30 }}>
                {i + 1}
              </span>
              <div className="grow">
                <VideoCard post={p} row />
              </div>
              {me && (
                <button className="icon-btn icon-btn--sm" aria-label="Убрать" onClick={() => void api.del(`/playlists/${id}/items/${p.id}`).then(() => q.refetch())}>
                  <Trash2 size={16} />
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Студия автора ──────────────────────────────────────────────────────────

interface StudioData {
  totals: Record<'posts' | 'views' | 'likes' | 'comments' | 'reposts' | 'followers', number>;
  byKind: { kind: PostKind; posts: number; views: number; likes: number }[];
  top: Post[];
}

const KIND_LABEL: Record<PostKind, string> = { note: 'Заметки', photo: 'Фото', video: 'Видео', short: 'Клипы' };

export function StudioPage({ tab }: { tab: 'dashboard' | 'content' }) {
  const q = useQuery({ queryKey: ['studio'], queryFn: () => api.get<StudioData>('/me/studio') });
  const me = useMe();
  const content = useCursorList<Post>(['user-posts', me.id, 'media'], `/users/${me.id}/posts?tab=media`, { enabled: tab === 'content' });
  if (q.isLoading) return <Loading />;
  if (!q.data) return <ErrorState error={q.error} />;
  const d = q.data;
  const maxViews = Math.max(1, ...d.byKind.map((k) => k.views));
  return (
    <div className="scroll">
      <div className="page page--wide">
        <PageHeader title="Студия" subtitle="Статистика и управление контентом" icon={<ChartColumn size={22} />} actions={<ButtonLink to="/video/upload" size="sm" icon={<Upload size={16} />}>Загрузить</ButtonLink>} />
        <TabLinks
          tabs={[
            { to: '/video/studio', label: 'Панель' },
            { to: '/video/studio/content', label: 'Контент' },
          ]}
        />
        <div style={{ height: 20 }} />
        {tab === 'dashboard' ? (
          <div className="col gap-4">
            <div className="stat-tiles">
              {(
                [
                  ['views', 'Просмотры', Eye],
                  ['likes', 'Лайки', Heart],
                  ['comments', 'Комментарии', Users],
                  ['followers', 'Подписчики', Users],
                  ['posts', 'Публикации', Clapperboard],
                ] as const
              ).map(([k, label, Icon]) => (
                <div key={k} className="stat-tile">
                  <div className="stat-tile__label row">
                    <Icon size={14} /> {label}
                  </div>
                  <div className="stat-tile__value">{compactNumber(d.totals[k] ?? 0)}</div>
                </div>
              ))}
            </div>
            <div className="card card--pad">
              <h3 style={{ marginBottom: 14 }}>Просмотры по форматам</h3>
              <div className="bars">
                {d.byKind.map((k) => (
                  <div key={k.kind} className="bar-row">
                    <span>
                      {KIND_LABEL[k.kind]} <span className="faint">({k.posts})</span>
                    </span>
                    <span className="bar-row__track">
                      <span className="bar-row__fill" style={{ width: `${(k.views / maxViews) * 100}%`, display: 'block' }} />
                    </span>
                    <span className="num" style={{ textAlign: 'right' }}>
                      {compactNumber(k.views)}
                    </span>
                  </div>
                ))}
                {d.byKind.length === 0 && <span className="muted">Опубликуйте первый материал, чтобы увидеть статистику</span>}
              </div>
            </div>
            <div className="card" style={{ overflowX: 'auto' }}>
              <h3 style={{ padding: '16px 16px 4px' }}>Лучшие публикации</h3>
              <table className="table">
                <thead>
                  <tr>
                    <th>Публикация</th>
                    <th>Формат</th>
                    <th className="num">Просмотры</th>
                    <th className="num">Лайки</th>
                    <th className="num">Комм.</th>
                  </tr>
                </thead>
                <tbody>
                  {d.top.map((p) => (
                    <tr key={p.id}>
                      <td>
                        <Link to={p.kind === 'video' ? `/watch/${p.id}` : `/post/${p.id}`} className="clamp-2" style={{ color: 'inherit' }}>
                          {p.title ?? p.text ?? '—'}
                        </Link>
                      </td>
                      <td>{KIND_LABEL[p.kind]}</td>
                      <td className="num">{compactNumber(p.stats.views)}</td>
                      <td className="num">{compactNumber(p.stats.likes)}</td>
                      <td className="num">{compactNumber(p.stats.comments)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <>
            <div className="video-grid">
              {flatPages(content.data).map((p) =>
                p.kind === 'photo' ? (
                  <Link key={p.id} to={`/post/${p.id}`} className="video-card">
                    <div className="video-thumb">
                      <img src={p.media[0]?.url} alt="" loading="lazy" />
                    </div>
                    <span className="video-card__title clamp-2">{p.text}</span>
                    <span className="video-card__meta">
                      {KIND_LABEL[p.kind]} · {compactNumber(p.stats.likes)} лайков
                    </span>
                  </Link>
                ) : (
                  <VideoCard key={p.id} post={p} />
                ),
              )}
            </div>
            {!content.isLoading && flatPages(content.data).length === 0 && <EmptyState icon={<Upload size={28} />} title="Нет контента" action={<ButtonLink to="/video/upload">Загрузить видео</ButtonLink>} />}
            <LoadMore hasMore={!!content.hasNextPage} loading={content.isFetchingNextPage} onLoad={() => void content.fetchNextPage()} />
          </>
        )}
      </div>
    </div>
  );
}

export function UploadVideoPage() {
  const navigate = useNavigate();
  return (
    <div className="scroll">
      <div className="page">
        <PageHeader title="Загрузка видео" subtitle="Видео обрабатывается на вашем устройстве: обложка и метаданные создаются автоматически" icon={<Upload size={22} />} />
        <UploadVideoForm kind="video" onDone={(p) => navigate(`/watch/${p.id}`)} />
      </div>
    </div>
  );
}
