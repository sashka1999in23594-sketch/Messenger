/**
 * Чат эфира или премьеры: сообщения в реальном времени, отправка по Enter,
 * плашка автора канала, упоминания вас, кнопка «к новым сообщениям»,
 * эмодзи и счётчик символов.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ArrowDown, MessageSquareOff, PanelRightClose, Send, Smile } from 'lucide-react';
import type { LiveChatMessage } from '@omni/shared';
import { api, errorMessage } from '../../shared/api/client';
import { queryClient } from '../../shared/api/query';
import { useMe } from '../../shared/stores/session';
import { toast } from '../../shared/stores/ui';
import { clockTime, cn } from '../../shared/lib/format';
import { Avatar, EmojiPicker } from '../../shared/ui';
import { roomKey } from './bus';

const MAX = 200;

export function LiveChat({
  room,
  initial,
  sendPath,
  disabled,
  title = 'Чат',
  subtitle,
  ownerId,
  onClose,
}: {
  room: string;
  initial: LiveChatMessage[];
  sendPath: string;
  disabled?: string | null;
  title?: string;
  subtitle?: string;
  /** Автор эфира или премьеры — его имя выделяется плашкой */
  ownerId?: string;
  /** Скрыть чат (на широком экране) */
  onClose?: () => void;
}) {
  const me = useMe();
  const [text, setText] = useState('');
  const [emoji, setEmoji] = useState(false);
  const [stuck, setStuck] = useState(true);
  const [unread, setUnread] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const q = useQuery({ queryKey: roomKey(room), queryFn: () => initial, initialData: initial, staleTime: Infinity });
  const messages = q.data;
  // Свежая история с сервера дополняет то, что уже пришло в реальном времени
  useEffect(() => {
    queryClient.setQueryData<LiveChatMessage[]>(roomKey(room), (old) => {
      const seen = new Set(initial.map((m) => m.id));
      return [...initial, ...(old ?? []).filter((m) => !seen.has(m.id))].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    });
  }, [room, initial]);
  const send = useMutation({
    mutationFn: (t: string) => api.post<LiveChatMessage>(sendPath, { text: t }),
    onSuccess: (m) => {
      setText('');
      setStuck(true);
      queryClient.setQueryData<LiveChatMessage[]>(roomKey(room), (old) => (old?.some((x) => x.id === m.id) ? old : [...(old ?? []), m]));
    },
    onError: (e) => toast({ text: errorMessage(e), kind: 'error' }),
  });
  // Новое сообщение — прокрутка вниз, если читатель внизу; иначе — счётчик непрочитанных
  const prevLen = useRef(messages.length);
  useLayoutEffect(() => {
    const el = listRef.current;
    const added = messages.length - prevLen.current;
    prevLen.current = messages.length;
    if (!el) return;
    if (stuck) el.scrollTop = el.scrollHeight;
    else if (added > 0) setUnread((n) => n + added);
  }, [messages.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const onScroll = () => {
    const el = listRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    setStuck(atBottom);
    if (atBottom) setUnread(0);
  };
  const toBottom = () => {
    const el = listRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    setUnread(0);
    setStuck(true);
  };
  const submit = () => {
    const t = text.trim();
    if (t && !send.isPending) send.mutate(t);
  };
  const mention = `@${me.username}`.toLowerCase();

  return (
    <section className="live-chat" aria-label={title}>
      <header className="live-chat__head">
        <span className="live-chat__titles">
          <b>{title}</b>
          {subtitle && <span className="live-chat__sub">{subtitle}</span>}
        </span>
        {onClose && (
          <button type="button" className="live-chat__icon" onClick={onClose} aria-label="Скрыть чат" title="Скрыть чат">
            <PanelRightClose size={18} />
          </button>
        )}
      </header>
      <div className="live-chat__list" ref={listRef} role="log" aria-live="polite" onScroll={onScroll}>
        <p className="live-chat__welcome">Добро пожаловать в чат. Соблюдайте правила сообщества.</p>
        {messages.length === 0 && <p className="live-chat__empty">Здесь пока тихо — напишите первым</p>}
        {messages.map((m) => {
          const owner = m.user.id === ownerId;
          const mine = m.user.id === me.id;
          const mentioned = !mine && m.text.toLowerCase().includes(mention);
          return (
            <div key={m.id} className={cn('live-chat__msg', mentioned && 'live-chat__msg--mention')}>
              <Link to={`/u/${m.user.username}`} className="live-chat__avatar" tabIndex={-1}>
                <Avatar src={m.user.avatarUrl} name={m.user.displayName} id={m.user.id} size={24} />
              </Link>
              <span className="live-chat__body">
                <span className="live-chat__time">{clockTime(m.createdAt)}</span>
                <Link to={`/u/${m.user.username}`} className={cn('live-chat__name', owner && 'live-chat__name--owner', mine && !owner && 'live-chat__name--me')}>
                  {m.user.displayName}
                </Link>
                <span className="live-chat__text">{m.text}</span>
              </span>
            </div>
          );
        })}
      </div>
      {unread > 0 && !stuck && (
        <button type="button" className="live-chat__new" onClick={toBottom}>
          <ArrowDown size={16} /> {unread > 99 ? '99+' : unread} новых
        </button>
      )}
      {disabled ? (
        <p className="live-chat__closed">
          <MessageSquareOff size={16} /> {disabled}
        </p>
      ) : (
        <form
          className="live-chat__form"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <div className="live-chat__who">
            <Avatar src={me.avatarUrl} name={me.displayName} id={me.id} size={24} />
            <span className="ellipsis">{me.displayName}</span>
          </div>
          <div className="live-chat__field">
            <input
              ref={inputRef}
              className="live-chat__input"
              placeholder="Написать в чат…"
              value={text}
              maxLength={MAX}
              onChange={(e) => setText(e.target.value)}
              aria-label="Сообщение в чат"
            />
            <button type="button" className="live-chat__icon" onClick={() => setEmoji((v) => !v)} aria-label="Эмодзи" aria-expanded={emoji}>
              <Smile size={18} />
            </button>
            <span className={cn('live-chat__count', text.length > MAX - 20 && 'live-chat__count--warn')}>
              {text.length}/{MAX}
            </span>
            <button type="submit" className="live-chat__send" disabled={!text.trim() || send.isPending} aria-label="Отправить">
              <Send size={18} />
            </button>
          </div>
          {emoji && (
            <div className="live-chat__emoji">
              <EmojiPicker
                onPick={(e) => {
                  setText((t) => (t + e).slice(0, MAX));
                  inputRef.current?.focus();
                }}
                onClose={() => setEmoji(false)}
              />
            </div>
          )}
        </form>
      )}
    </section>
  );
}
