import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { AtSign, Bell, Briefcase, Cake, CheckCheck, ChevronRight, Heart, MessageCircle, Repeat2, Shield, UserCheck, UserPlus, Users } from 'lucide-react';
import type { AppNotification, ChatSummary, NotificationType, UserSummary } from '@omni/shared';
import { api, errorMessage } from '../../shared/api/client';
import { flatPages, qk, queryClient, useCursorList } from '../../shared/api/query';
import { useMe, useSession } from '../../shared/stores/session';
import { toast } from '../../shared/stores/ui';
import { cn } from '../../shared/lib/format';
import { Avatar, Button, EmptyState, ListSkeleton, LoadMore, Spinner, Verified } from '../../shared/ui';
import { InviteCard } from '../spaces';
import { useMyInvites } from '../spaces/api';
import { ChipLinks, shortAgo } from '../misc/kit';
import './notifications.css';

export const notificationText = (t: NotificationType) => TEXT[t];

const TEXT: Record<NotificationType, string> = {
  follow: 'подписался(-ась) на вас',
  follow_request: 'хочет подписаться на вас',
  follow_accepted: 'принял(а) вашу заявку',
  like: 'оценил(а) вашу публикацию',
  comment: 'прокомментировал(а)',
  reply: 'ответил(а) на ваш комментарий',
  mention: 'упомянул(а) вас',
  repost: 'сделал(а) репост',
  community_join: 'вступил(а) в ваше сообщество',
  new_post: 'опубликовал(а) новое',
  story_reaction: 'отреагировал(а) на вашу историю',
  space_invite: '',
  security: 'Безопасность',
  birthday: 'празднует день рождения',
};

/** Значок типа: иконка и цвет кружка в углу аватара */
const KIND: Record<NotificationType, { icon: React.ReactNode; tone: string }> = {
  follow: { icon: <UserPlus size={11} strokeWidth={2.6} />, tone: 'follow' },
  follow_request: { icon: <UserPlus size={11} strokeWidth={2.6} />, tone: 'follow' },
  follow_accepted: { icon: <UserCheck size={11} strokeWidth={2.6} />, tone: 'follow' },
  like: { icon: <Heart size={11} fill="currentColor" strokeWidth={0} />, tone: 'like' },
  comment: { icon: <MessageCircle size={11} fill="currentColor" strokeWidth={0} />, tone: 'comment' },
  reply: { icon: <MessageCircle size={11} fill="currentColor" strokeWidth={0} />, tone: 'comment' },
  mention: { icon: <AtSign size={11} strokeWidth={2.8} />, tone: 'mention' },
  repost: { icon: <Repeat2 size={11} strokeWidth={2.8} />, tone: 'repost' },
  community_join: { icon: <Users size={11} strokeWidth={2.6} />, tone: 'space' },
  new_post: { icon: <Bell size={11} fill="currentColor" strokeWidth={0} />, tone: 'post' },
  story_reaction: { icon: <Heart size={11} fill="currentColor" strokeWidth={0} />, tone: 'story' },
  space_invite: { icon: <Briefcase size={11} strokeWidth={2.6} />, tone: 'space' },
  security: { icon: <Shield size={11} fill="currentColor" strokeWidth={0} />, tone: 'security' },
  birthday: { icon: <Cake size={11} strokeWidth={2.6} />, tone: 'birthday' },
};

/** Группы по времени, как в Instagram */
function bucket(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const t = d.getTime();
  if (t >= startOfDay) return 'Сегодня';
  if (t >= startOfDay - 86400_000) return 'Вчера';
  if (t >= startOfDay - 6 * 86400_000) return 'На этой неделе';
  if (t >= startOfDay - 29 * 86400_000) return 'В этом месяце';
  return 'Ранее';
}

/** Мои подписки — чтобы на «подписался на вас» показать «Подписаться в ответ» или «Вы подписаны». */
export function useFollowingIds() {
  const me = useMe();
  return useQuery({
    queryKey: ['following-ids', me.id],
    queryFn: async () => new Set((await api.get<{ items: UserSummary[] }>(`/users/${me.id}/following?limit=100`)).items.map((u) => u.id)),
    staleTime: 60_000,
  });
}

function FollowBack({ user, following }: { user: UserSummary; following: boolean }) {
  const m = useMutation({
    mutationFn: () => api.post<{ status: 'accepted' | 'pending' }>(`/users/${user.id}/follow`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['following-ids'] });
      void queryClient.invalidateQueries({ queryKey: qk.user(user.username) });
    },
    onError: (e) => toast({ text: errorMessage(e), kind: 'error' }),
  });
  if (following || m.data?.status === 'accepted') return <span className="nt-btn nt-btn--ghost">Вы подписаны</span>;
  if (m.data?.status === 'pending') return <span className="nt-btn nt-btn--ghost">Заявка</span>;
  return (
    <button type="button" className="nt-btn" disabled={m.isPending} onClick={(e) => (e.stopPropagation(), m.mutate())}>
      {m.isPending ? <Spinner /> : 'Подписаться'}
    </button>
  );
}

