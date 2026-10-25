/**
 * Меню аккаунта рабочего стола: открывается по аватару в доке и в строке меню.
 */
import { Download, LifeBuoy, Lock, LogOut, Settings, UserPlus, UserRound } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import type { UserSummary } from '@omni/shared';
import { addAccount, confirmLogout, switchAccount } from '../../app/session';
import { api, errorMessage } from '../../shared/api/client';
import { useLock } from '../../shared/lib/passcode';
import { usePrefs } from '../../shared/stores/prefs';
import { useSession } from '../../shared/stores/session';
import { toast } from '../../shared/stores/ui';
import { Avatar } from '../../shared/ui';
import { DeskMenu, type MenuAnchor } from './DeskMenu';
import { openPath } from './fx';

export function AccountMenu({ anchor, onClose }: { anchor: MenuAnchor | null; onClose: () => void }) {
  const me = useSession((s) => s.me);
  const passcode = usePrefs((s) => !!s.passcode);
  const linked = useQuery({
    queryKey: ['linked-accounts'],
    queryFn: () => api.get<{ accounts: UserSummary[] }>('/auth/accounts'),
    staleTime: 30_000,
    enabled: !!anchor,
  });
  if (!me) return null;
  const others = (linked.data?.accounts ?? []).filter((a) => a.id !== me.id);
  const switchTo = (id: string) => void switchAccount(id).catch((e) => toast({ text: errorMessage(e), kind: 'error' }));
  return (
    <DeskMenu
      anchor={anchor}
      onClose={onClose}
      label="Мой аккаунт"
      header={
        <div className="menu__me">
          <Avatar src={me.avatarUrl} name={me.displayName} id={me.id} size={40} />
          <span className="col" style={{ gap: 0, minWidth: 0 }}>
            <span className="bold ellipsis">{me.displayName}</span>
            <span className="small muted ellipsis">@{me.username}</span>
          </span>
        </div>
      }
      items={[
        ...others.map((a) => ({
          label: a.displayName,
          hint: `@${a.username}`,
          icon: <Avatar src={a.avatarUrl} name={a.displayName} id={a.id} size={24} />,
          onClick: () => switchTo(a.id),
        })),
        { label: 'Добавить аккаунт', icon: <UserPlus size={18} />, onClick: () => addAccount() },
        'separator',
        { label: 'Мой профиль', icon: <UserRound size={18} />, onClick: () => openPath('/profile') },
        { label: 'Настройки', icon: <Settings size={18} />, onClick: () => openPath('/settings') },
        { label: 'Скачать приложение', icon: <Download size={18} />, onClick: () => openPath('/download') },
        { label: 'Помощь', icon: <LifeBuoy size={18} />, onClick: () => openPath('/help') },
        'separator',
        passcode && { label: 'Заблокировать', icon: <Lock size={18} />, onClick: () => useLock.getState().lock() },
        { label: 'Выйти', icon: <LogOut size={18} />, danger: true, onClick: () => void confirmLogout() },
      ]}
    />
  );
}

/** Аватар текущего пользователя для кнопок. */
export function MeAvatar({ size }: { size: number }) {
  const me = useSession((s) => s.me);
  if (!me) return null;
  return <Avatar src={me.avatarUrl} name={me.displayName} id={me.id} size={size} />;
}
