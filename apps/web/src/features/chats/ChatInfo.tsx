import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { AtSign, Bell, BellOff, Crown, FolderPlus, Hourglass, Image, Link2, Lock, Paintbrush, Pencil, Shield, Timer, UserMinus, UserPlus, Users, X } from 'lucide-react';
import { SECRET_TTL_OPTIONS, SLOW_MODE_OPTIONS, type ChatMember, type ChatSummary, type MediaItem, type Paginated, type UserSummary } from '@omni/shared';
import { api, errorMessage } from '../../shared/api/client';
import { qk, queryClient } from '../../shared/api/query';
import { fingerprint } from '../../shared/crypto/e2e';
import { usePrefs } from '../../shared/stores/prefs';
import { useMe } from '../../shared/stores/session';
import { toast } from '../../shared/stores/ui';
import { members as membersLabel } from '../../shared/lib/format';
import { Avatar, Button, IconButton, Input, Lightbox, Menu, Modal, Notice, RichText, SettingRow, Textarea, UserName, useMenu, Verified } from '../../shared/ui';
import { patchChat } from './cache';
import { useSecretChat } from './secret';
import { UserPicker } from './dialogs';
import { AddToFolderDialog } from './folders';
import { InvitesDialog } from './invites';
import { setChatWallpaper, WALLPAPERS, WallpaperPicker } from './wallpapers';

function ttlLabel(sec: number): string {
  if (sec === 0) return 'Выключен';
  if (sec < 60) return `${sec} секунд`;
  if (sec < 3600) return `${sec / 60} мин`;
  if (sec < 86400) return `${sec / 3600} ч`;
  if (sec < 604800) return `${sec / 86400} дн`;
  return '1 неделя';
}

function slowLabel(sec: number): string {
  if (sec === 0) return 'Выключен';
  if (sec < 60) return `${sec} с`;
  if (sec < 3600) return `${sec / 60} мин`;
  return '1 час';
}

/** Настройки чата: автоудаление, медленный режим, ссылки, обои, папки. */
function ChatSettingsBlock({ chat }: { chat: ChatSummary }) {
  const [dialog, setDialog] = useState<'invites' | 'wallpaper' | 'folder' | null>(null);
  const globalWp = usePrefs((s) => s.wallpaper ?? 'aurora');
  const ownWp = usePrefs((s) => s.chatWallpapers?.[chat.id] ?? null);
  const isAdmin = chat.role === 'owner' || chat.role === 'admin';
  const shared = chat.type === 'group' || chat.type === 'channel';
  const update = useMutation({
    mutationFn: (body: { ttlSeconds?: number; slowModeSec?: number }) => api.patch<ChatSummary>(`/chats/${chat.id}`, body),
    onSuccess: (c) => {
      queryClient.setQueryData(qk.chat(chat.id), c);
      toast({ text: 'Сохранено', kind: 'success' });
    },
    onError: (e) => toast({ text: errorMessage(e), kind: 'error' }),
  });
  if (!chat.role) return null;
  const canTtl = chat.type !== 'secret' && (!shared || isAdmin);
  return (
    <div className="panel info-settings">
      <div className="panel__title">Настройки чата</div>
      {canTtl && (
        <SettingRow
          icon={<Hourglass size={18} />}
          tile="tile-orange"
          title="Автоудаление"
          description="Для новых сообщений"
          control={
            <select className="select" value={chat.ttlSeconds} onChange={(e) => update.mutate({ ttlSeconds: Number(e.target.value) })} aria-label="Автоудаление">
              {SECRET_TTL_OPTIONS.filter((s) => s === 0 || s >= 60).map((s) => (
                <option key={s} value={s}>
                  {ttlLabel(s)}
                </option>
              ))}
            </select>
          }
        />
      )}
      {chat.type === 'group' && isAdmin && (
        <SettingRow
          icon={<Timer size={18} />}
          tile="tile-cyan"
          title="Медленный режим"
          description="Пауза между сообщениями"
          control={
            <select className="select" value={chat.slowModeSec} onChange={(e) => update.mutate({ slowModeSec: Number(e.target.value) })} aria-label="Медленный режим">
              {SLOW_MODE_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {slowLabel(s)}
                </option>
              ))}
            </select>
          }
        />
      )}
      {shared && isAdmin && <SettingRow icon={<Link2 size={18} />} tile="tile-blue" title="Пригласительные ссылки" description="Срок, лимит, отзыв" onClick={() => setDialog('invites')} />}
      <SettingRow
        icon={<Paintbrush size={18} />}
        tile="tile-pink"
        title="Обои"
        description={ownWp ? WALLPAPERS.find((w) => w.id === ownWp)?.label : 'Как во всех чатах'}
        onClick={() => setDialog('wallpaper')}
      />
      <SettingRow icon={<FolderPlus size={18} />} tile="tile-violet" title="Добавить в папку" onClick={() => setDialog('folder')} />
      {dialog === 'invites' && <InvitesDialog chat={chat} onClose={() => setDialog(null)} />}
      {dialog === 'folder' && <AddToFolderDialog chat={chat} onClose={() => setDialog(null)} />}
      {dialog === 'wallpaper' && (
        <Modal open onClose={() => setDialog(null)} title="Обои этого чата">
          <WallpaperPicker value={ownWp} inherit={globalWp} onChange={(w) => setChatWallpaper(chat.id, w)} />
          <p className="small muted" style={{ marginTop: 12 }}>
            Обои хранятся на этом устройстве. Общие обои для всех чатов — в настройках «Чаты и медиа».
          </p>
        </Modal>
      )}
    </div>
  );
}

