import { useEffect, useState } from 'react';
import { Navigate, Outlet, useLocation, useNavigate, useParams } from 'react-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Compass, Lock, Megaphone, MessageCircle, Plus, Search, ShieldCheck, Users } from 'lucide-react';
import type { ChatSummary } from '@omni/shared';
import { api, errorMessage } from '../../shared/api/client';
import { qk, queryClient } from '../../shared/api/query';
import { toast } from '../../shared/stores/ui';
import { useDebounced } from '../../shared/hooks';
import { members } from '../../shared/lib/format';
import { Avatar, Button, ButtonLink, EmptyState, ListSkeleton, Loading, PageHeader } from '../../shared/ui';
import { cn } from '../../shared/lib/format';
import { useBareLayout } from '../../app/layout/Shell';
import { usePrefs } from '../../shared/stores/prefs';
import { ChatInfo } from './ChatInfo';
import { ChatList } from './ChatList';
import { DetailHead } from './DetailHead';
export { DetailHead };
import { useChatUi } from './store';
import { ChatWallpaper } from './wallpapers';
import './chats.css';

let lastFolder = 'all';

export function ChatsLayout({ variant = 'chats' }: { variant?: 'chats' | 'channels' }) {
  const { chatId, folder: routeFolder } = useParams();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const channels = variant === 'channels';
  const infoOpen = useChatUi((s) => s.infoOpen);
  const setInfo = useChatUi((s) => s.setInfo);
  const msgScale = usePrefs((s) => s.messageScale ?? 100);
  if (routeFolder && !channels) lastFolder = routeFolder;
  const folder = channels ? 'channels' : (routeFolder ?? (chatId ? lastFolder : pathname === '/chats' ? 'all' : lastFolder));
  const hasDetail = !!chatId || /^\/chats\/(new|discover|saved|folders)/.test(pathname) || /^\/channels\/(new|discover)/.test(pathname);
  useBareLayout(true);
  useEffect(() => {
    if (!chatId) setInfo(false);
  }, [chatId, setInfo]);

  return (
    <div className="chats-host">
      <div className={cn('chats', hasDetail && 'chats--detail', infoOpen && chatId && 'chats--info')} style={{ '--msg-scale': msgScale / 100 } as React.CSSProperties}>
        <ChatList folder={folder} variant={variant} activeId={chatId ?? null} onFolder={(f) => navigate(f === 'all' ? '/chats' : `/chats/folder/${f}`)} />
        <section className="chats__detail">
          {chatId && <ChatWallpaper chatId={chatId} />}
          <Outlet />
        </section>
        {infoOpen && chatId && <ChatInfo chatId={chatId} onClose={() => setInfo(false)} />}
      </div>
    </div>
  );
}

export function NoChannelSelected() {
  return (
    <EmptyState
      icon={<Megaphone size={30} />}
      title="Каналы"
      text="Публикации от авторов и компаний: реакции, комментарии и просмотры. Писать в канал могут владелец и назначенные им администраторы."
      action={
        <div className="row wrap center">
          <ButtonLink to="/channels/discover" icon={<Compass size={18} />}>
            Найти каналы
          </ButtonLink>
          <ButtonLink to="/channels/new" variant="secondary" icon={<Plus size={18} />}>
            Создать канал
          </ButtonLink>
        </div>
      }
    />
  );
}

export function NoChatSelected() {
  return (
    <EmptyState
      icon={<MessageCircle size={30} />}
      title="Выберите, кому написать"
      text="Личные чаты, группы и секретные переписки со сквозным шифрованием"
      action={
        <div className="row wrap center">
          <ButtonLink to="/chats/new/direct" icon={<MessageCircle size={18} />}>
            Новый чат
          </ButtonLink>
          <ButtonLink to="/chats/new/secret" variant="secondary" icon={<Lock size={18} />}>
            Секретный чат
          </ButtonLink>
        </div>
      }
    />
  );
}

/** «Избранное»: создаётся при первом открытии и сразу открывается. */
export function OpenSaved() {
  const q = useQuery({
    queryKey: ['saved-chat'],
    queryFn: () => api.post<ChatSummary>('/chats/saved'),
  });
  if (q.data) return <Navigate to={`/chats/${q.data.id}`} replace />;
  return <Loading />;
}

export function DiscoverChannels({ only }: { only?: 'channel' | 'group' }) {
  const [q, setQ] = useState('');
  const debounced = useDebounced(q.trim(), 250);
  const navigate = useNavigate();
  const list = useQuery({
    queryKey: ['discover-chats', debounced],
    queryFn: () => api.get<{ items: ChatSummary[] }>(`/chats/discover${debounced ? `?q=${encodeURIComponent(debounced)}` : ''}`),
  });
  const join = useMutation({
    mutationFn: (id: string) => api.post<ChatSummary>(`/chats/${id}/join`),
    onSuccess: (c) => {
      void queryClient.invalidateQueries({ queryKey: qk.chatsAll });
      void queryClient.invalidateQueries({ queryKey: ['discover-chats'] });
      navigate(open(c));
    },
    onError: (e) => toast({ text: errorMessage(e), kind: 'error' }),
  });
  const open = (c: ChatSummary) => `/${c.type === 'channel' ? 'channels' : 'chats'}/${c.id}`;
  const items = (list.data?.items ?? []).filter((c) => !only || c.type === only);
  const pageTitle = only === 'channel' ? 'Обзор каналов' : only === 'group' ? 'Открытые группы' : 'Открытые каналы и группы';
  return (
    <div className="chat-page">
      <DetailHead title={pageTitle} />
      <div className="scroll">
        <div className="page">
          <PageHeader
            title={pageTitle}
            subtitle={only === 'channel' ? 'Открытые каналы, на которые можно подписаться' : 'Вступить может любой — без приглашения'}
            icon={<Compass size={22} />}
          />
          <div className="input-group" style={{ marginBottom: 16 }}>
            <Search size={16} className="input-group__icon" />
            <input className="input" placeholder="Название или @ссылка" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          {list.isLoading ? (
            <ListSkeleton />
          ) : items.length === 0 ? (
            <EmptyState icon={<Users size={28} />} title="Ничего не найдено" text={q ? 'Попробуйте другое название' : 'Открытых каналов пока нет — создайте первый'} />
          ) : (
            <div className="card">
              {items.map((c) => (
                <div key={c.id} className="list-item">
                  <button className="row grow" style={{ gap: 12, textAlign: 'left' }} onClick={() => navigate(open(c))}>
                    <Avatar src={c.avatarUrl} name={c.title} id={c.id} size={48} />
                    <span className="list-item__body">
                      <span className="list-item__title row gap-1">
                        {c.title} {c.type === 'channel' && <ShieldCheck size={14} className="faint" />}
                      </span>
                      <span className="list-item__sub ellipsis" style={{ display: 'block' }}>
                        {c.handle ? `@${c.handle} · ` : ''}
                        {members(c.memberCount, c.type === 'channel' ? 'channel' : 'group')}
                      </span>
                      {c.description && <span className="list-item__sub clamp-2">{c.description}</span>}
                    </span>
                  </button>
                  {c.role ? (
                    <Button variant="secondary" size="sm" onClick={() => navigate(open(c))}>
                      Открыть
                    </Button>
                  ) : (
                    <Button size="sm" loading={join.isPending && join.variables === c.id} onClick={() => join.mutate(c.id)}>
                      {c.type === 'channel' ? 'Подписаться' : 'Вступить'}
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
