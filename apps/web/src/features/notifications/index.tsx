import { useEffect } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { AtSign, Bell, Briefcase, Cake, CheckCheck, Heart, MessageSquare, Repeat2, Shield, UserCheck, UserPlus, Users } from 'lucide-react';
import type { AppNotification, ChatSummary, NotificationType, UserSummary } from '@omni/shared';
import { api } from '../../shared/api/client';
import { flatPages, qk, queryClient, useCursorList } from '../../shared/api/query';
import { useSession } from '../../shared/stores/session';
import { cn, timeAgo } from '../../shared/lib/format';
import { Avatar, Button, EmptyState, ListSkeleton, LoadMore, PageHeader, TabLinks, UserRow } from '../../shared/ui';
import { InviteCard } from '../spaces';
import { useMyInvites } from '../spaces/api';

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

const ICON: Record<NotificationType, React.ReactNode> = {
  follow: <UserPlus size={16} />,
  follow_request: <UserPlus size={16} />,
  follow_accepted: <UserCheck size={16} />,
  like: <Heart size={16} />,
  comment: <MessageSquare size={16} />,
  reply: <MessageSquare size={16} />,
  mention: <AtSign size={16} />,
  repost: <Repeat2 size={16} />,
  community_join: <Users size={16} />,
  new_post: <Bell size={16} />,
  story_reaction: <Heart size={16} />,
  space_invite: <Briefcase size={16} />,
  security: <Shield size={16} />,
  birthday: <Cake size={16} />,
};

function NotificationRow({ n }: { n: AppNotification }) {
  const navigate = useNavigate();
  // Приглашение в компанию или сообщество — с кнопками «Принять» и «Отклонить», пока не ответили
  const invite = useMyInvites().data?.items.find((i) => n.type === 'space_invite' && i.id === n.entityId);
  const row = (
    <button
      className="list-item"
      style={{ alignItems: 'flex-start', background: n.readAt ? undefined : 'var(--accent-soft)' }}
      onClick={() => n.link && navigate(n.link)}
    >
      <span style={{ position: 'relative' }}>
        {n.actor ? (
          <Avatar src={n.actor.avatarUrl} name={n.actor.displayName} id={n.actor.id} size={44} />
        ) : (
          <span className="list-item__icon" style={{ width: 44, height: 44, borderRadius: 22, background: 'var(--danger-soft)', color: 'var(--danger)' }}>
            <Shield size={20} />
          </span>
        )}
        <span
          className="badge"
          style={{ position: 'absolute', right: -4, bottom: -4, width: 22, height: 22, padding: 0, background: n.type === 'like' ? '#f91880' : n.type === 'security' ? 'var(--danger)' : n.type === 'birthday' ? 'var(--warning)' : 'var(--accent)' }}
        >
          {ICON[n.type]}
        </span>
      </span>
      <span className="list-item__body">
        <span>
          {n.actor && <b>{n.actor.displayName} </b>}
          {n.type === 'security' ? <b>Безопасность</b> : TEXT[n.type]}
        </span>
        {n.preview && <span className="list-item__sub clamp-2" style={{ display: 'block' }}>{n.preview}</span>}
        <span className="xs faint">{timeAgo(n.createdAt)}</span>

      </span>
      {!n.readAt && <span className="badge badge--dot" style={{ marginTop: 8 }} />}
    </button>
  );
  // День рождения: кнопка «Поздравить» открывает личный чат
  if (n.type === 'birthday' && n.actor) {
    const actor = n.actor;
    return (
      <div className="notif-invite">
        {row}
        <div style={{ padding: '0 14px 14px 72px' }}>
          <Button
            variant="soft"
            size="sm"
            icon={<Cake size={15} />}
            onClick={async () => {
              const chat = await api.post<ChatSummary>('/chats/direct', { userId: actor.id });
              navigate(`/chats/${chat.id}`);
            }}
          >
            Поздравить
          </Button>
        </div>
      </div>
    );
  }
  if (!invite) return row;
  return (
    <div className="notif-invite">
      {row}
      <div style={{ padding: '0 14px 14px 72px' }}>
        <InviteCard inv={invite} compact />
      </div>
    </div>
  );
}