function SecretBlock({ chat }: { chat: ChatSummary }) {
  const me = useMe();
  const secret = useSecretChat(chat, me.id);
  const [fp, setFp] = useState<{ digits: string[]; emoji: string[] } | null>(null);
  useEffect(() => {
    if (secret.status === 'ready') void fingerprint(secret.myPublicKey, secret.peerPublicKey).then(setFp);
  }, [secret]);
  const ttl = useMutation({
    mutationFn: (ttlSeconds: number) => api.patch<ChatSummary>(`/chats/${chat.id}`, { ttlSeconds }),
    onSuccess: (c) => queryClient.setQueryData(qk.chat(chat.id), c),
    onError: (e) => toast({ text: errorMessage(e), kind: 'error' }),
  });
  return (
    <div className="panel" style={{ margin: 12 }}>
      <div className="panel__title row">
        <Lock size={14} /> Сквозное шифрование
      </div>
      <div style={{ padding: '0 16px 16px' }} className="col gap-3">
        {fp ? (
          <>
            <div className="fingerprint__emoji">{fp.emoji.join('')}</div>
            <div className="fingerprint">
              {fp.digits.map((d, i) => (
                <span key={i}>{d}</span>
              ))}
            </div>
            <p className="small muted">
              Сверьте эти эмодзи или цифры с собеседником (лично или по звонку). Если они совпадают — переписку никто не перехватывает.
            </p>
          </>
        ) : (
          <Notice kind="warning">
            {secret.status === 'wrong-device' ? 'Ключи этого чата хранятся на другом устройстве.' : 'Подготовка ключей…'}
          </Notice>
        )}
        <label className="col" style={{ gap: 6 }}>
          <span className="field__label row">
            <Timer size={14} /> Таймер самоуничтожения
          </span>
          <select className="select" value={chat.secret?.ttlSeconds ?? 0} onChange={(e) => ttl.mutate(Number(e.target.value))}>
            {SECRET_TTL_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {ttlLabel(s)}
              </option>
            ))}
          </select>
        </label>
      </div>
    </div>
  );
}

function EditChatDialog({ chat, onClose }: { chat: ChatSummary; onClose: () => void }) {
  const [title, setTitle] = useState(chat.title);
  const [description, setDescription] = useState(chat.description);
  const save = useMutation({
    mutationFn: () => api.patch<ChatSummary>(`/chats/${chat.id}`, { title, description }),
    onSuccess: (c) => {
      queryClient.setQueryData(qk.chat(chat.id), c);
      patchChat(chat.id, () => c);
      onClose();
    },
    onError: (e) => toast({ text: errorMessage(e), kind: 'error' }),
  });
  return (
    <Modal open onClose={onClose} title="Изменить" footer={<Button loading={save.isPending} onClick={() => save.mutate()}>Сохранить</Button>}>
      <div className="col gap-3">
        <Input label="Название" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={128} />
        <Textarea label="Описание" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={1000} />
      </div>
    </Modal>
  );
}

