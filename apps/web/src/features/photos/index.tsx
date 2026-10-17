import { useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useMutation } from '@tanstack/react-query';
import { Bookmark, Camera, Copy, Heart, ImagePlus, MessageCircle, Play, Send, X } from 'lucide-react';
import type { MediaItem, Post } from '@omni/shared';
import { api, ApiError, errorMessage } from '../../shared/api/client';
import { flatPages, qk, queryClient, useCursorList } from '../../shared/api/query';
import { prepareImage } from '../../shared/lib/media';
import { uploadFile } from '../../shared/api/client';
import { toast } from '../../shared/stores/ui';
import { cn, compactNumber, plural, timeAgo } from '../../shared/lib/format';
import { Avatar, Button, EmptyState, ListSkeleton, LoadMore, PageHeader, RichText, Textarea, UserName } from '../../shared/ui';
import { shareLink, usePostActions } from '../posts/actions';
import { PostMenu } from '../posts/PostCard';
import { StoriesBar } from './stories';
import './photos.css';

function Carousel({ media, onDoubleTap }: { media: MediaItem[]; onDoubleTap: () => void }) {
  const [index, setIndex] = useState(0);
  const [heart, setHeart] = useState(false);
  const lastTap = useRef(0);
  return (
    <div className="carousel">
      <div
        className="carousel__track"
        onScroll={(e) => setIndex(Math.round(e.currentTarget.scrollLeft / e.currentTarget.clientWidth))}
        onClick={() => {
          const now = Date.now();
          if (now - lastTap.current < 300) {
            onDoubleTap();
            setHeart(true);
            setTimeout(() => setHeart(false), 650);
          }
          lastTap.current = now;
        }}
      >
        {media.map((m) => (
          <div key={m.id} className="carousel__slide">
            {m.kind === 'video' ? <video src={m.url} poster={m.posterUrl ?? undefined} controls playsInline preload="metadata" /> : <img src={m.url} alt="" loading="lazy" decoding="async" draggable={false} />}
          </div>
        ))}
      </div>
      {media.length > 1 && (
        <>
          <span className="carousel__count">
            {index + 1}/{media.length}
          </span>
          <div className="carousel__dots">
            {media.map((m, i) => (
              <span key={m.id} data-on={i === index} />
            ))}
          </div>
        </>
      )}
      {heart && <Heart className="carousel__heart" size={96} fill="#fff" color="#fff" />}
    </div>
  );
}

export function PhotoCard({ post }: { post: Post }) {
  const { like, bookmark } = usePostActions(post);
  const navigate = useNavigate();
  return (
    <article className="photo-card">
      <div className="photo-card__head">
        <Link to={`/u/${post.author.username}`} className="row grow" style={{ color: 'inherit', gap: 10 }}>
          <Avatar src={post.author.avatarUrl} name={post.author.displayName} id={post.author.id} size={36} />
          <span className="col" style={{ gap: 0, minWidth: 0 }}>
            <UserName user={post.author} />
            {post.community && <span className="xs muted">{post.community.name}</span>}
          </span>
        </Link>
        <span className="faint small">{timeAgo(post.createdAt)}</span>
        <PostMenu post={post} />
      </div>
      <Carousel media={post.media} onDoubleTap={() => !post.viewer.liked && like.mutate(true)} />
      <div className="photo-card__actions">
        <button className={cn('action action--like', post.viewer.liked && 'action--liked')} onClick={() => like.mutate(!post.viewer.liked)} aria-label="Нравится">
          <Heart size={24} fill={post.viewer.liked ? 'currentColor' : 'none'} />
        </button>
        <button className="action" onClick={() => navigate(`/post/${post.id}`)} aria-label="Комментарии">
          <MessageCircle size={24} />
        </button>
        <button className="action" onClick={() => shareLink(`/post/${post.id}`)} aria-label="Поделиться">
          <Send size={22} />
        </button>
        <span className="grow" />
        <button className={cn('action', post.viewer.bookmarked && 'action--saved')} onClick={() => bookmark.mutate(!post.viewer.bookmarked)} aria-label="Сохранить">
          <Bookmark size={24} fill={post.viewer.bookmarked ? 'currentColor' : 'none'} />
        </button>
      </div>
      <div className="photo-card__body">
        <span className="bold small">
          {compactNumber(post.stats.likes)} {plural(post.stats.likes, 'отметка', 'отметки', 'отметок')} «Нравится»
        </span>
        {post.text && (
          <span className="small">
            <Link to={`/u/${post.author.username}`} className="bold" style={{ color: 'inherit' }}>
              {post.author.username}
            </Link>{' '}
            <RichText text={post.text} />
          </span>
        )}
        {post.stats.comments > 0 && (
          <Link to={`/post/${post.id}`} className="small muted">
            Смотреть все комментарии ({post.stats.comments})
          </Link>
        )}
      </div>
    </article>
  );
}

