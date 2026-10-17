import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Ban, Bell, BellRing, CalendarDays, Ellipsis, Flag, Globe, Link2, ListPlus, Lock, MapPin, MessageCircle, PenLine, ShieldCheck, Smile, Star, UserCheck, UserPlus, Users, VolumeX } from 'lucide-react';
import type { ChatSummary, Post, Story, UserProfile, UserSummary } from '@omni/shared';
import { api, errorMessage } from '../../shared/api/client';
import { flatPages, qk, queryClient, useCursorList } from '../../shared/api/query';
import { getIdentity, registerDevice } from '../../shared/crypto/e2e';
import { useMe } from '../../shared/stores/session';
import { toast, useCrumb } from '../../shared/stores/ui';
import { compactNumber, lastSeen, plural } from '../../shared/lib/format';
import { Avatar, Button, ButtonLink, confirm, EmptyState, ErrorState, ListSkeleton, Loading, LoadMore, Menu, PageHeader, ReportDialog, RichText, TabLinks, useMenu, UserRow, Verified } from '../../shared/ui';
import { PostCard } from '../posts/PostCard';
import { PhotoGrid } from '../photos';
import { VideoCard } from '../video/components';
import { FollowButton } from '../feed';
import { HighlightsRow, StoryViewer } from '../stories';
import { ListPickerDialog } from '../social/dialogs';
import { StatusDialog } from './extras';
import './profile.css';

const TABS = [
  { id: 'posts', label: 'Публикации' },
  { id: 'photos', label: 'Фото' },
  { id: 'videos', label: 'Видео' },
  { id: 'shorts', label: 'Клипы' },
  { id: 'likes', label: 'Лайки' },
] as const;

function ProfileContent({ profile, tab }: { profile: UserProfile; tab: string }) {
  const apiTab = tab === 'photos' ? 'photo' : tab === 'videos' ? 'video' : tab === 'shorts' ? 'short' : tab === 'likes' ? 'likes' : 'posts';
  const list = useCursorList<Post>(qk.userPosts(profile.id, apiTab), `/users/${profile.id}/posts?tab=${apiTab}`, { limit: 24 });
  const items = flatPages(list.data);
  if (!profile.canViewContent) {
    return <EmptyState icon={<Lock size={28} />} title="Это закрытый профиль" text="Подпишитесь, чтобы видеть публикации. Автор должен одобрить заявку." />;
  }
  if (list.isLoading) return <ListSkeleton rows={4} />;
  if (!items.length) return <EmptyState title={tab === 'likes' ? 'Лайков пока нет' : 'Здесь пока пусто'} />;
  return (
    <>
      {apiTab === 'photo' ? (
        <PhotoGrid posts={items} />
      ) : apiTab === 'video' || apiTab === 'short' ? (
        <div className="video-grid" style={{ padding: 16, gridTemplateColumns: apiTab === 'short' ? 'repeat(auto-fill, minmax(150px, 1fr))' : undefined }}>
          {items.map((p) => (
            <VideoCard key={p.id} post={p} />
          ))}
        </div>
      ) : (
        items.map((p) => <PostCard key={p.id} post={p} />)
      )}
      <LoadMore hasMore={!!list.hasNextPage} loading={list.isFetchingNextPage} onLoad={() => void list.fetchNextPage()} />
    </>
  );
}

