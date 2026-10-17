import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { useMutation } from '@tanstack/react-query';
import { Archive, ArchiveRestore, Bell, BellOff, Compass, FolderPlus, Lock, Megaphone, Menu as MenuIcon, PanelLeftOpen, Pin, PinOff, Search, SlidersHorizontal, SquarePen, Trash2, Users, X } from 'lucide-react';
import type { ChatSummary } from '@omni/shared';
import { api, errorMessage } from '../../shared/api/client';
import { flatPages, qk, queryClient, useCursorList } from '../../shared/api/query';
import { realtime } from '../../shared/realtime/socket';
import { useRealtime } from '../../shared/stores/realtime';
import { useMe } from '../../shared/stores/session';
import { toast, useUi } from '../../shared/stores/ui';
import { activityLabel, chatTime, cn, messageLabel } from '../../shared/lib/format';
import { Avatar, confirm, EmptyState, IconButton, ListSkeleton, LoadMore, Menu, useMenu, Verified } from '../../shared/ui';
import { patchChat, forgetChat } from './cache';
import { AddToFolderDialog, useFolders } from './folders';
import { StoriesBar } from '../stories';

export const FOLDERS: { id: string; label: string }[] = [
  { id: 'all', label: 'Все' },
  { id: 'unread', label: 'Непрочитанные' },
  { id: 'direct', label: 'Личные' },
  { id: 'groups', label: 'Группы' },
  { id: 'secret', label: 'Секретные' },
  { id: 'archived', label: 'Архив' },
];

export function previewText(chat: ChatSummary, myId: string): React.ReactNode {
  const m = chat.lastMessage;
  if (!m) return chat.type === 'secret' ? 'Секретный чат создан' : 'Нет сообщений';
  const who = chat.type === 'channel' ? null : m.senderId === myId ? 'Вы' : chat.type === 'group' ? m.senderName?.split(' ')[0] : null;
  const body = m.kind === 'system' ? `${m.senderName ?? ''} ${m.text ?? ''}` : messageLabel(m.kind, m.text);
  return (
    <>
      {who && m.kind !== 'system' && <b>{who}: </b>}
      {body}
    </>
  );
}

