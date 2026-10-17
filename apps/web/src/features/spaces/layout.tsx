/**
 * Пространство в стиле Discord: слева — категории с чатами и каналами,
 * в центре — переписка (обычный ChatView), справа — участники по ролям
 * с цветами. На телефоне — список чатов и переписка на отдельных экранах.
 */
import { useEffect, useMemo, useState } from 'react';
import { Link, Navigate, Outlet, useLocation, useNavigate, useParams } from 'react-router';
import { useMutation } from '@tanstack/react-query';
import {
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  Crown,
  FolderPlus,
  Hash,
  Lock,
  LogIn,
  LogOut,
  Megaphone,
  Pencil,
  Plus,
  Settings,
  Trash2,
  UserPlus,
  Users,
} from 'lucide-react';
import type { SpaceDetails, SpaceRoom } from '@omni/shared';
import { api, errorMessage } from '../../shared/api/client';
import { cn, members as membersLabel } from '../../shared/lib/format';
import { useBareLayout } from '../../app/layout/Shell';
import { useMe } from '../../shared/stores/session';
import { toast, useCrumb } from '../../shared/stores/ui';
import { Avatar, Button, confirm, EmptyState, ErrorState, IconButton, Input, Loading, Menu, Modal, Textarea, useMenu } from '../../shared/ui';
import { ChatInfo } from '../chats/ChatInfo';
import { ChatHeaderExtra } from '../chats/ChatView';
import { SenderColors } from '../chats/Messages';
import { useChatUi } from '../chats/store';
import { ChatWallpaper } from '../chats/wallpapers';
import { can, refreshSpace, spaceBase, topRole, useSpace, useSpaceMembers } from './api';
import { SpaceSettings, type SettingsTab } from './settings';

function RoomRow({ space, room, active }: { space: SpaceDetails; room: SpaceRoom; active: boolean }) {
  const menu = useMenu();
  const [editing, setEditing] = useState(false);
  const c = room.chat;
  const unread = room.joined && c.unreadCount > 0 && !c.mutedUntil;
  // Замок — у чатов, закрытых для части участников (по ролям или по приглашению в сообществе)
  const Icon = c.type === 'channel' ? Megaphone : room.roleIds.length || (space.kind === 'community' && !c.isPublic) ? Lock : Hash;
  const manage = can(space, 'manageRooms');
  const remove = async () => {
    if (!(await confirm({ title: `Удалить «${c.title}»?`, text: 'Вся переписка будет удалена для всех.', danger: true, confirmLabel: 'Удалить' }))) return;
    try {
      await api.del(`/spaces/${space.id}/rooms/${c.id}`);
      refreshSpace(space.id);
    } catch (e) {
      toast({ text: errorMessage(e), kind: 'error' });
    }
  };
  return (
    <>
      <Link
        to={`${spaceBase(space.kind)}/${space.id}/${c.id}`}
        className={cn('room', active && 'room--active', unread && 'room--unread', !room.joined && 'room--guest')}
        onContextMenu={(e) => manage && menu.openFromEvent(e)}
        aria-current={active ? 'page' : undefined}
      >
        <Icon size={17} className="room__icon" />
        <span className="ellipsis grow">{c.title}</span>
        {unread && <span className="badge">{c.unreadCount > 99 ? '99+' : c.unreadCount}</span>}
        {!room.joined && <span className="room__hint">вступить</span>}
        {manage && (
          <span
            role="button"
            tabIndex={0}
            className="room__gear"
            aria-label="Настроить"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setEditing(true);
            }}
          >
            <Settings size={14} />
          </span>
        )}
      </Link>
      <Menu
        anchor={menu.anchor}
        onClose={menu.close}
        items={[
          { label: 'Настроить доступ', icon: <Pencil size={18} />, onClick: () => setEditing(true) },
          { label: 'Удалить', icon: <Trash2 size={18} />, danger: true, onClick: () => void remove() },
        ]}
      />
      {editing && <RoomDialog space={space} room={room} onClose={() => setEditing(false)} />}
    </>
  );
}

