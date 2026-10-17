import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { useInfiniteQuery, useMutation, useQuery, type InfiniteData } from '@tanstack/react-query';
import { ArrowDown, ArrowLeft, Ban, Bell, BellOff, CalendarClock, Eraser, Flag, Info, Lock, LogOut, Megaphone, Pin, Search, ShieldAlert, Trash2, X } from 'lucide-react';
import type { ChatSummary, EncryptedPayload, Message, PollInput, ScheduledMessage } from '@omni/shared';
import { api, errorMessage } from '../../shared/api/client';
import { qk, queryClient } from '../../shared/api/query';
import { encryptMessage } from '../../shared/crypto/e2e';
import { realtime } from '../../shared/realtime/socket';
import { useRealtime } from '../../shared/stores/realtime';
import { useMe } from '../../shared/stores/session';
import { toast, useCrumb } from '../../shared/stores/ui';
import { activityLabel, cn, fullDate, lastSeen, members, randomId } from '../../shared/lib/format';
import { Avatar, Button, confirm, ErrorState, IconButton, Loading, Menu, Modal, ReportDialog, useMenu, Verified } from '../../shared/ui';
import { useImmersive } from '../../app/layout/Shell';
import { activeChat, forgetChat, onIncomingMessage, patchChat, patchMessage, removeMessage, upsertMessage, type LocalMessage, type MessagesPage } from './cache';
import { Composer, type ComposerSubmit } from './Composer';
import { ForwardDialog, InChatSearch } from './dialogs';
import { ReadersDialog, ScheduledListDialog, scheduledKey } from './extras';
import { MessageList, type MessageActions } from './Messages';
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

