import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Bookmark, Clapperboard, Heart, MessageCircle, Plus, Share2, Volume2, VolumeX } from 'lucide-react';
import type { Post } from '@omni/shared';
import { api } from '../../shared/api/client';
import { flatPages, qk, useCursorList } from '../../shared/api/query';
import { useInView } from '../../shared/hooks';
import { usePrefs } from '../../shared/stores/prefs';
import { useMe } from '../../shared/stores/session';
import { compactNumber, cn } from '../../shared/lib/format';
import { Avatar, ButtonLink, EmptyState, LoadMore, Loading, Modal, PageHeader, RichText, Verified } from '../../shared/ui';
import { useImmersive } from '../../app/layout/Shell';
import { CommentsSection } from '../posts/Comments';
import { shareLink, usePostActions } from '../posts/actions';
import { UploadVideoForm, VideoCard } from '../video/components';
import './shorts.css';

let globalMuted = true;

function ShortItem({ post, active }: { post: Post; active: boolean }) {
  const [ref, inView] = useInView<HTMLDivElement>(0.7);
  const video = useRef<HTMLVideoElement>(null);
  const [muted, setMuted] = useState(globalMuted);
  const [paused, setPaused] = useState(false);
  const [comments, setComments] = useState(false);
  const [heart, setHeart] = useState(false);
  const autoplay = usePrefs((s) => s.autoplayVideo);
  const { like, bookmark } = usePostActions(post);
  const counted = useRef(false);
  const m = post.media[0];

  useEffect(() => {
    const el = video.current;
    if (!el) return;
    if (inView && autoplay) {
      el.muted = globalMuted;
      setMuted(globalMuted);
      el.play().catch(() => {
        // Браузер запретил автозапуск со звуком — включаем без звука
        el.muted = true;
        setMuted(true);
        void el.play().catch(() => setPaused(true));
      });
      setPaused(false);
      if (!counted.current) {
        counted.current = true;
        void api.post(`/posts/${post.id}/view`, { progressSec: 0 }).catch(() => undefined);
      }
    } else {
      el.pause();
    }
  }, [inView, autoplay, post.id]);

  const toggle = () => {
    const el = video.current;
    if (!el) return;
    if (el.paused) {
      void el.play();
      setPaused(false);
    } else {
      el.pause();
      setPaused(true);
    }
  };

  return (
    <div className={cn('short', active && 'short--active')} ref={ref}>
      <div className="short__stage">
        {m && (
          <video
            ref={video}
            className="short__video"
            src={m.url}
            poster={m.posterUrl ?? undefined}
            loop
            playsInline
            muted={muted}
            preload={inView ? 'auto' : 'metadata'}
            onClick={toggle}
            onDoubleClick={() => {
              if (!post.viewer.liked) like.mutate(true);
              setHeart(true);
              setTimeout(() => setHeart(false), 700);
            }}
          />
        )}
        {paused && <div className="short__paused">▶</div>}
        {heart && <Heart className="short__heart" size={110} fill="#ff2d55" color="#ff2d55" />}
        <button
          className="short__mute"
          aria-label={muted ? 'Включить звук' : 'Выключить звук'}
          onClick={() => {
            globalMuted = !muted;
            setMuted(!muted);
            if (video.current) video.current.muted = !muted;
          }}
        >
          {muted ? <VolumeX size={20} /> : <Volume2 size={20} />}
        </button>
        <div className="short__info">
          <Link to={`/u/${post.author.username}`} className="row" style={{ color: '#fff', gap: 10 }}>
            <Avatar src={post.author.avatarUrl} name={post.author.displayName} id={post.author.id} size={40} />
            <span className="bold row gap-1">
              @{post.author.username} {post.author.verified && <Verified size={14} />}
            </span>
          </Link>
          {post.text && <RichText text={post.text} className="short__caption clamp-3" />}
        </div>
        <div className="short__actions">
          <button className={cn('short__action', post.viewer.liked && 'short__action--on')} onClick={() => like.mutate(!post.viewer.liked)} aria-label="Нравится">
            <span>
              <Heart size={28} fill={post.viewer.liked ? 'currentColor' : 'none'} />
            </span>
            {compactNumber(post.stats.likes)}
          </button>
          <button className="short__action" onClick={() => setComments(true)} aria-label="Комментарии">
            <span>
              <MessageCircle size={28} />
            </span>
            {compactNumber(post.stats.comments)}
          </button>
          <button className={cn('short__action', post.viewer.bookmarked && 'short__action--saved')} onClick={() => bookmark.mutate(!post.viewer.bookmarked)} aria-label="Сохранить">
            <span>
              <Bookmark size={26} fill={post.viewer.bookmarked ? 'currentColor' : 'none'} />
            </span>
            Сохр.
          </button>
          <button className="short__action" onClick={() => shareLink(`/post/${post.id}`)} aria-label="Поделиться">
            <span>
              <Share2 size={26} />
            </span>
            {compactNumber(post.stats.views)}
          </button>
        </div>
      </div>
      {comments && (
        <Modal open onClose={() => setComments(false)} title="Комментарии">
          <CommentsSection postId={post.id} postAuthorId={post.author.id} count={post.stats.comments} disabled={post.commentsDisabled} />
        </Modal>
      )}
    </div>
  );
}

