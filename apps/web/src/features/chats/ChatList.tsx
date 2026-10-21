import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { useMutation } from '@tanstack/react-query';
import {
  Archive,
  ArchiveRestore,
  BarChart3,
  Bell,
  BellOff,
  Bookmark,
  Check,
  CheckCheck,
  Compass,
  Ellipsis,
  FolderPlus,
  Image,
  Lock,
  Mic,
  PanelLeftOpen,
  Phone,
  Pin,
  PinOff,
  Search,
  SlidersHorizontal,
  SquarePen,
  Trash2,
  Users,
  UsersRound,
  Video,
  X,
} from 'lucide-react';
import type { ChatSummary } from '@omni/shared';
import { api, errorMessage } from '../../shared/api/client';
import { flatPages, qk, queryClient, useCursorList } from '../../shared/api/query';
import { realtime } from '../../shared/realtime/socket';
import { useRealtime } from '../../shared/stores/realtime';
import { useMe, useSession } from '../../shared/stores/session';
import { toast, useUi } from '../../shared/stores/ui';
import { activityLabel, chatTime, cn } from '../../shared/lib/format';
import { Avatar, confirm, EmptyState, IconButton, ListSkeleton, LoadMore, Menu, useMenu, Verified } from '../../shared/ui';
import { patchChat, forgetChat } from './cache';
import { draftOf } from './Composer';
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

/** seq больше любого реального — сервер обрежет до последнего сообщения («прочитать всё»). */
const READ_ALL_SEQ = 2_147_483_647;

/** Отметить чат прочитанным целиком (свайп вправо, «Прочитать все»). */
export async function markChatRead(chat: ChatSummary): Promise<void> {
  await api.post(`/chats/${chat.id}/read`, { seq: READ_ALL_SEQ });
  patchChat(chat.id, (c) => ({ ...c, unreadCount: 0, unreadMentions: 0 }));
}

/** Аватар «Избранного» — закладка на солнечном фоне, как «Saved Messages» в Telegram. */
export function SavedAvatar({ size = 54 }: { size?: number }) {
  return (
    <span className="saved-avatar" style={{ width: size, height: size }} aria-hidden>
      <Bookmark size={Math.round(size * 0.44)} fill="currentColor" strokeWidth={1.6} />
    </span>
  );
}

/** Аватар чата: «Избранное» — своим значком, остальные — фото или инициалы. */
export function ChatAvatar({ chat, size, online }: { chat: ChatSummary; size: number; online?: boolean }) {
  if (chat.type === 'saved') return <SavedAvatar size={size} />;
  return <Avatar src={chat.avatarUrl} name={chat.title} id={chat.peer?.id ?? chat.id} size={size} online={online} />;
}

/** Последнее сообщение в списке: отправитель, значок вложения, текст. */
export function previewText(chat: ChatSummary, myId: string): React.ReactNode {
  const m = chat.lastMessage;
  if (!m)
    return chat.system ? 'Коды входа и новости Sunnet' : chat.type === 'secret' ? 'Секретный чат создан' : chat.type === 'saved' ? 'Заметки и файлы для себя' : 'Нет сообщений';
  if (m.kind === 'system') return `${m.senderName ?? ''} ${m.text ?? ''}`.trim();
  const who = chat.type === 'channel' || chat.type === 'saved' ? null : m.senderId === myId ? 'Вы' : chat.type === 'group' ? m.senderName?.split(' ')[0] : null;
  const icon =
    m.kind === 'voice' ? (
      <Mic size={14} />
    ) : m.kind === 'round' ? (
      <Video size={14} />
    ) : m.kind === 'media' ? (
      <Image size={14} />
    ) : m.kind === 'poll' ? (
      <BarChart3 size={14} />
    ) : m.kind === 'call' ? (
      <Phone size={14} />
    ) : m.kind === 'encrypted' ? (
      <Lock size={14} />
    ) : null;
  const body =
    m.kind === 'voice'
      ? 'Голосовое сообщение'
      : m.kind === 'round'
        ? 'Видеосообщение'
        : m.kind === 'media'
          ? m.text || 'Фото'
          : m.kind === 'poll'
            ? m.text || 'Опрос'
            : m.kind === 'call'
              ? m.text || 'Звонок'
              : m.kind === 'encrypted'
                ? 'Зашифрованное сообщение'
                : (m.text ?? '');
  return (
    <>
      {who && <span className="chat-item__sender">{who}: </span>}
      {icon}
      {body}
    </>
  );
}

