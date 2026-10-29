import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  Archive,
  Ban,
  Bell,
  BellRing,
  CalendarDays,
  ChevronDown,
  Clapperboard,
  Flag,
  Globe,
  Grid3x3,
  Heart,
  Image,
  Link2,
  ListPlus,
  Lock,
  MapPin,
  MessageSquareText,
  MoreHorizontal,
  PenLine,
  Search,
  ShieldCheck,
  Smile,
  SquarePlay,
  Star,
  UserMinus,
  UserPlus,
  Users,
  VolumeX,
} from 'lucide-react';
import type { ChatSummary, Post, Story, UserProfile, UserSummary } from '@omni/shared';
import { api, errorMessage } from '../../shared/api/client';
import { flatPages, qk, queryClient, useCursorList } from '../../shared/api/query';
import { getIdentity, registerDevice } from '../../shared/crypto/e2e';
import { useMe } from '../../shared/stores/session';
import { toast, useCrumb } from '../../shared/stores/ui';
import { cn, compactNumber, lastSeen, plural } from '../../shared/lib/format';
import { Avatar, Button, confirm, EmptyState, ErrorState, ListSkeleton, LoadMore, ReportDialog, Spinner, UserName, Verified } from '../../shared/ui';
import { ExpandableText, PostCard, PostSkeleton } from '../posts/PostCard';
import { ComposeSheet } from '../posts/PostComposer';
import { GridSkeleton, PhotoGrid } from './PhotoGrid';
import { FollowButton } from '../feed';
import { HighlightsRow, StoryViewer } from '../stories';
import { StoryRing } from '../stories/StoriesBar';
import { ListPickerDialog } from '../social/dialogs';
import { copyLink, ShareSheet, UnderlineTabs, useOptions } from '../misc/kit';
import { StatusDialog } from './extras';
import './profile.css';

type TabId = 'posts' | 'photos' | 'videos' | 'shorts' | 'notes' | 'likes';
const TABS: { id: TabId; label: string; icon: React.ReactNode }[] = [
  { id: 'posts', label: 'Публикации', icon: <Grid3x3 size={22} /> },
  { id: 'photos', label: 'Фото', icon: <Image size={22} /> },
  { id: 'videos', label: 'Видео', icon: <SquarePlay size={22} /> },
  { id: 'shorts', label: 'Reels', icon: <Clapperboard size={22} /> },
  { id: 'notes', label: 'Заметки', icon: <MessageSquareText size={22} /> },
  { id: 'likes', label: 'Лайки', icon: <Heart size={22} /> },
];
const API_TAB: Record<TabId, string> = { posts: 'posts', photos: 'photo', videos: 'video', shorts: 'short', notes: 'note', likes: 'likes' };

function ProfileContent({ profile, tab, isMe }: { profile: UserProfile; tab: TabId; isMe: boolean }) {
  const apiTab = API_TAB[tab] ?? 'posts';
  const list = useCursorList<Post>(qk.userPosts(profile.id, apiTab), `/users/${profile.id}/posts?tab=${apiTab}`, { limit: 24 });
  const [composing, setComposing] = useState(false);
  const items = flatPages(list.data);
  const asList = tab === 'notes' || tab === 'likes';
  if (!profile.canViewContent) {
    return (
      <div className="pf-locked">
        <span className="pf-locked__icon">
          <Lock size={30} />
        </span>
        <b>Это закрытый профиль</b>
        <span>Подпишитесь, чтобы видеть фото и видео. Автор должен одобрить заявку.</span>
      </div>
    );
  }
  if (list.isLoading) return asList ? <PostSkeleton media={false} /> : <GridSkeleton tall={tab === 'shorts'} />;
  if (!items.length) {
    const own = isMe && tab !== 'likes';
    return (
      <div className="pf-empty">
        <span className="pf-empty__icon">{TABS.find((t) => t.id === tab)?.icon}</span>
        <b>{tab === 'likes' ? 'Лайков пока нет' : own ? 'Поделитесь первой публикацией' : 'Публикаций пока нет'}</b>
        {own && (
          <>
            <span>Фото, видео и заметки появятся в вашем профиле</span>
            {tab === 'shorts' ? (
              <Link to="/create" className="pf-empty__link">
                Снять Reels
              </Link>
            ) : tab === 'videos' ? (
              <Link to="/video/upload" className="pf-empty__link">
                Загрузить видео
              </Link>
            ) : (
              <button type="button" className="pf-empty__link" onClick={() => setComposing(true)}>
                Создать публикацию
              </button>
            )}
          </>
        )}
        {composing && <ComposeSheet onClose={() => setComposing(false)} />}
      </div>
    );
  }
  return (
    <>
      {asList ? <div className="pf-list">{items.map((p) => <PostCard key={p.id} post={p} />)}</div> : <PhotoGrid posts={items} tall={tab === 'shorts'} />}
      <LoadMore hasMore={!!list.hasNextPage} loading={list.isFetchingNextPage} onLoad={() => void list.fetchNextPage()} />
    </>
  );
}

