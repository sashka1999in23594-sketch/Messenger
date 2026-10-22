/** Правая панель действий Reels — как в TikTok: автор, «Нравится», комментарии, сохранить, поделиться, звук. */
import { memo, useEffect, useState, type MouseEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Check, Flag, Link2, Plus, Repeat2, Trash2, UserRound, VolumeX } from 'lucide-react';
import type { Post, Relationship, UserProfile } from '@omni/shared';
import { api, errorMessage } from '../../shared/api/client';
import { qk, queryClient } from '../../shared/api/query';
import { useMe } from '../../shared/stores/session';
import { toast } from '../../shared/stores/ui';
import { cn } from '../../shared/lib/format';
import { Avatar, confirm, Menu, ReportDialog, useMenu } from '../../shared/ui';
import { usePostActions } from '../posts/actions';
import { BookmarkIcon, CommentIcon, HeartIcon, MoreIcon, ParticleRing, RollingCount, ShareIcon } from './Effects';
import { copyReelLink, shareReel } from './lib';

const NO_RELATION: Relationship = { following: false, followedBy: false, requested: false, blocked: false, blockedBy: false, muted: false };

/** Аватар автора со значком «+», который после подписки превращается в галочку и исчезает. */
function AuthorAvatar({ post, enabled }: { post: Post; enabled: boolean }) {
  const me = useMe();
  const { author } = post;
  const mine = author.id === me.id;
  const profile = useQuery({
    queryKey: qk.user(author.username),
    queryFn: () => api.get<UserProfile>(`/users/${encodeURIComponent(author.username)}`),
    enabled: enabled && !mine,
    staleTime: 60_000,
  });
  const rel = profile.data?.relationship ?? NO_RELATION;
  const [phase, setPhase] = useState<'idle' | 'done' | 'leaving' | 'gone'>('idle');
  const follow = useMutation({
    mutationFn: () => api.post<{ status: 'accepted' | 'pending' }>(`/users/${author.id}/follow`),
    onMutate: () => setPhase('done'),
    onSuccess: (r) => {
      queryClient.setQueryData<UserProfile>(qk.user(author.username), (old) =>
        old ? { ...old, relationship: { ...(old.relationship ?? NO_RELATION), following: r.status === 'accepted', requested: r.status === 'pending' } } : old,
      );
      void queryClient.invalidateQueries({ queryKey: qk.feed('following', 'short') });
      toast({ text: r.status === 'pending' ? `Заявка отправлена @${author.username}` : `Вы подписались на @${author.username}`, kind: 'success' });
    },
    onError: (e) => {
      setPhase('idle');
      toast({ text: errorMessage(e), kind: 'error' });
    },
  });
  useEffect(() => {
    if (phase === 'done') {
      const t = setTimeout(() => setPhase('leaving'), 1100);
      return () => clearTimeout(t);
    }
    if (phase === 'leaving') {
      const t = setTimeout(() => setPhase('gone'), 320);
      return () => clearTimeout(t);
    }
  }, [phase]);

  const canFollow = !mine && profile.isSuccess && !rel.following && !rel.requested && !rel.blocked && !rel.blockedBy;
  const badge = phase === 'idle' ? canFollow : phase !== 'gone';
  return (
    <div className="rl-author">
      <Link to={`/u/${author.username}`} className="rl-author__link" aria-label={`Профиль @${author.username}`}>
        <Avatar src={author.avatarUrl} name={author.displayName} id={author.id} size={48} />
      </Link>
      {badge && (
        <button
          type="button"
          className={cn('rl-follow', phase !== 'idle' && 'is-done', phase === 'leaving' && 'is-leaving')}
          onClick={() => phase === 'idle' && follow.mutate()}
          aria-label={phase === 'idle' ? `Подписаться на @${author.username}` : 'Вы подписаны'}
          disabled={phase !== 'idle'}
        >
          <Plus className="rl-follow__plus" size={14} strokeWidth={3.2} />
          <Check className="rl-follow__check" size={14} strokeWidth={3.4} />
        </button>
      )}
    </div>
  );
}

/** Вращающаяся «пластинка» с аватаром автора и вылетающими нотами. */
function SoundDisc({ post, spinning }: { post: Post; spinning: boolean }) {
  return (
    <Link to={`/u/${post.author.username}`} className={cn('rl-disc', spinning && 'is-spinning')} aria-label={`Оригинальный звук — @${post.author.username}`}>
      <span className="rl-disc__note rl-disc__note--1" aria-hidden>
        ♪
      </span>
      <span className="rl-disc__note rl-disc__note--2" aria-hidden>
        ♫
      </span>
      <span className="rl-disc__vinyl">
        <Avatar src={post.author.avatarUrl} name={post.author.displayName} id={post.author.id} size={24} />
      </span>
    </Link>
  );
}

export interface LikeFx {
  k: number;
  on: boolean;
}

interface RailProps {
  post: Post;
  /** Ролик рядом с текущим — можно подгрузить профиль автора */
  near: boolean;
  playing: boolean;
  likeFx: LikeFx | null;
  onLike: (on: boolean) => void;
  onComments: () => void;
  commentsOpen: boolean;
}

