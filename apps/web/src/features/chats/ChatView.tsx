import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router';
import { useInfiniteQuery, useMutation, useQuery, type InfiniteData } from '@tanstack/react-query';
import {
  Ban,
  Bell,
  BellOff,
  CalendarClock,
  ChevronDown,
  ChevronLeft,
  Copy,
  EllipsisVertical,
  Eraser,
  Flag,
  Forward,
  Info,
  Lock,
  LogOut,
  Megaphone,
  Phone,
  Pin,
  PinOff,
  Search,
  ShieldAlert,
  Trash2,
  Video,
  X,
} from 'lucide-react';
import type { ChatSummary, EncryptedPayload, Message, PollInput, ScheduledMessage } from '@omni/shared';
import { api, errorMessage } from '../../shared/api/client';
import { qk, queryClient } from '../../shared/api/query';
import { startCall } from '../../shared/calls/engine';
import { encryptMessage } from '../../shared/crypto/e2e';
import { playSound } from '../../shared/lib/sounds';
import { realtime } from '../../shared/realtime/socket';
import { useRealtime } from '../../shared/stores/realtime';
import { useMe, useSession } from '../../shared/stores/session';
import { toast, useCrumb } from '../../shared/stores/ui';
import { activityLabel, cn, fullDate, lastSeen, members, plural, randomId } from '../../shared/lib/format';
import { Avatar, Button, confirm, ErrorState, IconButton, Loading, Menu, Modal, ReportDialog, useMenu, Verified } from '../../shared/ui';
import { useImmersive } from '../../app/layout/Shell';
import { activeChat, forgetChat, onIncomingMessage, patchChat, patchMessage, removeMessage, upsertMessage, type LocalMessage, type MessagesPage } from './cache';
import { Composer, type ComposerSubmit } from './Composer';
import { ForwardDialog, InChatSearch } from './dialogs';
import { ReadersDialog, ScheduledListDialog, scheduledKey } from './extras';
import { MessageList, scrollToEl, type MessageActions } from './Messages';
import { ChatAvatar, TypingDots } from './ChatList';
import { CommentsDialog, useViewTracker } from './channel';
import { rememberPlaintext, useSecretChat } from './secret';
import { useChatUi } from './store';

type PendingBody = {
  clientId: string;
  text?: string;
  mediaIds: string[];
  replyToId?: string;
  encrypted?: EncryptedPayload;
  kind?: 'voice' | 'round';
  silent?: boolean;
};
const pending = new Map<string, PendingBody>();

/** Дополнительные кнопки в шапке чата (например, «Участники» в компании). */
export const ChatHeaderExtra = createContext<ReactNode>(null);

