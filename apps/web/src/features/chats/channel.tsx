/**
 * Каналы как в Telegram: комментарии к постам, счётчик просмотров и блокировки.
 * Посты публикуют владелец и назначенные им администраторы, комментарии
 * модерируют администраторы.
 */
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Ban, Eye, MessageSquare, Send, Trash2, UserX } from 'lucide-react';
import type { ChatBan, ChatSummary, Message } from '@omni/shared';
import { api, errorMessage } from '../../shared/api/client';
import { qk, queryClient } from '../../shared/api/query';
import { useMe } from '../../shared/stores/session';
import { toast } from '../../shared/stores/ui';
import { chatTime, compactNumber, fullDate, plural, randomId } from '../../shared/lib/format';
import { Avatar, Button, confirm, EmptyState, IconButton, Loading, MediaGrid, Menu, Modal, RichText, UserName, useMenu } from '../../shared/ui';
import { patchMessage } from './cache';

interface Thread {
  root: Message;
  items: Message[];
  hasMore: boolean;
}

export const threadKey = (chatId: string, rootId: string) => ['comments', chatId, rootId] as const;

/** Новый комментарий из реального времени: в ветку и в счётчик поста. */
export function onIncomingComment(msg: Message): void {
  if (!msg.threadRootId) return;
  let added = false;
  queryClient.setQueryData<Thread>(threadKey(msg.chatId, msg.threadRootId), (old) => {
    if (!old || old.items.some((m) => m.id === msg.id || (!!msg.clientId && m.clientId === msg.clientId))) return old;
    added = true;
    return { ...old, items: [...old.items, msg], root: { ...old.root, commentCount: old.root.commentCount + 1 } };
  });
  const cached = queryClient.getQueryData<Thread>(threadKey(msg.chatId, msg.threadRootId));
  if (added || !cached) patchMessage(msg.chatId, (m) => m.id === msg.threadRootId, (m) => ({ ...m, commentCount: m.commentCount + 1 }));
}

/** Удалённый комментарий: убираем из открытых веток этого канала. */
export function onCommentDeleted(chatId: string, messageId: string): void {
  for (const [key, data] of queryClient.getQueriesData<Thread>({ queryKey: ['comments', chatId] })) {
    if (!data?.items.some((m) => m.id === messageId)) continue;
    queryClient.setQueryData<Thread>(key, { ...data, items: data.items.filter((m) => m.id !== messageId), root: { ...data.root, commentCount: Math.max(0, data.root.commentCount - 1) } });
    patchMessage(chatId, (m) => m.id === data.root.id, (m) => ({ ...m, commentCount: Math.max(0, m.commentCount - 1) }));
  }
}

/**
 * Учёт просмотров: пост считается просмотренным, когда больше половины его
 * видно на экране. Пачки уходят на сервер раз в полторы секунды.
 */
export function useViewTracker(chat: ChatSummary | undefined, root: React.RefObject<HTMLElement | null>, deps: unknown) {
  const seen = useRef(new Set<string>());
  const queue = useRef(new Set<string>());
  const chatId = chat?.type === 'channel' ? chat.id : null;
  useEffect(() => {
    seen.current = new Set();
  }, [chatId]);
  useEffect(() => {
    if (!chatId || !root.current) return;
    const flush = () => {
      if (!queue.current.size) return;
      const ids = [...queue.current].slice(0, 100);
      ids.forEach((id) => queue.current.delete(id));
      api
        .post<{ views: Record<string, number> }>(`/chats/${chatId}/views`, { messageIds: ids })
        .then((r) => patchMessage(chatId, (m) => m.id in r.views, (m) => ({ ...m, viewCount: Math.max(m.viewCount ?? 0, r.views[m.id] ?? 0) })))
        .catch(() => undefined);
    };
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const id = (e.target as HTMLElement).dataset.view;
          if (!e.isIntersecting || !id || seen.current.has(id)) continue;
          seen.current.add(id);
          queue.current.add(id);
        }
      },
      { root: root.current, threshold: 0.5 },
    );
    root.current.querySelectorAll<HTMLElement>('[data-view]').forEach((el) => io.observe(el));
    const t = window.setInterval(flush, 1500);
    return () => {
      io.disconnect();
      window.clearInterval(t);
      flush();
    };
  }, [chatId, root, deps]);
}

