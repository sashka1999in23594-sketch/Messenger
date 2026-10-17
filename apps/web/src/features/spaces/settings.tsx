/**
 * Настройки пространства: обзор, роли с правами и цветом, участники с их
 * ролями, приглашения. Каждый раздел показывается только тем, у кого есть
 * соответствующее право; сервер всё равно проверяет каждое действие.
 */
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Copy, Crown, Link2, Plus, RefreshCw, Shield, Trash2, UserMinus, UserPlus, Users, X } from 'lucide-react';
import { ROLE_COLORS, SPACE_PERMS, type SpaceDetails, type SpaceInvite, type SpaceMember, type SpaceRole, type UserSummary } from '@omni/shared';
import { api, errorMessage } from '../../shared/api/client';
import { queryClient } from '../../shared/api/query';
import { cn, timeAgo } from '../../shared/lib/format';
import { useMe } from '../../shared/stores/session';
import { toast } from '../../shared/stores/ui';
import { Avatar, Button, confirm, EmptyState, IconButton, Input, Modal, SettingRow, Switch, Textarea, UserName, UserPicker } from '../../shared/ui';
import { can, PERM_INFO, refreshSpace, spaceBase, spaceKeys, topRole, useSpaceMembers } from './api';

export type SettingsTab = 'overview' | 'roles' | 'members' | 'invites';

function Overview({ space, onClose }: { space: SpaceDetails; onClose: () => void }) {
  const navigate = useNavigate();
  const me = useMe();
  const [name, setName] = useState(space.name);
  const [description, setDescription] = useState(space.description);
  const editable = can(space, 'manageSpace');
  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.patch<SpaceDetails>(`/spaces/${space.id}`, body),
    onSuccess: (s) => {
      queryClient.setQueryData(spaceKeys.one(space.id), s);
      refreshSpace();
      toast({ text: 'Сохранено', kind: 'success' });
    },
    onError: (e) => toast({ text: errorMessage(e), kind: 'error' }),
  });
  const remove = async () => {
    const ok = await confirm({
      title: `Удалить «${space.name}»?`,
      text: 'Все чаты, роли и переписка будут удалены для всех участников. Это нельзя отменить.',
      danger: true,
      confirmLabel: 'Удалить навсегда',
      typeToConfirm: space.name,
    });
    if (!ok) return;
    try {
      await api.del(`/spaces/${space.id}`);
      refreshSpace();
      onClose();
      navigate(spaceBase(space.kind));
    } catch (e) {
      toast({ text: errorMessage(e), kind: 'error' });
    }
  };
  return (
    <div className="col gap-4">
      <Input label="Название" value={name} disabled={!editable} onChange={(e) => setName(e.target.value)} maxLength={64} />
      <Textarea label="Описание" value={description} disabled={!editable} onChange={(e) => setDescription(e.target.value)} rows={3} maxLength={1000} />
      {editable && (
        <Button style={{ alignSelf: 'flex-start' }} loading={save.isPending} disabled={!name.trim()} onClick={() => save.mutate({ name, description })}>
          Сохранить
        </Button>
      )}
      {space.kind === 'community' && editable && (
        <div className="card">
          <SettingRow
            title="Открытое сообщество"
            description={space.isPublic ? 'Любой найдёт в обзоре и вступит сам' : 'Только по приглашению или ссылке'}
            control={<Switch checked={space.isPublic} onChange={(v) => save.mutate({ isPublic: v })} label="Открытое сообщество" />}
          />
        </div>
      )}
      {space.ownerId === me.id && (
        <div className="danger-zone">
          <div>
            <b>Удалить {space.kind === 'company' ? 'компанию' : 'сообщество'}</b>
            <div className="small muted">Вместе со всеми чатами и ролями</div>
          </div>
          <Button variant="danger" icon={<Trash2 size={16} />} onClick={() => void remove()}>
            Удалить
          </Button>
        </div>
      )}
    </div>
  );
}