export function NotificationsPage() {
  const { filter = 'all' } = useParams();
  const list = useCursorList<AppNotification>(qk.notifications(filter), `/notifications?filter=${filter}`);
  const items = flatPages(list.data);
  const counters = useSession((s) => s.me?.counters);
  const readAll = useMutation({
    mutationFn: () => api.post('/notifications/read', {}),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });
  // Открыли — значит прочитали (с небольшой задержкой, чтобы успеть увидеть подсветку)
  useEffect(() => {
    if (!items.some((n) => !n.readAt)) return;
    const t = setTimeout(() => void api.post('/notifications/read', { ids: items.filter((n) => !n.readAt).map((n) => n.id) }), 2500);
    return () => clearTimeout(t);
  }, [items]);
  return (
    <div className="scroll">
      <div className="page">
        <PageHeader
          title="Уведомления"
          icon={<Bell size={22} />}
          actions={
            <Button variant="ghost" size="sm" icon={<CheckCheck size={16} />} onClick={() => readAll.mutate()}>
              Прочитать все
            </Button>
          }
        />
        <TabLinks
          tabs={[
            { to: '/notifications', label: 'Все' },
            { to: '/notifications/mentions', label: 'Упоминания' },
            { to: '/notifications/replies', label: 'Ответы' },
            { to: '/notifications/likes', label: 'Отметки' },
            { to: '/notifications/posts', label: 'Новое у авторов' },
            { to: '/notifications/follows', label: 'Подписчики' },
            { to: '/notifications/requests', label: 'Заявки', count: counters?.followRequests },
            { to: '/notifications/security', label: 'Безопасность' },
          ]}
        />
        <div className="card" style={{ marginTop: 16, overflow: 'hidden' }}>
          {list.isLoading ? <ListSkeleton /> : items.length === 0 ? <EmptyState icon={<Bell size={28} />} title="Уведомлений нет" text="Здесь появятся лайки, ответы, упоминания и подписчики" /> : items.map((n) => <NotificationRow key={n.id} n={n} />)}
        </div>
        <LoadMore hasMore={!!list.hasNextPage} loading={list.isFetchingNextPage} onLoad={() => void list.fetchNextPage()} />
      </div>
    </div>
  );
}

export function FollowRequestsPage() {
  const q = useQuery({ queryKey: ['follow-requests'], queryFn: () => api.get<{ items: UserSummary[] }>('/me/follow-requests') });
  const answer = async (u: UserSummary, accept: boolean) => {
    await api.post(`/me/follow-requests/${u.id}/${accept ? 'accept' : 'decline'}`);
    void q.refetch();
  };
  return (
    <div className="scroll">
      <div className="page">
        <PageHeader title="Заявки на подписку" subtitle="У вас закрытый профиль — подтвердите, кто может видеть ваши публикации" icon={<UserCheck size={22} />} />
        <TabLinks tabs={[{ to: '/notifications', label: '← Все уведомления' }, { to: '/notifications/requests', label: 'Заявки' }]} />
        <div className="card" style={{ marginTop: 16 }}>
          {q.data?.items.length === 0 && (
            <EmptyState
              icon={<UserCheck size={28} />}
              title="Новых заявок нет"
              text={
                <>
                  Заявки появляются, если включён <Link to="/settings/privacy/profile">закрытый профиль</Link>
                </>
              }
            />
          )}
          {q.data?.items.map((u) => (
            <UserRow
              key={u.id}
              user={u}
              action={
                <div className={cn('row')}>
                  <Button size="sm" onClick={() => void answer(u, true)}>
                    Принять
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => void answer(u, false)}>
                    Отклонить
                  </Button>
                </div>
              }
            />
          ))}
        </div>
      </div>
    </div>
  );
}
