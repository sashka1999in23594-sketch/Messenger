/**
 * Раздел «Видео»: главная с подборками и полками, страница просмотра с
 * плеером, описанием, комментариями и «Далее», библиотека (история,
 * «Смотреть позже», понравившиеся, плейлисты), творческая студия и загрузка.
 */
import { useEffect, useLayoutEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  Bookmark,
  ChartColumn,
  Clapperboard,
  Clock,
  Copy,
  Download,
  Ellipsis,
  Eye,
  Flag,
  Globe,
  Heart,
  History,
  Link2,
  ListPlus,
  ListVideo,
  Lock,
  MessageSquare,
  Pencil,
  Play,
  Plus,
  Radio,
  Repeat,
  Search,
  Share2,
  Shuffle,
  ThumbsUp,
  Trash2,
  Upload,
  Users,
  X,
} from 'lucide-react';
import type {
  Comment,
  HistoryEntry,
  Paginated,
  Playlist,
  Post,
  PostKind,
  Visibility,
} from '@omni/shared';
import { LIMITS } from '@omni/shared';
import { api, errorMessage } from '../../shared/api/client';
import { flatPages, qk, queryClient, useCursorList } from '../../shared/api/query';
import { useMe } from '../../shared/stores/session';
import { toast, useCrumb } from '../../shared/stores/ui';
import {
  cn,
  compactNumber,
  dayLabel,
  duration,
  fullDate,
  plural,
  timeAgo,
  views,
} from '../../shared/lib/format';
import {
  Avatar,
  Button,
  ButtonLink,
  confirm,
  EmptyState,
  ErrorState,
  LoadMore,
  Menu,
  Modal,
  ReportDialog,
  Skeleton,
  Switch,
  TabLinks,
  useMenu,
  type MenuEntry,
} from '../../shared/ui';
import { CommentsSection } from '../posts/Comments';
import { patchPostEverywhere, removePostEverywhere, usePostActions } from '../posts/actions';
import { PremiereChat, PremiereWaiting, usePremierePhase, usePremiereRoom } from '../live/premiere';
import {
  ChannelLine,
  CreateButton,
  DescriptionText,
  LiveBadge,
  LiveCard,
  SaveDialog,
  Shelf,
  SubscribeButton,
  UploadVideoForm,
  useChannel,
  useLiveList,
  VideoCard,
  VideoCardSkeleton,
  VideoChips,
  type ChipId,
} from './components';
import {
  channelPath,
  chapterAt,
  parseChapters,
  premiereState,
  qualityLabel,
  trackViews,
  useCompact,
  useHiddenVideos,
  useLocal,
  videosLabel,
  watchingLabel,
  type Chapter,
} from './lib';
import { closeMini, handOff, peekMini, releaseMini, useMini } from './mini';
import { Player } from './player';
import './video.css';

// ─── Главная ────────────────────────────────────────────────────────────────

function SkeletonGrid({ n = 8 }: { n?: number }) {
  return (
    <>
      {Array.from({ length: n }, (_, i) => (
        <VideoCardSkeleton key={i} />
      ))}
    </>
  );
}

export function VideoHome({ mode }: { mode: 'for-you' | 'following' | 'trending' }) {
  const [params] = useSearchParams();
  const tag = mode === 'for-you' ? params.get('tag') : null;
  const isAll = mode === 'for-you' && !tag;
  const hidden = useHiddenVideos();
  const live = useLiveList();
  const list = useCursorList<Post>(
    tag ? ['tag-videos', tag] : qk.feed(mode, 'video'),
    tag ? `/hashtags/${encodeURIComponent(tag)}/posts` : `/feed/${mode}?kind=video`,
    { limit: 24 },
  );
  const shorts = useQuery({
    queryKey: ['feed', 'for-you', 'short-shelf'],
    queryFn: () => api.get<Paginated<Post>>('/feed/for-you?kind=short&limit=12'),
    enabled: isAll,
    staleTime: 60_000,
  });
  const premieres = useQuery({
    queryKey: ['premieres'],
    queryFn: () => api.get<{ items: Post[] }>('/premieres'),
    enabled: isAll,
    staleTime: 60_000,
  });
  const items = flatPages(list.data).filter((p) => p.kind === 'video' && !hidden.has(p.id));
  const upcoming = (premieres.data?.items ?? []).filter(
    (p) => premiereState(p) !== null && !hidden.has(p.id),
  );
  const reels = (shorts.data?.items ?? []).filter((p) => !hidden.has(p.id));
  const liveNow = live.data?.live ?? [];
  const active: ChipId = tag
    ? `tag:${tag}`
    : mode === 'following'
      ? 'subscriptions'
      : mode === 'trending'
        ? 'trending'
        : 'all';
  useCrumb(tag ? `#${tag}` : null);

  const channels = useMemo(() => {
    if (mode !== 'following') return [];
    const seen = new Map<string, Post['author']>();
    for (const p of items) if (!seen.has(p.author.id)) seen.set(p.author.id, p.author);
    return [...seen.values()].slice(0, 16);
  }, [items, mode]);

  const first = items.slice(0, 8);
  const rest = items.slice(8);

  return (
    <div className="scroll">
      <div className="vroot">
        <div className="vhome">
          <div className="vhome__top">
            <VideoChips active={active} />
            <CreateButton />
          </div>

          {tag && (
            <header className="vpage-head">
              <h1>#{tag}</h1>
            </header>
          )}
          {mode === 'trending' && (
            <header className="vpage-head">
              <h1>В тренде</h1>
            </header>
          )}
          {channels.length > 0 && (
            <div className="vsubs" aria-label="Каналы">
              {channels.map((u) => (
                <Link key={u.id} to={channelPath(u)} className="vsubs__item">
                  <Avatar src={u.avatarUrl} name={u.displayName} id={u.id} size={56} />
                  <span className="ellipsis">{u.displayName}</span>
                </Link>
              ))}
            </div>
          )}

          {isAll && liveNow.length > 0 && (
            <Shelf
              title="Сейчас в эфире"
              icon={<LiveBadge small label="Live" />}
              more={{ to: '/live' }}
              className="vshelf--live"
            >
              {liveNow.map((s) => (
                <div key={s.id} className="vshelf__cell">
                  <LiveCard s={s} />
                </div>
              ))}
            </Shelf>
          )}

          {list.error ? (
            <ErrorState error={list.error} onRetry={() => void list.refetch()} />
          ) : !list.isLoading && items.length === 0 && !list.hasNextPage ? (
            <EmptyState
              icon={<Users size={28} />}
              title={
                mode === 'following'
                  ? 'Нет новых видео от подписок'
                  : tag
                    ? 'Видео с этим хэштегом пока нет'
                    : 'Видео пока нет'
              }
              text={
                mode === 'following'
                  ? 'Подпишитесь на авторов, чтобы видеть их новые видео'
                  : 'Загрузите первое видео — оно появится здесь'
              }
              action={
                <ButtonLink to="/video/upload" pill icon={<Upload size={16} />}>
                  Загрузить видео
                </ButtonLink>
              }
            />
          ) : (
            <div className="vgrid">
              {list.isLoading ? (
                <SkeletonGrid n={12} />
              ) : (
                <>
                  {first.map((p) => (
                    <VideoCard key={p.id} post={p} />
                  ))}
                  {isAll && reels.length > 0 && (
                    <div className="vgrid__full">
                      <Shelf
                        title="Reels"
                        icon={<Clapperboard size={20} className="vshelf__reels-icon" />}
                        more={{ to: '/reels' }}
                        className="vshelf--reels"
                      >
                        {reels.map((p) => (
                          <div key={p.id} className="vshelf__cell vshelf__cell--short">
                            <VideoCard post={p} />
                          </div>
                        ))}
                      </Shelf>
                    </div>
                  )}
                  {isAll && upcoming.length > 0 && (
                    <div className="vgrid__full">
                      <Shelf
                        title="Премьеры"
                        icon={<Clapperboard size={20} />}
                        more={{ to: '/premieres' }}
                      >
                        {upcoming.map((p) => (
                          <div key={p.id} className="vshelf__cell">
                            <VideoCard post={p} />
                          </div>
                        ))}
                      </Shelf>
                    </div>
                  )}
                  {rest.map((p) => (
                    <VideoCard key={p.id} post={p} />
                  ))}
                  {list.isFetchingNextPage && <SkeletonGrid n={4} />}
                </>
              )}
            </div>
          )}
          <LoadMore
            hasMore={!!list.hasNextPage}
            loading={false}
            onLoad={() => !list.isFetchingNextPage && void list.fetchNextPage()}
          />
        </div>
      </div>
    </div>
  );
}