function RoleEditor({ space, role, onDone }: { space: SpaceDetails; role: SpaceRole | null; onDone: () => void }) {
  const me = useMe();
  const [name, setName] = useState(role?.name ?? '');
  const [color, setColor] = useState(role?.color ?? ROLE_COLORS[1]);
  const [perms, setPerms] = useState(role?.permissions ?? 0);
  const isOwner = space.ownerId === me.id;
  const save = useMutation({
    mutationFn: () =>
      role ? api.patch<SpaceRole>(`/spaces/${space.id}/roles/${role.id}`, { name, color, permissions: perms }) : api.post<SpaceRole>(`/spaces/${space.id}/roles`, { name, color, permissions: perms }),
    onSuccess: () => {
      refreshSpace(space.id);
      onDone();
    },
    onError: (e) => toast({ text: errorMessage(e), kind: 'error' }),
  });
  const remove = async () => {
    if (!role || !(await confirm({ title: `Удалить роль «${role.name}»?`, text: 'Участники потеряют её права и доступ к закрытым для неё чатам.', danger: true, confirmLabel: 'Удалить' }))) return;
    try {
      await api.del(`/spaces/${space.id}/roles/${role.id}`);
      refreshSpace(space.id);
      onDone();
    } catch (e) {
      toast({ text: errorMessage(e), kind: 'error' });
    }
  };
  // Нельзя выдать права, которых нет у себя; «Администратор» — только владелец
  const grantable = (bit: number) => (isOwner ? true : bit !== SPACE_PERMS.admin && (space.permissions & bit) !== 0);
  return (
    <div className="col gap-3">
      <Input label="Название роли" value={name} disabled={role?.isDefault} onChange={(e) => setName(e.target.value)} maxLength={40} autoFocus={!role} />
      <div className="col gap-2">
        <span className="field__label">Цвет</span>
        <div className="color-row">
          {ROLE_COLORS.map((c) => (
            <button key={c} type="button" className={cn('color-swatch', color === c && 'color-swatch--on')} style={{ background: c }} onClick={() => setColor(c)} aria-label={`Цвет ${c}`} aria-pressed={color === c} />
          ))}
        </div>
      </div>
      <div className="card">
        {PERM_INFO.map((p) => {
          const bit = SPACE_PERMS[p.key];
          return (
            <SettingRow
              key={p.key}
              title={p.label}
              description={p.text}
              control={<Switch checked={(perms & bit) !== 0} disabled={!grantable(bit)} onChange={(v) => setPerms((x) => (v ? x | bit : x & ~bit))} label={p.label} />}
            />
          );
        })}
      </div>
      <div className="row gap-2" style={{ justifyContent: 'space-between' }}>
        {role && !role.isDefault ? (
          <Button variant="ghost" icon={<Trash2 size={16} />} onClick={() => void remove()}>
            Удалить роль
          </Button>
        ) : (
          <span />
        )}
        <div className="row gap-2">
          <Button variant="secondary" onClick={onDone}>
            Отмена
          </Button>
          <Button disabled={!name.trim()} loading={save.isPending} onClick={() => save.mutate()}>
            {role ? 'Сохранить' : 'Создать роль'}
          </Button>
        </div>
      </div>
    </div>
  );
}

function Roles({ space }: { space: SpaceDetails }) {
  const [editing, setEditing] = useState<SpaceRole | 'new' | null>(null);
  const manage = can(space, 'manageRoles');
  if (editing) return <RoleEditor space={space} role={editing === 'new' ? null : editing} onDone={() => setEditing(null)} />;
  return (
    <div className="col gap-3">
      <p className="small muted" style={{ margin: 0 }}>
        Роли дают права и открывают доступ к закрытым чатам. Имя участника в переписке окрашивается цветом его главной роли.
      </p>
      {manage && (
        <Button style={{ alignSelf: 'flex-start' }} icon={<Plus size={16} />} onClick={() => setEditing('new')}>
          Новая роль
        </Button>
      )}
      <div className="card">
        {space.roles.map((r) => (
          <button key={r.id} type="button" className="list-item" disabled={!manage} onClick={() => setEditing(r)}>
            <span className="role-dot role-dot--lg" style={{ '--role': r.color } as React.CSSProperties} />
            <span className="list-item__body">
              <span className="list-item__title" style={{ color: r.isDefault ? undefined : r.color }}>
                {r.name}
              </span>
              <span className="list-item__sub">
                {r.isDefault ? 'есть у всех' : `${r.memberCount} чел.`}
                {r.permissions & SPACE_PERMS.admin ? ' · все права' : r.permissions ? ` · прав: ${PERM_INFO.filter((p) => r.permissions & SPACE_PERMS[p.key]).length}` : ''}
              </span>
            </span>
            {r.permissions & SPACE_PERMS.admin ? <Shield size={16} className="faint" /> : null}
          </button>
        ))}
      </div>
    </div>
  );
}

