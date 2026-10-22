/**
 * Карточка публикации в духе Instagram и Threads: шапка с аватаром и «⋯»,
 * текст с «ещё», медиа во всю ширину (карусель, двойное касание — лайк),
 * строка действий, «Нравится: N» и переход к комментариям.
 */
import { memo, useLayoutEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import {
  Bookmark,
  EyeOff,
  Flag,
  FolderPlus,
  Globe,
  Heart,
  Link2,
  Lock,
  MessageCircle,
  MoreHorizontal,
  Pin,
  PinOff,
  Quote,
  Repeat2,
  Send,
  Trash2,
  Users,
  VolumeX,
} from 'lucide-react';
import type { Me, Post } from '@omni/shared';
import { api, errorMessage } from '../../shared/api/client';
import { queryClient } from '../../shared/api/query';
import { useMe, useSession } from '../../shared/stores/session';
import { toast } from '../../shared/stores/ui';
import { cn, compactNumber, fullDate, plural } from '../../shared/lib/format';
import { Avatar, confirm, ReportDialog, RichText, Verified } from '../../shared/ui';
import { copyLink, ShareSheet, shortAgo, useOptions } from '../misc/kit';
import { removePostEverywhere, usePostActions } from './actions';
import { useHiddenPosts } from './hidden';
import { MediaThumb, PostMedia, postHref } from './PostMedia';
import { QuoteDialog } from './PostComposer';
import { CollectionPickerDialog, LikersDialog } from '../social/dialogs';
import './posts.css';

/** Текст с «ещё»: длинный сворачивается до нескольких строк и раскрывается на месте. */
export function ExpandableText({ text, lines = 4, className }: { text: string; lines?: number; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [long, setLong] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el && !open) setLong(el.scrollHeight > el.clientHeight + 2);
  }, [text, open]);
  return (
    <div className={cn('pc-text', className)}>
      <div ref={ref} className={cn('pc-text__body', !open && 'pc-text__body--clamp')} style={{ WebkitLineClamp: open ? undefined : lines }}>
        <RichText text={text} />
      </div>
      {long && !open && (
        <button
          type="button"
          className="pc-text__more"
          onClick={(e) => {
            e.stopPropagation();
            setOpen(true);
          }}
        >
          ещё
        </button>
      )}
    </div>
  );
}

/** Цитируемая публикация внутри карточки. */
export function PostEmbed({ post }: { post: Post }) {
  const navigate = useNavigate();
  return (
    <div
      className="pc-quote"
      role="link"
      tabIndex={0}
      onClick={(e) => {
        e.stopPropagation();
        navigate(postHref(post));
      }}
    >
      <div className="pc-quote__main">
        <div className="pc-quote__head">
          <Avatar src={post.author.avatarUrl} name={post.author.displayName} id={post.author.id} size={20} />
          <b className="ellipsis">{post.author.displayName}</b>
          {post.author.verified && <Verified size={13} />}
          <span className="pc-quote__meta">· {shortAgo(post.createdAt)}</span>
        </div>
        {post.title && <div className="bold clamp-2">{post.title}</div>}
        {post.text && <RichText text={post.text} className="clamp-3 pc-quote__text" />}
      </div>
      <MediaThumb post={post} size={64} />
    </div>
  );
}