/** Создание чата или канала и настройка доступа: категория и роли, которые его видят. */
function RoomDialog({ space, room, categoryId, onClose }: { space: SpaceDetails; room?: SpaceRoom; categoryId?: string | null; onClose: () => void }) {
  const navigate = useNavigate();
  const [title, setTitle] = useState(room?.chat.title ?? '');
  const [description, setDescription] = useState('');
  const [kind, setKind] = useState<'group' | 'channel'>(room?.chat.type === 'channel' ? 'channel' : 'group');
  const [cat, setCat] = useState<string | null>(room ? room.categoryId : (categoryId ?? null));
  const [roleIds, setRoleIds] = useState<string[]>(room?.roleIds ?? []);
  const [isPublic, setPublic] = useState(true);
  const roles = space.roles.filter((r) => !r.isDefault);
  const save = useMutation({
    mutationFn: () =>
      room
        ? api.patch<SpaceRoom>(`/spaces/${space.id}/rooms/${room.chat.id}`, { categoryId: cat, roleIds })
        : api.post<SpaceRoom>(`/spaces/${space.id}/rooms`, { title, description, kind, categoryId: cat, roleIds, isPublic }),
    onSuccess: (r) => {
      refreshSpace(space.id);
      onClose();
      if (!room) navigate(`${spaceBase(space.kind)}/${space.id}/${r.chat.id}`);
    },
    onError: (e) => toast({ text: errorMessage(e), kind: 'error' }),
  });
  return (
    <Modal
      open
      onClose={onClose}
      title={room ? `Доступ: ${room.chat.title}` : 'Новый чат'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button disabled={!room && !title.trim()} loading={save.isPending} onClick={() => save.mutate()}>
            {room ? 'Сохранить' : 'Создать'}
          </Button>
        </>
      }
    >
      <div className="col gap-3">
        {!room && (
          <>
            <div className="choice-grid choice-grid--2">
              <button type="button" className={`choice-card ${kind === 'group' ? 'choice-card--on' : ''}`} onClick={() => setKind('group')} aria-pressed={kind === 'group'}>
                <Hash size={20} />
                <b>Чат</b>
                <span className="xs muted">Пишут все, у кого есть доступ</span>
              </button>
              <button type="button" className={`choice-card ${kind === 'channel' ? 'choice-card--on' : ''}`} onClick={() => setKind('channel')} aria-pressed={kind === 'channel'}>
                <Megaphone size={20} />
                <b>Объявления</b>
                <span className="xs muted">Пишут те, у кого есть право публиковать</span>
              </button>
            </div>
            <Input label="Название" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={128} autoFocus placeholder={kind === 'group' ? 'например, дизайн' : 'например, новости'} />
            <Textarea label="Описание" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} maxLength={1000} />
          </>
        )}
        <label className="field">
          <span className="field__label">Категория</span>
          <select className="select" value={cat ?? ''} onChange={(e) => setCat(e.target.value || null)}>
            <option value="">Без категории</option>
            {space.categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        {space.kind === 'community' && !room && (
          <label className="row gap-2 small">
            <input type="checkbox" checked={!isPublic} onChange={(e) => setPublic(!e.target.checked)} />
            Закрытая группа — только по приглашению
          </label>
        )}
        {roles.length > 0 && (
          <div className="col gap-2">
            <span className="field__label">Кто видит</span>
            <span className="xs muted">Ничего не выбрано — все участники. Иначе — только выбранные роли.</span>
            <div className="role-picks">
              {roles.map((r) => {
                const on = roleIds.includes(r.id);
                return (
                  <button
                    key={r.id}
                    type="button"
                    className={cn('role-chip', on && 'role-chip--on')}
                    style={{ '--role': r.color } as React.CSSProperties}
                    onClick={() => setRoleIds((l) => (on ? l.filter((x) => x !== r.id) : [...l, r.id]))}
                    aria-pressed={on}
                  >
                    <span className="role-dot" />
                    {r.name}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

function CategoryDialog({ space, onClose }: { space: SpaceDetails; onClose: () => void }) {
  const [name, setName] = useState('');
  const create = useMutation({
    mutationFn: () => api.post(`/spaces/${space.id}/categories`, { name }),
    onSuccess: () => {
      refreshSpace(space.id);
      onClose();
    },
    onError: (e) => toast({ text: errorMessage(e), kind: 'error' }),
  });
  return (
    <Modal open onClose={onClose} title="Новая категория" footer={<Button disabled={!name.trim()} loading={create.isPending} onClick={() => create.mutate()}>Создать</Button>}>
      <Input label="Название" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} autoFocus placeholder="например, Отдел продаж" />
    </Modal>
  );
}

function Sidebar({ space, activeId, onSettings }: { space: SpaceDetails; activeId: string | null; onSettings: (tab: SettingsTab) => void }) {
  const navigate = useNavigate();
  const me = useMe();
  const menu = useMenu();
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [newRoom, setNewRoom] = useState<{ categoryId: string | null } | null>(null);
  const [newCat, setNewCat] = useState(false);
  const manage = can(space, 'manageRooms');
  const groups = useMemo(() => {
    const byCat = new Map<string | null, SpaceRoom[]>();
    for (const r of [...space.rooms].sort((a, b) => a.position - b.position)) byCat.set(r.categoryId, [...(byCat.get(r.categoryId) ?? []), r]);
    return [
      { id: null as string | null, name: '', rooms: byCat.get(null) ?? [] },
      ...space.categories.map((c) => ({ id: c.id as string | null, name: c.name, rooms: byCat.get(c.id) ?? [] })),
    ];
  }, [space]);
  const join = useMutation({
    mutationFn: () => api.post(`/spaces/${space.id}/join`),
    onSuccess: () => refreshSpace(space.id),
    onError: (e) => toast({ text: errorMessage(e), kind: 'error' }),
  });
  const leave = async () => {
    if (!(await confirm({ title: `Покинуть «${space.name}»?`, text: 'Вы выйдете из всех его чатов.', danger: true, confirmLabel: 'Покинуть' }))) return;
    try {
      await api.post(`/spaces/${space.id}/leave`);
      refreshSpace(space.id);
      navigate(spaceBase(space.kind));
    } catch (e) {
      toast({ text: errorMessage(e), kind: 'error' });
    }
  };
  const isOwner = space.ownerId === me.id;

  return (
    <aside className="chats__list space-side" aria-label={space.name}>
      <div className="space-side__head">
        <IconButton label="Назад" size="sm" className="mobile-only" onClick={() => navigate(spaceBase(space.kind))}>
          <ArrowLeft size={18} />
        </IconButton>
        <button type="button" className="space-side__title" onClick={(e) => menu.openFromEvent(e)} aria-haspopup="menu">
          <Avatar src={space.avatarUrl} name={space.name} id={space.id} size={32} />
          <span className="col grow" style={{ gap: 0, minWidth: 0, textAlign: 'left' }}>
            <b className="ellipsis">{space.name}</b>
            <span className="xs muted">{membersLabel(space.memberCount)}</span>
          </span>
          <ChevronDown size={18} />
        </button>
      </div>
      <Menu
        anchor={menu.anchor}
        onClose={menu.close}
        items={[
          { label: 'Пригласить', icon: <UserPlus size={18} />, hidden: !can(space, 'invite'), onClick: () => onSettings('invites') },
          { label: 'Создать чат', icon: <Plus size={18} />, hidden: !manage, onClick: () => setNewRoom({ categoryId: null }) },
          { label: 'Создать категорию', icon: <FolderPlus size={18} />, hidden: !manage, onClick: () => setNewCat(true) },
          { label: 'Участники и роли', icon: <Users size={18} />, hidden: !space.joined, onClick: () => onSettings('members') },
          { label: 'Настройки', icon: <Settings size={18} />, hidden: !space.joined, onClick: () => onSettings('overview') },
          'separator',
          { label: 'Покинуть', icon: <LogOut size={18} />, danger: true, hidden: !space.joined || isOwner, onClick: () => void leave() },
        ]}
      />
      {!space.joined && (
        <div className="space-side__join">
          <span className="small muted">Вы смотрите сообщество как гость</span>
          <Button block icon={<LogIn size={16} />} loading={join.isPending} onClick={() => join.mutate()}>
            Вступить в сообщество
          </Button>
        </div>
      )}
      <nav className="space-side__scroll">
        {groups.map((g) =>
          g.id === null && !g.rooms.length ? null : (
            <div key={g.id ?? 'none'} className="room-group">
              {g.id !== null && (
                <div className="room-group__head">
                  <button type="button" className="room-group__toggle" onClick={() => setCollapsed((c) => ({ ...c, [g.id!]: !c[g.id!] }))} aria-expanded={!collapsed[g.id]}>
                    {collapsed[g.id] ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
                    <span className="ellipsis">{g.name}</span>
                  </button>
                  {manage && (
                    <IconButton label={`Создать чат в «${g.name}»`} size="sm" onClick={() => setNewRoom({ categoryId: g.id })}>
                      <Plus size={15} />
                    </IconButton>
                  )}
                </div>
              )}
              {!(g.id && collapsed[g.id]) && g.rooms.map((r) => <RoomRow key={r.chat.id} space={space} room={r} active={r.chat.id === activeId} />)}
              {!(g.id && collapsed[g.id]) && g.rooms.length === 0 && <div className="room-group__empty xs faint">Пусто</div>}
            </div>
          ),
        )}
        {space.rooms.length === 0 && <EmptyState icon={<Hash size={24} />} title="Чатов пока нет" text={manage ? 'Создайте первый чат' : undefined} />}
      </nav>
      {newRoom && <RoomDialog space={space} categoryId={newRoom.categoryId} onClose={() => setNewRoom(null)} />}
      {newCat && <CategoryDialog space={space} onClose={() => setNewCat(false)} />}
    </aside>
  );
}

/** Участники по ролям: как в Discord — группы по главной роли, имена её цветом. */
function MembersPanel({ space, onClose }: { space: SpaceDetails; onClose: () => void }) {
  const list = useSpaceMembers(space.id, space.joined).data?.items ?? [];
  const groups = useMemo(() => {
    const out = new Map<string, { title: string; color: string | null; items: typeof list }>();
    for (const m of list) {
      const role = topRole(space.roles, m.roleIds);
      const key = role?.id ?? 'none';
      if (!out.has(key)) out.set(key, { title: role?.name ?? 'Участники', color: role?.color ?? null, items: [] });
      out.get(key)!.items.push(m);
    }
    const order = (k: string) => (k === 'none' ? -1 : (space.roles.find((r) => r.id === k)?.position ?? 0));
    return [...out.entries()].sort((a, b) => order(b[0]) - order(a[0])).map(([, v]) => v);
  }, [list, space.roles]);
  return (
    <aside className="chats__info space-members" aria-label="Участники">
      <div className="row" style={{ padding: '12px 12px 4px', justifyContent: 'space-between' }}>
        <b>Участники · {space.memberCount}</b>
        <IconButton label="Скрыть участников" size="sm" onClick={onClose}>
          ✕
        </IconButton>
      </div>
      {groups.map((g) => (
        <section key={g.title}>
          <h3 className="space-members__title">
            {g.title} — {g.items.length}
          </h3>
          {g.items.map((m) => (
            <Link key={m.user.id} to={`/u/${m.user.username}`} className="space-member">
              <Avatar src={m.user.avatarUrl} name={m.user.displayName} id={m.user.id} size={32} />
              <span className="ellipsis" style={{ color: g.color ?? undefined, fontWeight: 600 }}>
                {m.user.displayName}
              </span>
              {m.isOwner && <Crown size={14} className="space-member__crown" aria-label="Владелец" />}
            </Link>
          ))}
        </section>
      ))}
    </aside>
  );
}

export function SpaceLayout() {
  const { spaceId = '', chatId } = useParams();
  const { pathname } = useLocation();
  const q = useSpace(spaceId);
  const space = q.data;
  const infoOpen = useChatUi((s) => s.infoOpen);
  const setInfo = useChatUi((s) => s.setInfo);
  const [membersOpen, setMembersOpen] = useState(() => typeof window !== 'undefined' && window.innerWidth >= 1600);
  const [settings, setSettings] = useState<SettingsTab | null>(null);
  const members = useSpaceMembers(spaceId, !!space?.joined).data?.items;
  useBareLayout(true);
  useCrumb(space?.name);
  useEffect(() => {
    if (!chatId) setInfo(false);
  }, [chatId, setInfo]);

  // Цвета имён в переписке — цвет главной роли автора
  const colors = useMemo(() => {
    const map = new Map<string, string>();
    if (space && members) for (const m of members) {
      const r = topRole(space.roles, m.roleIds);
      if (r) map.set(m.user.id, r.color);
    }
    return map;
  }, [space, members]);

  if (q.isLoading) return <Loading />;
  if (q.error || !space) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  // Неверный раздел в адресе (компания по ссылке сообщества и наоборот)
  if (!pathname.startsWith(spaceBase(space.kind))) return <Navigate to={`${spaceBase(space.kind)}/${space.id}${chatId ? `/${chatId}` : ''}`} replace />;
  const side = infoOpen && chatId ? 'info' : membersOpen && space.joined ? 'members' : null;

  return (
    <SenderColors.Provider value={colors}>
      <div className={cn('chats space', !!chatId && 'chats--detail', side && 'chats--info')}>
        <Sidebar space={space} activeId={chatId ?? null} onSettings={setSettings} />
        <section className="chats__detail">
          <ChatWallpaper chatId={chatId} />
          <ChatHeaderExtra.Provider
            value={
              space.joined ? (
                <IconButton label="Участники" className="desktop-only" active={membersOpen && !infoOpen} onClick={() => (setInfo(false), setMembersOpen((v) => !v))}>
                  <Users size={20} />
                </IconButton>
              ) : null
            }
          >
            <Outlet />
          </ChatHeaderExtra.Provider>
        </section>
        {side === 'info' && chatId && <ChatInfo chatId={chatId} onClose={() => setInfo(false)} />}
        {side === 'members' && <MembersPanel space={space} onClose={() => setMembersOpen(false)} />}
        {settings && <SpaceSettings space={space} tab={settings} onTab={setSettings} onClose={() => setSettings(null)} />}
      </div>
    </SenderColors.Provider>
  );
}

/** Пространство без выбранного чата: приветствие и первый шаг. */
export function SpaceWelcome() {
  const { spaceId = '' } = useParams();
  const space = useSpace(spaceId).data;
  const me = useMe();
  if (!space) return null;
  const first = space.rooms.find((r) => r.joined) ?? space.rooms[0];
  return (
    <EmptyState
      icon={<Avatar src={space.avatarUrl} name={space.name} id={space.id} size={72} />}
      title={`Добро пожаловать в «${space.name}»`}
      text={space.description || (space.kind === 'company' ? 'Выберите чат слева, чтобы начать работу' : 'Выберите группу слева и вступайте в те, что интересны')}
      action={
        first ? (
          <Link className="btn btn--primary" to={`${spaceBase(space.kind)}/${space.id}/${first.chat.id}`}>
            Открыть «{first.chat.title}»
          </Link>
        ) : space.ownerId === me.id ? (
          <span className="small muted">Создайте первый чат через меню с названием слева</span>
        ) : undefined
      }
    />
  );
}