function MemberRow({ chat, m }: { chat: ChatSummary; m: ChatMember }) {
  const me = useMe();
  const menu = useMenu();
  const canManage = (chat.role === 'owner' || (chat.role === 'admin' && m.role !== 'admin')) && m.role !== 'owner' && m.user.id !== me.id;
  const refresh = () => void queryClient.invalidateQueries({ queryKey: qk.members(chat.id) });
  return (
    <div className="list-item">
      <Link to={`/u/${m.user.username}`} className="row grow" style={{ gap: 12, color: 'inherit' }}>
        <Avatar src={m.user.avatarUrl} name={m.user.displayName} id={m.user.id} size={40} />
        <span className="list-item__body">
          <UserName user={m.user} />
          <span className="list-item__sub">{m.role === 'owner' ? 'владелец' : m.role === 'admin' ? 'администратор' : `@${m.user.username}`}</span>
        </span>
      </Link>
      {m.role === 'owner' && <Crown size={16} style={{ color: 'var(--warning)' }} />}
      {canManage && (
        <>
          <IconButton label="Действия" size="sm" onClick={(e) => menu.openFromEvent(e)}>
            ⋮
          </IconButton>
          <Menu
            anchor={menu.anchor}
            onClose={menu.close}
            items={[
              {
                label: m.role === 'admin' ? 'Снять права админа' : 'Сделать админом',
                icon: <Shield size={18} />,
                hidden: chat.role !== 'owner',
                onClick: () => void api.patch(`/chats/${chat.id}/members/${m.user.id}`, { role: m.role === 'admin' ? 'member' : 'admin' }).then(refresh),
              },
              { label: 'Удалить из чата', icon: <UserMinus size={18} />, danger: true, onClick: () => void api.del(`/chats/${chat.id}/members/${m.user.id}`).then(refresh) },
            ]}
          />
        </>
      )}
    </div>
  );
}