/** Строка действий: лайк, комментарии, репост, отправить и закладка справа. */
export const PostActionsBar = memo(function PostActionsBar({ post, onComment }: { post: Post; onComment?: () => void }) {
  const { like, bookmark, repost } = usePostActions(post);
  const [quoting, setQuoting] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [pop, setPop] = useState(0);
  const navigate = useNavigate();
  const repostMenu = useOptions([
    { label: post.viewer.reposted ? 'Отменить репост' : 'Сделать репост', icon: <Repeat2 size={20} />, onClick: () => repost.mutate(!post.viewer.reposted) },
    { label: 'Цитировать', icon: <Quote size={20} />, onClick: () => setQuoting(true) },
  ]);
  const toggleLike = () => {
    if (!post.viewer.liked) setPop(Date.now());
    like.mutate(!post.viewer.liked);
  };
  return (
    <div className="pc-actions" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        className={cn('pc-act', 'pc-act--like', post.viewer.liked && 'pc-act--on')}
        onClick={toggleLike}
        aria-label={post.viewer.liked ? 'Убрать отметку «Нравится»' : 'Нравится'}
        aria-pressed={post.viewer.liked}
      >
        <Heart key={pop} size={24} fill={post.viewer.liked ? 'currentColor' : 'none'} className={cn(pop > 0 && 'pc-act__pop')} />
      </button>
      <button type="button" className="pc-act" onClick={onComment ?? (() => navigate(`/post/${post.id}#comments`))} aria-label="Комментарии" disabled={post.commentsDisabled}>
        <MessageCircle size={23} style={{ transform: 'scaleX(-1)' }} />
        {post.stats.comments > 0 && <span className="pc-act__n">{compactNumber(post.stats.comments)}</span>}
      </button>
      <button
        type="button"
        className={cn('pc-act', 'pc-act--repost', post.viewer.reposted && 'pc-act--on')}
        onClick={(e) => repostMenu.open(e)}
        aria-label="Репост"
        disabled={post.visibility !== 'public'}
      >
        <Repeat2 size={24} />
        {post.stats.reposts > 0 && <span className="pc-act__n">{compactNumber(post.stats.reposts)}</span>}
      </button>
      <button type="button" className="pc-act" onClick={() => setSharing(true)} aria-label="Поделиться">
        <Send size={22} />
      </button>
      <span className="grow" />
      <button
        type="button"
        className={cn('pc-act', 'pc-act--save', post.viewer.bookmarked && 'pc-act--on')}
        onClick={() => bookmark.mutate(!post.viewer.bookmarked)}
        aria-label={post.viewer.bookmarked ? 'Убрать из закладок' : 'В закладки'}
        aria-pressed={post.viewer.bookmarked}
      >
        <Bookmark size={23} fill={post.viewer.bookmarked ? 'currentColor' : 'none'} />
      </button>
      {repostMenu.element}
      {quoting && <QuoteDialog post={post} onClose={() => setQuoting(false)} />}
      {sharing && <ShareSheet path={postHref(post)} title={post.title ?? undefined} onClose={() => setSharing(false)} />}
    </div>
  );
});