export function NotificationRow({ n, followingIds, onOpen }: { n: AppNotification; followingIds?: Set<string>; onOpen: (to: string) => void }) {
  // Приглашение в компанию или сообщество — с кнопками «Принять» и «Отклонить», пока не ответили
  const invite = useMyInvites().data?.items.find((i) => n.type === 'space_invite' && i.id === n.entityId);
  const kind = KIND[n.type];
  const actor = n.actor;
  const greet = async () => {
    if (!actor) return;
    try {
      const chat = await api.post<ChatSummary>('/chats/direct', { userId: actor.id });
      onOpen(`/chats/${chat.id}`);
    } catch (e) {
      toast({ text: errorMessage(e), kind: 'error' });
    }
  };
  const action =
    n.type === 'birthday' && actor ? (
      <button type="button" className="nt-btn nt-btn--warm" onClick={(e) => (e.stopPropagation(), void greet())}>
        <Cake size={15} /> Поздравить
      </button>
    ) : (n.type === 'follow' || n.type === 'follow_accepted') && actor && followingIds ? (
      <FollowBack user={actor} following={followingIds.has(actor.id)} />
    ) : null;
  return (
    <div className={cn('nt-row', !n.readAt && 'nt-row--unread')}>
      <button type="button" className="nt-row__main" onClick={() => n.link && onOpen(n.link)}>
        <span className="nt-row__avatar">
          {actor ? (
            <Avatar src={actor.avatarUrl} name={actor.displayName} id={actor.id} size={48} />
          ) : (
            <span className="nt-row__system">
              <Shield size={22} />
            </span>
          )}
          <span className={`nt-kind nt-kind--${kind.tone}`}>{kind.icon}</span>
        </span>
        <span className="nt-row__body">
          <span className="nt-row__text">
            {actor && (
              <b>
                {actor.displayName}
                {actor.verified && (
                  <>
                    {' '}
                    <Verified size={13} />
                  </>
                )}{' '}
              </b>
            )}
            {n.type === 'security' ? <b>Безопасность. </b> : TEXT[n.type]}
            {n.type !== 'security' && n.preview && TEXT[n.type] ? ': ' : ''}
            {n.preview && <span className="nt-row__preview">{n.preview}</span>}
            <span className="nt-row__time"> {shortAgo(n.createdAt)}</span>
          </span>
        </span>
      </button>
      {action && <span className="nt-row__action">{action}</span>}
      {!n.readAt && !action && <span className="nt-row__dot" aria-label="Не прочитано" />}
      {invite && (
        <div className="nt-row__invite">
          <InviteCard inv={invite} compact />
        </div>
      )}
    </div>
  );
}

/** Заявки на подписку — строка над лентой уведомлений (закрытый профиль). */
function RequestsEntry({ count }: { count: number }) {
  const q = useQuery({ queryKey: ['follow-requests'], queryFn: () => api.get<{ items: UserSummary[] }>('/me/follow-requests'), enabled: count > 0 });
  if (!count) return null;
  const sample = q.data?.items.slice(0, 2) ?? [];
  return (
    <Link to="/notifications/requests" className="nt-requests">
      <span className="nt-requests__avatars">
        {sample.length ? (
          sample.map((u) => <Avatar key={u.id} src={u.avatarUrl} name={u.displayName} id={u.id} size={sample.length > 1 ? 36 : 48} />)
        ) : (
          <span className="nt-row__system">
            <UserPlus size={22} />
          </span>
        )}
      </span>
      <span className="nt-row__body">
        <b>Заявки на подписку</b>
        <span className="nt-row__preview">{sample.length ? `${sample.map((u) => u.username).join(', ')}${count > sample.length ? ` и ещё ${count - sample.length}` : ''}` : 'Одобрите или отклоните'}</span>
      </span>
      <span className="nt-requests__count">{count}</span>
      <ChevronRight size={18} className="faint" />
    </Link>
  );
}

const FILTERS = [
  { to: '/notifications', label: 'Все' },
  { to: '/notifications/mentions', label: 'Упоминания' },
  { to: '/notifications/replies', label: 'Ответы' },
  { to: '/notifications/likes', label: 'Отметки' },
  { to: '/notifications/follows', label: 'Подписчики' },
  { to: '/notifications/posts', label: 'Новое у авторов' },
  { to: '/notifications/security', label: 'Безопасность' },
];