export function ProfilePage() {
  const { username: param, tab = 'posts' } = useParams();
  const me = useMe();
  const navigate = useNavigate();
  const username = param ?? me.username;
  const isMe = username === me.username;
  const menu = useMenu();
  const [dialog, setDialog] = useState<'report' | 'lists' | 'status' | null>(null);
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

  if (q.isLoading) return <Loading />;
  if (q.error || !p) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const rel = p.relationship;
  const base = isMe ? '/profile' : `/u/${p.username}`;

  return (
    <div className="scroll">
      <div className="profile">
        <div className="profile__banner" style={p.bannerUrl ? { backgroundImage: `url("${p.bannerUrl}")` } : undefined} />
        <div className="profile__card">
        <div className="profile__head">
          <span className="profile__avatar-wrap">
            {p.storyRing ? (
              <button type="button" onClick={() => void openStories()} aria-label="Смотреть истории" style={{ borderRadius: '50%' }}>
                <Avatar src={p.avatarUrl} name={p.displayName} id={p.id} size={120} className="profile__avatar" online={p.presence?.online} ring={p.storyRing} />
              </button>
            ) : (
              <Avatar src={p.avatarUrl} name={p.displayName} id={p.id} size={120} className="profile__avatar" online={p.presence?.online} />
            )}
          </span>
          <div className="profile__actions">
            {isMe ? (
              <ButtonLink to="/settings/account/profile" variant="secondary" pill icon={<PenLine size={16} />}>
                Редактировать
              </ButtonLink>
            ) : rel?.blocked ? (
              <Button variant="danger" pill onClick={() => void api.del(`/users/${p.id}/block`).then(refresh)}>
                Разблокировать
              </Button>
            ) : (
              <>
                <Button variant="secondary" pill icon={<MessageCircle size={16} />} disabled={!p.canMessage} loading={message.isPending} onClick={() => message.mutate()}>
                  Написать
                </Button>
                {p.canViewContent && (rel?.following || p.subscribed) && (
                  <button
                    type="button"
                    className={`icon-btn profile__bell${p.subscribed ? ' profile__bell--on' : ''}`}
                    aria-label={p.subscribed ? 'Не уведомлять о публикациях' : 'Уведомлять о новых публикациях'}
                    title={p.subscribed ? 'Уведомления включены' : 'Уведомлять о новых публикациях'}
                    aria-pressed={p.subscribed}
                    onClick={() => bell.mutate(!p.subscribed)}
                  >
                    {p.subscribed ? <BellRing size={19} /> : <Bell size={19} />}
                  </button>
                )}
                {rel?.following ? (
                  <Button variant="secondary" pill icon={<UserCheck size={16} />} onClick={() => follow.mutate(false)}>
                    Вы подписаны
                  </Button>
                ) : rel?.requested ? (
                  <Button variant="secondary" pill onClick={() => follow.mutate(false)}>
                    Заявка отправлена
                  </Button>
                ) : (
                  <Button pill icon={<UserPlus size={16} />} loading={follow.isPending} onClick={() => follow.mutate(true)} disabled={rel?.blockedBy}>
                    {rel?.followedBy ? 'Подписаться в ответ' : 'Подписаться'}
                  </Button>
                )}
              </>
            )}
            <button className="icon-btn" style={{ border: '1px solid var(--border)', width: 42, height: 42 }} aria-label="Ещё" onClick={(e) => menu.openFromEvent(e)}>
              <Ellipsis size={20} />
            </button>
          </div>
        </div>
        <div className="profile__info">
          <h1 className="profile__name">
            <span className="ellipsis">{p.displayName}</span> {p.verified && <Verified size={24} />} {p.isPrivate && <Lock size={20} className="faint" />}
          </h1>
          {(p.status || isMe) && (
            <button type="button" className="profile__status" onClick={() => isMe && setDialog('status')} disabled={!isMe} title={p.status?.until ? `До ${new Date(p.status.until).toLocaleString('ru-RU')}` : undefined}>
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
          <div className="muted">
            @{p.username}
            {rel?.followedBy && <span className="tag" style={{ marginLeft: 8 }}>Подписан(а) на вас</span>}
          </div>
          {p.bio && <RichText text={p.bio} />}
          <div className="profile__meta">
            {p.location && (
              <span>
                <MapPin size={15} /> {p.location}
              </span>
            )}
            {p.website && (
              <a href={p.website} target="_blank" rel="noopener noreferrer nofollow">
                <Globe size={15} /> {p.website.replace(/^https?:\/\//, '')}
              </a>
            )}
            {p.links.map((l) => (
              <a key={l.url} href={l.url} target="_blank" rel="noopener noreferrer nofollow ugc">
                <Link2 size={15} /> {l.title}
              </a>
            ))}
            <span>
              <CalendarDays size={15} /> С нами с {new Date(p.createdAt).toLocaleDateString('ru', { month: 'long', year: 'numeric' })}
            </span>
            {!isMe && p.presence && <span>{lastSeen(p.presence)}</span>}
          </div>
          <div className="profile__stats">
            <span className="profile__stat">
              <b>{compactNumber(p.stats.posts)}</b> {plural(p.stats.posts, 'публикация', 'публикации', 'публикаций')}
            </span>
            <Link className="profile__stat" to={isMe ? '/contacts/followers' : `/u/${p.username}/followers`}>
              <b>{compactNumber(p.stats.followers)}</b> {plural(p.stats.followers, 'подписчик', 'подписчика', 'подписчиков')}
            </Link>
            <Link className="profile__stat" to={isMe ? '/contacts/following' : `/u/${p.username}/following`}>
              <b>{compactNumber(p.stats.following)}</b> {plural(p.stats.following, 'подписка', 'подписки', 'подписок')}
            </Link>
          </div>
          {p.mutualFollowers.count > 0 && (
            <div className="profile__mutuals">
              <span className="profile__mutuals-avatars">
                {p.mutualFollowers.sample.map((u) => (
                  <Avatar key={u.id} src={u.avatarUrl} name={u.displayName} id={u.id} size={24} />
                ))}
              </span>
              <span>
                Подписаны {p.mutualFollowers.sample.map((u) => u.displayName.split(' ')[0]).join(', ')}
                {p.mutualFollowers.count > p.mutualFollowers.sample.length && ` и ещё ${p.mutualFollowers.count - p.mutualFollowers.sample.length}`}
              </span>
            </div>
          )}
          {p.canViewContent && (
            <div style={{ marginTop: 14 }}>
              <HighlightsRow userId={p.id} own={isMe} />
            </div>
          )}
        </div>
        </div>
        <div className="profile__tabs">
          <TabLinks tabs={TABS.filter((t) => t.id !== 'likes' || isMe).map((t) => ({ to: t.id === 'posts' ? base : `${base}/${t.id}`, label: t.label }))} />
        </div>
        <div className="profile__content">
          <ProfileContent profile={p} tab={tab} />
        </div>
      </div>
      <Menu
        anchor={menu.anchor}
        onClose={menu.close}
        items={[
          { label: 'Скопировать ссылку', icon: <Link2 size={18} />, onClick: () => void navigator.clipboard.writeText(`${location.origin}/u/${p.username}`).then(() => toast('Ссылка скопирована')) },
          { label: 'Секретный чат', icon: <ShieldCheck size={18} />, hidden: isMe || !p.canMessage, onClick: () => secretChat.mutate() },
          { label: 'Добавить в список…', icon: <ListPlus size={18} />, hidden: isMe, onClick: () => setDialog('lists') },
          {
            label: p.closeFriend ? 'Убрать из близких друзей' : 'В близкие друзья',
            icon: <Star size={18} />,
            hidden: isMe || !!rel?.blocked,
            onClick: () => closeFriend.mutate(!p.closeFriend),
          },
          { label: 'Статус', icon: <Smile size={18} />, hidden: !isMe, onClick: () => setDialog('status') },
          { label: 'Архив историй', icon: <Star size={18} />, hidden: !isMe, onClick: () => navigate('/stories/archive') },
          {
            label: rel?.muted ? 'Показывать публикации' : 'Скрыть публикации',
            icon: <VolumeX size={18} />,
            hidden: isMe,
            onClick: () => void (rel?.muted ? api.del(`/users/${p.id}/mute`) : api.post(`/users/${p.id}/mute`)).then(refresh),
          },
          { label: 'Пожаловаться', icon: <Flag size={18} />, hidden: isMe, onClick: () => setDialog('report') },
          {
            label: rel?.blocked ? 'Разблокировать' : 'Заблокировать',
            icon: <Ban size={18} />,
            danger: true,
            hidden: isMe,
            onClick: async () => {
              if (rel?.blocked) return void api.del(`/users/${p.id}/block`).then(refresh);
              if (await confirm({ title: `Заблокировать ${p.displayName}?`, text: 'Пользователь не сможет писать вам, видеть ваши публикации и подписываться.', danger: true, confirmLabel: 'Заблокировать' })) {
                await api.post(`/users/${p.id}/block`);
                refresh();
              }
            },
          },
        ]}
      />
      {dialog === 'report' && <ReportDialog open entityType="user" entityId={p.id} onClose={() => setDialog(null)} />}
      {dialog === 'lists' && <ListPickerDialog user={p} onClose={() => setDialog(null)} />}
      {dialog === 'status' && <StatusDialog onClose={() => setDialog(null)} />}
      {stories && <StoryViewer groups={[{ author: p, stories, hasUnseen: stories.some((s) => !s.viewed) }]} onClose={() => (setStories(null), refresh())} />}
    </div>
  );
}

/** Подписчики / подписки (свои — в разделе «Контакты», чужие — со страницы профиля). */
export function FollowListPage({ which }: { which: 'followers' | 'following' | 'suggestions' }) {
  const me = useMe();
  const navigate = useNavigate();
  const { username } = useParams();
  const target = useQuery({ queryKey: qk.user(username ?? me.username), queryFn: () => api.get<UserProfile>(`/users/${username ?? me.username}`), enabled: which !== 'suggestions' });
  const id = target.data?.id;
  const list = useCursorList<UserSummary>(['follow-list', id, which], `/users/${id}/${which}`, { enabled: !!id && which !== 'suggestions' });
  const suggestions = useQuery({ queryKey: ['suggestions'], queryFn: () => api.get<{ items: UserSummary[] }>('/users/suggestions'), enabled: which === 'suggestions' });
  const message = async (u: UserSummary) => {
    try {
      const c = await api.post<ChatSummary>('/chats/direct', { userId: u.id });
      navigate(`/chats/${c.id}`);
    } catch (e) {
      toast({ text: errorMessage(e), kind: 'error' });
    }
  };
  const items = which === 'suggestions' ? (suggestions.data?.items ?? []) : flatPages(list.data);
  const title = which === 'followers' ? 'Подписчики' : which === 'following' ? 'Подписки' : 'Возможно, вы знакомы';
  return (
    <div className="scroll">
      <div className="page">
        <PageHeader title={title} subtitle={username && username !== me.username ? `@${username}` : undefined} icon={<Users size={22} />} />
        {(list.isLoading || suggestions.isLoading) && <ListSkeleton />}
        {!list.isLoading && !suggestions.isLoading && items.length === 0 && <EmptyState icon={<Users size={28} />} title="Список пуст" />}
        <div className="card">
          {items.map((u) => (
            <UserRow
              key={u.id}
              user={u}
              action={
                which === 'suggestions' ? (
                  <FollowButton user={u} />
                ) : (
                  <Button variant="secondary" size="sm" icon={<MessageCircle size={16} />} onClick={() => void message(u)}>
                    Написать
                  </Button>
                )
              }
            />
          ))}
        </div>
        {which !== 'suggestions' && <LoadMore hasMore={!!list.hasNextPage} loading={list.isFetchingNextPage} onLoad={() => void list.fetchNextPage()} />}
      </div>
    </div>
  );
}