export function ShortsFeed({ mode }: { mode: 'for-you' | 'following' | 'trending' }) {
  useImmersive(true);
  const [params] = useSearchParams();
  const start = params.get('start');
  const list = useCursorList<Post>(qk.feed(mode, 'short'), `/feed/${mode}?kind=short`, { limit: 10 });
  const first = useQuery({ queryKey: qk.post(start ?? ''), queryFn: () => api.get<Post>(`/posts/${start}`), enabled: !!start });
  const items = flatPages(list.data);
  const all = first.data ? [first.data, ...items.filter((p) => p.id !== first.data!.id)] : items;
  const navigate = useNavigate();
  const scroller = useRef<HTMLDivElement>(null);

  // Клавиши ↑/↓ — переход между клипами
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!scroller.current || (e.target as HTMLElement).closest('input, textarea')) return;
      const h = scroller.current.clientHeight;
      if (e.key === 'ArrowDown' || e.key === 'j') scroller.current.scrollBy({ top: h, behavior: 'smooth' });
      if (e.key === 'ArrowUp' || e.key === 'k') scroller.current.scrollBy({ top: -h, behavior: 'smooth' });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (list.isLoading) return <Loading />;
  return (
    <div className="shorts" ref={scroller}>
      <div className="shorts__tabs">
        {(
          [
            ['for-you', 'Для вас', '/shorts'],
            ['following', 'Подписки', '/shorts/following'],
            ['trending', 'Популярные', '/shorts/trending'],
          ] as const
        ).map(([m, label, to]) => (
          <button key={m} className={cn('shorts__tab', mode === m && 'shorts__tab--active')} onClick={() => navigate(to)}>
            {label}
          </button>
        ))}
        <Link to="/shorts/create" className="shorts__tab" aria-label="Снять клип">
          <Plus size={20} />
        </Link>
      </div>
      {all.length === 0 ? (
        <div className="short">
          <EmptyState icon={<Clapperboard size={28} />} title="Клипов пока нет" action={<ButtonLink to="/shorts/create">Снять первый клип</ButtonLink>} />
        </div>
      ) : (
        all.map((p) => <ShortItem key={p.id} post={p} active={false} />)
      )}
      <div className="short short--loader">
        <LoadMore hasMore={!!list.hasNextPage} loading={list.isFetchingNextPage} onLoad={() => void list.fetchNextPage()} />
        {!list.hasNextPage && all.length > 0 && <span className="muted">Вы посмотрели все клипы 🎉</span>}
      </div>
    </div>
  );
}

export function CreateShortPage() {
  const navigate = useNavigate();
  return (
    <div className="scroll">
      <div className="page">
        <PageHeader title="Новый клип" subtitle="Вертикальное видео 9:16 смотрится лучше всего" icon={<Clapperboard size={22} />} />
        <UploadVideoForm kind="short" onDone={(p) => navigate(`/shorts?start=${p.id}`)} />
      </div>
    </div>
  );
}

export function MyShortsPage() {
  const me = useMe();
  const list = useCursorList<Post>(qk.userPosts(me.id, 'short'), `/users/${me.id}/posts?tab=short`);
  const items = flatPages(list.data);
  return (
    <div className="scroll">
      <div className="page page--wide">
        <PageHeader title="Мои клипы" icon={<Clapperboard size={22} />} actions={<ButtonLink to="/shorts/create" size="sm" icon={<Plus size={16} />}>Новый клип</ButtonLink>} />
        {items.length === 0 && !list.isLoading && <EmptyState icon={<Clapperboard size={28} />} title="У вас пока нет клипов" />}
        <div className="video-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))' }}>
          {items.map((p) => (
            <VideoCard key={p.id} post={p} />
          ))}
        </div>
      </div>
    </div>
  );
}