// ─── Просмотр ───────────────────────────────────────────────────────────────

/** ?t=90, ?t=1m30s */
function parseStart(v: string | null): number | null {
  if (!v) return null;
  if (/^\d+$/.test(v)) return Number(v);
  const m = v.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/);
  if (!m) return null;
  return Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0) || null;
}

function WatchSkeleton() {
  return (
    <div className="scroll">
      <div className="vroot">
        <div className="vwatch">
          <div className="vwatch__player">
            <div className="vp-skeleton" />
          </div>
          <div className="vwatch__main">
            <Skeleton width="70%" height={24} />
            <div className="row" style={{ gap: 12, marginTop: 16 }}>
              <Skeleton width={40} height={40} radius={20} />
              <Skeleton width={160} height={16} />
            </div>
            <Skeleton width="100%" height={90} radius={12} className="vskel-desc" />
          </div>
          <aside className="vwatch__side">
            {Array.from({ length: 6 }, (_, i) => (
              <VideoCardSkeleton key={i} row />
            ))}
          </aside>
        </div>
      </div>
    </div>
  );
}

export function WatchPage() {
  const { id = '' } = useParams();
  const [params] = useSearchParams();
  const q = useQuery({ queryKey: qk.post(id), queryFn: () => api.get<Post>(`/posts/${id}`) });
  useCrumb(q.data?.title);
  if (q.isLoading) return <WatchSkeleton />;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  return (
    <Watch
      key={id}
      post={q.data}
      listId={params.get('list')}
      startAt={parseStart(params.get('t'))}
    />
  );
}

interface Queue {
  title: string;
  items: Post[];
  isPrivate: boolean;
}

/** Список воспроизведения: «Смотреть позже» (WL), понравившиеся (LL) или плейлист. */
function useQueue(listId: string | null): Queue | null {
  const q = useQuery({
    queryKey: ['queue', listId],
    enabled: !!listId,
    queryFn: async (): Promise<Queue> => {
      if (listId === 'WL')
        return {
          title: 'Смотреть позже',
          isPrivate: true,
          items: (await api.get<Paginated<Post>>('/me/watch-later?limit=50')).items,
        };
      if (listId === 'LL')
        return {
          title: 'Понравившиеся',
          isPrivate: true,
          items: (await api.get<Paginated<Post>>('/me/liked?kind=video&limit=50')).items,
        };
      const r = await api.get<{ playlist: Playlist; items: Post[] }>(`/playlists/${listId}`);
      return { title: r.playlist.title, isPrivate: !r.playlist.isPublic, items: r.items };
    },
  });
  return q.data ? { ...q.data, items: q.data.items.filter((p) => p.kind === 'video') } : null;
}