export function ChatInfo({ chatId, onClose }: { chatId: string; onClose: () => void }) {
  const chat = useQuery({ queryKey: qk.chat(chatId), queryFn: () => api.get<ChatSummary>(`/chats/${chatId}`) }).data;
  const [tab, setTab] = useState<'members' | 'media'>('members');
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [lightbox, setLightbox] = useState<number | null>(null);
  const isGroupish = chat?.type === 'group' || chat?.type === 'channel';
  const isAdmin = chat?.role === 'owner' || chat?.role === 'admin';
  const membersQ = useQuery({
    queryKey: qk.members(chatId),
    queryFn: () => api.get<Paginated<ChatMember>>(`/chats/${chatId}/members?limit=100`),
    enabled: !!chat && isGroupish && (chat.type === 'group' || isAdmin),
  });
  const mediaQ = useQuery({
    queryKey: ['chat-media', chatId],
    queryFn: () => api.get<{ items: { messageId: string; media: MediaItem }[] }>(`/chats/${chatId}/media?limit=60`),
    enabled: !!chat && chat.type !== 'secret' && !!chat.role,
  });
  const mute = useMutation({
    mutationFn: (muted: boolean) => api.patch<ChatSummary>(`/chats/${chatId}/prefs`, { mutedUntil: muted ? new Date(Date.now() + 365 * 86400_000).toISOString() : null }),
    onSuccess: (c) => patchChat(chatId, () => c),
  });
  if (!chat) return null;
  const media = (mediaQ.data?.items ?? []).map((i) => i.media).filter((m) => m.kind === 'image' || m.kind === 'video');
  const showTabs = isGroupish && (chat.type === 'group' || isAdmin);

  return (
    <aside className="chats__info" aria-label="Информация о чате">
      <div className="row" style={{ padding: '8px 8px 0', justifyContent: 'space-between' }}>
        <span className="bold" style={{ paddingLeft: 8 }}>
          Информация
        </span>
        <IconButton label="Закрыть" onClick={onClose}>
          <X size={20} />
        </IconButton>
      </div>
      <div className="info-hero">
        <Avatar src={chat.avatarUrl} name={chat.title} id={chat.peer?.id ?? chat.id} size={96} />
        <h2 className="row gap-1" style={{ justifyContent: 'center' }}>
          {chat.title} {chat.peer?.verified && <Verified size={18} />}
        </h2>
        <div className="muted small">
          {chat.peer ? `@${chat.peer.username}` : chat.handle ? `@${chat.handle}` : isGroupish ? membersLabel(chat.memberCount, chat.type === 'channel' ? 'channel' : 'group') : ''}
        </div>
        {chat.description && <RichText text={chat.description} className="small" />}
      </div>
      <div className="info-actions">
        {chat.role && (
          <button className="info-action" onClick={() => mute.mutate(!chat.mutedUntil)}>
            {chat.mutedUntil ? <Bell size={20} /> : <BellOff size={20} />}
            {chat.mutedUntil ? 'Включить' : 'Без звука'}
          </button>
        )}
        {chat.peer && (
          <Link className="info-action" to={`/u/${chat.peer.username}`}>
            <AtSign size={20} />
            Профиль
          </Link>
        )}
        {isAdmin && isGroupish && (
          <button className="info-action" onClick={() => setEditing(true)}>
            <Pencil size={20} />
            Изменить
          </button>
        )}
        {isGroupish && chat.role && (chat.type === 'group' || isAdmin) && (
          <button className="info-action" onClick={() => setAdding(true)}>
            <UserPlus size={20} />
            Добавить
          </button>
        )}
      </div>

      {chat.type === 'secret' && <SecretBlock chat={chat} />}
      <ChatSettingsBlock chat={chat} />

      {showTabs && (
        <div className="tabs" style={{ padding: '0 8px' }}>
          <button className={`tab ${tab === 'members' ? 'tab--active' : ''}`} onClick={() => setTab('members')}>
            <Users size={15} style={{ verticalAlign: -2 }} /> Участники
          </button>
          <button className={`tab ${tab === 'media' ? 'tab--active' : ''}`} onClick={() => setTab('media')}>
            <Image size={15} style={{ verticalAlign: -2 }} /> Медиа
          </button>
        </div>
      )}
      {showTabs && tab === 'members' && membersQ.data?.items.map((m) => <MemberRow key={m.user.id} chat={chat} m={m} />)}
      {(!showTabs || tab === 'media') && chat.type !== 'secret' && (
        <>
          {!showTabs && <div className="panel__title">Медиа</div>}
          {media.length ? (
            <div className="media-tiles">
              {media.map((m, i) => (
                <button key={m.id} onClick={() => setLightbox(i)}>
                  <img src={m.kind === 'video' ? (m.posterUrl ?? '') : m.url} alt="" loading="lazy" />
                </button>
              ))}
            </div>
          ) : (
            <p className="muted small" style={{ padding: '0 16px 16px' }}>
              Здесь появятся фото и видео из чата
            </p>
          )}
        </>
      )}
      {lightbox !== null && <Lightbox items={media} index={lightbox} onClose={() => setLightbox(null)} />}
      {editing && <EditChatDialog chat={chat} onClose={() => setEditing(false)} />}
      {adding && (
        <Modal open onClose={() => setAdding(false)} title="Добавить участников">
          <UserPicker
            exclude={membersQ.data?.items.map((m) => m.user.id) ?? []}
            onPick={(u: UserSummary) =>
              void api
                .post<{ added: string[]; skipped: string[] }>(`/chats/${chatId}/members`, { userIds: [u.id] })
                .then((r) => {
                  toast(r.added.length ? { text: `${u.displayName} добавлен(а)`, kind: 'success' } : { text: 'Настройки приватности пользователя не позволяют его добавить', kind: 'error' });
                  void queryClient.invalidateQueries({ queryKey: qk.members(chatId) });
                })
                .catch((e) => toast({ text: errorMessage(e), kind: 'error' }))
            }
          />
        </Modal>
      )}
    </aside>
  );
}