export function PhotoFeed({ mode }: { mode: 'for-you' | 'following' }) {
  const list = useCursorList<Post>(qk.feed(mode, 'photo'), `/feed/${mode}?kind=photo`, { limit: 10 });
  const items = flatPages(list.data);
  return (
    <div className="scroll">
      <div className="photo-col">
        <StoriesBar />
        <div className="chips" style={{ padding: '0 12px' }}>
          <Link to="/photos" className={cn('chip', mode === 'for-you' && 'chip--active')}>
            Рекомендации
          </Link>
          <Link to="/photos/following" className={cn('chip', mode === 'following' && 'chip--active')}>
            Подписки
          </Link>
          <Link to="/photos/explore" className="chip">
            Интересное
          </Link>
          <Link to="/photos/new" className="chip">
            <ImagePlus size={15} /> Опубликовать
          </Link>
        </div>
        {list.isLoading && <ListSkeleton rows={3} />}
        {!list.isLoading && items.length === 0 && <EmptyState icon={<Camera size={28} />} title="Фото пока нет" text="Подпишитесь на авторов или опубликуйте первое фото" />}
        {items.map((p) => (
          <PhotoCard key={p.id} post={p} />
        ))}
        <LoadMore hasMore={!!list.hasNextPage} loading={list.isFetchingNextPage} onLoad={() => void list.fetchNextPage()} />
      </div>
    </div>
  );
}

export function PhotoGrid({ posts }: { posts: Post[] }) {
  return (
    <div className="photo-grid">
      {posts.map((p) => {
        const m = p.media[0];
        const href = p.kind === 'video' ? `/watch/${p.id}` : p.kind === 'short' ? `/shorts?start=${p.id}` : `/post/${p.id}`;
        return (
          <Link key={p.id} to={href} aria-label={p.text || 'Публикация'}>
            {m && <img src={m.kind === 'image' ? m.url : (m.posterUrl ?? '')} alt="" loading="lazy" decoding="async" />}
            {p.media.length > 1 && <Copy size={18} className="photo-grid__badge" />}
            {(p.kind === 'video' || p.kind === 'short') && <Play size={18} className="photo-grid__badge" fill="#fff" />}
          </Link>
        );
      })}
    </div>
  );
}

export function ExplorePhotos() {
  const photos = useCursorList<Post>(['explore', 'photo'], '/feed/trending?kind=photo', { limit: 30 });
  const fallback = useCursorList<Post>(['explore', 'photo-all'], '/feed/for-you?kind=photo', { limit: 30 });
  const items = flatPages(photos.data).length ? flatPages(photos.data) : flatPages(fallback.data);
  return (
    <div className="scroll">
      <div className="page page--wide">
        <PageHeader title="Интересное" subtitle="Популярные фото со всего Omni" icon={<Camera size={22} />} />
        <PhotoGrid posts={items} />
        <LoadMore hasMore={!!fallback.hasNextPage} loading={fallback.isFetchingNextPage} onLoad={() => void fallback.fetchNextPage()} />
      </div>
    </div>
  );
}