export const ActionRail = memo(function ActionRail({ post, near, playing, likeFx, onLike, onComments, commentsOpen }: RailProps) {
  const me = useMe();
  const navigate = useNavigate();
  const { bookmark, repost, remove } = usePostActions(post);
  const [saveFx, setSaveFx] = useState<LikeFx | null>(null);
  const [report, setReport] = useState(false);
  const menu = useMenu();
  const mine = post.author.id === me.id;
  const liked = post.viewer.liked;
  const saved = post.viewer.bookmarked;

  const toggleSave = () => {
    const on = !saved;
    setSaveFx({ k: Date.now(), on });
    bookmark.mutate(on, {
      onSuccess: () =>
        on && toast({ text: 'Сохранено в закладки', kind: 'success', action: { label: 'Открыть', onClick: () => navigate('/feed/bookmarks') } }),
    });
  };

  const openMenu = (e: MouseEvent<HTMLButtonElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    menu.openAt(r.left - 228, r.top - 8);
  };

  return (
    <div className="rl-rail" onClick={(e) => e.stopPropagation()}>
      <AuthorAvatar post={post} enabled={near} />

      <button
        type="button"
        className={cn('rl-act rl-act--like', liked && 'is-on')}
        aria-pressed={liked}
        aria-label={liked ? 'Убрать отметку «Нравится»' : 'Нравится'}
        onClick={() => onLike(!liked)}
      >
        <span className="rl-act__icon">
          <span key={likeFx?.k ?? 0} className={cn('rl-act__glyph', likeFx && (likeFx.on ? 'is-pop' : 'is-unpop'))}>
            <HeartIcon liked={liked} size={32} />
          </span>
          {likeFx?.on && <ParticleRing key={`ring${likeFx.k}`} />}
        </span>
        <RollingCount value={post.stats.likes} />
      </button>

      <button type="button" className={cn('rl-act', commentsOpen && 'is-active')} aria-label={`Комментарии: ${post.stats.comments}`} aria-haspopup="dialog" aria-expanded={commentsOpen} onClick={onComments}>
        <span className="rl-act__icon">
          <span className="rl-act__glyph">
            <CommentIcon size={31} />
          </span>
        </span>
        <RollingCount value={post.stats.comments} />
      </button>

      <button type="button" className={cn('rl-act rl-act--save', saved && 'is-on')} aria-pressed={saved} aria-label={saved ? 'Убрать из закладок' : 'Сохранить в закладки'} onClick={toggleSave}>
        <span className="rl-act__icon">
          <span key={saveFx?.k ?? 0} className={cn('rl-act__glyph', saveFx && (saveFx.on ? 'is-pop' : 'is-unpop'))}>
            <BookmarkIcon saved={saved} size={28} />
          </span>
          {saveFx?.on && <ParticleRing key={`ring${saveFx.k}`} tone="save" />}
        </span>
      </button>

      <button type="button" className="rl-act rl-act--share" aria-label="Поделиться" onClick={() => void shareReel(post)}>
        <span className="rl-act__icon">
          <span className="rl-act__glyph">
            <ShareIcon size={29} />
          </span>
        </span>
        {post.stats.reposts > 0 && <RollingCount value={post.stats.reposts} />}
      </button>

      <button type="button" className="rl-act rl-act--more" aria-label="Ещё" aria-haspopup="menu" onClick={openMenu}>
        <span className="rl-act__icon rl-act__icon--sm">
          <MoreIcon size={24} />
        </span>
      </button>

      <SoundDisc post={post} spinning={playing} />

      <Menu
        anchor={menu.anchor}
        onClose={menu.close}
        items={[
          { label: 'Скопировать ссылку', icon: <Link2 size={18} />, onClick: () => void copyReelLink(post) },
          { label: post.viewer.reposted ? 'Отменить репост' : 'Сделать репост', icon: <Repeat2 size={18} />, hidden: mine, onClick: () => repost.mutate(!post.viewer.reposted) },
          { label: `Профиль @${post.author.username}`, icon: <UserRound size={18} />, onClick: () => navigate(`/u/${post.author.username}`) },
          {
            label: `Скрыть @${post.author.username}`,
            icon: <VolumeX size={18} />,
            hidden: mine,
            onClick: () =>
              void api
                .post(`/users/${post.author.id}/mute`)
                .then(() => toast(`Reels @${post.author.username} больше не будут попадаться`))
                .catch((e) => toast({ text: errorMessage(e), kind: 'error' })),
          },
          { label: 'Пожаловаться', icon: <Flag size={18} />, hidden: mine, onClick: () => setReport(true) },
          {
            label: 'Удалить',
            icon: <Trash2 size={18} />,
            danger: true,
            hidden: !mine,
            onClick: async () => {
              if (await confirm({ title: 'Удалить Reels?', text: 'Его нельзя будет восстановить.', danger: true, confirmLabel: 'Удалить' })) remove.mutate();
            },
          },
        ]}
      />
      {report && <ReportDialog open entityType="post" entityId={post.id} onClose={() => setReport(false)} />}
    </div>
  );
});