export function ChatView() {
  const { chatId = '' } = useParams();
  const me = useMe();
  const navigate = useNavigate();
  // Каналы открываются в своём разделе, чаты компаний и сообществ — в своём, остальные — в мессенджере
  const { pathname } = useLocation();
  const base = pathname.match(/^\/(companies|communities)\/[^/]+/)?.[0] ?? (pathname.startsWith('/channels') ? '/channels' : '/chats');
  const headerExtra = useContext(ChatHeaderExtra);
  useImmersive(true);
  const toggleInfo = useChatUi((s) => s.toggleInfo);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [atBottom, setAtBottom] = useState(true);
  const [replyTo, setReplyTo] = useState<LocalMessage | null>(null);
  const [editing, setEditing] = useState<{ msg: LocalMessage; text: string } | null>(null);
  const [forwarding, setForwarding] = useState<LocalMessage | null>(null);
  const [reporting, setReporting] = useState<{ type: 'message' | 'chat' | 'user'; id: string } | null>(null);
  const [deleting, setDeleting] = useState<LocalMessage[] | null>(null);
  // Режим выделения: несколько сообщений — переслать, скопировать, удалить
  const [selected, setSelected] = useState<Map<string, LocalMessage>>(new Map());
  const selecting = selected.size > 0;
  const [forwardMany, setForwardMany] = useState<LocalMessage[] | null>(null);
  const otherUnread = useSession((s) => s.me?.counters.unreadChats ?? 0);
  // Новые сообщения, пришедшие, пока лента прокручена вверх
  const seenSeq = useRef(0);
  // Поиск по переписке открывается и из шапки, и из информации о чате
  const searchOpen = useChatUi((s) => s.searchOpen);
  const setSearchOpen = useChatUi((s) => s.setSearch);
  const [readersOf, setReadersOf] = useState<LocalMessage | null>(null);
  const [scheduledOpen, setScheduledOpen] = useState(false);
  const [params, setParams] = useSearchParams();
  const commentsOf = params.get('post');
  const openComments = useCallback(
    (id: string | null) => {
      const next = new URLSearchParams(params);
      if (id) next.set('post', id);
      else next.delete('post');
      setParams(next, { replace: !id });
    },
    [params, setParams],
  );
  const jumpSeq = Number(params.get('m')) || null;
  const headerMenu = useMenu();

  const chatQ = useQuery({ queryKey: qk.chat(chatId), queryFn: () => api.get<ChatSummary>(`/chats/${chatId}`), enabled: !!chatId });
  const chat = chatQ.data;
  const msgsQ = useInfiniteQuery<MessagesPage, Error, InfiniteData<MessagesPage, number | undefined>, readonly unknown[], number | undefined>({
    queryKey: qk.messages(chatId),
    initialPageParam: undefined,
    queryFn: ({ pageParam }) => api.get<MessagesPage>(`/chats/${chatId}/messages?limit=50${pageParam ? `&before=${pageParam}` : ''}`),
    getNextPageParam: (last) => (last.hasMore ? last.items[0]?.seq : undefined),
    enabled: !!chatId,
    staleTime: Infinity,
  });
  const messages = useMemo(() => (msgsQ.data ? [...msgsQ.data.pages].reverse().flatMap((p) => p.items) : []), [msgsQ.data]);
  const secret = useSecretChat(chat, me.id);
  useViewTracker(chat, scrollRef, messages);
  const scheduledQ = useQuery({
    queryKey: scheduledKey(chatId),
    queryFn: () => api.get<{ items: ScheduledMessage[] }>(`/chats/${chatId}/scheduled`),
    enabled: !!chat && !!chat.role && chat.type !== 'secret',
  });
  const scheduledCount = scheduledQ.data?.items.length ?? 0;

  // Переход к сообщению по ссылке ?m=<seq>: догружаем историю, прокручиваем и подсвечиваем
  useEffect(() => {
    if (!jumpSeq || !msgsQ.data) return;
    const loaded = messages.some((m) => m.seq <= jumpSeq);
    if (!loaded && msgsQ.hasNextPage && !msgsQ.isFetchingNextPage) {
      void msgsQ.fetchNextPage();
      return;
    }
    const el = scrollRef.current?.querySelector<HTMLElement>(`[data-seq="${jumpSeq}"]`);
    if (el) {
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      el.classList.add('bubble--highlight');
      setTimeout(() => el.classList.remove('bubble--highlight'), 1800);
    }
    if (loaded || !msgsQ.hasNextPage) {
      params.delete('m');
      setParams(params, { replace: true });
    }
  }, [jumpSeq, messages, msgsQ, params, setParams]);
  useCrumb(chat?.title);
  const typing = useRealtime((s) => s.typing[chatId]);
  const presence = useRealtime((s) => (chat?.peer ? s.presence[chat.peer.id] : undefined));

  // Активный чат: тосты о новых сообщениях не показываем, непрочитанное не растёт
  useEffect(() => () => setSearchOpen(false), [chatId, setSearchOpen]);
  useEffect(() => {
    activeChat.id = chatId;
    setReplyTo(null);
    setEditing(null);
    setSelected(new Map());
    seenSeq.current = 0;
    return () => {
      activeChat.id = null;
    };
  }, [chatId]);

  useEffect(() => (chat?.peer ? realtime.retainPresence([chat.peer.id]) : undefined), [chat?.peer]);

  // Отметка «прочитано»
  const lastSeq = messages.filter((m) => !m.local).at(-1)?.seq ?? 0;
  useEffect(() => {
    if (!chat || !chat.role || lastSeq <= chat.lastReadSeq || document.visibilityState !== 'visible') return;
    const t = setTimeout(() => {
      api.post(`/chats/${chatId}/read`, { seq: lastSeq }).catch(() => undefined);
      patchChat(chatId, (c) => ({ ...c, unreadCount: 0, lastReadSeq: lastSeq }));
    }, 300);
    return () => clearTimeout(t);
  }, [chatId, chat, lastSeq]);

  const scrollToBottom = useCallback(() => scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' }), []);
  if (atBottom) seenSeq.current = Math.max(seenSeq.current, lastSeq);
  const newBelow = atBottom ? 0 : messages.filter((m) => m.seq > seenSeq.current && !m.local && m.sender?.id !== me.id && m.kind !== 'system').length;

  /** К сообщению по id: подсветить, если оно уже загружено. */
  const jumpTo = useCallback((messageId: string) => {
    const el = scrollRef.current?.querySelector<HTMLElement>(`[data-mid="${messageId}"]`);
    if (!el) return toast('Сообщение выше в истории — прокрутите вверх');
    scrollToEl(scrollRef.current, el, 'center');
    el.classList.add('bubble--highlight');
    setTimeout(() => el.classList.remove('bubble--highlight'), 1800);
  }, []);
  const toggleSelect = useCallback((m: LocalMessage) => {
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(m.id)) next.delete(m.id);
      else next.set(m.id, m);
      return next;
    });
  }, []);
  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (el) setAtBottom(Math.abs(el.scrollTop) < 120);
  }, []);

  const deliver = useCallback(
    async (body: PendingBody) => {
      pending.set(body.clientId, body);
      try {
        const msg = await api.post<Message>(`/chats/${chatId}/messages`, body);
        pending.delete(body.clientId);
        onIncomingMessage(msg, me.id);
        playSound('sent');
      } catch (e) {
        patchMessage(
          chatId,
          (m) => m.clientId === body.clientId,
          (m) => ({ ...m, local: { status: 'failed', error: errorMessage(e) } }),
        );
        toast({ text: errorMessage(e), kind: 'error' });
      }
    },
    [chatId, me.id],
  );

  const send = useCallback(
    async (data: ComposerSubmit) => {
      if (!chat) return;
      const clientId = `c${randomId(12)}`;
      let encrypted: EncryptedPayload | undefined;
      if (chat.type === 'secret') {
        if (secret.status !== 'ready') return toast({ text: 'Ключи шифрования ещё не готовы', kind: 'error' });
        encrypted = await encryptMessage(chat.id, secret.key, data.text);
        rememberPlaintext(clientId, data.text);
      }
      const local: LocalMessage = {
        id: `local-${clientId}`,
        chatId: chat.id,
        seq: (messages.at(-1)?.seq ?? 0) + 0.001,
        clientId,
        sender: { id: me.id, username: me.username, displayName: me.displayName, avatarUrl: me.avatarUrl, verified: me.verified },
        kind: encrypted ? 'encrypted' : (data.kind ?? (data.mediaIds.length ? 'media' : 'text')),
        text: encrypted ? null : data.text || null,
        media: data.media,
        poll: null,
        call: null,
        silent: !!data.silent,
        replyTo: data.replyTo
          ? {
              id: data.replyTo.id,
              senderId: data.replyTo.sender?.id ?? null,
              senderName: data.replyTo.sender?.displayName ?? null,
              kind: data.replyTo.kind,
              text: data.replyTo.text,
              createdAt: data.replyTo.createdAt,
            }
          : null,
        forwardedFrom: null,
        reactions: [],
        encrypted: encrypted ?? null,
        editedAt: null,
        deletedAt: null,
        expiresAt: null,
        createdAt: new Date().toISOString(),
        threadRootId: null,
        viewCount: chat.type === 'channel' ? 1 : null,
        commentCount: 0,
        local: { status: 'sending' },
      };
      upsertMessage(chat.id, local);
      setReplyTo(null);
      scrollToBottom();
      await deliver({
        clientId,
        text: encrypted ? undefined : data.text || undefined,
        mediaIds: data.mediaIds,
        replyToId: data.replyTo?.id,
        encrypted,
        kind: data.kind,
        silent: data.silent || undefined,
      });
    },
    [chat, secret, messages, me, deliver, scrollToBottom],
  );

  const saveEdit = useCallback(
    async (msg: LocalMessage, text: string) => {
      setEditing(null);
      try {
        let body: Record<string, unknown> = { text };
        if (chat?.type === 'secret' && secret.status === 'ready') {
          body = { encrypted: await encryptMessage(chat.id, secret.key, text) };
          rememberPlaintext(msg.id, text);
        }
        const updated = await api.patch<Message>(`/chats/${chatId}/messages/${msg.id}`, body);
        upsertMessage(chatId, updated);
      } catch (e) {
        toast({ text: errorMessage(e), kind: 'error' });
      }
    },
    [chat, chatId, secret],
  );

  const actions: MessageActions = useMemo(
    () => ({
      reply: (m) => setReplyTo(m),
      edit: (m, text) => setEditing({ msg: m, text }),
      remove: (m) => (m.local ? removeMessage(chatId, m.id) : setDeleting([m])),
      forward: (m) => setForwarding(m),
      react: (m, emoji) =>
        void api
          .post<Message>(`/chats/${chatId}/messages/${m.id}/reactions`, { emoji })
          .then((u) => upsertMessage(chatId, u))
          .catch((e) => toast({ text: errorMessage(e), kind: 'error' })),
      pin: (m) =>
        void api
          .post<ChatSummary>(`/chats/${chatId}/pin`, { messageId: chat?.pinnedMessage?.id === m.id ? null : m.id })
          .then((c) => queryClient.setQueryData(qk.chat(chatId), c))
          .catch((e) => toast({ text: errorMessage(e), kind: 'error' })),
      report: (m) => setReporting({ type: 'message', id: m.id }),
      retry: (m) => {
        const body = m.clientId ? pending.get(m.clientId) : undefined;
        if (!body) return removeMessage(chatId, m.id);
        patchMessage(
          chatId,
          (x) => x.clientId === m.clientId,
          (x) => ({ ...x, local: { status: 'sending' } }),
        );
        void deliver(body);
      },
      copy: (text) => {
        void navigator.clipboard.writeText(text).then(() => toast('Текст скопирован'));
      },
      readers: (m) => setReadersOf(m),
      callBack: chat?.peer ? (video) => void startCall(chatId, video) : undefined,
      comments: (m) => openComments(m.id),
      select: toggleSelect,
      jumpTo,
    }),
    [chatId, chat?.pinnedMessage?.id, chat?.peer, deliver, openComments, toggleSelect, jumpTo],
  );

  const prefs = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.patch<ChatSummary>(`/chats/${chatId}/prefs`, body),
    onSuccess: (c) => patchChat(chatId, () => c),
    onError: (e) => toast({ text: errorMessage(e), kind: 'error' }),
  });
  const join = useMutation({
    mutationFn: () => api.post<ChatSummary>(`/chats/${chatId}/join`),
    onSuccess: (c) => {
      queryClient.setQueryData(qk.chat(chatId), c);
      void queryClient.invalidateQueries({ queryKey: qk.chatsAll });
      if (c.spaceId) void queryClient.invalidateQueries({ queryKey: ['space', c.spaceId] });
      toast({ text: c.type === 'channel' ? 'Вы подписались на канал' : 'Вы вступили в группу', kind: 'success' });
    },
  });

  if (chatQ.isLoading) return <Loading />;
  if (chatQ.error || !chat) return <ErrorState error={chatQ.error} onRetry={() => void chatQ.refetch()} />;

  const typingOthers = (typing ?? []).filter((t) => t.userId !== me.id);
  const subtitle = typingOthers.length
    ? activityLabel(typingOthers[0]!.activity, chat.type === 'group' ? typingOthers.map((t) => t.name.split(' ')[0]).join(', ') : undefined)
    : chat.system
      ? 'Служебный чат: коды входа и новости'
      : chat.type === 'direct' || chat.type === 'secret'
        ? chat.peer
          ? presence
            ? lastSeen(presence)
            : 'был(а) недавно'
          : ''
        : chat.type === 'saved'
          ? 'Заметки, файлы и ссылки для себя'
          : members(chat.memberCount, chat.type === 'channel' ? 'channel' : 'group');
  const muted = !!chat.mutedUntil;
  const isMember = !!chat.role;
  const isAdmin = chat.role === 'owner' || chat.role === 'admin';
  const canCall = (chat.type === 'direct' || chat.type === 'secret') && !!chat.peer && isMember && !chat.system;
  const canWrite = isMember && !chat.system && (chat.type !== 'channel' || isAdmin) && (chat.type !== 'secret' || secret.status === 'ready');

  const selectedList = [...selected.values()].sort((a, b) => a.seq - b.seq);
  const copySelected = () => {
    const text = selectedList
      .filter((m) => m.text)
      .map((m) => (selectedList.length > 1 ? `${m.sender?.displayName ?? ''}: ${m.text}` : m.text))
      .join('\n\n');
    void navigator.clipboard.writeText(text).then(() => toast('Текст скопирован'));
    setSelected(new Map());
  };
  const removeMany = (list: LocalMessage[], forEveryone: boolean) => {
    setDeleting(null);
    setSelected(new Map());
    for (const m of list) {
      removeMessage(chatId, m.id);
      void api.del(`/chats/${chatId}/messages/${m.id}?forEveryone=${forEveryone}`).catch((e) => toast({ text: errorMessage(e), kind: 'error' }));
    }
  };

  const removeChat = async () => {
    const leaving = (chat.type === 'group' || chat.type === 'channel') && chat.role !== 'owner';
    const ok = await confirm({ title: leaving ? `Покинуть «${chat.title}»?` : 'Удалить чат?', danger: true, confirmLabel: leaving ? 'Покинуть' : 'Удалить' });
    if (!ok) return;
    await api.del(`/chats/${chatId}`);
    forgetChat(chatId);
    navigate(base);
  };

  return (
    <>
      {selecting ? (
        <header className="chat-header chat-header--select">
          <IconButton label="Отменить выбор" onClick={() => setSelected(new Map())}>
            <X size={22} />
          </IconButton>
          <span className="chat-header__count">
            {selected.size} {plural(selected.size, 'сообщение', 'сообщения', 'сообщений')}
          </span>
          <span className="chat-header__actions">
            {selectedList.some((m) => m.text) && (
              <IconButton label="Копировать" onClick={copySelected}>
                <Copy size={21} />
              </IconButton>
            )}
            {chat.type !== 'secret' && (
              <IconButton label="Переслать" onClick={() => setForwardMany(selectedList)}>
                <Forward size={21} />
              </IconButton>
            )}
            {!chat.system && (chat.type !== 'channel' || isAdmin) && (
              <IconButton label="Удалить" danger onClick={() => setDeleting(selectedList)}>
                <Trash2 size={21} />
              </IconButton>
            )}
          </span>
        </header>
      ) : (
        <header className="chat-header">
          <button type="button" className="chat-back" aria-label={base === '/channels' ? 'К списку каналов' : 'К списку чатов'} onClick={() => navigate(base)}>
            <ChevronLeft size={28} strokeWidth={2.2} />
            {otherUnread - (chat.unreadCount > 0 ? 1 : 0) > 0 && <span className="chat-back__count">{otherUnread - (chat.unreadCount > 0 ? 1 : 0)}</span>}
          </button>
          <button className="chat-header__info" onClick={toggleInfo} aria-label="Информация о чате">
            <ChatAvatar chat={chat} size={40} online={presence?.online} />
            <span className="chat-header__text">
              <span className="chat-header__title">
                {chat.type === 'secret' && <Lock size={14} style={{ color: 'var(--success)' }} />}
                {chat.type === 'channel' && <Megaphone size={14} className="faint" />}
                <span className="ellipsis">{chat.title}</span>
                {(chat.peer?.verified || chat.system) && <Verified size={15} />}
                {muted && <BellOff size={13} className="faint" />}
              </span>
              <span className={cn('chat-header__sub ellipsis', typingOthers.length > 0 || presence?.online ? 'chat-header__sub--accent' : '')}>
                {typingOthers.length > 0 && <TypingDots />}
                {subtitle}
              </span>
            </span>
          </button>
          <span className="chat-header__actions">
            {scheduledCount > 0 && (
              <IconButton label="Отложенные сообщения" onClick={() => setScheduledOpen(true)}>
                <CalendarClock size={20} />
                <span className="badge header-badge">{scheduledCount}</span>
              </IconButton>
            )}
            {canCall && (
              <>
                <IconButton label="Видеозвонок" onClick={() => void startCall(chat.id, true)}>
                  <Video size={22} />
                </IconButton>
                <IconButton label="Аудиозвонок" onClick={() => void startCall(chat.id, false)}>
                  <Phone size={20} />
                </IconButton>
              </>
            )}
            {chat.type !== 'secret' && (
              <IconButton label="Поиск в чате" className="chat-header__wide" onClick={() => setSearchOpen(true)}>
                <Search size={20} />
              </IconButton>
            )}
            {headerExtra}
            <IconButton label="Информация" onClick={toggleInfo} className="chat-header__wide">
              <Info size={20} />
            </IconButton>
            <IconButton label="Ещё" onClick={(e) => headerMenu.openFromEvent(e)}>
              <EllipsisVertical size={21} />
            </IconButton>
          </span>
        </header>
      )}

      {chat.pinnedMessage && !selecting && (
        <div
          className="pinned-bar"
          role="button"
          tabIndex={0}
          onClick={() => jumpTo(chat.pinnedMessage!.id)}
          onKeyDown={(e) => e.key === 'Enter' && jumpTo(chat.pinnedMessage!.id)}
        >
          <span className="pinned-bar__line" />
          <span className="col grow" style={{ gap: 0, minWidth: 0 }}>
            <span className="pinned-bar__title">Закреплённое сообщение</span>
            <span className="ellipsis">{chat.pinnedMessage.kind === 'encrypted' ? 'Зашифрованное сообщение' : chat.pinnedMessage.text || 'Вложение'}</span>
          </span>
          {isAdmin || chat.type === 'direct' || chat.type === 'saved' || chat.type === 'secret' ? (
            <button
              type="button"
              className="icon-btn icon-btn--sm"
              aria-label="Открепить"
              title="Открепить"
              onClick={(e) => {
                e.stopPropagation();
                void api.post<ChatSummary>(`/chats/${chatId}/pin`, { messageId: null }).then((c) => queryClient.setQueryData(qk.chat(chatId), c));
              }}
            >
              <PinOff size={17} />
            </button>
          ) : (
            <Pin size={16} className="pinned-bar__pin" />
          )}
        </div>
      )}

      {chat.type === 'secret' && secret.status === 'wrong-device' && (
        <div className="notice notice--warning" style={{ margin: 10, borderRadius: 12 }}>
          <ShieldAlert size={18} />
          <div>Этот секретный чат привязан к другому устройству. Ключи никогда не покидают устройство, поэтому переписку можно читать только там.</div>
        </div>
      )}

      <div className="chat-body">
        {msgsQ.isLoading ? (
          <Loading />
        ) : (
          <MessageList
            selection={selecting ? new Set(selected.keys()) : undefined}
            messages={messages}
            chat={chat}
            myId={me.id}
            secret={secret}
            actions={actions}
            hasOlder={!!msgsQ.hasNextPage}
            loadingOlder={msgsQ.isFetchingNextPage}
            onLoadOlder={() => void msgsQ.fetchNextPage()}
            scrollRef={scrollRef}
            onScroll={onScroll}
          />
        )}

        {!atBottom && (
          <button className="scroll-down" onClick={scrollToBottom} aria-label={newBelow ? `Вниз: новых сообщений — ${newBelow}` : 'Вниз'}>
            <ChevronDown size={26} />
            {newBelow > 0 && <span className="badge">{newBelow > 99 ? '99+' : newBelow}</span>}
          </button>
        )}
      </div>

      {canWrite ? (
        <Composer
          chat={chat}
          replyTo={replyTo}
          editing={editing}
          onCancelReply={() => setReplyTo(null)}
          onCancelEdit={() => setEditing(null)}
          onSubmit={(d) => void send(d)}
          onSaveEdit={(m, t) => void saveEdit(m, t)}
          onEditLast={() => {
            const last = [...messages].reverse().find((m) => m.sender?.id === me.id && !m.local && (m.kind === 'text' || m.kind === 'encrypted'));
            if (last && last.kind === 'text') setEditing({ msg: last, text: last.text ?? '' });
          }}
          secret={chat.type === 'secret'}
          onPoll={async (poll: PollInput) => {
            const msg = await api.post<Message>(`/chats/${chatId}/messages`, { clientId: `p${randomId(12)}`, poll });
            upsertMessage(chatId, msg);
            scrollToBottom();
          }}
          onSchedule={async (d, at) => {
            await api.post(`/chats/${chatId}/scheduled`, {
              text: d.text || undefined,
              mediaIds: d.mediaIds,
              replyToId: d.replyTo?.id,
              silent: !!d.silent,
              sendAt: at.toISOString(),
            });
            void queryClient.invalidateQueries({ queryKey: scheduledKey(chatId) });
            toast({ text: `Сообщение будет отправлено ${fullDate(at.toISOString())}`, kind: 'success' });
            setReplyTo(null);
          }}
        />
      ) : (
        <div className="composer">
          <div className="composer__readonly">
            {!isMember ? (
              <Button pill loading={join.isPending} onClick={() => join.mutate()}>
                {chat.type === 'channel' ? 'Подписаться' : 'Вступить в группу'}
              </Button>
            ) : chat.type === 'channel' ? (
              <Button
                variant="secondary"
                pill
                icon={muted ? <Bell size={18} /> : <BellOff size={18} />}
                onClick={() => prefs.mutate({ mutedUntil: muted ? null : new Date(Date.now() + 365 * 86400_000).toISOString() })}
              >
                {muted ? 'Включить уведомления' : 'Выключить уведомления'}
              </Button>
            ) : chat.system ? (
              <span className="muted small system-chat__note">
                Служебный чат Sunnet: сюда приходят коды входа и новости. Отвечать сюда нельзя — сотрудники Sunnet никогда не спрашивают коды и пароли.
              </span>
            ) : (
              <span className="muted small">Отправка недоступна на этом устройстве</span>
            )}
          </div>
        </div>
      )}

      <Menu
        anchor={headerMenu.anchor}
        onClose={headerMenu.close}
        items={[
          {
            label: muted ? 'Включить уведомления' : 'Без звука',
            icon: muted ? <Bell size={18} /> : <BellOff size={18} />,
            onClick: () => prefs.mutate({ mutedUntil: muted ? null : new Date(Date.now() + 365 * 86400_000).toISOString() }),
            hidden: !isMember,
          },
          { label: chat.pinned ? 'Открепить чат' : 'Закрепить чат', icon: <Pin size={18} />, onClick: () => prefs.mutate({ pinned: !chat.pinned }), hidden: !isMember },
          { label: 'Информация', icon: <Info size={18} />, onClick: toggleInfo },
          { label: 'Поиск в чате', icon: <Search size={18} />, onClick: () => setSearchOpen(true), hidden: chat.type === 'secret' },
          { label: 'Отложенные сообщения', icon: <CalendarClock size={18} />, onClick: () => setScheduledOpen(true), hidden: !isMember || chat.type === 'secret' || !canWrite },
          { label: 'Аудиозвонок', icon: <Phone size={18} />, onClick: () => void startCall(chat.id, false), hidden: !canCall },
          { label: 'Видеозвонок', icon: <Video size={18} />, onClick: () => void startCall(chat.id, true), hidden: !canCall },
          {
            label: 'Очистить историю',
            icon: <Eraser size={18} />,
            hidden: !isMember || chat.type === 'channel',
            onClick: async () => {
              if (!(await confirm({ title: 'Очистить историю?', text: 'Сообщения исчезнут только у вас.', danger: true, confirmLabel: 'Очистить' }))) return;
              await api.post(`/chats/${chatId}/clear`);
              void queryClient.invalidateQueries({ queryKey: qk.messages(chatId) });
            },
          },
          {
            label: 'Заблокировать',
            icon: <Ban size={18} />,
            hidden: chat.type !== 'direct' || !chat.peer || chat.system,
            danger: true,
            onClick: async () => {
              if (
                !(await confirm({
                  title: `Заблокировать ${chat.peer!.displayName}?`,
                  text: 'Пользователь не сможет писать вам и видеть ваши публикации.',
                  danger: true,
                  confirmLabel: 'Заблокировать',
                }))
              )
                return;
              await api.post(`/users/${chat.peer!.id}/block`);
              toast({ text: 'Пользователь заблокирован', kind: 'success' });
            },
          },
          {
            label: 'Пожаловаться',
            icon: <Flag size={18} />,
            hidden: chat.type === 'saved' || chat.system,
            onClick: () => setReporting(chat.peer ? { type: 'user', id: chat.peer.id } : { type: 'chat', id: chat.id }),
          },
          'separator',
          {
            label: (chat.type === 'group' || chat.type === 'channel') && chat.role !== 'owner' ? 'Покинуть' : 'Удалить чат',
            icon: (chat.type === 'group' || chat.type === 'channel') && chat.role !== 'owner' ? <LogOut size={18} /> : <Trash2 size={18} />,
            danger: true,
            hidden: !isMember || chat.system,
            onClick: () => void removeChat(),
          },
        ]}
      />
      {forwarding && <ForwardDialog chatId={chatId} message={forwarding} onClose={() => setForwarding(null)} />}
      {forwardMany && (
        <ForwardDialog
          chatId={chatId}
          messages={forwardMany}
          onClose={() => {
            setForwardMany(null);
            setSelected(new Map());
          }}
        />
      )}
      {reporting && <ReportDialog open entityType={reporting.type} entityId={reporting.id} onClose={() => setReporting(null)} />}
      {searchOpen && (
        <InChatSearch
          chatId={chatId}
          onClose={() => setSearchOpen(false)}
          onJump={(m) => {
            const next = new URLSearchParams(params);
            next.set('m', String(m.seq));
            setParams(next, { replace: true });
          }}
        />
      )}
      {readersOf && <ReadersDialog chatId={chatId} messageId={readersOf.id} onClose={() => setReadersOf(null)} />}
      {scheduledOpen && <ScheduledListDialog chatId={chatId} onClose={() => setScheduledOpen(false)} />}
      {commentsOf && chat.type === 'channel' && <CommentsDialog chat={chat} rootId={commentsOf} onClose={() => openComments(null)} />}
      {deleting && (
        <Modal
          open
          onClose={() => setDeleting(null)}
          title={deleting.length > 1 ? `Удалить ${deleting.length} ${plural(deleting.length, 'сообщение', 'сообщения', 'сообщений')}?` : 'Удалить сообщение?'}
          footer={
            <>
              <Button variant="ghost" onClick={() => setDeleting(null)}>
                Отмена
              </Button>
              {chat.type !== 'channel' && chat.type !== 'secret' && chat.type !== 'saved' && (
                <Button variant="secondary" onClick={() => removeMany(deleting, false)}>
                  Только у меня
                </Button>
              )}
              {(deleting.every((m) => m.sender?.id === me.id) || isAdmin || chat.type === 'saved') && (
                <Button variant="danger" onClick={() => removeMany(deleting, true)}>
                  {chat.type === 'saved' ? 'Удалить' : 'У всех'}
                </Button>
              )}
            </>
          }
        >
          <p className="muted">{chat.type === 'secret' ? 'Сообщения будут удалены у обоих участников.' : 'Это действие нельзя отменить.'}</p>
        </Modal>
      )}
    </>
  );
}