export function SavedPhotos() {
  const list = useCursorList<Post>(['saved-posts', 'photo'], '/me/bookmarks?kind=photo', { limit: 30 });
  const items = flatPages(list.data);
  return (
    <div className="scroll">
      <div className="page page--wide">
        <PageHeader title="Сохранённые фото" subtitle="Видны только вам" icon={<Bookmark size={22} />} />
        {items.length === 0 && !list.isLoading && <EmptyState icon={<Bookmark size={28} />} title="Пока ничего не сохранено" />}
        <PhotoGrid posts={items} />
      </div>
    </div>
  );
}

interface Picked {
  id: string;
  file: File;
  preview: string;
}

export function NewPhotoPage() {
  const navigate = useNavigate();
  const [files, setFiles] = useState<Picked[]>([]);
  const [text, setText] = useState('');
  const [progress, setProgress] = useState(0);
  const publish = useMutation({
    mutationFn: async () => {
      const ids: string[] = [];
      for (const [i, f] of files.entries()) {
        const img = await prepareImage(f.file);
        const m = await uploadFile(img.blob, img.name, { width: img.width, height: img.height, onProgress: (p) => setProgress((i + p) / files.length) });
        ids.push(m.id);
      }
      return api.post<Post>('/posts', { kind: 'photo', text, mediaIds: ids, visibility: 'public' });
    },
    onSuccess: (p) => {
      toast({ text: 'Фото опубликовано', kind: 'success' });
      void queryClient.invalidateQueries({ queryKey: ['feed'] });
      navigate(`/post/${p.id}`);
    },
    onError: (e) => toast({ text: e instanceof ApiError && e.fields ? Object.values(e.fields)[0]! : errorMessage(e), kind: 'error' }),
  });
  const add = (list: FileList) =>
    setFiles((f) => [...f, ...[...list].filter((x) => x.type.startsWith('image/')).map((file) => ({ id: `${Math.random()}`, file, preview: URL.createObjectURL(file) }))].slice(0, 10));
  return (
    <div className="scroll">
      <div className="page">
        <PageHeader title="Новое фото" subtitle="До 10 фото в одной публикации. Геометки и EXIF удаляются автоматически" icon={<ImagePlus size={22} />} />
        {files.length === 0 ? (
          <label className="dropzone">
            <ImagePlus size={44} className="faint" />
            <span className="bold">Выберите фотографии</span>
            <span className="small muted">JPEG, PNG, WebP, GIF</span>
            <input type="file" accept="image/*" multiple hidden onChange={(e) => e.target.files && add(e.target.files)} />
          </label>
        ) : (
          <div className="col gap-4">
            <div className="photo-grid" style={{ borderRadius: 16, overflow: 'hidden' }}>
              {files.map((f) => (
                <button key={f.id} onClick={() => setFiles((l) => l.filter((x) => x.id !== f.id))} aria-label="Убрать">
                  <img src={f.preview} alt="" />
                  <X size={18} className="photo-grid__badge" />
                </button>
              ))}
              {files.length < 10 && (
                <label style={{ aspectRatio: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--surface-2)', cursor: 'pointer' }}>
                  <ImagePlus size={28} className="faint" />
                  <input type="file" accept="image/*" multiple hidden onChange={(e) => e.target.files && add(e.target.files)} />
                </label>
              )}
            </div>
            <Textarea label="Подпись" value={text} onChange={(e) => setText(e.target.value)} maxLength={2000} placeholder="Добавьте подпись и #хэштеги" />
            {publish.isPending && (
              <div className="progress">
                <div className="progress__bar" style={{ width: `${progress * 100}%` }} />
              </div>
            )}
            <Button size="lg" loading={publish.isPending} onClick={() => publish.mutate()}>
              Опубликовать
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

export { StoriesPage, NewStoryPage } from './stories';