function Watch({
  post,
  listId,
  startAt,
}: {
  post: Post;
  listId: string | null;
  startAt: number | null;
}) {
  const navigate = useNavigate();
  const me = useMe();
  const [rootRef, compact, rootNode] = useCompact<HTMLDivElement>(1000);
  const [inWindow, setInWindow] = useState(false);
  useLayoutEffect(() => setInWindow(!!rootNode?.closest('.desk-win')), [rootNode]);
  const m = post.media[0];
  const premiere = usePremierePhase(post);
  const room = usePremiereRoom(post, !!premiere.phase);
  const channel = useChannel(post.author);
  const related = useQuery({
    queryKey: ['related', post.id],
    queryFn: () => api.get<{ items: Post[] }>(`/posts/${post.id}/related`),
  });
  const queue = useQueue(listId);
  const hidden = useHiddenVideos();
  const [theater, setTheater] = useLocal('theater', false);
  const [autoplay, setAutoplay] = useLocal('autoplay', true);
  const [loopList, setLoopList] = useLocal('list-loop', false);
  const [shuffle, setShuffle] = useState(false);
  const [el, setEl] = useState<HTMLVideoElement | null>(null);
  const [ended, setEnded] = useState(false);
  const [cancelled, setCancelled] = useState(false);
  const [filter, setFilter] = useState<'all' | 'author' | 'other'>('all');

  // Видео из мини-плеера продолжаем; другое видео в мини-плеере — закрываем
  const [adopt] = useState(() => peekMini(post.id));
  useEffect(() => {
    if (adopt) releaseMini(adopt);
    else if (useMini.getState().post) closeMini();
  }, [adopt]);

  // Учёт просмотров и прогресса
  const waiting = premiere.phase === 'before';
  useEffect(() => {
    if (!el || waiting) return;
    return trackViews(el, post.id);
  }, [el, post.id, waiting]);

  // Премьера началась — ссылка на файл открывается только теперь
  useEffect(() => {
    if (premiere.phase === 'live' && m && !m.url)
      void queryClient.invalidateQueries({ queryKey: qk.post(post.id) });
  }, [premiere.phase, m, post.id]);

  useEffect(() => {
    if (!el) return;
    const onPlay = () => {
      setEnded(false);
      setCancelled(false);
    };
    el.addEventListener('play', onPlay);
    return () => el.removeEventListener('play', onPlay);
  }, [el]);

  const chapters = useMemo(
    () => parseChapters(post.text, m?.durationSec),
    [post.text, m?.durationSec],
  );
  const relatedItems = (related.data?.items ?? []).filter((p) => !hidden.has(p.id));
  const shown = relatedItems.filter((p) =>
    filter === 'author'
      ? p.author.id === post.author.id
      : filter === 'other'
        ? p.author.id !== post.author.id
        : true,
  );
  const shuffleSeed = useMemo(() => Math.random(), [shuffle]); // eslint-disable-line react-hooks/exhaustive-deps

  const next = useMemo((): { post: Post; href: string } | null => {
    if (queue?.items.length) {
      const items = queue.items;
      const idx = items.findIndex((p) => p.id === post.id);
      let n: Post | undefined;
      if (shuffle) {
        const others = items.filter((p) => p.id !== post.id);
        n = others[Math.floor(shuffleSeed * others.length)];
      } else n = items[idx + 1] ?? (loopList ? items[0] : undefined);
      return n && n.id !== post.id ? { post: n, href: `/watch/${n.id}?list=${listId}` } : null;
    }
    const n = relatedItems.find((p) => p.kind === 'video' && premiereState(p) !== 'upcoming');
    return n ? { post: n, href: `/watch/${n.id}` } : null;
  }, [queue, relatedItems, post.id, shuffle, shuffleSeed, loopList, listId]);

  const goNext = next ? () => navigate(next.href) : null;
  const showUpNext = ended && !cancelled && !!next && (autoplay || !!queue);
  const wide = !compact;

  const seekTo = (sec: number) => {
    if (!el) return;
    el.currentTime = sec;
    void el.play().catch(() => undefined);
    rootNode?.querySelector('.vp')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };

  const player = waiting ? (
    <div className="vp-shell">
      <PremiereWaiting post={post} left={premiere.left} watching={room.data?.watching} />
    </div>
  ) : (
    <Player
      storageKey={post.id}
      src={m?.url || null}
      poster={m?.posterUrl}
      mode={premiere.phase === 'live' ? 'premiere' : 'vod'}
      liveEdge={premiere.phase === 'live' ? premiere.elapsed / 1000 : undefined}
      startAt={premiere.phase === 'live' ? premiere.elapsed / 1000 : startAt}
      title={post.title ?? ''}
      artist={post.author.displayName}
      chapters={chapters}
      quality={qualityLabel(m?.height)}
      autoPlay
      theater={theater}
      onTheater={wide ? () => setTheater(!theater) : null}
      onNext={goNext}
      nextTitle={next?.post.title ?? undefined}
      onEnded={() => setEnded(true)}
      onElement={setEl}
      adopt={adopt}
      onRelease={(v) =>
        !inWindow &&
        !location.pathname.startsWith('/watch/') &&
        handOff(post, v, (to) => navigate(to))
      }
      ambient={wide && !theater}
      badges={
        premiere.phase === 'live' ? (
          <>
            <LiveBadge label="Премьера" />
            {room.data && (
              <span className="vbadge vbadge--glass">{watchingLabel(room.data.watching)}</span>
            )}
          </>
        ) : null
      }
      overlay={
        showUpNext && next ? (
          <UpNext
            next={next.post}
            inList={!!queue}
            onCancel={() => setCancelled(true)}
            onGo={() => navigate(next.href)}
          />
        ) : null
      }
    />
  );

  return (
    <div className="scroll">
      <div className="vroot" ref={rootRef}>
        <div
          className={cn(
            'vwatch',
            theater && wide && 'vwatch--theater',
            compact && 'vwatch--compact',
          )}
        >
          <div className="vwatch__player">{player}</div>
          <div className="vwatch__main">
            <WatchInfo
              post={post}
              channel={channel.data}
              premiere={premiere.phase}
              chapters={chapters}
              el={el}
              onSeek={seekTo}
              compact={compact}
            />
          </div>
          <aside className="vwatch__side">
            {premiere.phase && (
              <div className="vwatch__chat">
                <PremiereChat post={post} live={premiere.phase === 'live'} />
              </div>
            )}
            {queue && listId && (
              <QueuePanel
                queue={queue}
                listId={listId}
                current={post.id}
                loop={loopList}
                shuffle={shuffle}
                onLoop={() => setLoopList(!loopList)}
                onShuffle={() => setShuffle(!shuffle)}
              />
            )}
            <section className="vnext" aria-label="Далее">
              <div className="vnext__head">
                <div className="vnext__chips" role="tablist">
                  {(
                    [
                      ['all', 'Все'],
                      ['author', `От автора`],
                      ['other', 'Похожие'],
                    ] as const
                  ).map(([k, label]) => (
                    <button
                      key={k}
                      type="button"
                      role="tab"
                      aria-selected={filter === k}
                      className={cn('vchip vchip--sm', filter === k && 'vchip--on')}
                      onClick={() => setFilter(k)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                {!queue && (
                  <label className="vnext__auto">
                    <span>Автовоспроизведение</span>
                    <Switch checked={autoplay} onChange={setAutoplay} label="Автовоспроизведение" />
                  </label>
                )}
              </div>
              {related.isLoading
                ? Array.from({ length: 6 }, (_, i) => <VideoCardSkeleton key={i} row />)
                : shown.map((r) => <VideoCard key={r.id} post={r} row />)}
              {!related.isLoading && shown.length === 0 && (
                <p className="vnext__empty">Пока нечего предложить</p>
              )}
            </section>
          </aside>
        </div>
      </div>
    </div>
  );
}

/** «Далее через 8 с» поверх закончившегося видео. */
function UpNext({
  next,
  inList,
  onCancel,
  onGo,
}: {
  next: Post;
  inList: boolean;
  onCancel: () => void;
  onGo: () => void;
}) {
  const SECONDS = 8;
  const [left, setLeft] = useState(SECONDS);
  useEffect(() => {
    if (left <= 0) {
      onGo();
      return;
    }
    const t = window.setTimeout(() => setLeft((l) => l - 1), 1000);
    return () => window.clearTimeout(t);
  }, [left]); // eslint-disable-line react-hooks/exhaustive-deps
  const m = next.media[0];
  return (
    <div className="vupnext" role="dialog" aria-label="Следующее видео">
      <span className="vupnext__label">
        {inList ? 'Следующее в списке' : 'Далее'} · через {left} с
      </span>
      <div className="vupnext__card">
        <span className="vupnext__thumb">{m?.posterUrl && <img src={m.posterUrl} alt="" />}</span>
        <span className="vupnext__text">
          <b className="clamp-2">{next.title}</b>
          <span>{next.author.displayName}</span>
          <span>{views(next.stats.views)}</span>
        </span>
      </div>
      <div className="vupnext__actions">
        <button type="button" className="vupnext__btn" onClick={onCancel}>
          Отмена
        </button>
        <button
          type="button"
          className="vupnext__btn vupnext__btn--go"
          onClick={onGo}
          style={{ '--p': (SECONDS - left) / SECONDS } as React.CSSProperties}
        >
          <Play size={16} fill="currentColor" /> Смотреть
        </button>
      </div>
    </div>
  );
}

function QueuePanel({
  queue,
  listId,
  current,
  loop,
  shuffle,
  onLoop,
  onShuffle,
}: {
  queue: Queue;
  listId: string;
  current: string;
  loop: boolean;
  shuffle: boolean;
  onLoop: () => void;
  onShuffle: () => void;
}) {
  const idx = queue.items.findIndex((p) => p.id === current);
  const [open, setOpen] = useState(true);
  useEffect(() => {
    document.getElementById(`vq-${current}`)?.scrollIntoView({ block: 'nearest' });
  }, [current]);
  return (
    <section className="vqueue" aria-label={queue.title}>
      <header className="vqueue__head">
        <button
          type="button"
          className="vqueue__title"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
        >
          <b className="ellipsis">{queue.title}</b>
          <span>
            {queue.isPrivate ? <Lock size={12} /> : <Globe size={12} />} {idx + 1} /{' '}
            {queue.items.length}
          </span>
        </button>
        <button
          type="button"
          className={cn('vqueue__tool', loop && 'vqueue__tool--on')}
          onClick={onLoop}
          aria-pressed={loop}
          title="Повторять список"
        >
          <Repeat size={18} />
        </button>
        <button
          type="button"
          className={cn('vqueue__tool', shuffle && 'vqueue__tool--on')}
          onClick={onShuffle}
          aria-pressed={shuffle}
          title="Перемешать"
        >
          <Shuffle size={18} />
        </button>
      </header>
      {open && (
        <div className="vqueue__list">
          {queue.items.map((p, i) => (
            <Link
              key={p.id}
              id={`vq-${p.id}`}
              to={`/watch/${p.id}?list=${listId}`}
              className={cn('vqueue__item', p.id === current && 'vqueue__item--on')}
            >
              <span className="vqueue__idx">
                {p.id === current ? <Play size={12} fill="currentColor" /> : i + 1}
              </span>
              <span className="vqueue__thumb">
                {p.media[0]?.posterUrl && <img src={p.media[0].posterUrl} alt="" loading="lazy" />}
                {p.media[0]?.durationSec ? (
                  <span className="vbadge vbadge--dur">{duration(p.media[0].durationSec)}</span>
                ) : null}
              </span>
              <span className="vqueue__text">
                <b className="clamp-2">{p.title}</b>
                <span className="ellipsis">{p.author.displayName}</span>
              </span>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}

function WatchInfo({
  post,
  channel,
  premiere,
  chapters,
  el,
  onSeek,
  compact,
}: {
  post: Post;
  channel: ReturnType<typeof useChannel>['data'];
  premiere: 'before' | 'live' | null;
  chapters: Chapter[];
  el: HTMLVideoElement | null;
  onSeek: (sec: number) => void;
  compact: boolean;
}) {
  const me = useMe();
  const navigate = useNavigate();
  const { like, watchLater, bookmark, remove } = usePostActions(post);
  const [descOpen, setDescOpen] = useState(false);
  const [dialog, setDialog] = useState<null | 'save' | 'share' | 'report'>(null);
  const more = useMenu();
  const m = post.media[0];
  const own = post.author.id === me.id;
  const liked = post.viewer.liked;

  const download = () => {
    if (!m?.url) return;
    const a = document.createElement('a');
    a.href = m.url;
    a.download = `${(post.title ?? 'video').replace(/[^\p{L}\p{N} _-]/gu, '').slice(0, 80) || 'video'}`;
    a.click();
  };

  const menuItems: MenuEntry[] = [
    {
      label: post.viewer.watchLater ? 'Убрать из «Смотреть позже»' : 'Смотреть позже',
      icon: <Clock size={18} />,
      onClick: () => watchLater.mutate(!post.viewer.watchLater),
    },
    {
      label: post.viewer.bookmarked ? 'Убрать из закладок' : 'В закладки',
      icon: <Bookmark size={18} />,
      onClick: () => bookmark.mutate(!post.viewer.bookmarked),
    },
    {
      label: 'Скачать',
      icon: <Download size={18} />,
      hidden: !m?.url || !compact,
      onClick: download,
    },
    {
      label: 'Ссылка на этот момент',
      icon: <Link2 size={18} />,
      hidden: !el,
      onClick: () =>
        void navigator.clipboard
          .writeText(`${location.origin}/watch/${post.id}?t=${Math.floor(el?.currentTime ?? 0)}`)
          .then(() => toast('Ссылка с таймкодом скопирована')),
    },
    'separator',
    {
      label: 'Пожаловаться',
      icon: <Flag size={18} />,
      hidden: own,
      onClick: () => setDialog('report'),
    },
    {
      label: 'Удалить видео',
      icon: <Trash2 size={18} />,
      danger: true,
      hidden: !own,
      onClick: async () => {
        if (
          !(await confirm({
            title: 'Удалить видео?',
            text: 'Видео, просмотры и комментарии будут удалены навсегда',
            danger: true,
            confirmLabel: 'Удалить',
          }))
        )
          return;
        remove.mutate(undefined, { onSuccess: () => navigate('/video') });
      },
    },
  ];

  const current = el ? chapterAt(chapters, el.currentTime) : null;
  const exactViews = `${post.stats.views.toLocaleString('ru')} ${plural(post.stats.views, 'просмотр', 'просмотра', 'просмотров')}`;

  return (
    <>
      <h1 className="vwatch__title">{post.title || 'Без названия'}</h1>
      <div className="vwatch__bar">
        <div className="vwatch__owner">
          <ChannelLine user={post.author} profile={channel} />
          <SubscribeButton user={post.author} profile={channel} />
        </div>
        <div className="vwatch__actions">
          <span className="vpill">
            <button
              type="button"
              className={cn('vpill__btn', liked && 'vpill__btn--on')}
              onClick={() => like.mutate(!liked)}
              aria-pressed={liked}
              aria-label={liked ? 'Убрать отметку «Нравится»' : 'Нравится'}
              title="Нравится"
            >
              <ThumbsUp size={18} fill={liked ? 'currentColor' : 'none'} />
              {compactNumber(post.stats.likes)}
            </button>
          </span>
          <button type="button" className="vact" onClick={() => setDialog('share')}>
            <Share2 size={18} /> Поделиться
          </button>
          <button type="button" className="vact" onClick={() => setDialog('save')}>
            <ListPlus size={18} /> Сохранить
          </button>
          {m?.url && !compact && (
            <button type="button" className="vact" onClick={download}>
              <Download size={18} /> Скачать
            </button>
          )}
          <button
            type="button"
            className="vact vact--icon"
            aria-label="Ещё"
            onClick={(e) => more.openFromEvent(e)}
          >
            <Ellipsis size={18} />
          </button>
          <Menu anchor={more.anchor} items={menuItems} onClose={more.close} />
        </div>
      </div>

      <div
        className={cn('vdesc', descOpen && 'vdesc--open')}
        onClick={(e) => {
          if (!descOpen && !(e.target as HTMLElement).closest('a, button')) setDescOpen(true);
        }}
        role={descOpen ? undefined : 'button'}
        tabIndex={descOpen ? undefined : 0}
        onKeyDown={(e) => !descOpen && e.key === 'Enter' && setDescOpen(true)}
      >
        <div className="vdesc__meta">
          {premiere === 'before' ? (
            <b>Премьера запланирована на {fullDate(post.premiereAt!)}</b>
          ) : premiere === 'live' ? (
            <b>Премьера идёт сейчас · началась {timeAgo(post.premiereAt!)}</b>
          ) : (
            <b>
              {descOpen ? exactViews : views(post.stats.views)} ·{' '}
              {descOpen
                ? fullDate(post.premiereAt ?? post.createdAt)
                : timeAgo(post.premiereAt ?? post.createdAt)}
            </b>
          )}
          {post.hashtags.slice(0, 4).map((t) => (
            <Link key={t} to={`/video?tag=${encodeURIComponent(t)}`} className="vdesc__tag">
              #{t}
            </Link>
          ))}
        </div>
        <div className={cn('vdesc__body', !descOpen && 'vdesc__body--clamp')}>
          {post.text ? (
            <DescriptionText text={post.text} onSeek={onSeek} max={m?.durationSec ?? undefined} />
          ) : (
            <span className="vdesc__empty">Без описания</span>
          )}
        </div>
        {descOpen && chapters.length > 0 && (
          <div className="vchapters">
            <b className="vchapters__title">Главы</b>
            <div className="vchapters__row">
              {chapters.map((c) => (
                <button
                  key={c.start}
                  type="button"
                  className={cn('vchapter', current?.start === c.start && 'vchapter--on')}
                  onClick={() => onSeek(c.start)}
                >
                  <span className="vchapter__time">{duration(c.start)}</span>
                  <span className="vchapter__title clamp-2">{c.title}</span>
                </button>
              ))}
            </div>
          </div>
        )}
        {descOpen && (
          <div className="vdesc__channel">
            <ChannelLine user={post.author} profile={channel} size={48} />
            <div className="row gap-2 wrap">
              <ButtonLink
                to={channelPath(post.author)}
                variant="secondary"
                size="sm"
                pill
                icon={<ListVideo size={16} />}
              >
                Видео
              </ButtonLink>
              <ButtonLink
                to={channelPath(post.author)}
                variant="secondary"
                size="sm"
                pill
                icon={<Users size={16} />}
              >
                О канале
              </ButtonLink>
            </div>
          </div>
        )}
        <button
          type="button"
          className="vdesc__toggle"
          onClick={(e) => {
            e.stopPropagation();
            setDescOpen(!descOpen);
          }}
        >
          {descOpen ? 'Свернуть' : 'ещё'}
        </button>
      </div>

      <CommentsBlock post={post} compact={compact} />

      {dialog === 'save' && <SaveDialog post={post} onClose={() => setDialog(null)} />}
      {dialog === 'share' && <ShareDialog post={post} el={el} onClose={() => setDialog(null)} />}
      <ReportDialog
        open={dialog === 'report'}
        onClose={() => setDialog(null)}
        entityType="post"
        entityId={post.id}
      />
    </>
  );
}

function ShareDialog({
  post,
  el,
  onClose,
}: {
  post: Post;
  el: HTMLVideoElement | null;
  onClose: () => void;
}) {
  const at = Math.floor(el?.currentTime ?? 0);
  const [withTime, setWithTime] = useState(false);
  const url = `${location.origin}/watch/${post.id}${withTime && at > 0 ? `?t=${at}` : ''}`;
  const copy = () =>
    void navigator.clipboard.writeText(url).then(() => toast('Ссылка скопирована'));
  return (
    <Modal open onClose={onClose} title="Поделиться">
      <div className="vshare">
        {typeof navigator.share === 'function' && (
          <button
            type="button"
            className="vshare__native"
            onClick={() =>
              void navigator.share({ title: post.title ?? undefined, url }).catch(() => undefined)
            }
          >
            <Share2 size={20} /> Отправить через…
          </button>
        )}
        <div className="vshare__link">
          <input
            className="vshare__input"
            readOnly
            value={url}
            onFocus={(e) => e.currentTarget.select()}
            aria-label="Ссылка на видео"
          />
          <button type="button" className="vsub" onClick={copy}>
            <Copy size={16} /> Копировать
          </button>
        </div>
        {at > 0 && (
          <label className="vshare__time">
            <input
              type="checkbox"
              checked={withTime}
              onChange={(e) => setWithTime(e.target.checked)}
            />{' '}
            Начать с {duration(at)}
          </label>
        )}
      </div>
    </Modal>
  );
}

/** Комментарии: на узком экране — свёрнутая карточка с лучшим комментарием. */
function CommentsBlock({ post, compact }: { post: Post; compact: boolean }) {
  const [open, setOpen] = useState(false);
  const top = useQuery({
    queryKey: ['comments-top', post.id],
    queryFn: () => api.get<Paginated<Comment>>(`/posts/${post.id}/comments?sort=top&limit=1`),
    enabled: compact && !open && !post.commentsDisabled && post.stats.comments > 0,
  });
  if (compact && !open) {
    const c = top.data?.items[0];
    return (
      <button type="button" className="vcomm-teaser" onClick={() => setOpen(true)}>
        <span className="vcomm-teaser__head">
          <b>Комментарии</b>{' '}
          <span>{post.commentsDisabled ? '' : compactNumber(post.stats.comments)}</span>
        </span>
        {post.commentsDisabled ? (
          <span className="vcomm-teaser__text">Комментарии отключены</span>
        ) : c ? (
          <span className="vcomm-teaser__row">
            <Avatar
              src={c.author.avatarUrl}
              name={c.author.displayName}
              id={c.author.id}
              size={24}
            />
            <span className="vcomm-teaser__text clamp-2">{c.text}</span>
          </span>
        ) : (
          <span className="vcomm-teaser__row">
            <MessageSquare size={18} />
            <span className="vcomm-teaser__text">Оставьте первый комментарий</span>
          </span>
        )}
      </button>
    );
  }
  return (
    <div className="vcomments">
      {compact && (
        <button
          type="button"
          className="vcomments__close"
          onClick={() => setOpen(false)}
          aria-label="Свернуть комментарии"
        >
          <X size={18} />
        </button>
      )}
      <CommentsSection
        postId={post.id}
        postAuthorId={post.author.id}
        count={post.stats.comments}
        disabled={post.commentsDisabled}
      />
    </div>
  );
}

// ─── Библиотека ─────────────────────────────────────────────────────────────

export function HistoryPage() {
  const list = useCursorList<HistoryEntry>(['history', 'video'], '/me/history?kind=all', {
    limit: 30,
  });
  const [query, setQuery] = useState('');
  const all = flatPages(list.data);
  const q = query.trim().toLowerCase();
  const items = q
    ? all.filter((h) =>
        `${h.post.title ?? ''} ${h.post.text} ${h.post.author.displayName}`
          .toLowerCase()
          .includes(q),
      )
    : all;
  const groups = useMemo(() => {
    const out: { label: string; items: HistoryEntry[] }[] = [];
    for (const h of items) {
      const label = dayLabel(h.viewedAt);
      const last = out[out.length - 1];
      if (last?.label === label) last.items.push(h);
      else out.push({ label, items: [h] });
    }
    return out;
  }, [items]);
  const clear = async () => {
    if (
      !(await confirm({
        title: 'Очистить историю просмотра?',
        text: 'История будет удалена со всех устройств',
        danger: true,
        confirmLabel: 'Очистить',
      }))
    )
      return;
    await api.del('/me/history');
    void list.refetch();
  };
  const removeOne = (id: string) =>
    void api
      .del(`/me/history/${id}`)
      .then(() => list.refetch())
      .catch((e) => toast({ text: errorMessage(e), kind: 'error' }));
  return (
    <div className="scroll">
      <div className="vroot">
        <div className="vhist">
          <div className="vhist__list">
            <header className="vpage-head">
              <h1>История просмотра</h1>
            </header>
            {list.isLoading ? (
              Array.from({ length: 5 }, (_, i) => <VideoCardSkeleton key={i} row />)
            ) : items.length === 0 ? (
              <EmptyState
                icon={<History size={28} />}
                title={q ? 'Ничего не найдено' : 'История пуста'}
                text={q ? 'Попробуйте другой запрос' : 'Здесь появятся видео, которые вы смотрели'}
              />
            ) : (
              groups.map((g) => (
                <section key={g.label} className="vhist__group">
                  <h2 className="vhist__day">{g.label}</h2>
                  {g.items.map((h) => (
                    <div key={h.post.id} className="vhist__item">
                      {h.post.kind === 'video' || h.post.kind === 'short' ? (
                        <VideoCard post={h.post} row size="lg" progressSec={h.progressSec} noHide />
                      ) : (
                        <Link to={`/post/${h.post.id}`} className="vhist__note clamp-2">
                          {h.post.title ?? h.post.text}
                        </Link>
                      )}
                      <button
                        type="button"
                        className="vhist__remove"
                        aria-label="Удалить из истории"
                        title="Удалить из истории"
                        onClick={() => removeOne(h.post.id)}
                      >
                        <X size={20} />
                      </button>
                    </div>
                  ))}
                </section>
              ))
            )}
            <LoadMore
              hasMore={!!list.hasNextPage}
              loading={list.isFetchingNextPage}
              onLoad={() => void list.fetchNextPage()}
            />
          </div>
          <aside className="vhist__side">
            <label className="vsearch">
              <Search size={18} />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Искать в истории"
                aria-label="Искать в истории"
              />
              {query && (
                <button type="button" onClick={() => setQuery('')} aria-label="Очистить поиск">
                  <X size={16} />
                </button>
              )}
            </label>
            <button
              type="button"
              className="vside-act"
              onClick={() => void clear()}
              disabled={all.length === 0}
            >
              <Trash2 size={18} /> Очистить историю
            </button>
            <p className="vside-note">
              История видна только вам. Прогресс просмотра сохраняется, чтобы продолжить с того же
              места.
            </p>
          </aside>
        </div>
      </div>
    </div>
  );
}

/** Страница списка в стиле плейлиста: обложка слева, видео справа. */
function ListLayout({
  title,
  meta,
  items,
  listParam,
  loading,
  empty,
  actions,
  onRemove,
  footer,
}: {
  title: string;
  meta: ReactNode;
  items: Post[];
  listParam: string;
  loading: boolean;
  empty: ReactNode;
  actions?: ReactNode;
  onRemove?: (p: Post) => void;
  footer?: ReactNode;
}) {
  const navigate = useNavigate();
  const cover = items[0]?.media[0]?.posterUrl;
  const playable = items.filter((p) => p.kind === 'video');
  return (
    <div className="scroll">
      <div className="vroot">
        <div className="vlist">
          <aside className="vlist__hero">
            {cover && (
              <div
                className="vlist__bg"
                style={{ backgroundImage: `url("${cover}")` }}
                aria-hidden
              />
            )}
            <div className="vlist__hero-inner">
              <div className="vlist__cover">
                {cover ? <img src={cover} alt="" /> : <ListVideo size={40} />}
              </div>
              <h1 className="vlist__title">{title}</h1>
              <div className="vlist__meta">{meta}</div>
              <div className="vlist__buttons">
                <button
                  type="button"
                  className="vlist__play"
                  disabled={!playable.length}
                  onClick={() =>
                    playable[0] && navigate(`/watch/${playable[0].id}?list=${listParam}`)
                  }
                >
                  <Play size={18} fill="currentColor" /> Воспроизвести все
                </button>
                <button
                  type="button"
                  className="vlist__ghost"
                  disabled={!playable.length}
                  onClick={() => {
                    const p = playable[Math.floor(Math.random() * playable.length)];
                    if (p) navigate(`/watch/${p.id}?list=${listParam}`);
                  }}
                >
                  <Shuffle size={18} /> Перемешать
                </button>
                {actions}
              </div>
            </div>
          </aside>
          <div className="vlist__items">
            {loading
              ? Array.from({ length: 5 }, (_, i) => <VideoCardSkeleton key={i} row />)
              : items.length === 0
                ? empty
                : items.map((p, i) => (
                    <div key={p.id} className="vlist__item">
                      <span className="vlist__idx">{i + 1}</span>
                      <VideoCard
                        post={p}
                        row
                        size="lg"
                        to={p.kind === 'video' ? `/watch/${p.id}?list=${listParam}` : undefined}
                        noHide
                      />
                      {onRemove && (
                        <button
                          type="button"
                          className="vhist__remove"
                          aria-label="Убрать из списка"
                          title="Убрать из списка"
                          onClick={() => onRemove(p)}
                        >
                          <X size={20} />
                        </button>
                      )}
                    </div>
                  ))}
            {footer}
          </div>
        </div>
      </div>
    </div>
  );
}

export function LibraryList({ kind }: { kind: 'watch-later' | 'liked' }) {
  const me = useMe();
  const list = useCursorList<Post>(
    ['library', kind],
    kind === 'liked' ? '/me/liked?kind=video' : '/me/watch-later',
    { limit: 50 },
  );
  const items = flatPages(list.data).filter((p) => p.kind === 'video' || p.kind === 'short');
  const title = kind === 'liked' ? 'Понравившиеся' : 'Смотреть позже';
  const remove = (p: Post) =>
    void (kind === 'liked' ? api.del(`/posts/${p.id}/like`) : api.del(`/posts/${p.id}/watch-later`))
      .then(() => {
        patchPostEverywhere(p.id, (x) => ({
          ...x,
          viewer: { ...x.viewer, [kind === 'liked' ? 'liked' : 'watchLater']: false },
          stats: kind === 'liked' ? { ...x.stats, likes: Math.max(0, x.stats.likes - 1) } : x.stats,
        }));
        removePostEverywhere(p.id, (k) => k[0] === 'library' && k[1] === kind);
        toast(kind === 'liked' ? 'Убрано из понравившихся' : 'Убрано из «Смотреть позже»');
      })
      .catch((e) => toast({ text: errorMessage(e), kind: 'error' }));
  return (
    <ListLayout
      title={title}
      meta={
        <>
          <b>{me.displayName}</b>
          <span>
            {videosLabel(items.length)}
            {list.hasNextPage ? '+' : ''} · <Lock size={12} /> Видно только вам
          </span>
        </>
      }
      items={items}
      listParam={kind === 'liked' ? 'LL' : 'WL'}
      loading={list.isLoading}
      empty={
        <EmptyState
          icon={kind === 'liked' ? <Heart size={28} /> : <Clock size={28} />}
          title="Список пуст"
          text={
            kind === 'liked'
              ? 'Ставьте «Нравится» видео — они соберутся здесь'
              : 'Нажмите «Сохранить» или значок часов на превью, чтобы посмотреть видео позже'
          }
        />
      }
      onRemove={remove}
      footer={
        <LoadMore
          hasMore={!!list.hasNextPage}
          loading={list.isFetchingNextPage}
          onLoad={() => void list.fetchNextPage()}
        />
      }
    />
  );
}

function PlaylistCard({
  to,
  title,
  cover,
  count,
  meta,
}: {
  to: string;
  title: string;
  cover: string | null | undefined;
  count: ReactNode;
  meta: ReactNode;
}) {
  return (
    <Link to={to} className="vpl">
      <span className="vpl__stack" aria-hidden />
      <span className="vpl__thumb">
        {cover ? <img src={cover} alt="" loading="lazy" /> : <ListVideo size={32} />}
        <span className="vbadge vbadge--dur vpl__count">
          <ListVideo size={13} /> {count}
        </span>
        <span className="vpl__hover">
          <Play size={18} fill="currentColor" /> Воспроизвести все
        </span>
      </span>
      <b className="vpl__title clamp-2">{title}</b>
      <span className="vpl__meta">{meta}</span>
    </Link>
  );
}

export function PlaylistsPage() {
  const lists = useQuery({
    queryKey: ['playlists'],
    queryFn: () => api.get<{ items: Playlist[] }>('/me/playlists'),
  });
  const later = useQuery({
    queryKey: ['library-cover', 'WL'],
    queryFn: () => api.get<Paginated<Post>>('/me/watch-later?limit=1'),
  });
  const liked = useQuery({
    queryKey: ['library-cover', 'LL'],
    queryFn: () => api.get<Paginated<Post>>('/me/liked?kind=video&limit=1'),
  });
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [isPublic, setPublic] = useState(false);
  const create = useMutation({
    mutationFn: () => api.post<Playlist>('/playlists', { title: title.trim(), isPublic }),
    onSuccess: () => {
      setOpen(false);
      setTitle('');
      void lists.refetch();
    },
    onError: (e) => toast({ text: errorMessage(e), kind: 'error' }),
  });
  return (
    <div className="scroll">
      <div className="vroot">
        <div className="vhome">
          <header className="vpage-head vpage-head--row">
            <div>
              <h1>Плейлисты</h1>
            </div>
            <Button pill icon={<Plus size={16} />} onClick={() => setOpen(true)}>
              Создать
            </Button>
          </header>
          <div className="vgrid">
            <PlaylistCard
              to="/video/watch-later"
              title="Смотреть позже"
              cover={later.data?.items[0]?.media[0]?.posterUrl}
              count={later.data?.items.length ? 'Видео' : '0'}
              meta="Личный · Плейлист"
            />
            <PlaylistCard
              to="/video/liked"
              title="Понравившиеся"
              cover={liked.data?.items[0]?.media[0]?.posterUrl}
              count={liked.data?.items.length ? 'Видео' : '0'}
              meta="Личный · Плейлист"
            />
            {lists.isLoading && <SkeletonGrid n={2} />}
            {lists.data?.items.map((p) => (
              <PlaylistCard
                key={p.id}
                to={`/playlist/${p.id}`}
                title={p.title}
                cover={p.cover?.posterUrl ?? p.cover?.url}
                count={p.itemCount}
                meta={
                  <>
                    {p.isPublic ? 'Открытый' : 'Личный'} · Плейлист · {timeAgo(p.createdAt)}
                  </>
                }
              />
            ))}
          </div>
        </div>
      </div>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Новый плейлист"
        footer={
          <Button
            disabled={!title.trim()}
            loading={create.isPending}
            onClick={() => create.mutate()}
          >
            Создать
          </Button>
        }
      >
        <div className="col gap-3">
          <label className="vup-field">
            <span className="vup-field__label">Название</span>
            <input
              className="vup-field__input"
              value={title}
              maxLength={100}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Например, «Лучшее за неделю»"
            />
          </label>
          <div className="vseg" role="radiogroup" aria-label="Доступ">
            <button
              type="button"
              role="radio"
              aria-checked={!isPublic}
              className={cn('vseg__opt', !isPublic && 'vseg__opt--on')}
              onClick={() => setPublic(false)}
            >
              <Lock size={15} /> Личный
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={isPublic}
              className={cn('vseg__opt', isPublic && 'vseg__opt--on')}
              onClick={() => setPublic(true)}
            >
              <Globe size={15} /> Открытый
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

export function PlaylistPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const me = useMe();
  const q = useQuery({
    queryKey: ['playlist', id],
    queryFn: () => api.get<{ playlist: Playlist; items: Post[] }>(`/playlists/${id}`),
  });
  useCrumb(q.data?.playlist.title);
  if (q.error) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const playlist = q.data?.playlist;
  const items = q.data?.items ?? [];
  return (
    <ListLayout
      title={playlist?.title ?? ' '}
      meta={
        playlist && (
          <>
            <b>{me.displayName}</b>
            <span>
              {videosLabel(items.length)} ·{' '}
              {playlist.isPublic ? <Globe size={12} /> : <Lock size={12} />}{' '}
              {playlist.isPublic ? 'Открытый' : 'Личный'}
            </span>
            {playlist.description && <span>{playlist.description}</span>}
          </>
        )
      }
      items={items}
      listParam={id}
      loading={q.isLoading}
      empty={
        <EmptyState
          icon={<ListVideo size={28} />}
          title="В плейлисте пока нет видео"
          text="Нажмите «Сохранить» под видео, чтобы добавить его сюда"
        />
      }
      actions={
        <button
          type="button"
          className="vlist__ghost vlist__ghost--icon"
          aria-label="Удалить плейлист"
          title="Удалить плейлист"
          onClick={async () => {
            if (
              !(await confirm({
                title: 'Удалить плейлист?',
                text: 'Видео останутся на сайте, удалится только подборка',
                danger: true,
                confirmLabel: 'Удалить',
              }))
            )
              return;
            await api.del(`/playlists/${id}`);
            void queryClient.invalidateQueries({ queryKey: ['playlists'] });
            navigate('/video/playlists');
          }}
        >
          <Trash2 size={18} />
        </button>
      }
      onRemove={(p) =>
        void api
          .del(`/playlists/${id}/items/${p.id}`)
          .then(() => q.refetch())
          .catch((e) => toast({ text: errorMessage(e), kind: 'error' }))
      }
    />
  );
}

// ─── Творческая студия ──────────────────────────────────────────────────────

interface StudioData {
  totals: Record<'posts' | 'views' | 'likes' | 'comments' | 'reposts' | 'followers', number>;
  byKind: { kind: PostKind; posts: number; views: number; likes: number }[];
  top: Post[];
}

const KIND_LABEL: Record<PostKind, string> = {
  note: 'Заметки',
  photo: 'Фото',
  video: 'Видео',
  short: 'Reels',
};
const VIS_LABEL: Record<Visibility, { label: string; icon: typeof Globe }> = {
  public: { label: 'Открытый', icon: Globe },
  followers: { label: 'Подписчики', icon: Users },
  private: { label: 'Только я', icon: Lock },
};

function StudioShell({ children, tab }: { children: ReactNode; tab: 'dashboard' | 'content' }) {
  return (
    <div className="scroll">
      <div className="vroot">
        <div className="vstudio">
          <header className="vpage-head vpage-head--row">
            <div>
              <h1>{tab === 'dashboard' ? 'Панель управления каналом' : 'Контент на канале'}</h1>
            </div>
            <div className="row gap-2 wrap">
              <ButtonLink
                to="/live/new"
                variant="secondary"
                size="sm"
                pill
                icon={<Radio size={16} />}
              >
                Трансляция
              </ButtonLink>
              <ButtonLink to="/video/upload" size="sm" pill icon={<Upload size={16} />}>
                Загрузить видео
              </ButtonLink>
            </div>
          </header>
          <TabLinks
            tabs={[
              { to: '/video/studio', label: 'Панель' },
              { to: '/video/studio/content', label: 'Контент' },
            ]}
          />
          <div className="vstudio__body">{children}</div>
        </div>
      </div>
    </div>
  );
}

export function StudioPage({ tab }: { tab: 'dashboard' | 'content' }) {
  return (
    <StudioShell tab={tab}>
      {tab === 'dashboard' ? <StudioDashboard /> : <StudioContent />}
    </StudioShell>
  );
}

function StudioDashboard() {
  const me = useMe();
  const q = useQuery({ queryKey: ['studio'], queryFn: () => api.get<StudioData>('/me/studio') });
  const latest = useQuery({
    queryKey: ['user-posts', me.id, 'video', 'latest'],
    queryFn: () => api.get<Paginated<Post>>(`/users/${me.id}/posts?tab=video&limit=1`),
  });
  const premieres = useQuery({
    queryKey: ['premieres'],
    queryFn: () => api.get<{ items: Post[] }>('/premieres'),
  });
  const live = useLiveList();
  if (q.isLoading)
    return (
      <div className="vs-grid">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} height={220} radius={16} />
        ))}
      </div>
    );
  if (!q.data) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const d = q.data;
  const maxViews = Math.max(1, ...d.byKind.map((k) => k.views));
  const last = latest.data?.items[0];
  const mine = (premieres.data?.items ?? []).filter(
    (p) => p.author.id === me.id && premiereState(p),
  );
  const streams = [...(live.data?.live ?? []), ...(live.data?.recent ?? [])]
    .filter((s) => s.owner.id === me.id)
    .slice(0, 4);
  return (
    <div className="vs-grid">
      <section className="vs-card">
        <h2 className="vs-card__title">Последнее видео</h2>
        {last ? (
          <>
            <Link to={`/watch/${last.id}`} className="vs-latest">
              <span className="vs-latest__thumb">
                {last.media[0]?.posterUrl && <img src={last.media[0].posterUrl} alt="" />}
                {last.media[0]?.durationSec ? (
                  <span className="vbadge vbadge--dur">{duration(last.media[0].durationSec)}</span>
                ) : null}
              </span>
              <b className="clamp-2">{last.title}</b>
            </Link>
            <dl className="vs-rows">
              <div>
                <dt>Просмотры</dt>
                <dd>{compactNumber(last.stats.views)}</dd>
              </div>
              <div>
                <dt>Нравится</dt>
                <dd>{compactNumber(last.stats.likes)}</dd>
              </div>
              <div>
                <dt>Комментарии</dt>
                <dd>{compactNumber(last.stats.comments)}</dd>
              </div>
              <div>
                <dt>Опубликовано</dt>
                <dd>{timeAgo(last.createdAt)}</dd>
              </div>
            </dl>
            <Link to="/video/studio/content" className="vs-link">
              Перейти к контенту
            </Link>
          </>
        ) : (
          <div className="vs-empty">
            <Upload size={28} />
            <span>Загрузите первое видео — здесь появится его статистика</span>
            <ButtonLink to="/video/upload" pill size="sm">
              Загрузить видео
            </ButtonLink>
          </div>
        )}
      </section>

      <section className="vs-card">
        <h2 className="vs-card__title">Аналитика канала</h2>
        <div className="vs-big">
          <span>Подписчики</span>
          <b>{d.totals.followers.toLocaleString('ru')}</b>
        </div>
        <h3 className="vs-card__sub">Сводные данные</h3>
        <dl className="vs-rows">
          <div>
            <dt>
              <Eye size={14} /> Просмотры
            </dt>
            <dd>{compactNumber(d.totals.views)}</dd>
          </div>
          <div>
            <dt>
              <ThumbsUp size={14} /> Нравится
            </dt>
            <dd>{compactNumber(d.totals.likes)}</dd>
          </div>
          <div>
            <dt>
              <MessageSquare size={14} /> Комментарии
            </dt>
            <dd>{compactNumber(d.totals.comments)}</dd>
          </div>
          <div>
            <dt>
              <Repeat size={14} /> Репосты
            </dt>
            <dd>{compactNumber(d.totals.reposts)}</dd>
          </div>
          <div>
            <dt>
              <Clapperboard size={14} /> Публикации
            </dt>
            <dd>{compactNumber(d.totals.posts)}</dd>
          </div>
        </dl>
      </section>

      <section className="vs-card">
        <h2 className="vs-card__title">Просмотры по форматам</h2>
        <div className="vs-bars">
          {d.byKind.map((k) => (
            <div key={k.kind} className="vs-bar">
              <span className="vs-bar__label">
                {KIND_LABEL[k.kind]} <span>{k.posts}</span>
              </span>
              <span className="vs-bar__track">
                <span style={{ width: `${(k.views / maxViews) * 100}%` }} />
              </span>
              <span className="vs-bar__num">{compactNumber(k.views)}</span>
            </div>
          ))}
          {d.byKind.length === 0 && (
            <span className="vs-muted">Опубликуйте первый материал, чтобы увидеть статистику</span>
          )}
        </div>
      </section>

      <section className="vs-card vs-card--wide">
        <h2 className="vs-card__title">Лучшие публикации</h2>
        <div className="vs-top">
          {d.top.map((p, i) => (
            <Link
              key={p.id}
              to={
                p.kind === 'video'
                  ? `/watch/${p.id}`
                  : p.kind === 'short'
                    ? `/reels?start=${p.id}`
                    : `/post/${p.id}`
              }
              className="vs-top__row"
            >
              <span className="vs-top__idx">{i + 1}</span>
              <span className="vs-top__thumb">
                {p.media[0]?.posterUrl ? (
                  <img src={p.media[0].posterUrl} alt="" loading="lazy" />
                ) : p.media[0]?.kind === 'image' ? (
                  <img src={p.media[0].url} alt="" loading="lazy" />
                ) : null}
              </span>
              <span className="vs-top__title clamp-2">{p.title || p.text || '—'}</span>
              <span className="vs-top__kind">{KIND_LABEL[p.kind]}</span>
              <span className="vs-top__num">
                <Eye size={14} /> {compactNumber(p.stats.views)}
              </span>
            </Link>
          ))}
          {d.top.length === 0 && <span className="vs-muted">Пока нет публикаций</span>}
        </div>
      </section>

      {(mine.length > 0 || streams.length > 0) && (
        <section className="vs-card">
          <h2 className="vs-card__title">Премьеры и трансляции</h2>
          <div className="vs-list">
            {mine.map((p) => (
              <Link key={p.id} to={`/watch/${p.id}`} className="vs-list__row">
                <Clapperboard size={16} />
                <span className="ellipsis">{p.title}</span>
                <span className="vs-muted">
                  {premiereState(p) === 'live' ? 'идёт' : fullDate(p.premiereAt!)}
                </span>
              </Link>
            ))}
            {streams.map((s) => (
              <Link
                key={s.id}
                to={
                  s.status === 'live'
                    ? `/live/${s.id}`
                    : s.recordingPostId
                      ? `/watch/${s.recordingPostId}`
                      : `/live/${s.id}`
                }
                className="vs-list__row"
              >
                <Radio size={16} />
                <span className="ellipsis">{s.title}</span>
                <span className="vs-muted">
                  {s.status === 'live'
                    ? 'в эфире'
                    : `${timeAgo(s.startedAt)} · пик ${s.peakViewers}`}
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function StudioContent() {
  const me = useMe();
  const [kind, setKind] = useState<'video' | 'short' | 'live'>('video');
  const content = useCursorList<Post>(
    ['user-posts', me.id, kind],
    `/users/${me.id}/posts?tab=${kind}`,
    { enabled: kind !== 'live', limit: 30 },
  );
  const live = useLiveList();
  const items = flatPages(content.data);
  const streams = [...(live.data?.live ?? []), ...(live.data?.recent ?? [])].filter(
    (s) => s.owner.id === me.id,
  );
  const [editing, setEditing] = useState<Post | null>(null);
  return (
    <>
      <div className="vstudio__filters">
        {(
          [
            ['video', 'Видео'],
            ['short', 'Reels'],
            ['live', 'Трансляции'],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            type="button"
            className={cn('vchip', kind === k && 'vchip--on')}
            onClick={() => setKind(k)}
          >
            {label}
          </button>
        ))}
      </div>
      {kind === 'live' ? (
        streams.length === 0 ? (
          <EmptyState
            icon={<Radio size={28} />}
            title="Трансляций пока нет"
            action={
              <ButtonLink to="/live/new" pill>
                Начать трансляцию
              </ButtonLink>
            }
          />
        ) : (
          <div className="vs-table">
            <div className="vs-table__head">
              <span>Трансляция</span>
              <span>Статус</span>
              <span>Дата</span>
              <span className="num">Зрители</span>
              <span className="num">Пик</span>
              <span />
            </div>
            {streams.map((s) => (
              <div key={s.id} className="vs-table__row">
                <Link
                  to={
                    s.status === 'live'
                      ? `/live/${s.id}`
                      : s.recordingPostId
                        ? `/watch/${s.recordingPostId}`
                        : `/live/${s.id}`
                  }
                  className="vs-table__video"
                >
                  <span className="vs-table__thumb vs-table__thumb--live">
                    <Radio size={20} />
                  </span>
                  <span className="vs-table__text">
                    <b className="clamp-2">{s.title}</b>
                    <span className="clamp-1">{s.description || 'Без описания'}</span>
                  </span>
                </Link>
                <span>
                  {s.status === 'live' ? (
                    <LiveBadge small />
                  ) : s.recordingPostId ? (
                    'Запись опубликована'
                  ) : (
                    'Завершена'
                  )}
                </span>
                <span className="vs-table__date">{fullDate(s.startedAt)}</span>
                <span className="num" data-label="Зрители:">
                  {s.totalViewers}
                </span>
                <span className="num" data-label="Пик:">
                  {s.peakViewers}
                </span>
                <span />
              </div>
            ))}
          </div>
        )
      ) : content.isLoading ? (
        <div className="vs-table">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} height={72} radius={10} />
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          icon={<Upload size={28} />}
          title={kind === 'short' ? 'Reels пока нет' : 'Видео пока нет'}
          action={
            <ButtonLink to={kind === 'short' ? '/reels/new' : '/video/upload'} pill>
              {kind === 'short' ? 'Снять Reels' : 'Загрузить видео'}
            </ButtonLink>
          }
        />
      ) : (
        <div className="vs-table">
          <div className="vs-table__head">
            <span>{kind === 'short' ? 'Reels' : 'Видео'}</span>
            <span>Доступ</span>
            <span>Дата</span>
            <span className="num">Просмотры</span>
            <span className="num">Комм.</span>
            <span className="num">Нравится</span>
          </div>
          {items.map((p) => (
            <ContentRow key={p.id} post={p} onEdit={() => setEditing(p)} />
          ))}
        </div>
      )}
      <LoadMore
        hasMore={kind !== 'live' && !!content.hasNextPage}
        loading={content.isFetchingNextPage}
        onLoad={() => void content.fetchNextPage()}
      />
      {editing && <EditDialog post={editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function ContentRow({ post, onEdit }: { post: Post; onEdit: () => void }) {
  const { remove } = usePostActions(post);
  const m = post.media[0];
  const vis = VIS_LABEL[post.visibility];
  const href = post.kind === 'short' ? `/reels?start=${post.id}` : `/watch/${post.id}`;
  const premiere = premiereState(post);
  return (
    <div className="vs-table__row">
      <div className="vs-table__video">
        <Link
          to={href}
          className={cn('vs-table__thumb', post.kind === 'short' && 'vs-table__thumb--short')}
        >
          {m?.posterUrl && <img src={m.posterUrl} alt="" loading="lazy" />}
          {m?.durationSec ? (
            <span className="vbadge vbadge--dur">{duration(m.durationSec)}</span>
          ) : null}
        </Link>
        <span className="vs-table__text">
          <Link to={href} className="clamp-2">
            <b>{post.title || post.text || 'Без названия'}</b>
          </Link>
          <span className="vs-table__desc clamp-1">
            {post.title ? post.text || 'Без описания' : ''}
          </span>
          <span className="vs-table__actions">
            <button type="button" onClick={onEdit} title="Изменить">
              <Pencil size={16} /> Изменить
            </button>
            <Link to={href} title="Смотреть">
              <Play size={16} /> Смотреть
            </Link>
            <button
              type="button"
              className="vs-danger"
              onClick={async () => {
                if (
                  !(await confirm({
                    title: 'Удалить навсегда?',
                    text: 'Видео, просмотры и комментарии будут удалены',
                    danger: true,
                    confirmLabel: 'Удалить',
                  }))
                )
                  return;
                remove.mutate();
              }}
              title="Удалить"
            >
              <Trash2 size={16} /> Удалить
            </button>
          </span>
        </span>
      </div>
      <span className="vs-table__vis">
        <vis.icon size={15} /> {vis.label}
        {premiere && <span className="vs-table__premiere">Премьера</span>}
      </span>
      <span className="vs-table__date">
        {fullDate(post.premiereAt ?? post.createdAt).replace(/,.*$/, '')}
        <span>{premiere === 'upcoming' ? 'Запланировано' : 'Опубликовано'}</span>
      </span>
      <span className="num" data-label="Просмотры:">
        {compactNumber(post.stats.views)}
      </span>
      <span className="num" data-label="Комментарии:">
        {compactNumber(post.stats.comments)}
      </span>
      <span className="num" data-label="Нравится:">
        {compactNumber(post.stats.likes)}
      </span>
    </div>
  );
}

function EditDialog({ post, onClose }: { post: Post; onClose: () => void }) {
  const [title, setTitle] = useState(post.title ?? '');
  const [text, setText] = useState(post.text);
  const [visibility, setVisibility] = useState<Visibility>(post.visibility);
  const [commentsDisabled, setCommentsDisabled] = useState(post.commentsDisabled);
  const save = useMutation({
    mutationFn: () =>
      api.patch<Post>(`/posts/${post.id}`, {
        ...(post.kind === 'video' ? { title: title.trim() } : {}),
        text,
        visibility,
        commentsDisabled,
      }),
    onSuccess: (p) => {
      patchPostEverywhere(post.id, () => p);
      toast({ text: 'Изменения сохранены', kind: 'success' });
      onClose();
    },
    onError: (e) => toast({ text: errorMessage(e), kind: 'error' }),
  });
  return (
    <Modal
      open
      onClose={onClose}
      title="Сведения о видео"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button
            loading={save.isPending}
            disabled={post.kind === 'video' && !title.trim()}
            onClick={() => save.mutate()}
          >
            Сохранить
          </Button>
        </>
      }
    >
      <div className="col gap-3">
        {post.kind === 'video' && (
          <label className="vup-field">
            <span className="vup-field__label">Название (обязательно)</span>
            <input
              className="vup-field__input"
              value={title}
              maxLength={LIMITS.titleMax}
              onChange={(e) => setTitle(e.target.value)}
            />
            <span className="vup-field__count">
              {title.length}/{LIMITS.titleMax}
            </span>
          </label>
        )}
        <label className="vup-field">
          <span className="vup-field__label">{post.kind === 'video' ? 'Описание' : 'Подпись'}</span>
          <textarea
            className="vup-field__input"
            rows={5}
            value={text}
            maxLength={LIMITS.postMax}
            onChange={(e) => setText(e.target.value)}
          />
          <span className="vup-field__count">
            {text.length}/{LIMITS.postMax}
          </span>
        </label>
        <div className="vseg" role="radiogroup" aria-label="Доступ">
          {(Object.keys(VIS_LABEL) as Visibility[]).map((v) => {
            const Icon = VIS_LABEL[v].icon;
            return (
              <button
                key={v}
                type="button"
                role="radio"
                aria-checked={visibility === v}
                className={cn('vseg__opt', visibility === v && 'vseg__opt--on')}
                onClick={() => setVisibility(v)}
              >
                <Icon size={15} /> {VIS_LABEL[v].label}
              </button>
            );
          })}
        </div>
        <div className="vup-row">
          <MessageSquare size={18} className="vup-row__icon" />
          <span className="vup-row__text">
            <b>Комментарии</b>
            <span>{commentsDisabled ? 'Отключены' : 'Разрешены'}</span>
          </span>
          <Switch
            checked={!commentsDisabled}
            onChange={(v) => setCommentsDisabled(!v)}
            label="Разрешить комментарии"
          />
        </div>
      </div>
    </Modal>
  );
}

export function UploadVideoPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const premiere = params.get('premiere') === '1';
  return (
    <div className="scroll">
      <div className="vroot">
        <div className="vupload-page">
          <header className="vpage-head">
            <h1>{premiere ? 'Новая премьера' : 'Загрузка видео'}</h1>
          </header>
          <UploadVideoForm
            kind="video"
            premiereDefault={premiere}
            onDone={(p) => navigate(`/watch/${p.id}`)}
          />
        </div>
      </div>
    </div>
  );
}