/** Кнопка «⋯» с действиями над публикацией. */
export function PostMenu({ post }: { post: Post }) {
  const me = useMe();
  const [dialog, setDialog] = useState<'report' | 'collection' | 'likers' | 'share' | null>(null);
  const { remove, bookmark } = usePostActions(post);
  const hide = useHiddenPosts((s) => s.hide);
  const unhide = useHiddenPosts((s) => s.unhide);
  const mine = post.author.id === me.id;
  const pinned = me.pinnedPostId === post.id;
  const pin = async () => {
    try {
      const updated = await api.put<Me>('/me/pinned-post', { postId: pinned ? null : post.id });
      useSession.getState().patchMe({ pinnedPostId: updated.pinnedPostId });
      void queryClient.invalidateQueries({ queryKey: ['user-posts'] });
      toast({ text: pinned ? 'Публикация откреплена' : 'Закреплено в профиле — она будет первой', kind: 'success' });
    } catch (e) {
      toast({ text: errorMessage(e), kind: 'error' });
    }
  };
  const notInterested = () => {
    hide(post.id);
    removePostEverywhere(post.id, (k) => k[0] === 'feed');
    toast({
      text: 'Публикация скрыта. Будем показывать меньше похожего',
      action: {
        label: 'Вернуть',
        onClick: () => {
          unhide(post.id);
          void queryClient.invalidateQueries({ queryKey: ['feed'] });
        },
      },
    });
  };
  const menu = useOptions([
    { label: 'Поделиться…', icon: <Send size={20} />, onClick: () => setDialog('share') },
    { label: 'Скопировать ссылку', icon: <Link2 size={20} />, onClick: () => void copyLink(postHref(post)) },
    { label: post.viewer.bookmarked ? 'Убрать из закладок' : 'Сохранить', icon: <Bookmark size={20} />, onClick: () => bookmark.mutate(!post.viewer.bookmarked) },
    { label: 'В коллекцию…', icon: <FolderPlus size={20} />, onClick: () => setDialog('collection') },
    { label: 'Кто оценил', icon: <Heart size={20} />, hidden: !post.stats.likes, onClick: () => setDialog('likers') },
    { label: pinned ? 'Открепить из профиля' : 'Закрепить в профиле', icon: pinned ? <PinOff size={20} /> : <Pin size={20} />, hidden: !mine || !!post.community, onClick: () => void pin() },
    'separator',
    { label: 'Не интересно', icon: <EyeOff size={20} />, hidden: mine, onClick: notInterested },
    {
      label: `Скрыть @${post.author.username}`,
      icon: <VolumeX size={20} />,
      hidden: mine,
      onClick: () => void api.post(`/users/${post.author.id}/mute`).then(() => toast(`Публикации @${post.author.username} скрыты из ваших лент`)),
    },
    { label: 'Пожаловаться', icon: <Flag size={20} />, danger: true, hidden: mine, onClick: () => setDialog('report') },
    {
      label: 'Удалить',
      icon: <Trash2 size={20} />,
      danger: true,
      hidden: !mine,
      onClick: async () => {
        if (await confirm({ title: 'Удалить публикацию?', text: 'Её нельзя будет восстановить.', danger: true, confirmLabel: 'Удалить' })) remove.mutate();
      },
    },
  ]);
  return (
    <span onClick={(e) => e.stopPropagation()} className="pc-more">
      <button type="button" className="pk-icon" aria-label="Ещё" onClick={(e) => menu.open(e)}>
        <MoreHorizontal size={20} />
      </button>
      {menu.element}
      {dialog === 'report' && <ReportDialog open entityType="post" entityId={post.id} onClose={() => setDialog(null)} />}
      {dialog === 'collection' && <CollectionPickerDialog post={post} onClose={() => setDialog(null)} />}
      {dialog === 'likers' && <LikersDialog postId={post.id} onClose={() => setDialog(null)} />}
      {dialog === 'share' && <ShareSheet path={postHref(post)} title={post.title ?? undefined} onClose={() => setDialog(null)} />}
    </span>
  );
}

/** «Нравится: N · M просмотров» — по нажатию список оценивших. */
function LikesLine({ post }: { post: Post }) {
  const [likers, setLikers] = useState(false);
  if (!post.stats.likes && !post.stats.views) return null;
  return (
    <div className="pc-likes" onClick={(e) => e.stopPropagation()}>
      {post.stats.likes > 0 && (
        <button type="button" className="pc-likes__btn" onClick={() => setLikers(true)}>
          Нравится: {post.stats.likes.toLocaleString('ru')}
        </button>
      )}
      {post.stats.views > 0 && (
        <span className="pc-likes__views">
          {compactNumber(post.stats.views)} {plural(post.stats.views, 'просмотр', 'просмотра', 'просмотров')}
        </span>
      )}
      {likers && <LikersDialog postId={post.id} onClose={() => setLikers(false)} />}
    </div>
  );
}

const VISIBILITY_ICON = { public: null, followers: <Users size={13} aria-label="Только подписчики" />, private: <Lock size={13} aria-label="Только я" /> };