function ChatItem({ chat, active, myId, base }: { chat: ChatSummary; active: boolean; myId: string; base: string }) {
  const menu = useMenu();
  const navigate = useNavigate();
  const typing = useRealtime((s) => s.typing[chat.id]);
  const presence = useRealtime((s) => (chat.peer ? s.presence[chat.peer.id] : undefined));
  const muted = !!chat.mutedUntil;
  const [toFolder, setToFolder] = useState(false);

  const prefs = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.patch<ChatSummary>(`/chats/${chat.id}/prefs`, body),
    onSuccess: (c) => {
      patchChat(chat.id, () => c);
      void queryClient.invalidateQueries({ queryKey: qk.chatsAll });
    },
    onError: (e) => toast({ text: errorMessage(e), kind: 'error' }),
  });

  const remove = async () => {
    const isOwner = chat.role === 'owner' && (chat.type === 'group' || chat.type === 'channel');
    const ok = await confirm({
      title: chat.type === 'secret' ? 'Удалить секретный чат?' : isOwner ? `Удалить «${chat.title}» для всех?` : chat.type === 'group' || chat.type === 'channel' ? `Покинуть «${chat.title}»?` : 'Удалить чат?',
      text: chat.type === 'secret' ? 'Переписка будет удалена у обоих участников.' : isOwner ? 'Все участники потеряют доступ к переписке.' : 'История будет очищена только у вас.',
      danger: true,
      confirmLabel: isOwner || chat.type !== 'group' ? 'Удалить' : 'Покинуть',
    });
    if (!ok) return;
    try {
      await api.del(`/chats/${chat.id}`);
      forgetChat(chat.id);
      if (active) navigate(base);
    } catch (e) {
      toast({ text: errorMessage(e), kind: 'error' });
    }
  };

  const TypeIcon = chat.type === 'secret' ? Lock : chat.type === 'channel' ? Megaphone : chat.type === 'group' ? Users : null;
  const typingNames = (typing ?? []).filter((t) => t.userId !== myId);

  return (
    <>
      <Link
        to={`${base}/${chat.id}`}
        className={cn('chat-item', active && 'chat-item--active', chat.unreadCount > 0 && !muted && 'chat-item--unread')}
        onContextMenu={(e) => menu.openFromEvent(e)}
        aria-current={active ? 'page' : undefined}
      >
        <Avatar src={chat.avatarUrl} name={chat.title} id={chat.peer?.id ?? chat.id} size={52} online={presence?.online} />
        <span className="chat-item__body">
          <span className="chat-item__top">
            <span className="chat-item__title">
              {TypeIcon && <TypeIcon size={14} style={{ color: chat.type === 'secret' ? 'var(--success)' : undefined, flex: '0 0 auto' }} />}
              <span className="ellipsis">{chat.title}</span>
              {chat.peer?.verified && <Verified size={14} />}
              {muted && <BellOff size={13} className="faint" />}
            </span>
            {chat.lastMessage && <span className="chat-item__time">{chatTime(chat.lastMessage.createdAt)}</span>}
          </span>
          <span className="chat-item__bottom">
            <span className="chat-item__preview">
              {typingNames.length ? (
                <span className="chat-item__typing">{activityLabel(typingNames[0]!.activity, chat.type === 'group' ? typingNames[0]!.name.split(' ')[0] : undefined)}</span>
              ) : (
                previewText(chat, myId)
              )}
            </span>
            <span className="chat-item__icons">
              {chat.pinned && !chat.unreadCount && <Pin size={14} />}
              {chat.unreadMentions > 0 && <span className="badge badge--mention" title="Вас упомянули">@</span>}
              {chat.unreadCount > 0 && <span className={cn('badge', muted && 'badge--muted')}>{chat.unreadCount > 999 ? '999+' : chat.unreadCount}</span>}
            </span>
          </span>
        </span>
      </Link>
      <Menu
        anchor={menu.anchor}
        onClose={menu.close}
        items={[
          { label: chat.pinned ? 'Открепить' : 'Закрепить', icon: chat.pinned ? <PinOff size={18} /> : <Pin size={18} />, onClick: () => prefs.mutate({ pinned: !chat.pinned }) },
          {
            label: muted ? 'Включить уведомления' : 'Без звука на 8 часов',
            icon: muted ? <Bell size={18} /> : <BellOff size={18} />,
            onClick: () => prefs.mutate({ mutedUntil: muted ? null : new Date(Date.now() + 8 * 3600_000).toISOString() }),
          },
          {
            label: chat.archived ? 'Вернуть из архива' : 'В архив',
            icon: chat.archived ? <ArchiveRestore size={18} /> : <Archive size={18} />,
            onClick: () => prefs.mutate({ archived: !chat.archived }),
          },
          { label: 'Добавить в папку…', icon: <FolderPlus size={18} />, onClick: () => setToFolder(true) },
          'separator',
          { label: chat.type === 'group' || chat.type === 'channel' ? 'Покинуть' : 'Удалить чат', icon: <Trash2 size={18} />, danger: true, onClick: () => void remove() },
        ]}
      />
      {toFolder && <AddToFolderDialog chat={chat} onClose={() => setToFolder(false)} />}
    </>
  );
}