function CommentRow({ chat, m, onBan }: { chat: ChatSummary; m: Message; onBan: (userId: string, name: string) => void }) {
  const me = useMe();
  const menu = useMenu();
  const isAdmin = chat.role === 'owner' || chat.role === 'admin';
  const mine = m.sender?.id === me.id;
  const remove = async () => {
    if (!(await confirm({ title: 'Удалить комментарий?', danger: true, confirmLabel: 'Удалить' }))) return;
    try {
      await api.del(`/chats/${chat.id}/messages/${m.id}?forEveryone=true`);
      onCommentDeleted(chat.id, m.id);
    } catch (e) {
      toast({ text: errorMessage(e), kind: 'error' });
    }
  };
  return (
    <div className="chat-comment-row" onContextMenu={(e) => (mine || isAdmin) && menu.openFromEvent(e)}>
      {m.sender ? (
        <Link to={`/u/${m.sender.username}`}>
          <Avatar src={m.sender.avatarUrl} name={m.sender.displayName} id={m.sender.id} size={34} />
        </Link>
      ) : (
        <Avatar src={null} name="?" id={m.id} size={34} />
      )}
      <div className="chat-comment-row__body">
        <div className="row gap-2" style={{ justifyContent: 'space-between' }}>
          {m.sender ? <UserName user={m.sender} className="small" /> : <b className="small">Удалённый аккаунт</b>}
          <span className="xs faint">{chatTime(m.createdAt)}</span>
        </div>
        {m.media.length > 0 && <MediaGrid media={m.media} className="chat-comment-row__media" />}
        {m.text && <RichText text={m.text} className="small" />}
      </div>
      {(mine || isAdmin) && (
        <>
          <IconButton label="Действия" size="sm" onClick={(e) => menu.openFromEvent(e)}>
            ⋮
          </IconButton>
          <Menu
            anchor={menu.anchor}
            onClose={menu.close}
            items={[
              {
                label: 'Заблокировать автора',
                icon: <UserX size={18} />,
                hidden: !isAdmin || mine || !m.sender,
                onClick: () => m.sender && onBan(m.sender.id, m.sender.displayName),
              },
              { label: 'Удалить', icon: <Trash2 size={18} />, danger: true, onClick: () => void remove() },
            ]}
          />
        </>
      )}
    </div>
  );
}

/** Ветка комментариев к посту: сам пост сверху, обсуждение и поле ввода снизу. */
export function CommentsDialog({ chat, rootId, onClose }: { chat: ChatSummary; rootId: string; onClose: () => void }) {
  const [text, setText] = useState('');
  const [banning, setBanning] = useState<{ id: string; name: string } | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const q = useQuery({
    queryKey: threadKey(chat.id, rootId),
    queryFn: () => api.get<Thread>(`/chats/${chat.id}/messages/${rootId}/comments?limit=100`),
  });
  const send = useMutation({
    mutationFn: (body: string) => api.post<Message>(`/chats/${chat.id}/messages/${rootId}/comments`, { clientId: `k${randomId(12)}`, text: body }),
    onSuccess: (m) => {
      setText('');
      onIncomingComment(m);
      requestAnimationFrame(() => listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' }));
    },
    onError: (e) => toast({ text: errorMessage(e), kind: 'error' }),
  });
  const thread = q.data;
  const canComment = !!chat.role && chat.commentsEnabled;
  const submit = () => {
    const t = text.trim();
    if (t && !send.isPending) send.mutate(t);
  };

  return (
    <Modal open onClose={onClose} title={thread ? `${compactNumber(thread.root.commentCount)} ${plural(thread.root.commentCount, 'комментарий', 'комментария', 'комментариев')}` : 'Комментарии'} wide className="chat-comments-modal">
      {q.isLoading || !thread ? (
        <Loading />
      ) : (
        <div className="chat-comments">
          <div className="chat-comments__scroll" ref={listRef}>
            <article className="chat-comments__root">
              <div className="post-head">
                <Avatar src={chat.avatarUrl} name={chat.title} id={chat.id} size={28} />
                <b className="ellipsis">{chat.title}</b>
                <span className="xs faint" style={{ marginLeft: 'auto' }}>
                  {fullDate(thread.root.createdAt)}
                </span>
              </div>
              {thread.root.media.length > 0 && <MediaGrid media={thread.root.media} />}
              {thread.root.text && <RichText text={thread.root.text} />}
              {thread.root.viewCount !== null && (
                <span className="post-meta">
                  <Eye size={13} /> {compactNumber(thread.root.viewCount)}
                </span>
              )}
            </article>
            {thread.items.length === 0 ? (
              <EmptyState icon={<MessageSquare size={26} />} title="Пока без комментариев" text={canComment ? 'Будьте первым — напишите, что думаете' : undefined} />
            ) : (
              thread.items.map((m) => <CommentRow key={m.id} chat={chat} m={m} onBan={(id, name) => setBanning({ id, name })} />)
            )}
          </div>
          {canComment ? (
            <form
              className="chat-comments__composer"
              onSubmit={(e) => {
                e.preventDefault();
                submit();
              }}
            >
              <textarea
                className="input chat-comments__input"
                rows={1}
                placeholder="Комментарий…"
                value={text}
                maxLength={4000}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    submit();
                  }
                }}
                aria-label="Комментарий"
              />
              <IconButton label="Отправить" type="submit" disabled={!text.trim() || send.isPending}>
                <Send size={20} />
              </IconButton>
            </form>
          ) : (
            <p className="small muted center" style={{ padding: 12 }}>
              {chat.role ? 'Комментарии выключены владельцем канала' : 'Подпишитесь на канал, чтобы комментировать'}
            </p>
          )}
        </div>
      )}
      {banning && <BanDialog chat={chat} userId={banning.id} name={banning.name} onClose={() => setBanning(null)} />}
    </Modal>
  );
}