/** Цифра и подпись в шапке профиля. */
function Stat({ n, label, to }: { n: number; label: string; to?: string }) {
  const body = (
    <>
      <b>{compactNumber(n)}</b>
      <span>{label}</span>
    </>
  );
  return to ? (
    <Link className="pf-stat" to={to}>
      {body}
    </Link>
  ) : (
    <span className="pf-stat">{body}</span>
  );
}

export function ProfilePage() {
  const { username: param, tab: tabParam = 'posts' } = useParams();
  const me = useMe();
  const navigate = useNavigate();
  const username = param ?? me.username;
  const isMe = username === me.username;
  const [dialog, setDialog] = useState<'report' | 'lists' | 'status' | 'share' | null>(null);
  const [stories, setStories] = useState<Story[] | null>(null);
  const q = useQuery({ queryKey: qk.user(username), queryFn: () => api.get<UserProfile>(`/users/${encodeURIComponent(username)}`) });
  const p = q.data;
  useCrumb(p ? (isMe ? 'Моя страница' : p.displayName) : null);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: qk.user(username) });
    void queryClient.invalidateQueries({ queryKey: ['feed'] });
  };
  const follow = useMutation({
    mutationFn: (on: boolean) => (on ? api.post<{ status: string }>(`/users/${p!.id}/follow`) : api.del(`/users/${p!.id}/follow`)),
    onSuccess: refresh,
    onError: (e) => toast({ text: errorMessage(e), kind: 'error' }),
  });
  const message = useMutation({
    mutationFn: () => api.post<ChatSummary>('/chats/direct', { userId: p!.id }),
    onSuccess: (c) => navigate(`/chats/${c.id}`),
    onError: (e) => toast({ text: errorMessage(e), kind: 'error' }),
  });
  const secretChat = useMutation({
    mutationFn: async () => {
      const deviceId = (await registerDevice()) ?? (await getIdentity()).deviceId;
      return api.post<ChatSummary>('/chats/secret', { userId: p!.id, myDeviceId: deviceId, ttlSeconds: 0 });
    },
    onSuccess: (c) => {
      void queryClient.invalidateQueries({ queryKey: qk.chatsAll });
      navigate(`/chats/${c.id}`);
    },
    onError: (e) => toast({ text: errorMessage(e), kind: 'error' }),
  });
  const bell = useMutation({
    mutationFn: (on: boolean) => (on ? api.post(`/users/${p!.id}/subscribe`) : api.del(`/users/${p!.id}/subscribe`)),
    onSuccess: (_, on) => {
      refresh();
      toast({ text: on ? 'Будем присылать уведомления о новых публикациях' : 'Уведомления о публикациях выключены', kind: 'success' });
    },
    onError: (e) => toast({ text: errorMessage(e), kind: 'error' }),
  });
  const closeFriend = useMutation({
    mutationFn: (on: boolean) => (on ? api.post('/me/close-friends', { userIds: [p!.id] }) : api.del(`/me/close-friends/${p!.id}`)),
    onSuccess: (_, on) => {
      refresh();
      toast({ text: on ? `${p!.displayName} — в близких друзьях` : 'Убрано из близких друзей', kind: 'success' });
    },
    onError: (e) => toast({ text: errorMessage(e), kind: 'error' }),
  });
  const openStories = async () => {
    try {
      const r = await api.get<{ items: Story[] }>(`/users/${p!.id}/stories`);
      if (r.items.length) setStories(r.items);
    } catch (e) {
      toast({ text: errorMessage(e), kind: 'error' });
    }
  };
  const block = async () => {
    if (!p) return;
    if (p.relationship?.blocked) return void api.del(`/users/${p.id}/block`).then(refresh);
    if (await confirm({ title: `Заблокировать ${p.displayName}?`, text: 'Пользователь не сможет писать вам, видеть ваши публикации и подписываться.', danger: true, confirmLabel: 'Заблокировать' })) {
      await api.post(`/users/${p.id}/block`);
      refresh();
    }
  };
  const rel = p?.relationship;

  const more = useOptions([
    { label: 'Поделиться профилем', icon: <Link2 size={20} />, onClick: () => setDialog('share') },
    { label: 'Скопировать ссылку', icon: <Link2 size={20} />, onClick: () => p && void copyLink(`/u/${p.username}`) },
    { label: 'Статус', icon: <Smile size={20} />, hidden: !isMe, onClick: () => setDialog('status') },
    { label: 'Архив историй', icon: <Archive size={20} />, hidden: !isMe, onClick: () => navigate('/stories/archive') },
    { label: 'Закладки', icon: <Star size={20} />, hidden: !isMe, onClick: () => navigate('/feed/bookmarks') },
    { label: 'Секретный чат', icon: <ShieldCheck size={20} />, hidden: isMe || !p?.canMessage, onClick: () => secretChat.mutate() },
    { label: 'Добавить в список…', icon: <ListPlus size={20} />, hidden: isMe, onClick: () => setDialog('lists') },
    {
      label: p?.closeFriend ? 'Убрать из близких друзей' : 'В близкие друзья',
      icon: <Star size={20} />,
      hidden: isMe || !!rel?.blocked,
      onClick: () => p && closeFriend.mutate(!p.closeFriend),
    },
    'separator',
    {
      label: rel?.muted ? 'Показывать публикации' : 'Скрыть публикации',
      icon: <VolumeX size={20} />,
      hidden: isMe,
      onClick: () => p && void (rel?.muted ? api.del(`/users/${p.id}/mute`) : api.post(`/users/${p.id}/mute`)).then(refresh),
    },
    { label: 'Пожаловаться', icon: <Flag size={20} />, danger: true, hidden: isMe, onClick: () => setDialog('report') },
    { label: rel?.blocked ? 'Разблокировать' : 'Заблокировать', icon: <Ban size={20} />, danger: true, hidden: isMe, onClick: () => void block() },
  ]);
  const following = useOptions(
    [
      {
        label: p?.subscribed ? 'Не уведомлять о публикациях' : 'Уведомлять о публикациях',
        icon: p?.subscribed ? <BellRing size={20} /> : <Bell size={20} />,
        onClick: () => p && bell.mutate(!p.subscribed),
      },
      { label: p?.closeFriend ? 'Убрать из близких друзей' : 'В близкие друзья', icon: <Star size={20} />, onClick: () => p && closeFriend.mutate(!p.closeFriend) },
      { label: 'Добавить в список…', icon: <ListPlus size={20} />, onClick: () => setDialog('lists') },
      'separator',
      { label: 'Отписаться', icon: <UserMinus size={20} />, danger: true, onClick: () => follow.mutate(false) },
    ],
    p ? <UserName user={p} /> : undefined,
  );

  if (q.isLoading) return <ProfileSkeleton />;
  if (q.error || !p) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const base = isMe ? '/profile' : `/u/${p.username}`;
  const tab = (TABS.some((t) => t.id === tabParam) ? tabParam : 'posts') as TabId;
  const tabs = TABS.filter((t) => t.id !== 'likes' || isMe);

  return (
    <div className="pk-root">
      <div className="scroll">
        <div className="pf">
          {p.bannerUrl && <div className="pf-banner" style={{ backgroundImage: `url("${p.bannerUrl}")` }} />}
          <section className={cn('pf-head', p.bannerUrl && 'pf-head--banner')}>
            <div className="pf-avatar">
              {p.storyRing ? (
                <button type="button" onClick={() => void openStories()} aria-label="Смотреть истории" className="pf-avatar__btn">
                  <StoryRing user={p} size={96} ring={p.storyRing} className="pf-avatar__ring" />
                </button>
              ) : (
                <span className="pf-avatar__plain">
                  <Avatar src={p.avatarUrl} name={p.displayName} id={p.id} size={88} online={p.presence?.online} className="pf-avatar__img" />
                </span>
              )}
              {isMe && (
                <Link to="/stories/new" className="pf-avatar__add" aria-label="Новая история">
                  +
                </Link>
              )}
            </div>
            <div className="pf-stats">
              <Stat n={p.stats.posts} label={plural(p.stats.posts, 'публикация', 'публикации', 'публикаций')} />
              <Stat n={p.stats.followers} label={plural(p.stats.followers, 'подписчик', 'подписчика', 'подписчиков')} to={isMe ? '/contacts/followers' : `/u/${p.username}/followers`} />
              <Stat n={p.stats.following} label={plural(p.stats.following, 'подписка', 'подписки', 'подписок')} to={isMe ? '/contacts/following' : `/u/${p.username}/following`} />
            </div>
            <div className="pf-info">
              <h1 className="pf-name">
                <span className="ellipsis">{p.displayName}</span>
                {p.verified && <Verified size={20} />}
                {p.isPrivate && <Lock size={16} className="faint" aria-label="Закрытый профиль" />}
              </h1>
              <div className="pf-handle">
                <span>@{p.username}</span>
                {rel?.followedBy && <span className="pf-tag">Подписан(а) на вас</span>}
                {!isMe && p.presence && <span className="pf-seen">{lastSeen(p.presence)}</span>}
              </div>
              {(p.status || isMe) && (
                <button
                  type="button"
                  className="pf-status"
                  onClick={() => isMe && setDialog('status')}
                  disabled={!isMe}
                  title={p.status?.until ? `До ${new Date(p.status.until).toLocaleString('ru-RU')}` : undefined}
                >
                  {p.status ? (
                    <>
                      <span aria-hidden>{p.status.emoji}</span> {p.status.text || 'Статус'}
                    </>
                  ) : (
                    <>
                      <Smile size={15} /> Установить статус
                    </>
                  )}
                </button>
              )}
              {p.bio && <ExpandableText text={p.bio} lines={3} className="pf-bio" />}
              {(p.website || p.links.length > 0) && (
                <div className="pf-links">
                  {p.website && (
                    <a href={p.website} target="_blank" rel="noopener noreferrer nofollow">
                      <Globe size={14} /> {p.website.replace(/^https?:\/\//, '').replace(/\/$/, '')}
                    </a>
                  )}
                  {p.links.map((l) => (
                    <a key={l.url} href={l.url} target="_blank" rel="noopener noreferrer nofollow ugc">
                      <Link2 size={14} /> {l.title}
                    </a>
                  ))}
                </div>
              )}
              <div className="pf-meta">
                {p.location && (
                  <span>
                    <MapPin size={13} /> {p.location}
                  </span>
                )}
                <span>
                  <CalendarDays size={13} /> С нами с {new Date(p.createdAt).toLocaleDateString('ru', { month: 'long', year: 'numeric' })}
                </span>
              </div>
              {p.mutualFollowers.count > 0 && (
                <Link className="pf-mutuals" to={`/u/${p.username}/followers`}>
                  <span className="pf-mutuals__avatars">
                    {p.mutualFollowers.sample.slice(0, 3).map((u) => (
                      <Avatar key={u.id} src={u.avatarUrl} name={u.displayName} id={u.id} size={22} />
                    ))}
                  </span>
                  <span>
                    Подписаны {p.mutualFollowers.sample.map((u) => u.displayName.split(' ')[0]).join(', ')}
                    {p.mutualFollowers.count > p.mutualFollowers.sample.length && ` и ещё ${p.mutualFollowers.count - p.mutualFollowers.sample.length}`}
                  </span>
                </Link>
              )}
            </div>
            <div className="pf-actions">
              {isMe ? (
                <>
                  <Link to="/settings/account/profile" className="pf-btn">
                    <PenLine size={16} /> Редактировать
                  </Link>
                  <button type="button" className="pf-btn" onClick={() => setDialog('share')}>
                    Поделиться
                  </button>
                </>
              ) : rel?.blocked ? (
                <button type="button" className="pf-btn pf-btn--danger" onClick={() => void api.del(`/users/${p.id}/block`).then(refresh)}>
                  Разблокировать
                </button>
              ) : (
                <>
                  {rel?.following ? (
                    <button type="button" className="pf-btn" onClick={(e) => following.open(e)}>
                      Вы подписаны <ChevronDown size={16} />
                    </button>
                  ) : rel?.requested ? (
                    <button type="button" className="pf-btn" onClick={() => follow.mutate(false)}>
                      Заявка отправлена
                    </button>
                  ) : (
                    <button type="button" className="pf-btn pf-btn--primary" onClick={() => follow.mutate(true)} disabled={rel?.blockedBy || follow.isPending}>
                      {follow.isPending ? <Spinner /> : <UserPlus size={16} />}
                      {rel?.followedBy ? 'Подписаться в ответ' : 'Подписаться'}
                    </button>
                  )}
                  <button type="button" className="pf-btn" disabled={!p.canMessage || message.isPending} onClick={() => message.mutate()}>
                    Сообщение
                  </button>
                  {p.canViewContent && (rel?.following || p.subscribed) && (
                    <button
                      type="button"
                      className={cn('pf-btn pf-btn--icon', p.subscribed && 'pf-btn--on')}
                      aria-label={p.subscribed ? 'Не уведомлять о публикациях' : 'Уведомлять о новых публикациях'}
                      title={p.subscribed ? 'Уведомления включены' : 'Уведомлять о новых публикациях'}
                      aria-pressed={p.subscribed}
                      onClick={() => bell.mutate(!p.subscribed)}
                    >
                      {p.subscribed ? <BellRing size={18} /> : <Bell size={18} />}
                    </button>
                  )}
                </>
              )}
              <button type="button" className="pf-btn pf-btn--icon" aria-label="Ещё" onClick={(e) => more.open(e)}>
                <MoreHorizontal size={20} />
              </button>
            </div>
          </section>
          {p.canViewContent && (
            <div className="pf-highlights">
              <HighlightsRow userId={p.id} own={isMe} />
            </div>
          )}
          <UnderlineTabs iconsOnly sticky className="pf-tabs" tabs={tabs.map((t) => ({ to: t.id === 'posts' ? base : `${base}/${t.id}`, label: t.label, icon: t.icon }))} />
          <div className="pf-content">
            <ProfileContent key={tab} profile={p} tab={tab} isMe={isMe} />
          </div>
        </div>
      </div>
      {more.element}
      {following.element}
      {dialog === 'report' && <ReportDialog open entityType="user" entityId={p.id} onClose={() => setDialog(null)} />}
      {dialog === 'lists' && <ListPickerDialog user={p} onClose={() => setDialog(null)} />}
      {dialog === 'status' && <StatusDialog onClose={() => setDialog(null)} />}
      {dialog === 'share' && <ShareSheet path={`/u/${p.username}`} title={`${p.displayName} в Sunnet`} onClose={() => setDialog(null)} />}
      {stories && <StoryViewer groups={[{ author: p, stories, hasUnseen: stories.some((s) => !s.viewed) }]} onClose={() => (setStories(null), refresh())} />}
    </div>
  );
}

function ProfileSkeleton() {
  return (
    <div className="pk-root">
      <div className="scroll">
        <div className="pf" aria-hidden>
          <section className="pf-head">
            <div className="pf-avatar">
              <span className="skeleton" style={{ width: 88, height: 88, borderRadius: '50%', display: 'block' }} />
            </div>
            <div className="pf-stats">
              {[0, 1, 2].map((i) => (
                <span key={i} className="pf-stat">
                  <span className="skeleton" style={{ width: 28, height: 18 }} />
                  <span className="skeleton" style={{ width: 64, height: 10, marginTop: 6 }} />
                </span>
              ))}
            </div>
            <div className="pf-info">
              <span className="skeleton" style={{ width: '40%', height: 18 }} />
              <span className="skeleton" style={{ width: '25%', height: 12, marginTop: 8 }} />
              <span className="skeleton" style={{ width: '80%', height: 12, marginTop: 12 }} />
            </div>
          </section>
          <GridSkeleton count={6} />
        </div>
      </div>
    </div>
  );
}

/** Подписчики / подписки (свои — в разделе «Контакты», чужие — со страницы профиля). */
export function FollowListPage({ which }: { which: 'followers' | 'following' | 'suggestions' }) {
  const me = useMe();
  const navigate = useNavigate();
  const { username } = useParams();
  const [filter, setFilter] = useState('');
  const owner = username ?? me.username;
  const target = useQuery({ queryKey: qk.user(owner), queryFn: () => api.get<UserProfile>(`/users/${owner}`), enabled: which !== 'suggestions' });
  const id = target.data?.id;
  const list = useCursorList<UserSummary>(['follow-list', id, which], `/users/${id}/${which}`, { enabled: !!id && which !== 'suggestions' });
  const suggestions = useQuery({ queryKey: ['suggestions'], queryFn: () => api.get<{ items: UserSummary[] }>('/users/suggestions'), enabled: which === 'suggestions' });
  useCrumb(which === 'suggestions' ? 'Рекомендации' : target.data ? (owner === me.username ? (which === 'followers' ? 'Подписчики' : 'Подписки') : target.data.displayName) : null);
  const message = async (u: UserSummary) => {
    try {
      const c = await api.post<ChatSummary>('/chats/direct', { userId: u.id });
      navigate(`/chats/${c.id}`);
    } catch (e) {
      toast({ text: errorMessage(e), kind: 'error' });
    }
  };
  const all = which === 'suggestions' ? (suggestions.data?.items ?? []) : flatPages(list.data);
  const term = filter.trim().toLowerCase();
  const items = term ? all.filter((u) => u.displayName.toLowerCase().includes(term) || u.username.toLowerCase().includes(term)) : all;
  const base = owner === me.username ? '/contacts' : `/u/${owner}`;
  const loading = list.isLoading || suggestions.isLoading;
  const t = target.data;
  return (
    <div className="pk-root">
      <div className="scroll">
        <div className="fl">
          {which === 'suggestions' ? (
            <div className="feed-head">
              <span className="feed-head__icon">
                <Users size={22} />
              </span>
              <div>
                <h1>Возможно, вы знакомы</h1>
              </div>
            </div>
          ) : (
            <UnderlineTabs
              sticky
              tabs={[
                { to: `${base}/followers`, label: t ? `${compactNumber(t.stats.followers)} ${plural(t.stats.followers, 'подписчик', 'подписчика', 'подписчиков')}` : 'Подписчики' },
                { to: `${base}/following`, label: t ? `${compactNumber(t.stats.following)} ${plural(t.stats.following, 'подписка', 'подписки', 'подписок')}` : 'Подписки' },
              ]}
            />
          )}
          <label className="pk-search fl__search">
            <Search size={17} />
            <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Поиск" aria-label="Поиск по списку" />
          </label>
          {loading && <ListSkeleton />}
          {!loading && items.length === 0 && <EmptyState icon={<Users size={28} />} title={term ? 'Никого не нашли' : 'Список пуст'} />}
          <div className="fl__list">
            {items.map((u) => (
              <div key={u.id} className="fl__row">
                <Link to={`/u/${u.username}`} className="fl__user">
                  <Avatar src={u.avatarUrl} name={u.displayName} id={u.id} size={48} />
                  <span className="fl__text">
                    <span className="fl__name">
                      <span className="ellipsis">{u.displayName}</span>
                      {u.verified && <Verified size={14} />}
                    </span>
                    <span className="fl__sub">@{u.username}</span>
                  </span>
                </Link>
                {which === 'suggestions' ? (
                  <FollowButton user={u} />
                ) : u.id !== me.id ? (
                  <Button variant="secondary" size="sm" onClick={() => void message(u)}>
                    Написать
                  </Button>
                ) : null}
              </div>
            ))}
          </div>
          {which !== 'suggestions' && <LoadMore hasMore={!!list.hasNextPage} loading={list.isFetchingNextPage} onLoad={() => void list.fetchNextPage()} />}
        </div>
      </div>
    </div>
  );
}