export function NotificationsPage() {
  const { filter = 'all' } = useParams();
  const navigate = useNavigate();
  const list = useCursorList<AppNotification>(qk.notifications(filter), `/notifications?filter=${filter}`);
  const items = flatPages(list.data);
  const counters = useSession((s) => s.me?.counters);
  const following = useFollowingIds();
  const [readLocal, setReadLocal] = useState(false);
  const readAll = useMutation({
    mutationFn: () => api.post('/notifications/read', {}),
    onSuccess: () => {
      setReadLocal(true);
      void queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
  });
  // Открыли — значит прочитали (с небольшой задержкой, чтобы успеть увидеть подсветку)
  useEffect(() => {
    if (!items.some((n) => !n.readAt)) return;
    const t = setTimeout(() => void api.post('/notifications/read', { ids: items.filter((n) => !n.readAt).map((n) => n.id) }), 2500);
    return () => clearTimeout(t);
  }, [items]);
  const groups = useMemo(() => {
    const out: { title: string; items: AppNotification[] }[] = [];
    for (const n of items) {
      const title = bucket(n.createdAt);
      const last = out.at(-1);
      if (last?.title === title) last.items.push(n);
      else out.push({ title, items: [n] });
    }
    return out;
  }, [items]);
  const unread = !readLocal && items.some((n) => !n.readAt);
  return (
    <div className="pk-root">
      <div className="scroll">
        <div className="nt">
          <header className="nt-head">
            <h1>Уведомления</h1>
            <button type="button" className="pk-icon" onClick={() => readAll.mutate()} disabled={!unread || readAll.isPending} aria-label="Прочитать все" title="Прочитать все">
              <CheckCheck size={22} />
            </button>
          </header>
          <ChipLinks tabs={[...FILTERS, { to: '/notifications/requests', label: 'Заявки', count: counters?.followRequests }]} className="nt-filters" />
          {filter === 'all' && <RequestsEntry count={counters?.followRequests ?? 0} />}
          {list.isLoading ? (
            <ListSkeleton rows={8} avatar={48} />
          ) : items.length === 0 ? (
            <EmptyState icon={<Bell size={28} />} title="Уведомлений нет" text="Здесь появятся лайки, ответы, упоминания и новые подписчики" />
          ) : (
            groups.map((g) => (
              <section key={g.title} className="nt-group">
                <h2 className="nt-group__title">{g.title}</h2>
                {g.items.map((n) => (
                  <NotificationRow key={n.id} n={n} followingIds={following.data} onOpen={navigate} />
                ))}
              </section>
            ))
          )}
          <LoadMore hasMore={!!list.hasNextPage} loading={list.isFetchingNextPage} onLoad={() => void list.fetchNextPage()} />
        </div>
      </div>
    </div>
  );
}

export function FollowRequestsPage() {
  const q = useQuery({ queryKey: ['follow-requests'], queryFn: () => api.get<{ items: UserSummary[] }>('/me/follow-requests') });
  const [done, setDone] = useState<Record<string, 'accepted' | 'declined'>>({});
  const answer = async (u: UserSummary, accept: boolean) => {
    try {
      await api.post(`/me/follow-requests/${u.id}/${accept ? 'accept' : 'decline'}`);
      setDone((d) => ({ ...d, [u.id]: accept ? 'accepted' : 'declined' }));
      void queryClient.invalidateQueries({ queryKey: ['notifications'] });
    } catch (e) {
      toast({ text: errorMessage(e), kind: 'error' });
    }
  };
  return (
    <div className="pk-root">
      <div className="scroll">
        <div className="nt">
          <header className="nt-head">
            <h1>Заявки на подписку</h1>
          </header>
          <p className="nt-note">
            У вас <Link to="/settings/privacy/profile">закрытый профиль</Link> — публикации видят только одобренные подписчики.
          </p>
          {q.isLoading && <ListSkeleton rows={4} avatar={48} />}
          {q.data?.items.length === 0 && <EmptyState icon={<UserCheck size={28} />} title="Новых заявок нет" />}
          {q.data?.items.map((u) => (
            <div key={u.id} className="nt-row">
              <Link to={`/u/${u.username}`} className="nt-row__main">
                <span className="nt-row__avatar">
                  <Avatar src={u.avatarUrl} name={u.displayName} id={u.id} size={48} />
                </span>
                <span className="nt-row__body">
                  <b className="ellipsis">{u.displayName}</b>
                  <span className="nt-row__preview">@{u.username}</span>
                </span>
              </Link>
              <span className="nt-row__action nt-row__action--pair">
                {done[u.id] ? (
                  <span className="nt-btn nt-btn--ghost">{done[u.id] === 'accepted' ? 'Одобрено' : 'Отклонено'}</span>
                ) : (
                  <>
                    <Button size="sm" onClick={() => void answer(u, true)}>
                      Принять
                    </Button>
                    <Button size="sm" variant="secondary" onClick={() => void answer(u, false)}>
                      Удалить
                    </Button>
                  </>
                )}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
