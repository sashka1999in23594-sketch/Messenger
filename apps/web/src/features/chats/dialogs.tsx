import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Check, Search } from 'lucide-react';
import type { ChatSummary, Message, UserSummary } from '@omni/shared';
import { api, errorMessage } from '../../shared/api/client';
import { flatPages, qk, useCursorList } from '../../shared/api/query';
import { useDebounced } from '../../shared/hooks';
import { clockTime, dayLabel } from '../../shared/lib/format';
import { toast } from '../../shared/stores/ui';
import { useMe } from '../../shared/stores/session';
import { Avatar, Button, EmptyState, Modal, RichText, Spinner, UserName } from '../../shared/ui';
import type { LocalMessage } from './cache';

export function ForwardDialog({ chatId, message, onClose }: { chatId: string; message: LocalMessage; onClose: () => void }) {
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const navigate = useNavigate();
  const list = useCursorList<ChatSummary>(qk.chats('all'), '/chats?folder=all', { limit: 100 });
  const chats = flatPages(list.data).filter(
    (c) => c.type !== 'secret' && (c.type !== 'channel' || c.role === 'owner' || c.role === 'admin') && c.title.toLowerCase().includes(q.trim().toLowerCase()),
  );
  const send = useMutation({
    mutationFn: () => api.post<{ items: Message[] }>(`/chats/${chatId}/messages/${message.id}/forward`, { toChatIds: picked }),
    onSuccess: () => {
      toast({ text: picked.length > 1 ? `Переслано в ${picked.length} чата` : 'Сообщение переслано', kind: 'success' });
      onClose();
      if (picked.length === 1) navigate(`/chats/${picked[0]}`);
    },
    onError: (e) => toast({ text: errorMessage(e), kind: 'error' }),
  });
  return (
    <Modal
      open
      onClose={onClose}
      title="Переслать"
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
          <button key={c.id} className="list-item" style={{ borderRadius: 12 }} onClick={() => setPicked((p) => (on ? p.filter((x) => x !== c.id) : [...p, c.id]))}>
            <Avatar src={c.avatarUrl} name={c.title} id={c.peer?.id ?? c.id} size={40} />
            <span className="list-item__body ellipsis">{c.title}</span>
            <span className={on ? 'badge' : 'badge badge--muted'} style={{ opacity: on ? 1 : 0.25 }}>
              <Check size={12} />
            </span>
          </button>
        );
      })}
    </Modal>
  );
}

export function InChatSearch({ chatId, onClose }: { chatId: string; onClose: () => void }) {
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
        <div key={m.id} className="list-item" style={{ alignItems: 'flex-start' }}>
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
        </div>
      ))}
    </Modal>
  );
}

/** Поиск и выбор пользователей (для новых чатов, групп, добавления участников). */
export function UserPicker({ multiple, onPick, picked = [], exclude = [] }: { multiple?: boolean; onPick: (u: UserSummary) => void; picked?: string[]; exclude?: string[] }) {
  const [q, setQ] = useState('');
  const debounced = useDebounced(q.trim(), 250);
  const me = useMe();
  // Без запроса показываем контакты (подписки), затем рекомендации
  const suggestions = useQuery({
    queryKey: ['picker-contacts', me.id],
    queryFn: async () => {
      const [following, suggested] = await Promise.all([
        api.get<{ items: UserSummary[] }>(`/users/${me.id}/following?limit=50`),
        api.get<{ items: UserSummary[] }>('/users/suggestions'),
      ]);
      const seen = new Set<string>();
      return { items: [...following.items, ...suggested.items].filter((u) => !seen.has(u.id) && seen.add(u.id)) };
    },
  });
  const search = useQuery({
    queryKey: ['user-search', debounced],
    queryFn: () => api.get<{ users: UserSummary[] }>(`/search?type=users&limit=20&q=${encodeURIComponent(debounced)}`),
    enabled: debounced.length > 0,
  });
  const users = (debounced ? search.data?.users : suggestions.data?.items) ?? [];
  return (
    <div className="col">
      <div className="input-group">
        <Search size={16} className="input-group__icon" />
        <input className="input" placeholder="Имя или @username" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {!debounced && <div className="section-nav__group-label" style={{ paddingLeft: 4 }}>Контакты и рекомендации</div>}
      {(search.isFetching || suggestions.isLoading) && <Spinner />}
      {users
        .filter((u) => !exclude.includes(u.id))
        .map((u) => {
          const on = picked.includes(u.id);
          return (
            <button key={u.id} className="list-item" style={{ borderRadius: 12, paddingLeft: 8 }} onClick={() => onPick(u)}>
              <Avatar src={u.avatarUrl} name={u.displayName} id={u.id} size={42} />
              <span className="list-item__body">
                <UserName user={u} />
                <span className="list-item__sub" style={{ display: 'block' }}>
                  @{u.username}
                </span>
              </span>
              {multiple && (
                <span className={on ? 'badge' : 'badge badge--muted'} style={{ opacity: on ? 1 : 0.25 }}>
                  <Check size={12} />
                </span>
              )}
            </button>
          );
        })}
      {debounced && search.data && users.length === 0 && <div className="muted small" style={{ padding: 12 }}>Никого не нашли</div>}
    </div>
  );
}
