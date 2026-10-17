import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Lock, Megaphone, MessageCircle, Users, X } from 'lucide-react';
import { SECRET_TTL_OPTIONS, type ChatSummary, type UserSummary } from '@omni/shared';
import { api, ApiError, errorMessage } from '../../shared/api/client';
import { qk, queryClient } from '../../shared/api/query';
import { getIdentity, isE2ESupported, registerDevice } from '../../shared/crypto/e2e';
import { toast } from '../../shared/stores/ui';
import { Avatar, Button, Input, Notice, PageHeader, Switch, Textarea, TabLinks } from '../../shared/ui';
import { UserPicker } from './dialogs';

const KINDS = {
  direct: { title: 'Новый чат', icon: <MessageCircle size={22} />, text: 'Выберите, кому написать' },
  group: { title: 'Новая группа', icon: <Users size={22} />, text: 'Общий чат для нескольких человек' },
  channel: { title: 'Новый канал', icon: <Megaphone size={22} />, text: 'Публикации для неограниченной аудитории' },
  secret: { title: 'Секретный чат', icon: <Lock size={22} />, text: 'Сквозное шифрование, только на этом устройстве' },
} as const;

function useOpen() {
  const navigate = useNavigate();
  return (c: ChatSummary) => {
    void queryClient.invalidateQueries({ queryKey: qk.chatsAll });
    queryClient.setQueryData(qk.chat(c.id), c);
    navigate(`/chats/${c.id}`, { replace: true });
  };
}

function DirectForm() {
  const open = useOpen();
  const start = useMutation({
    mutationFn: (u: UserSummary) => api.post<ChatSummary>('/chats/direct', { userId: u.id }),
    onSuccess: open,
    onError: (e) => toast({ text: errorMessage(e), kind: 'error' }),
  });
  return <UserPicker onPick={(u) => start.mutate(u)} />;
}

function GroupForm() {
  const open = useOpen();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [members, setMembers] = useState<UserSummary[]>([]);
  const create = useMutation({
    mutationFn: () => api.post<ChatSummary & { skipped: string[] }>('/chats/group', { title, description, memberIds: members.map((m) => m.id) }),
    onSuccess: (c) => {
      if (c.skipped.length) toast(`Не удалось добавить ${c.skipped.length}: их настройки приватности не позволяют`);
      open(c);
    },
    onError: (e) => toast({ text: errorMessage(e), kind: 'error' }),
  });
  return (
    <div className="col gap-4">
      <Input label="Название группы" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={128} autoFocus />
      <Textarea label="Описание" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={1000} rows={2} />
      {members.length > 0 && (
        <div className="user-pick">
          {members.map((m) => (
            <button key={m.id} className="chip" onClick={() => setMembers((l) => l.filter((x) => x.id !== m.id))}>
              <Avatar src={m.avatarUrl} name={m.displayName} id={m.id} size={20} /> {m.displayName} <X size={14} />
            </button>
          ))}
        </div>
      )}
      <div className="field__label">Участники</div>
      <UserPicker
        multiple
        picked={members.map((m) => m.id)}
        onPick={(u) => setMembers((l) => (l.some((x) => x.id === u.id) ? l.filter((x) => x.id !== u.id) : [...l, u]))}
      />
      <Button size="lg" disabled={!title.trim()} loading={create.isPending} onClick={() => create.mutate()}>
        Создать группу{members.length ? ` (${members.length + 1})` : ''}
      </Button>
    </div>
  );
}

