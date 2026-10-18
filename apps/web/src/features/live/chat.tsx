/** Чат эфира или премьеры: сообщения в реальном времени, отправка по Enter. */
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Send } from 'lucide-react';
import type { LiveChatMessage } from '@omni/shared';
import { api, errorMessage } from '../../shared/api/client';
import { queryClient } from '../../shared/api/query';
import { toast } from '../../shared/stores/ui';
import { Avatar, IconButton } from '../../shared/ui';
import { roomKey } from './bus';

export function LiveChat({ room, initial, sendPath, disabled, title = 'Чат' }: { room: string; initial: LiveChatMessage[]; sendPath: string; disabled?: string | null; title?: string }) {
  const [text, setText] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
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
      queryClient.setQueryData<LiveChatMessage[]>(roomKey(room), (old) => (old?.some((x) => x.id === m.id) ? old : [...(old ?? []), m]));
    },
    onError: (e) => toast({ text: errorMessage(e), kind: 'error' }),
  });
  // Новое сообщение — прокрутка вниз, если читатель и так внизу
  useEffect(() => {
    const el = listRef.current;
    if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 120) el.scrollTop = el.scrollHeight;
  }, [messages.length]);
  const submit = () => {
    const t = text.trim();
    if (t && !send.isPending) send.mutate(t);
  };
  return (
    <section className="live-chat" aria-label={title}>
      <header className="live-chat__head">{title}</header>
      <div className="live-chat__list" ref={listRef} role="log" aria-live="polite">
        {messages.length === 0 && <p className="xs muted live-chat__empty">Здесь пока тихо — напишите первым</p>}
        {messages.map((m) => (
          <div key={m.id} className="live-chat__msg">
            <Link to={`/u/${m.user.username}`}>
              <Avatar src={m.user.avatarUrl} name={m.user.displayName} id={m.user.id} size={24} />
            </Link>
            <span>
              <b>{m.user.displayName}</b> {m.text}
            </span>
          </div>
        ))}
      </div>
      {disabled ? (
        <p className="xs muted live-chat__empty">{disabled}</p>
      ) : (
        <form
          className="live-chat__form"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <input className="input" placeholder="Сообщение в чат…" value={text} maxLength={500} onChange={(e) => setText(e.target.value)} aria-label="Сообщение в чат" />
          <IconButton label="Отправить" type="submit" disabled={!text.trim() || send.isPending}>
            <Send size={18} />
          </IconButton>
        </form>
      )}
    </section>
  );
}
