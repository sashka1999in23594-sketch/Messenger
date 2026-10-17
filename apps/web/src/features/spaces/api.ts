/** Запросы и кэш компаний и сообществ. */
import { useQuery } from '@tanstack/react-query';
import { SPACE_PERMS, type SpaceDetails, type SpaceInvite, type SpaceKind, type SpaceMember, type SpaceRole, type SpaceSummary } from '@omni/shared';
import { api } from '../../shared/api/client';
import { queryClient } from '../../shared/api/query';

export const spaceKeys = {
  list: (kind: SpaceKind) => ['spaces', kind] as const,
  discover: (q: string) => ['spaces-discover', q] as const,
  one: (id: string) => ['space', id] as const,
  members: (id: string) => ['space-members', id] as const,
  invites: ['space-invites'] as const,
  sent: (id: string) => ['space-sent-invites', id] as const,
};

/** Путь раздела: компании и сообщества живут по разным адресам. */
export const spaceBase = (kind: SpaceKind) => (kind === 'company' ? '/companies' : '/communities');
export const spacePath = (s: Pick<SpaceSummary, 'id' | 'kind'>) => `${spaceBase(s.kind)}/${s.id}`;

export const useSpaces = (kind: SpaceKind) =>
  useQuery({ queryKey: spaceKeys.list(kind), queryFn: () => api.get<{ items: SpaceSummary[] }>(`/spaces?kind=${kind}`) });

export const useSpace = (id: string) => useQuery({ queryKey: spaceKeys.one(id), queryFn: () => api.get<SpaceDetails>(`/spaces/${id}`), enabled: !!id });

export const useSpaceMembers = (id: string, enabled = true) =>
  useQuery({ queryKey: spaceKeys.members(id), queryFn: () => api.get<{ items: SpaceMember[] }>(`/spaces/${id}/members`), enabled: !!id && enabled });

export const useMyInvites = () => useQuery({ queryKey: spaceKeys.invites, queryFn: () => api.get<{ items: SpaceInvite[] }>('/space-invites') });

export function refreshSpace(id?: string): void {
  if (id) {
    void queryClient.invalidateQueries({ queryKey: spaceKeys.one(id) });
    void queryClient.invalidateQueries({ queryKey: spaceKeys.members(id) });
  }
  void queryClient.invalidateQueries({ queryKey: ['spaces'] });
}

export const can = (s: Pick<SpaceSummary, 'permissions'> | undefined, perm: keyof typeof SPACE_PERMS) => !!s && (s.permissions & SPACE_PERMS[perm]) !== 0;

/** Главная роль участника — самая высокая из его ролей (её цвет и группа в списке). */
export function topRole(roles: SpaceRole[], roleIds: string[]): SpaceRole | null {
  return roles.filter((r) => !r.isDefault && roleIds.includes(r.id)).sort((a, b) => b.position - a.position)[0] ?? null;
}

export const PERM_INFO: { key: keyof typeof SPACE_PERMS; label: string; text: string }[] = [
  { key: 'admin', label: 'Администратор', text: 'Все права. Выдаёт только владелец' },
  { key: 'manageSpace', label: 'Управлять настройками', text: 'Название, описание, аватар' },
  { key: 'manageRoles', label: 'Управлять ролями', text: 'Создавать роли и выдавать их участникам' },
  { key: 'manageRooms', label: 'Управлять чатами', text: 'Категории, чаты и каналы, доступ к ним' },
  { key: 'invite', label: 'Приглашать', text: 'Отправлять приглашения и ссылки' },
  { key: 'kick', label: 'Исключать', text: 'Удалять участников' },
  { key: 'moderate', label: 'Модерировать', text: 'Удалять чужие сообщения, блокировать в чатах' },
  { key: 'announce', label: 'Публиковать объявления', text: 'Писать в каналы-объявления' },
];