export function ChatList({
  folder,
  activeId,
  onFolder,
  variant = 'chats',
}: {
  folder: string;
  activeId: string | null;
  onFolder: (f: string) => void;
  /** «Каналы» — отдельный раздел со своим списком, без папок мессенджера */
  variant?: 'chats' | 'channels';
}) {
  const channels = variant === 'channels';
  const base = channels ? '/channels' : '/chats';
  const createPath = channels ? '/channels/new' : '/chats/new/direct';
  const onDiscover = useLocation().pathname.startsWith('/channels/discover');
  const me = useMe();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const status = useRealtime((s) => s.status);
  const setDrawer = useUi((s) => s.setDrawer);
  const setNavOpen = useUi((s) => s.setNavOpen);
  const setPalette = useUi((s) => s.setPalette);
  const list = useCursorList<ChatSummary>(qk.chats(folder), `/chats?folder=${folder}`);
  const custom = useFolders().data?.items ?? [];
  const chats = flatPages(list.data);
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? chats.filter((c) => c.title.toLowerCase().includes(s) || c.handle?.toLowerCase().includes(s)) : chats;
  }, [chats, q]);

  // Подписываемся на «в сети» собеседников из списка
  const peerIds = useMemo(() => chats.map((c) => c.peer?.id).filter((v): v is string => !!v).sort().join(','), [chats]);
  useEffect(() => (peerIds ? realtime.retainPresence(peerIds.split(',')) : undefined), [peerIds]);

  return (
    <div className="chats__list">
      <div className="chats__head">
        <div className="chats__title-row">
          <span className="mobile-only">
            <IconButton label="Меню" onClick={() => setDrawer(true)}>
              <MenuIcon size={22} />
            </IconButton>
          </span>
          <span className="desktop-only shell-nav-toggle">
            <IconButton label="Разделы мессенджера" onClick={() => setNavOpen(true)}>
              <PanelLeftOpen size={20} />
            </IconButton>
          </span>
          <h1 className="chats__title">{status === 'offline' ? 'Соединение…' : channels ? 'Каналы' : 'Чаты'}</h1>
          <IconButton label="Поиск и навигация (Ctrl+K)" onClick={() => setPalette(true)}>
            <Search size={20} />
          </IconButton>
          <IconButton label={channels ? 'Создать канал' : 'Новый чат'} onClick={() => navigate(createPath)}>
            <SquarePen size={20} />
          </IconButton>
        </div>
        {!q && !channels && <StoriesBar compact hideEmpty />}
        <div className="input-group">
          <Search size={16} className="input-group__icon" />
          <input className="input" placeholder={channels ? 'Поиск по подпискам' : 'Поиск по чатам'} value={q} onChange={(e) => setQ(e.target.value)} />
          {q && (
            <button className="icon-btn icon-btn--sm input-group__action" onClick={() => setQ('')} aria-label="Очистить">
              <X size={16} />
            </button>
          )}
        </div>
        {channels ? (
          <div className="chips" role="tablist" aria-label="Каналы">
            <button role="tab" aria-selected={!onDiscover} className={cn('chip', !onDiscover && 'chip--active')} onClick={() => navigate('/channels')}>
              Мои подписки
            </button>
            <button role="tab" aria-selected={onDiscover} className={cn('chip', onDiscover && 'chip--active')} onClick={() => navigate('/channels/discover')}>
              <Compass size={14} /> Обзор
            </button>
          </div>
        ) : (
        <div className="chips" role="tablist" aria-label="Папки">
          {FOLDERS.slice(0, 1).map((f) => (
            <button key={f.id} role="tab" aria-selected={folder === f.id} className={cn('chip', folder === f.id && 'chip--active')} onClick={() => onFolder(f.id)}>
              {f.label}
            </button>
          ))}
          {/* Свои папки — сразу после «Все», как в Telegram */}
          {custom.map((f) => (
            <button key={f.id} role="tab" aria-selected={folder === f.id} className={cn('chip', folder === f.id && 'chip--active')} onClick={() => onFolder(f.id)}>
              <span aria-hidden>{f.emoji}</span> {f.name}
              {f.unreadCount > 0 && <span className="badge">{f.unreadCount > 99 ? '99+' : f.unreadCount}</span>}
            </button>
          ))}
          {FOLDERS.slice(1).map((f) => (
            <button key={f.id} role="tab" aria-selected={folder === f.id} className={cn('chip', folder === f.id && 'chip--active')} onClick={() => onFolder(f.id)}>
              {f.label}
            </button>
          ))}
          <button className="chip chip--ghost" onClick={() => navigate('/chats/folders')} aria-label="Настроить папки" title="Настроить папки">
            <SlidersHorizontal size={14} />
          </button>
        </div>
        )}
      </div>
      <div className="chats__scroll">
        {list.isLoading ? (
          <ListSkeleton rows={8} avatar={52} />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={channels ? <Megaphone size={28} /> : <SquarePen size={28} />}
            title={q ? 'Ничего не найдено' : channels ? 'Нет подписок' : folder === 'archived' ? 'Архив пуст' : 'Здесь пока пусто'}
            text={q ? 'Попробуйте другой запрос или глобальный поиск (Ctrl+K)' : channels ? 'Найдите интересные каналы в обзоре или создайте свой' : 'Начните новый разговор — кнопка внизу'}
          />
        ) : (
          filtered.map((c) => <ChatItem key={c.id} chat={c} active={c.id === activeId} myId={me.id} base={base} />)
        )}
        <LoadMore hasMore={!!list.hasNextPage} loading={list.isFetchingNextPage} onLoad={() => void list.fetchNextPage()} />
      </div>
      <Link to={createPath} className="chat-fab" aria-label={channels ? 'Создать канал' : 'Новый чат'} title={channels ? 'Создать канал' : 'Новый чат'}>
        <SquarePen size={24} />
      </Link>
    </div>
  );
}