function MemberRoles({ space, member, onClose }: { space: SpaceDetails; member: SpaceMember; onClose: () => void }) {
  const [roleIds, setRoleIds] = useState(member.roleIds);
  const save = useMutation({
    mutationFn: () => api.put(`/spaces/${space.id}/members/${member.user.id}/roles`, { roleIds }),
    onSuccess: () => {
      refreshSpace(space.id);
      onClose();
    },
    onError: (e) => toast({ text: errorMessage(e), kind: 'error' }),
  });
  return (
    <Modal open onClose={onClose} title={`Роли: ${member.user.displayName}`} footer={<Button loading={save.isPending} onClick={() => save.mutate()}>Сохранить</Button>}>
      <div className="role-picks">
        {space.roles
          .filter((r) => !r.isDefault)
          .map((r) => {
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
    </Modal>
  );
}

function Members({ space }: { space: SpaceDetails }) {
  const me = useMe();
  const list = useSpaceMembers(space.id).data?.items ?? [];
  const [q, setQ] = useState('');
  const [rolesOf, setRolesOf] = useState<SpaceMember | null>(null);
  const kick = async (m: SpaceMember) => {
    if (!(await confirm({ title: `Исключить ${m.user.displayName}?`, text: 'Человек потеряет доступ ко всем чатам.', danger: true, confirmLabel: 'Исключить' }))) return;
    try {
      await api.del(`/spaces/${space.id}/members/${m.user.id}`);
      refreshSpace(space.id);
    } catch (e) {
      toast({ text: errorMessage(e), kind: 'error' });
    }
  };
  const s = q.trim().toLowerCase();
  const shown = s ? list.filter((m) => m.user.displayName.toLowerCase().includes(s) || m.user.username.includes(s)) : list;
  return (
    <div className="col gap-3">
      <input className="input" placeholder="Найти участника" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="card">
        {shown.map((m) => {
          const role = topRole(space.roles, m.roleIds);
          return (
            <div key={m.user.id} className="list-item">
              <Avatar src={m.user.avatarUrl} name={m.user.displayName} id={m.user.id} size={40} />
              <span className="list-item__body">
                <span className="row gap-1" style={{ color: role?.color }}>
                  <UserName user={m.user} />
                  {m.isOwner && <Crown size={14} style={{ color: 'var(--warning)' }} aria-label="Владелец" />}
                </span>
                <span className="role-picks role-picks--small">
                  {space.roles
                    .filter((r) => m.roleIds.includes(r.id))
                    .map((r) => (
                      <span key={r.id} className="role-chip role-chip--static" style={{ '--role': r.color } as React.CSSProperties}>
                        <span className="role-dot" />
                        {r.name}
                      </span>
                    ))}
                </span>
              </span>
              {can(space, 'manageRoles') && (!m.isOwner || space.ownerId === me.id) && (m.user.id !== me.id || space.ownerId === me.id) && (
                <IconButton label="Роли" size="sm" onClick={() => setRolesOf(m)}>
                  <Shield size={16} />
                </IconButton>
              )}
              {can(space, 'kick') && !m.isOwner && m.user.id !== me.id && (
                <IconButton label="Исключить" size="sm" danger onClick={() => void kick(m)}>
                  <UserMinus size={16} />
                </IconButton>
              )}
            </div>
          );
        })}
      </div>
      {rolesOf && <MemberRoles space={space} member={rolesOf} onClose={() => setRolesOf(null)} />}
    </div>
  );
}

function Invites({ space }: { space: SpaceDetails }) {
  const members = useSpaceMembers(space.id).data?.items ?? [];
  const sent = useQuery({ queryKey: spaceKeys.sent(space.id), queryFn: () => api.get<{ items: SpaceInvite[] }>(`/spaces/${space.id}/invites`) });
  const [link, setLink] = useState(space.inviteLink);
  const invite = useMutation({
    mutationFn: (u: UserSummary) => api.post<SpaceInvite>(`/spaces/${space.id}/invites`, { userId: u.id }),
    onSuccess: (inv) => {
      toast({ text: `Приглашение отправлено: ${inv.user?.displayName ?? ''}`, kind: 'success' });
      void sent.refetch();
    },
    onError: (e) => toast({ text: errorMessage(e), kind: 'error' }),
  });
  const revoke = useMutation({
    mutationFn: (id: string) => api.del(`/spaces/${space.id}/invites/${id}`),
    onSuccess: () => void sent.refetch(),
  });
  const reset = useMutation({
    mutationFn: () => api.post<{ inviteLink: string }>(`/spaces/${space.id}/link`),
    onSuccess: (r) => {
      setLink(r.inviteLink);
      refreshSpace(space.id);
    },
    onError: (e) => toast({ text: errorMessage(e), kind: 'error' }),
  });
  const pending = sent.data?.items ?? [];
  return (
    <div className="col gap-4">
      {space.kind === 'community' && (
        <div className="card" style={{ padding: 14 }}>
          <div className="row gap-2" style={{ marginBottom: 8 }}>
            <Link2 size={18} />
            <b>Ссылка-приглашение</b>
          </div>
          {link ? (
            <div className="row gap-2">
              <input className="input grow" readOnly value={link} onFocus={(e) => e.currentTarget.select()} aria-label="Ссылка-приглашение" />
              <IconButton label="Скопировать" onClick={() => void navigator.clipboard.writeText(link).then(() => toast('Ссылка скопирована'))}>
                <Copy size={18} />
              </IconButton>
              <IconButton label="Новая ссылка (старая перестанет работать)" onClick={() => reset.mutate()}>
                <RefreshCw size={18} />
              </IconButton>
            </div>
          ) : (
            <Button variant="secondary" icon={<Link2 size={16} />} loading={reset.isPending} onClick={() => reset.mutate()}>
              Создать ссылку
            </Button>
          )}
        </div>
      )}
      {pending.length > 0 && (
        <div className="col gap-2">
          <span className="field__label">Ждут ответа</span>
          <div className="card">
            {pending.map((i) => (
              <div key={i.id} className="list-item">
                {i.user && <Avatar src={i.user.avatarUrl} name={i.user.displayName} id={i.user.id} size={36} />}
                <span className="list-item__body">
                  {i.user && <UserName user={i.user} />}
                  <span className="list-item__sub">приглашён(а) {timeAgo(i.createdAt)}</span>
                </span>
                <IconButton label="Отозвать приглашение" size="sm" onClick={() => revoke.mutate(i.id)}>
                  <X size={16} />
                </IconButton>
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="col gap-2">
        <span className="field__label row gap-1">
          <UserPlus size={14} /> Пригласить человека — приглашение придёт ему в уведомления
        </span>
        <UserPicker exclude={[...members.map((m) => m.user.id), ...pending.map((i) => i.user?.id ?? '')]} onPick={(u) => invite.mutate(u)} />
      </div>
    </div>
  );
}

export function SpaceSettings({ space, tab, onTab, onClose }: { space: SpaceDetails; tab: SettingsTab; onTab: (t: SettingsTab) => void; onClose: () => void }) {
  const tabs: { id: SettingsTab; label: string; icon: React.ReactNode; show: boolean }[] = [
    { id: 'overview', label: 'Обзор', icon: <Shield size={16} />, show: true },
    { id: 'roles', label: 'Роли', icon: <Crown size={16} />, show: true },
    { id: 'members', label: 'Участники', icon: <Users size={16} />, show: true },
    { id: 'invites', label: 'Приглашения', icon: <UserPlus size={16} />, show: can(space, 'invite') },
  ];
  const visible = tabs.filter((t) => t.show);
  return (
    <Modal open onClose={onClose} title={space.name} wide className="space-settings">
      <div className="space-settings__layout">
        <nav className="space-settings__tabs" aria-label="Разделы настроек">
          {visible.map((t) => (
            <button key={t.id} type="button" className={cn('space-settings__tab', tab === t.id && 'space-settings__tab--on')} onClick={() => onTab(t.id)} aria-current={tab === t.id}>
              {t.icon}
              {t.label}
            </button>
          ))}
        </nav>
        <div className="space-settings__body">
          {tab === 'overview' && <Overview space={space} onClose={onClose} />}
          {tab === 'roles' && <Roles space={space} />}
          {tab === 'members' && <Members space={space} />}
          {tab === 'invites' && can(space, 'invite') && <Invites space={space} />}
          {tab === 'invites' && !can(space, 'invite') && <EmptyState title="Нет права приглашать" />}
        </div>
      </div>
    </Modal>
  );
}