export function ChatView() {
  const { chatId = '' } = useParams();
  const me = useMe();
  const navigate = useNavigate();
  useImmersive(true);
  const toggleInfo = useChatUi((s) => s.toggleInfo);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [atBottom, setAtBottom] = useState(true);
  const [replyTo, setReplyTo] = useState<LocalMessage | null>(null);
  const [editing, setEditing] = useState<{ msg: LocalMessage; text: string } | null>(null);
  const [forwarding, setForwarding] = useState<LocalMessage | null>(null);
  const [reporting, setReporting] = useState<{ type: 'message' | 'chat' | 'user'; id: string } | null>(null);
  const [deleting, setDeleting] = useState<LocalMessage | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [readersOf, setReadersOf] = useState<LocalMessage | null>(null);
  const [scheduledOpen, setScheduledOpen] = useState(false);
  const [params, setParams] = useSearchParams();
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
  useEffect(() => {
    activeChat.id = chatId;
    setReplyTo(null);
    setEditing(null);
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
      } catch (e) {
        patchMessage(chatId, (m) => m.clientId === body.clientId, (m) => ({ ...m, local: { status: 'failed', error: errorMessage(e) } }));
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
      remove: (m) => (m.local ? removeMessage(chatId, m.id) : setDeleting(m)),
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
        patchMessage(chatId, (x) => x.clientId === m.clientId, (x) => ({ ...x, local: { status: 'sending' } }));
        void deliver(body);
      },
      copy: (text) => {
        void navigator.clipboard.writeText(text).then(() => toast('Текст скопирован'));
      },
      readers: (m) => setReadersOf(m),
    }),
    [chatId, chat?.pinnedMessage?.id, deliver],
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
      toast({ text: c.type === 'channel' ? 'Вы подписались на канал' : 'Вы вступили в группу', kind: 'success' });
    },
  });

  if (chatQ.isLoading) return <Loading />;
  if (chatQ.error || !chat) return <ErrorState error={chatQ.error} onRetry={() => void chatQ.refetch()} />;

  const typingOthers = (typing ?? []).filter((t) => t.userId !== me.id);
  const subtitle = typingOthers.length
    ? activityLabel(typingOthers[0]!.activity, chat.type === 'group' ? typingOthers.map((t) => t.name.split(' ')[0]).join(', ') : undefined)
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
  const canWrite = isMember && (chat.type !== 'channel' || isAdmin) && (chat.type !== 'secret' || secret.status === 'ready');

  const removeChat = async () => {
    const leaving = (chat.type === 'group' || chat.type === 'channel') && chat.role !== 'owner';
    const ok = await confirm({ title: leaving ? `Покинуть «${chat.title}»?` : 'Удалить чат?', danger: true, confirmLabel: leaving ? 'Покинуть' : 'Удалить' });
    if (!ok) return;
    await api.del(`/chats/${chatId}`);
    forgetChat(chatId);
    navigate('/chats');
  };

  return (
    <>
      <header className="chat-header">
        <IconButton label="К списку чатов" className="mobile-only" onClick={() => navigate('/chats')}>
          <ArrowLeft size={22} />
        </IconButton>
        <button className="chat-header__info" onClick={toggleInfo}>
          <Avatar src={chat.avatarUrl} name={chat.title} id={chat.peer?.id ?? chat.id} size={42} online={presence?.online} />
          <span className="col" style={{ gap: 0, minWidth: 0 }}>
            <span className="chat-header__title">
              {chat.type === 'secret' && <Lock size={15} style={{ color: 'var(--success)' }} />}
              {chat.type === 'channel' && <Megaphone size={15} className="faint" />}
              <span className="ellipsis">{chat.title}</span>
              {chat.peer?.verified && <Verified size={15} />}
              {muted && <BellOff size={14} className="faint" />}
            </span>
            <span className={cn('chat-header__sub ellipsis', typingOthers.length > 0 || presence?.online ? 'chat-header__sub--accent' : '')}>{subtitle}</span>
          </span>
        </button>
        {scheduledCount > 0 && (
          <IconButton label="Отложенные сообщения" onClick={() => setScheduledOpen(true)}>
            <CalendarClock size={20} />
            <span className="badge header-badge">{scheduledCount}</span>
          </IconButton>
        )}
        {chat.type !== 'secret' && (
          <IconButton label="Поиск в чате" onClick={() => setSearchOpen(true)}>
            <Search size={20} />
          </IconButton>
        )}
        <IconButton label="Информация" onClick={toggleInfo} className="desktop-only">
          <Info size={20} />
        </IconButton>
        <IconButton label="Ещё" onClick={(e) => headerMenu.openFromEvent(e)}>
          <span style={{ fontWeight: 900, fontSize: 18, lineHeight: 1 }}>⋮</span>
        </IconButton>
      </header>

      {chat.pinnedMessage && (
        <button className="pinned-bar" onClick={() => toast(chat.pinnedMessage?.text ?? 'Закреплённое сообщение')}>
          <span className="pinned-bar__line" />
          <Pin size={16} className="faint" />
          <span className="col grow" style={{ gap: 0, minWidth: 0 }}>
            <span className="bold" style={{ color: 'var(--accent-fg)' }}>
              Закреплённое сообщение
            </span>
            <span className="ellipsis muted">{chat.pinnedMessage.kind === 'encrypted' ? '🔒 Зашифрованное сообщение' : chat.pinnedMessage.text || 'Вложение'}</span>
          </span>
          {(isAdmin || chat.type === 'direct' || chat.type === 'saved' || chat.type === 'secret') && (
            <span
              role="button"
              tabIndex={0}
              className="icon-btn icon-btn--sm"
              aria-label="Открепить"
              onClick={(e) => {
                e.stopPropagation();
                void api.post<ChatSummary>(`/chats/${chatId}/pin`, { messageId: null }).then((c) => queryClient.setQueryData(qk.chat(chatId), c));
              }}
            >
              <X size={16} />
            </span>
          )}
        </button>
      )}

      {chat.type === 'secret' && secret.status === 'wrong-device' && (
        <div className="notice notice--warning" style={{ margin: 10, borderRadius: 12 }}>
          <ShieldAlert size={18} />
          <div>Этот секретный чат привязан к другому устройству. Ключи никогда не покидают устройство, поэтому переписку можно читать только там.</div>
        </div>
      )}

      {msgsQ.isLoading ? (
        <Loading />
      ) : (
        <MessageList
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
        <button className="scroll-down" onClick={scrollToBottom} aria-label="Вниз">
          <ArrowDown size={22} />
          {chat.unreadCount > 0 && <span className="badge" style={{ position: 'absolute', top: -6, right: -2 }}>{chat.unreadCount}</span>}
        </button>
      )}

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
            await api.post(`/chats/${chatId}/scheduled`, { text: d.text || undefined, mediaIds: d.mediaIds, replyToId: d.replyTo?.id, silent: !!d.silent, sendAt: at.toISOString() });
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
              <Button variant="secondary" pill icon={muted ? <Bell size={18} /> : <BellOff size={18} />} onClick={() => prefs.mutate({ mutedUntil: muted ? null : new Date(Date.now() + 365 * 86400_000).toISOString() })}>
                {muted ? 'Включить уведомления' : 'Выключить уведомления'}
              </Button>
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
            hidden: chat.type !== 'direct' || !chat.peer,
            danger: true,
            onClick: async () => {
              if (!(await confirm({ title: `Заблокировать ${chat.peer!.displayName}?`, text: 'Пользователь не сможет писать вам и видеть ваши публикации.', danger: true, confirmLabel: 'Заблокировать' }))) return;
              await api.post(`/users/${chat.peer!.id}/block`);
              toast({ text: 'Пользователь заблокирован', kind: 'success' });
            },
          },
          { label: 'Пожаловаться', icon: <Flag size={18} />, hidden: chat.type === 'saved', onClick: () => setReporting(chat.peer ? { type: 'user', id: chat.peer.id } : { type: 'chat', id: chat.id }) },
          'separator',
          {
            label: (chat.type === 'group' || chat.type === 'channel') && chat.role !== 'owner' ? 'Покинуть' : 'Удалить чат',
            icon: (chat.type === 'group' || chat.type === 'channel') && chat.role !== 'owner' ? <LogOut size={18} /> : <Trash2 size={18} />,
            danger: true,
            hidden: !isMember,
            onClick: () => void removeChat(),
          },
        ]}
      />
      {forwarding && <ForwardDialog chatId={chatId} message={forwarding} onClose={() => setForwarding(null)} />}
      {reporting && <ReportDialog open entityType={reporting.type} entityId={reporting.id} onClose={() => setReporting(null)} />}
      {searchOpen && <InChatSearch chatId={chatId} onClose={() => setSearchOpen(false)} />}
      {readersOf && <ReadersDialog chatId={chatId} messageId={readersOf.id} onClose={() => setReadersOf(null)} />}
      {scheduledOpen && <ScheduledListDialog chatId={chatId} onClose={() => setScheduledOpen(false)} />}
      {deleting && (
        <Modal
          open
          onClose={() => setDeleting(null)}
          title="Удалить сообщение?"
          footer={
            <>
              <Button variant="ghost" onClick={() => setDeleting(null)}>
                Отмена
              </Button>
              {chat.type !== 'channel' && chat.type !== 'secret' && chat.type !== 'saved' && (
                <Button
                  variant="secondary"
                  onClick={() => {
                    const m = deleting;
                    setDeleting(null);
                    removeMessage(chatId, m.id);
                    void api.del(`/chats/${chatId}/messages/${m.id}?forEveryone=false`);
                  }}
                >
                  Только у меня
                </Button>
              )}
              {(deleting.sender?.id === me.id || isAdmin || chat.type === 'saved') && (
                <Button
                  variant="danger"
                  onClick={() => {
                    const m = deleting;
                    setDeleting(null);
                    removeMessage(chatId, m.id);
                    void api.del(`/chats/${chatId}/messages/${m.id}?forEveryone=true`).catch((e) => toast({ text: errorMessage(e), kind: 'error' }));
                  }}
                >
                  {chat.type === 'saved' ? 'Удалить' : 'У всех'}
                </Button>
              )}
            </>
          }
        >
          <p className="muted">{chat.type === 'secret' ? 'Сообщение будет удалено у обоих участников.' : 'Это действие нельзя отменить.'}</p>
        </Modal>
      )}
    </>
  );
}