/** Карточка публикации (заметки, фото, видео, Reels и репосты любых видов). */
export const PostCard = memo(function PostCard({ post, detail, onComment }: { post: Post; detail?: boolean; onComment?: () => void }) {
  const navigate = useNavigate();
  const isPureRepost = !!post.repostOf && !post.text;
  const shown = isPureRepost ? post.repostOf! : post;
  const { like } = usePostActions(shown);
  const open = () => {
    if (detail) return;
    if (window.getSelection()?.toString()) return;
    navigate(postHref(shown));
  };
  const author = shown.author;
  return (
    <article className={cn('pc', detail && 'pc--detail')} onClick={open}>
      {(isPureRepost || post.pinned || shown.community) && (
        <div className="pc-context">
          {isPureRepost && (
            <span>
              <Repeat2 size={14} />
              <Link to={`/u/${post.author.username}`} onClick={(e) => e.stopPropagation()}>
                {post.author.displayName}
              </Link>
              &nbsp;сделал(а) репост
            </span>
          )}
          {post.pinned && (
            <span>
              <Pin size={13} /> Закреплено
            </span>
          )}
          {shown.community && (
            <span>
              <Users size={13} /> {shown.community.name}
            </span>
          )}
        </div>
      )}
      <header className="pc-head">
        <Link to={`/u/${author.username}`} onClick={(e) => e.stopPropagation()} className="pc-head__avatar" aria-label={author.displayName}>
          <Avatar src={author.avatarUrl} name={author.displayName} id={author.id} size={detail ? 44 : 38} />
        </Link>
        <div className="pc-head__who">
          <div className="pc-head__line">
            <Link to={`/u/${author.username}`} onClick={(e) => e.stopPropagation()} className="pc-head__name">
              {author.displayName}
            </Link>
            {author.verified && <Verified size={15} />}
            <span className="pc-head__time" title={fullDate(shown.createdAt)}>
              {shortAgo(shown.createdAt)}
            </span>
          </div>
          <div className="pc-head__sub">
            <span className="ellipsis">@{author.username}</span>
            {shown.editedAt && <span>· изменено</span>}
            {VISIBILITY_ICON[shown.visibility] && <span className="pc-head__vis">· {VISIBILITY_ICON[shown.visibility]}</span>}
            {!VISIBILITY_ICON[shown.visibility] && detail && (
              <span className="pc-head__vis">
                · <Globe size={12} aria-label="Видят все" />
              </span>
            )}
          </div>
        </div>
        <PostMenu post={shown} />
      </header>
      {shown.title && <div className="pc-title">{shown.title}</div>}
      {shown.text && (detail ? <div className="pc-text pc-text--detail"><RichText text={shown.text} /></div> : <ExpandableText text={shown.text} />)}
      <PostMedia post={shown} onLike={() => !shown.viewer.liked && like.mutate(true)} />
      {shown.repostOf && !isPureRepost && <PostEmbed post={shown.repostOf} />}
      <PostActionsBar post={shown} onComment={onComment} />
      <LikesLine post={shown} />
      {detail ? (
        <div className="pc-date">{fullDate(shown.createdAt)}</div>
      ) : (
        shown.stats.comments > 0 &&
        !shown.commentsDisabled && (
          <Link to={`/post/${shown.id}#comments`} className="pc-comments-link" onClick={(e) => e.stopPropagation()}>
            {shown.stats.comments === 1 ? 'Смотреть комментарий' : `Смотреть все комментарии (${shown.stats.comments})`}
          </Link>
        )
      )}
    </article>
  );
});

/** Заглушка карточки на время загрузки. */
export function PostSkeleton({ media = true }: { media?: boolean }) {
  return (
    <div className="pc pc--skeleton" aria-hidden>
      <div className="pc-head">
        <span className="skeleton" style={{ width: 38, height: 38, borderRadius: '50%' }} />
        <div className="pc-head__who" style={{ gap: 6, display: 'flex', flexDirection: 'column' }}>
          <span className="skeleton" style={{ width: '42%', height: 12 }} />
          <span className="skeleton" style={{ width: '26%', height: 10 }} />
        </div>
      </div>
      <div className="pc-text" style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
        <span className="skeleton" style={{ width: '92%', height: 12 }} />
        <span className="skeleton" style={{ width: '64%', height: 12 }} />
      </div>
      {media && <span className="skeleton pc-media" style={{ aspectRatio: '1', display: 'block', borderRadius: 0 }} />}
      <div className="pc-actions">
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className="skeleton" style={{ width: 26, height: 26, borderRadius: 8, margin: '9px 8px' }} />
        ))}
      </div>
    </div>
  );
}
