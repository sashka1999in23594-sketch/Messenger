import { memo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { BarChart2, Bookmark, Ellipsis, Flag, FolderPlus, Heart, Link2, MessageCircle, PenLine, Pin, PinOff, Quote, Repeat2, Trash2, Users, VolumeX } from 'lucide-react';
import type { Me, Post } from '@omni/shared';
import { api, errorMessage } from '../../shared/api/client';
import { queryClient } from '../../shared/api/query';
import { useMe, useSession } from '../../shared/stores/session';
import { toast } from '../../shared/stores/ui';
import { cn, compactNumber, fullDate, timeAgo } from '../../shared/lib/format';
import { Avatar, confirm, MediaGrid, Menu, ReportDialog, RichText, useMenu, UserName } from '../../shared/ui';
import { shareLink, usePostActions } from './actions';
import { QuoteDialog } from './PostComposer';
import { CollectionPickerDialog, LikersDialog } from '../social/dialogs';
import './posts.css';

export function PostEmbed({ post }: { post: Post }) {
  const navigate = useNavigate();
  return (
    <div
      className="post__quote"
      onClick={(e) => {
        e.stopPropagation();
        navigate(post.kind === 'video' ? `/watch/${post.id}` : `/post/${post.id}`);
      }}
    >
      <div className="post__head">
        <Avatar src={post.author.avatarUrl} name={post.author.displayName} id={post.author.id} size={20} />
        <UserName user={post.author} />
        <span className="post__meta">
          @{post.author.username} · {timeAgo(post.createdAt)}
        </span>
      </div>
      {post.title && <div className="bold">{post.title}</div>}
      {post.text && <RichText text={post.text} className="clamp-3" />}
      <MediaGrid media={post.media} />
    </div>
  );
}

export const PostActionsBar = memo(function PostActionsBar({ post, onComment }: { post: Post; onComment?: () => void }) {
  const { like, bookmark, repost } = usePostActions(post);
  const repostMenu = useMenu();
  const [quoting, setQuoting] = useState(false);
  const navigate = useNavigate();
  return (
    <div className="post__actions" onClick={(e) => e.stopPropagation()}>
      <button className="action" onClick={onComment ?? (() => navigate(`/post/${post.id}`))} aria-label="Комментарии" disabled={post.commentsDisabled}>
        <MessageCircle size={18} />
        {post.stats.comments > 0 && compactNumber(post.stats.comments)}
      </button>
      <button
        className={cn('action action--repost', post.viewer.reposted && 'action--reposted')}
        onClick={(e) => repostMenu.openFromEvent(e)}
        aria-label="Репост"
        disabled={post.visibility !== 'public'}
      >
        <Repeat2 size={19} />
        {post.stats.reposts > 0 && compactNumber(post.stats.reposts)}
      </button>
      <button
        className={cn('action action--like', post.viewer.liked && 'action--liked')}
        onClick={() => like.mutate(!post.viewer.liked)}
        aria-label={post.viewer.liked ? 'Убрать лайк' : 'Нравится'}
        aria-pressed={post.viewer.liked}
      >
        <Heart size={18} fill={post.viewer.liked ? 'currentColor' : 'none'} />
        {post.stats.likes > 0 && compactNumber(post.stats.likes)}
      </button>
      <span className="action" title="Просмотры" style={{ cursor: 'default' }}>
        <BarChart2 size={17} />
        {post.stats.views > 0 && compactNumber(post.stats.views)}
      </span>
      <span className="row" style={{ gap: 0 }}>
        <button className={cn('action', post.viewer.bookmarked && 'action--saved')} onClick={() => bookmark.mutate(!post.viewer.bookmarked)} aria-label="В закладки">
          <Bookmark size={18} fill={post.viewer.bookmarked ? 'currentColor' : 'none'} />
        </button>
        <button className="action" onClick={() => shareLink(post.kind === 'video' ? `/watch/${post.id}` : `/post/${post.id}`)} aria-label="Поделиться">
          <Link2 size={18} />
        </button>
      </span>
      <Menu
        anchor={repostMenu.anchor}
        onClose={repostMenu.close}
        items={[
          { label: post.viewer.reposted ? 'Отменить репост' : 'Репост', icon: <Repeat2 size={18} />, onClick: () => repost.mutate(!post.viewer.reposted) },
          { label: 'Цитировать', icon: <Quote size={18} />, onClick: () => setQuoting(true) },
        ]}
      />
      {quoting && <QuoteDialog post={post} onClose={() => setQuoting(false)} />}
    </div>
  );
});

export function PostMenu({ post }: { post: Post }) {
  const me = useMe();
  const menu = useMenu();
  const [dialog, setDialog] = useState<'report' | 'collection' | 'likers' | null>(null);
  const { remove } = usePostActions(post);
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
  return (
    <span onClick={(e) => e.stopPropagation()}>
      <button className="icon-btn icon-btn--sm" aria-label="Ещё" onClick={(e) => menu.openFromEvent(e)}>
        <Ellipsis size={18} />
      </button>
      <Menu
        anchor={menu.anchor}
        onClose={menu.close}
        items={[
          { label: 'Скопировать ссылку', icon: <Link2 size={18} />, onClick: () => shareLink(post.kind === 'video' ? `/watch/${post.id}` : `/post/${post.id}`) },
          { label: 'В коллекцию…', icon: <FolderPlus size={18} />, onClick: () => setDialog('collection') },
          { label: 'Кто оценил', icon: <Heart size={18} />, hidden: !post.stats.likes, onClick: () => setDialog('likers') },
          { label: pinned ? 'Открепить из профиля' : 'Закрепить в профиле', icon: pinned ? <PinOff size={18} /> : <Pin size={18} />, hidden: !mine || !!post.community, onClick: () => void pin() },
          {
            label: `Скрыть @${post.author.username}`,
            icon: <VolumeX size={18} />,
            hidden: mine,
            onClick: () => void api.post(`/users/${post.author.id}/mute`).then(() => toast(`Публикации @${post.author.username} скрыты из ваших лент`)),
          },
          { label: 'Пожаловаться', icon: <Flag size={18} />, hidden: mine, onClick: () => setDialog('report') },
          {
            label: 'Удалить',
            icon: <Trash2 size={18} />,
            danger: true,
            hidden: !mine,
            onClick: async () => {
              if (await confirm({ title: 'Удалить публикацию?', text: 'Её нельзя будет восстановить.', danger: true, confirmLabel: 'Удалить' })) remove.mutate();
            },
          },
        ]}
      />
      {dialog === 'report' && <ReportDialog open entityType="post" entityId={post.id} onClose={() => setDialog(null)} />}
      {dialog === 'collection' && <CollectionPickerDialog post={post} onClose={() => setDialog(null)} />}
      {dialog === 'likers' && <LikersDialog postId={post.id} onClose={() => setDialog(null)} />}
    </span>
  );
}

/** Карточка публикации в стиле X/Twitter (заметки, а также репосты любых видов). */
export const PostCard = memo(function PostCard({ post, detail }: { post: Post; detail?: boolean }) {
  const navigate = useNavigate();
  const isPureRepost = !!post.repostOf && !post.text;
  const shown = isPureRepost ? post.repostOf! : post;
  const open = () => {
    if (detail) return;
    if (window.getSelection()?.toString()) return;
    navigate(shown.kind === 'video' ? `/watch/${shown.id}` : `/post/${shown.id}`);
  };
  return (
    <article className={cn('post', detail && 'post--detail')} onClick={open}>
      {!detail && (
        <Link to={`/u/${shown.author.username}`} onClick={(e) => e.stopPropagation()} style={{ flex: '0 0 auto' }}>
          <Avatar src={shown.author.avatarUrl} name={shown.author.displayName} id={shown.author.id} size={44} />
        </Link>
      )}
      <div className="post__body">
        {isPureRepost && (
          <div className="post__context" style={{ margin: 0 }}>
            <Repeat2 size={15} />
            <Link to={`/u/${post.author.username}`} onClick={(e) => e.stopPropagation()} style={{ color: 'inherit' }}>
              {post.author.displayName}
            </Link>{' '}
            сделал(а) репост
          </div>
        )}
        {post.pinned && (
          <div className="post__context" style={{ margin: 0 }}>
            <Pin size={14} /> Закреплено
          </div>
        )}
        {shown.community && (
          <Link className="post__context" style={{ margin: 0 }} to={`/c/${shown.community.slug}`} onClick={(e) => e.stopPropagation()}>
            <Users size={14} /> {shown.community.name}
          </Link>
        )}
        <div className="post__head">
          {detail && <Avatar src={shown.author.avatarUrl} name={shown.author.displayName} id={shown.author.id} size={48} />}
          <Link to={`/u/${shown.author.username}`} onClick={(e) => e.stopPropagation()} className="row gap-1" style={{ color: 'inherit', minWidth: 0 }}>
            <UserName user={shown.author} />
            <span className="post__meta">@{shown.author.username}</span>
          </Link>
          {!detail && (
            <span className="post__meta" title={fullDate(shown.createdAt)}>
              · {timeAgo(shown.createdAt)}
            </span>
          )}
          {shown.editedAt && <PenLine size={12} className="faint" aria-label="изменено" />}
          <span className="grow" />
          <PostMenu post={shown} />
        </div>
        {shown.title && <div className="post__title">{shown.title}</div>}
        {shown.text && <RichText text={shown.text} className="post__text" />}
        <MediaGrid media={shown.media} />
        {shown.repostOf && !isPureRepost && <PostEmbed post={shown.repostOf} />}
        {detail && <div className="post__meta" style={{ padding: '6px 0' }}>{fullDate(shown.createdAt)}</div>}
        <PostActionsBar post={shown} />
      </div>
    </article>
  );
});