function ChannelForm() {
  const open = useOpen();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [handle, setHandle] = useState('');
  const [isPublic, setPublic] = useState(true);
  const [fields, setFields] = useState<Record<string, string>>({});
  const create = useMutation({
    mutationFn: () => api.post<ChatSummary>('/chats/channel', { title, description, isPublic, handle: isPublic && handle ? handle : null }),
    onSuccess: open,
    onError: (e) => {
      if (e instanceof ApiError && e.fields) setFields(e.fields);
      toast({ text: errorMessage(e), kind: 'error' });
    },
  });
  return (
    <div className="col gap-4">
      <Input label="Название канала" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={128} autoFocus error={fields.title} />
      <Textarea label="Описание" value={description} onChange={(e) => setDescription(e.target.value)} rows={3} maxLength={1000} />
      <div className="card">
        <div className="list-item">
          <span className="list-item__body">
            <span className="list-item__title" style={{ display: 'block' }}>
              Публичный канал
            </span>
            <span className="list-item__sub">Его можно найти в поиске и каталоге</span>
          </span>
          <Switch checked={isPublic} onChange={setPublic} label="Публичный канал" />
        </div>
      </div>
      {isPublic && (
        <Input
          label="Короткая ссылка"
          value={handle}
          onChange={(e) => setHandle(e.target.value.toLowerCase())}
          placeholder="my_channel"
          hint="Латинские буквы, цифры и _ (от 3 символов)"
          error={fields.handle}
        />
      )}
      <Button size="lg" disabled={!title.trim()} loading={create.isPending} onClick={() => create.mutate()}>
        Создать канал
      </Button>
    </div>
  );
}

function SecretForm() {
  const open = useOpen();
  const [ttl, setTtl] = useState(0);
  const supported = isE2ESupported();
  const device = useQuery({ queryKey: ['device-id'], queryFn: async () => (await registerDevice()) ?? (await getIdentity()).deviceId, enabled: supported });
  const start = useMutation({
    mutationFn: (u: UserSummary) => api.post<ChatSummary>('/chats/secret', { userId: u.id, myDeviceId: device.data, ttlSeconds: ttl }),
    onSuccess: open,
    onError: (e) => toast({ text: errorMessage(e), kind: 'error' }),
  });
  if (!supported) return <Notice kind="danger">Этот браузер не поддерживает Web Crypto API — секретные чаты недоступны.</Notice>;
  return (
    <div className="col gap-4">
      <Notice icon={<Lock size={18} />}>
        Сообщения шифруются на вашем устройстве ключом, который знают только два участника. Сервер хранит лишь шифротекст и не может его прочитать. Чат будет доступен
        только на этом устройстве.
      </Notice>
      <label className="col" style={{ gap: 6 }}>
        <span className="field__label">Таймер самоуничтожения сообщений</span>
        <select className="select" value={ttl} onChange={(e) => setTtl(Number(e.target.value))}>
          {SECRET_TTL_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {s === 0 ? 'Выключен' : s < 60 ? `${s} секунд` : s < 3600 ? `${s / 60} мин` : s < 86400 ? `${s / 3600} ч` : s < 604800 ? `${s / 86400} дн` : '1 неделя'}
            </option>
          ))}
        </select>
      </label>
      <div className="field__label">Собеседник</div>
      <UserPicker onPick={(u) => device.data && start.mutate(u)} />
    </div>
  );
}

export function NewChatPage() {
  const { kind = 'direct' } = useParams();
  const k = (kind in KINDS ? kind : 'direct') as keyof typeof KINDS;
  const meta = KINDS[k];
  return (
    <div className="scroll" style={{ background: 'var(--bg)' }}>
      <div className="page">
        <PageHeader title={meta.title} subtitle={meta.text} icon={meta.icon} />
        <TabLinks
          className="mb"
          tabs={[
            { to: '/chats/new/direct', label: 'Чат' },
            { to: '/chats/new/group', label: 'Группа' },
            { to: '/chats/new/channel', label: 'Канал' },
            { to: '/chats/new/secret', label: 'Секретный' },
          ]}
        />
        <div style={{ height: 16 }} />
        {k === 'direct' && <DirectForm />}
        {k === 'group' && <GroupForm />}
        {k === 'channel' && <ChannelForm />}
        {k === 'secret' && <SecretForm />}
      </div>
    </div>
  );
}