/** «печатает…» с бегущими точками */
export function TypingDots() {
  return (
    <span className="typing-dots" aria-hidden>
      <i />
      <i />
      <i />
    </span>
  );
}

/** Открытая смахиванием строка закрывается, когда начинают смахивать другую. */
let closeOpenRow: (() => void) | null = null;

interface SwipeAction {
  key: string;
  label: string;
  icon: React.ReactNode;
  className: string;
  run: () => void;
}

function ChatItem({ chat, active, myId, base }: { chat: ChatSummary; active: boolean; myId: string; base: string }) {
  const menu = useMenu();
  const navigate = useNavigate();
  const typing = useRealtime((s) => s.typing[chat.id]);
  const presence = useRealtime((s) => (chat.peer ? s.presence[chat.peer.id] : undefined));
  const muted = !!chat.mutedUntil;
  const [toFolder, setToFolder] = useState(false);
  const link = useRef<HTMLAnchorElement>(null);
  const gesture = useRef<{ x: number; y: number; base: number; dx: number; mode: 'h' | 'v' | null; timer: ReturnType<typeof setTimeout> | null; long: boolean } | null>(null);
  const offset = useRef(0);
  const suppressClick = useRef(false);

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
      title:
        chat.type === 'secret'
          ? 'Удалить секретный чат?'
          : isOwner
            ? `Удалить «${chat.title}» для всех?`
            : chat.type === 'group' || chat.type === 'channel'
              ? `Покинуть «${chat.title}»?`
              : 'Удалить чат?',
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

  const toggleMute = () => prefs.mutate({ mutedUntil: muted ? null : new Date(Date.now() + 365 * 86400_000).toISOString() });
  const togglePin = () => prefs.mutate({ pinned: !chat.pinned });
  const toggleArchive = () => {
    prefs.mutate({ archived: !chat.archived });
    toast({ text: chat.archived ? 'Чат возвращён из архива' : 'Чат перенесён в архив', action: { label: 'Отменить', onClick: () => prefs.mutate({ archived: chat.archived }) } });
  };
  const readNow = () => void markChatRead(chat).catch((e) => toast({ text: errorMessage(e), kind: 'error' }));

  // Служебный чат Sunnet всегда сверху и не архивируется
  const rightActions: SwipeAction[] = [
    { key: 'mute', label: muted ? 'Звук' : 'Без звука', icon: muted ? <Bell size={20} /> : <BellOff size={20} />, className: 'chat-swipe--mute', run: toggleMute },
    ...(chat.system
      ? []
      : [
          {
            key: 'pin',
            label: chat.pinned ? 'Открепить' : 'Закрепить',
            icon: chat.pinned ? <PinOff size={20} /> : <Pin size={20} />,
            className: 'chat-swipe--pin',
            run: togglePin,
          },
          {
            key: 'archive',
            label: chat.archived ? 'Вернуть' : 'В архив',
            icon: chat.archived ? <ArchiveRestore size={20} /> : <Archive size={20} />,
            className: 'chat-swipe--archive',
            run: toggleArchive,
          },
        ]),
  ];
  const canRead = chat.unreadCount > 0 || chat.unreadMentions > 0;
  const RIGHT_W = rightActions.length * 74;
  const LEFT_W = canRead ? 74 : 0;

  const setOffset = (x: number, settle: boolean) => {
    offset.current = x;
    const el = link.current;
    if (!el) return;
    el.classList.toggle('chat-item--settling', settle);
    el.classList.toggle('chat-item--swiping', !settle);
    el.style.transform = x ? `translateX(${x}px)` : '';
  };
  const close = () => setOffset(0, true);

  const onTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0]!;
    const timer = setTimeout(() => {
      const g = gesture.current;
      if (!g || g.mode) return;
      g.long = true;
      suppressClick.current = true;
      navigator.vibrate?.(8);
      menu.openAt(t.clientX, t.clientY);
    }, 480);
    gesture.current = { x: t.clientX, y: t.clientY, base: offset.current, dx: 0, mode: null, timer, long: false };
  };
  const onTouchMove = (e: React.TouchEvent) => {
    const g = gesture.current;
    if (!g || g.long) return;
    const t = e.touches[0]!;
    const dx = t.clientX - g.x;
    const dy = t.clientY - g.y;
    if (!g.mode) {
      if (Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy) * 1.2) g.mode = 'h';
      else if (Math.abs(dy) > 8) g.mode = 'v';
      if (g.mode && g.timer) clearTimeout(g.timer);
      if (g.mode === 'h' && closeOpenRow && closeOpenRow !== close) closeOpenRow();
    }
    if (g.mode !== 'h') return;
    g.dx = dx;
    let x = g.base + dx;
    // Пружина за пределами действий
    if (x < -RIGHT_W) x = -RIGHT_W + (x + RIGHT_W) * 0.25;
    if (x > LEFT_W) x = LEFT_W + (x - LEFT_W) * 0.25;
    if (!LEFT_W && x > 0) x = x * 0.15;
    setOffset(x, false);
  };
  const onTouchEnd = () => {
    const g = gesture.current;
    gesture.current = null;
    if (!g) return;
    if (g.timer) clearTimeout(g.timer);
    if (g.mode !== 'h') return;
    suppressClick.current = true;
    const x = offset.current;
    if (x > 0) {
      // Вправо — «Прочитано» (полный свайп срабатывает сразу)
      if (canRead && x > 56) readNow();
      close();
      return;
    }
    if (x < -RIGHT_W * 0.35 || (g.dx < -40 && g.base === 0)) {
      setOffset(-RIGHT_W, true);
      closeOpenRow = close;
    } else close();
  };

  const typingNames = (typing ?? []).filter((t) => t.userId !== myId);
  const draft = !active ? draftOf(chat.id) : '';
  const lm = chat.lastMessage;
  const mineLast = !!lm && lm.senderId === myId && lm.kind !== 'system';
  const showTicks = mineLast && chat.type !== 'channel' && chat.type !== 'saved' && !chat.system;
  const read = showTicks && chat.lastReadSeq > 0 && chat.peerReadSeq >= chat.lastReadSeq;

  return (
    <div className="chat-row">
      {LEFT_W > 0 && (
        <div className="chat-row__actions chat-row__actions--left" aria-hidden>
          <button type="button" tabIndex={-1} className="chat-swipe chat-swipe--read" onClick={() => (readNow(), close())}>
            <CheckCheck size={20} />
            Прочитано
          </button>
        </div>
      )}
      <div className="chat-row__actions chat-row__actions--right" aria-hidden>
        {rightActions.map((a) => (
          <button
            key={a.key}
            type="button"
            tabIndex={-1}
            className={cn('chat-swipe', a.className)}
            onClick={() => {
              close();
              a.run();
            }}
          >
            {a.icon}
            {a.label}
          </button>
        ))}
      </div>
      <Link
        ref={link}
        to={`${base}/${chat.id}`}
        className={cn('chat-item', active && 'chat-item--active', chat.type === 'secret' && 'chat-item--secret', chat.unreadCount > 0 && !muted && 'chat-item--unread')}
        onContextMenu={(e) => {
          e.preventDefault();
          if (gesture.current?.long || suppressClick.current) return;
          menu.openFromEvent(e);
        }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchEnd}
        onClick={(e) => {
          if (suppressClick.current || offset.current !== 0) {
            e.preventDefault();
            suppressClick.current = false;
            if (offset.current !== 0) close();
          }
        }}
        aria-current={active ? 'page' : undefined}
      >
        <span className="chat-item__avatar">
          <ChatAvatar chat={chat} size={54} online={presence?.online} />
        </span>
        <span className="chat-item__body">
          <span className="chat-item__top">
            <span className="chat-item__title">
              {chat.type === 'secret' && <Lock size={14} className="chat-item__kind" />}
              <span className="ellipsis">{chat.title}</span>
              {(chat.peer?.verified || chat.system) && <Verified size={15} />}
              {muted && <BellOff size={14} className="chat-item__muted" aria-label="без звука" />}
            </span>
            {lm && (
              <span className="chat-item__meta">
                {showTicks &&
                  (read ? <CheckCheck size={16} className="chat-item__ticks" aria-label="прочитано" /> : <Check size={16} className="chat-item__ticks" aria-label="доставлено" />)}
                {chatTime(lm.createdAt)}
              </span>
            )}
          </span>
          <span className="chat-item__bottom">
            <span className="chat-item__preview">
              {typingNames.length ? (
                <span className="chat-item__typing">
                  <TypingDots />
                  {activityLabel(typingNames[0]!.activity, chat.type === 'group' ? typingNames[0]!.name.split(' ')[0] : undefined)}
                </span>
              ) : draft ? (
                <>
                  <span className="chat-item__draft">Черновик: </span>
                  {draft}
                </>
              ) : (
                previewText(chat, myId)
              )}
            </span>
            <span className="chat-item__icons">
              {chat.unreadMentions > 0 && (
                <span className="badge badge--mention" title="Вас упомянули">
                  @
                </span>
              )}
              {chat.unreadCount > 0 ? (
                <span className={cn('badge', muted && 'badge--muted')}>{chat.unreadCount > 999 ? '999+' : chat.unreadCount}</span>
              ) : (
                chat.pinned && <Pin size={15} className="chat-item__pin" aria-label="закреплён" />
              )}
            </span>
          </span>
        </span>
      </Link>
      <Menu
        anchor={menu.anchor}
        onClose={() => {
          menu.close();
          suppressClick.current = false;
        }}
        items={[
          { label: 'Прочитать', icon: <CheckCheck size={18} />, hidden: !canRead, onClick: readNow },
          { label: chat.pinned ? 'Открепить' : 'Закрепить', icon: chat.pinned ? <PinOff size={18} /> : <Pin size={18} />, hidden: chat.system, onClick: togglePin },
          { label: muted ? 'Включить уведомления' : 'Без звука', icon: muted ? <Bell size={18} /> : <BellOff size={18} />, onClick: toggleMute },
          {
            label: chat.archived ? 'Вернуть из архива' : 'В архив',
            icon: chat.archived ? <ArchiveRestore size={18} /> : <Archive size={18} />,
            hidden: chat.system,
            onClick: toggleArchive,
          },
          { label: 'Добавить в папку…', icon: <FolderPlus size={18} />, onClick: () => setToFolder(true) },
          'separator',
          {
            label: chat.type === 'group' || chat.type === 'channel' ? 'Покинуть' : 'Удалить чат',
            icon: <Trash2 size={18} />,
            danger: true,
            hidden: chat.system,
            onClick: () => void remove(),
          },
        ]}
      />
      {toFolder && <AddToFolderDialog chat={chat} onClose={() => setToFolder(false)} />}
    </div>
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
  const setNavOpen = useUi((s) => s.setNavOpen);
  const setPalette = useUi((s) => s.setPalette);
  const totalUnread = useSession((s) => (channels ? (s.me?.counters.unreadChannels ?? 0) : (s.me?.counters.unreadChats ?? 0)));
  const list = useCursorList<ChatSummary>(qk.chats(folder), `/chats?folder=${folder}`);
  const custom = useFolders().data?.items ?? [];
  const chats = flatPages(list.data);
  const headMenu = useMenu();
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? chats.filter((c) => c.title.toLowerCase().includes(s) || c.handle?.toLowerCase().includes(s)) : chats;
  }, [chats, q]);
  const unreadChats = chats.filter((c) => c.unreadCount > 0 || c.unreadMentions > 0);

  // Подписываемся на «в сети» собеседников из списка
  const peerIds = useMemo(
    () =>
      chats
        .map((c) => c.peer?.id)
        .filter((v): v is string => !!v)
        .sort()
        .join(','),
    [chats],
  );
  useEffect(() => (peerIds ? realtime.retainPresence(peerIds.split(',')) : undefined), [peerIds]);

  const readAll = async () => {
    try {
      await Promise.all(unreadChats.map((c) => markChatRead(c)));
      toast({ text: 'Все чаты прочитаны', kind: 'success' });
    } catch (e) {
      toast({ text: errorMessage(e), kind: 'error' });
    }
  };

  const tab = (id: string, label: React.ReactNode, badge?: number) => (
    <button key={id} type="button" role="tab" aria-selected={folder === id} className={cn('folder-tab', folder === id && 'folder-tab--active')} onClick={() => onFolder(id)}>
      {label}
      {!!badge && <span className="badge">{badge > 99 ? '99+' : badge}</span>}
    </button>
  );

  return (
    <div className="chats__list">
      <div className="chats__head">
        <div className="chats__bar">
          <span className="desktop-only shell-nav-toggle">
            <IconButton label="Разделы мессенджера" onClick={() => setNavOpen(true)}>
              <PanelLeftOpen size={20} />
            </IconButton>
          </span>
          {status === 'offline' ? (
            <h1 className="chats__title chats__title--status">
              <span className="spinner" /> Соединение…
            </h1>
          ) : (
            <h1 className="chats__title">{channels ? 'Каналы' : 'Чаты'}</h1>
          )}
          <IconButton label="Ещё" onClick={(e) => headMenu.openFromEvent(e)}>
            <Ellipsis size={22} />
          </IconButton>
          <IconButton label={channels ? 'Создать канал' : 'Новый чат'} onClick={() => navigate(createPath)}>
            <SquarePen size={21} />
          </IconButton>
        </div>
        {!q && !channels && <StoriesBar compact hideEmpty />}
        <div className="chat-search">
          <Search size={17} className="chat-search__icon" />
          <input
            className="input"
            type="search"
            enterKeyHint="search"
            placeholder={channels ? 'Поиск по подпискам' : 'Поиск'}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="Поиск по чатам"
          />
          {q && (
            <button className="icon-btn icon-btn--sm input-group__action" onClick={() => setQ('')} aria-label="Очистить">
              <X size={16} />
            </button>
          )}
        </div>
        {channels ? (
          <div className="folder-tabs" role="tablist" aria-label="Каналы">
            <button type="button" role="tab" aria-selected={!onDiscover} className={cn('folder-tab', !onDiscover && 'folder-tab--active')} onClick={() => navigate('/channels')}>
              Мои подписки
              {totalUnread > 0 && <span className="badge">{totalUnread > 99 ? '99+' : totalUnread}</span>}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={onDiscover}
              className={cn('folder-tab', onDiscover && 'folder-tab--active')}
              onClick={() => navigate('/channels/discover')}
            >
              <Compass size={15} /> Обзор
            </button>
          </div>
        ) : (
          <div className="folder-tabs" role="tablist" aria-label="Папки">
            {tab('all', 'Все', totalUnread)}
            {/* Свои папки — сразу после «Все», как в Telegram */}
            {custom.map((f) =>
              tab(
                f.id,
                <>
                  <span aria-hidden>{f.emoji}</span> {f.name}
                </>,
                f.unreadCount,
              ),
            )}
            {FOLDERS.slice(1).map((f) => tab(f.id, f.label))}
            <button type="button" className="folder-tab folder-tab--icon" onClick={() => navigate('/chats/folders')} aria-label="Настроить папки" title="Настроить папки">
              <SlidersHorizontal size={16} />
            </button>
          </div>
        )}
      </div>
      <div className="chats__scroll">
        {list.isLoading ? (
          <ListSkeleton rows={8} avatar={54} />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={q ? <Search size={28} /> : channels ? <Compass size={28} /> : folder === 'archived' ? <Archive size={28} /> : <SquarePen size={28} />}
            title={q ? 'Ничего не найдено' : channels ? 'Нет подписок' : folder === 'archived' ? 'Архив пуст' : 'Здесь пока пусто'}
            text={
              q
                ? 'Попробуйте другое название или общий поиск'
                : channels
                  ? 'Найдите интересные каналы в обзоре или создайте свой'
                  : folder === 'archived'
                    ? 'Смахните чат влево и нажмите «В архив», чтобы убрать его сюда'
                    : 'Начните разговор — кнопка с карандашом внизу'
            }
          />
        ) : (
          filtered.map((c) => <ChatItem key={c.id} chat={c} active={c.id === activeId} myId={me.id} base={base} />)
        )}
        <LoadMore hasMore={!!list.hasNextPage} loading={list.isFetchingNextPage} onLoad={() => void list.fetchNextPage()} />
      </div>
      <Link to={createPath} className="chat-fab" aria-label={channels ? 'Создать канал' : 'Новый чат'} title={channels ? 'Создать канал' : 'Новый чат'}>
        <SquarePen size={24} />
      </Link>
      <Menu
        anchor={headMenu.anchor}
        onClose={headMenu.close}
        items={[
          { label: 'Прочитать все', icon: <CheckCheck size={18} />, hidden: unreadChats.length === 0, onClick: () => void readAll() },
          { label: 'Поиск по Sunnet', icon: <Search size={18} />, onClick: () => setPalette(true) },
          { label: 'Новая группа', icon: <Users size={18} />, hidden: channels, onClick: () => navigate('/chats/new/group') },
          { label: 'Секретный чат', icon: <Lock size={18} />, hidden: channels, onClick: () => navigate('/chats/new/secret') },
          { label: 'Избранное', icon: <Bookmark size={18} />, hidden: channels, onClick: () => navigate('/chats/saved') },
          { label: 'Открытые группы', icon: <Compass size={18} />, hidden: channels, onClick: () => navigate('/chats/discover') },
          { label: 'Контакты', icon: <UsersRound size={18} />, hidden: channels, onClick: () => navigate('/contacts/following') },
          { label: 'Создать канал', icon: <SquarePen size={18} />, hidden: !channels, onClick: () => navigate('/channels/new') },
          { label: 'Обзор каналов', icon: <Compass size={18} />, hidden: !channels, onClick: () => navigate('/channels/discover') },
          'separator',
          { label: 'Папки', icon: <SlidersHorizontal size={18} />, hidden: channels, onClick: () => navigate('/chats/folders') },
          { label: 'Архив', icon: <Archive size={18} />, hidden: channels, onClick: () => onFolder('archived') },
        ]}
      />
    </div>
  );
}
