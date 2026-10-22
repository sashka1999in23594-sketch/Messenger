import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Check, Search } from 'lucide-react';
import type { ChatSummary, Message, UserSummary } from '@omni/shared';
import { api, errorMessage } from '../../shared/api/client';
import { flatPages, qk, useCursorList } from '../../shared/api/query';
import { useDebounced } from '../../shared/hooks';
import { clockTime, dayLabel, plural } from '../../shared/lib/format';
import { ChatAvatar } from './ChatList';
import { toast } from '../../shared/stores/ui';
import { Avatar, Button, EmptyState, Modal, RichText, Spinner, UserName } from '../../shared/ui';
import type { LocalMessage } from './cache';

/** Выбор пользователя теперь общий — в shared/ui */
export { UserPicker } from '../../shared/ui';

/** Переслать одно или несколько сообщений в один или несколько чатов. */
export function ForwardDialog({ chatId, message, messages, onClose }: { chatId: string; message?: LocalMessage; messages?: LocalMessage[]; onClose: () => void }) {
  const list_ = messages ?? (message ? [message] : []);
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const navigate = useNavigate();
  const list = useCursorList<ChatSummary>(qk.chats('all'), '/chats?folder=all', { limit: 100 });
  const chats = flatPages(list.data).filter(
    (c) => c.type !== 'secret' && (c.type !== 'channel' || c.role === 'owner' || c.role === 'admin') && c.title.toLowerCase().includes(q.trim().toLowerCase()),
  );
  const send = useMutation({
    mutationFn: async () => {
      // По порядку, чтобы в чате-получателе сообщения шли как в оригинале
      for (const m of [...list_].sort((a, b) => a.seq - b.seq)) await api.post<{ items: Message[] }>(`/chats/${chatId}/messages/${m.id}/forward`, { toChatIds: picked });
    },
    onSuccess: () => {
      const what = list_.length > 1 ? `${list_.length} ${plural(list_.length, 'сообщение', 'сообщения', 'сообщений')}` : 'Сообщение';
      toast({ text: picked.length > 1 ? `${what}: переслано в ${picked.length} ${plural(picked.length, 'чат', 'чата', 'чатов')}` : `${what} — переслано`, kind: 'success' });
      onClose();
      if (picked.length === 1) navigate(`/chats/${picked[0]}`);
    },
    onError: (e) => toast({ text: errorMessage(e), kind: 'error' }),
  });
  return (
    <Modal
      open
      onClose={onClose}
      title={list_.length > 1 ? `Переслать ${list_.length} ${plural(list_.length, 'сообщение', 'сообщения', 'сообщений')}` : 'Переслать'}
      footer={
        <Button disabled={!picked.length} loading={send.isPending} onClick={() => send.mutate()}>
          Переслать{picked.length > 1 ? ` (${picked.length})` : ''}
        </Button>
      }
    >
      <div className="input-group" style={{ marginBottom: 8 }}>
        <Search size={16} className="input-group__icon" />
        <input className="input" placeholder="Поиск чата" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
      </div>
      {chats.map((c) => {
        const on = picked.includes(c.id);
        return (
          <button
            key={c.id}
            className={on ? 'pick-row pick-row--on' : 'pick-row'}
            style={{ width: '100%' }}
            onClick={() => setPicked((p) => (on ? p.filter((x) => x !== c.id) : [...p, c.id]))}
          >
            <ChatAvatar chat={c} size={42} />
            <span className="list-item__body ellipsis">{c.title}</span>
            <span className="pick-row__check">{on && <Check size={14} strokeWidth={3} />}</span>
          </button>
        );
      })}
    </Modal>
  );
}

export function InChatSearch({ chatId, onClose, onJump }: { chatId: string; onClose: () => void; onJump?: (m: Message) => void }) {
  const [q, setQ] = useState('');
  const debounced = useDebounced(q.trim(), 300);
  const res = useQuery({
    queryKey: ['chat-search', chatId, debounced],
    queryFn: () => api.get<{ items: Message[] }>(`/chats/${chatId}/search?q=${encodeURIComponent(debounced)}`),
    enabled: debounced.length > 0,
  });
  return (
    <Modal open onClose={onClose} title="Поиск в чате">
      <div className="input-group" style={{ marginBottom: 8 }}>
        <Search size={16} className="input-group__icon" />
        <input className="input" placeholder="Текст сообщения" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
      </div>
      {res.isFetching && <Spinner />}
      {res.data?.items.length === 0 && <EmptyState title="Ничего не найдено" />}
      {res.data?.items.map((m) => (
        <button
          type="button"
          key={m.id}
          className="list-item"
          style={{ alignItems: 'flex-start', borderRadius: 12 }}
          onClick={() => {
            onJump?.(m);
            onClose();
          }}
        >
          {m.sender && <Avatar src={m.sender.avatarUrl} name={m.sender.displayName} id={m.sender.id} size={36} />}
          <div className="list-item__body">
            <div className="row between">
              {m.sender && <UserName user={m.sender} />}
              <span className="xs faint">
                {dayLabel(m.createdAt)}, {clockTime(m.createdAt)}
              </span>
            </div>
            <RichText text={m.text ?? ''} className="small" />
          </div>
        </button>
      ))}
    </Modal>
  );
}

/** Поиск и выбор пользователей (для новых чатов, групп, добавления участников). */