const BAN_TERMS = [
  { days: 1, label: 'На сутки' },
  { days: 7, label: 'На неделю' },
  { days: 30, label: 'На месяц' },
  { days: 0, label: 'Навсегда' },
];

export function BanDialog({ chat, userId, name, onClose }: { chat: ChatSummary; userId: string; name: string; onClose: () => void }) {
  const [days, setDays] = useState(7);
  const ban = useMutation({
    mutationFn: () => api.post(`/chats/${chat.id}/bans`, { userId, days }),
    onSuccess: () => {
      toast({ text: `${name} заблокирован(а)`, kind: 'success' });
      void queryClient.invalidateQueries({ queryKey: ['chat-bans', chat.id] });
      void queryClient.invalidateQueries({ queryKey: qk.members(chat.id) });
      onClose();
    },
    onError: (e) => toast({ text: errorMessage(e), kind: 'error' }),
  });
  return (
    <Modal
      open
      onClose={onClose}
      title={`Заблокировать ${name}?`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button variant="danger" icon={<Ban size={16} />} loading={ban.isPending} onClick={() => ban.mutate()}>
            Заблокировать
          </Button>
        </>
      }
    >
      <p className="muted small" style={{ marginTop: 0 }}>
        Человек будет исключён из {chat.type === 'channel' ? 'канала' : 'группы'} и не сможет вернуться, пока действует блокировка.
      </p>
      <div className="choice-grid">
        {BAN_TERMS.map((t) => (
          <button key={t.days} type="button" className={`choice-card ${days === t.days ? 'choice-card--on' : ''}`} onClick={() => setDays(t.days)} aria-pressed={days === t.days}>
            <b>{t.label}</b>
          </button>
        ))}
      </div>
    </Modal>
  );
}

/** Список заблокированных: снять блокировку может любой администратор. */
export function BansDialog({ chat, onClose }: { chat: ChatSummary; onClose: () => void }) {
  const q = useQuery({ queryKey: ['chat-bans', chat.id], queryFn: () => api.get<{ items: ChatBan[] }>(`/chats/${chat.id}/bans`) });
  const unban = useMutation({
    mutationFn: (userId: string) => api.del(`/chats/${chat.id}/bans/${userId}`),
    onSuccess: () => void q.refetch(),
    onError: (e) => toast({ text: errorMessage(e), kind: 'error' }),
  });
  return (
    <Modal open onClose={onClose} title="Заблокированные">
      {q.isLoading ? (
        <Loading />
      ) : !q.data?.items.length ? (
        <EmptyState icon={<UserX size={26} />} title="Никто не заблокирован" text="Заблокировать можно из меню участника или комментария" />
      ) : (
        q.data.items.map((b) => (
          <div key={b.user.id} className="list-item">
            <Avatar src={b.user.avatarUrl} name={b.user.displayName} id={b.user.id} size={40} />
            <span className="list-item__body">
              <UserName user={b.user} />
              <span className="list-item__sub">{b.until ? `до ${fullDate(b.until)}` : 'навсегда'}</span>
            </span>
            <Button size="sm" variant="secondary" loading={unban.isPending && unban.variables === b.user.id} onClick={() => unban.mutate(b.user.id)}>
              Разблокировать
            </Button>
          </div>
        ))
      )}
    </Modal>
  );
}
