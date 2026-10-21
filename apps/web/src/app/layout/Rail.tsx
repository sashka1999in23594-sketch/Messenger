import { Link, NavLink, useNavigate } from 'react-router';
import { Download, LifeBuoy, LogOut, Moon, Settings, Sun, UserRound } from 'lucide-react';
import type { Me } from '@omni/shared';
import { sections, type NavSection } from '../navigation';
import { confirmLogout } from '../session';
import { useSession } from '../../shared/stores/session';
import { usePrefs } from '../../shared/stores/prefs';
import { Avatar, Logo, Menu, useMenu } from '../../shared/ui';
import { cn } from '../../shared/lib/format';

export function useBadge(kind: NavSection['badge']): number {
  const counters = useSession((s) => s.me?.counters);
  if (!counters || !kind) return 0;
  if (kind === 'chats') return counters.unreadChats;
  if (kind === 'channels') return counters.unreadChannels ?? 0;
  if (kind === 'notifications') return counters.unreadNotifications + counters.followRequests;
  return counters.followRequests;
}

export function RailItem({ section, active, onClick }: { section: NavSection; active: boolean; onClick?: () => void }) {
  const badge = useBadge(section.badge);
  const Icon = section.icon;
  return (
    <NavLink
      to={section.path}
      className={cn('rail__item', active && 'rail__item--active')}
      onClick={onClick}
      aria-label={section.label}
      title={`${section.label} — ${section.description ?? ''}`}
    >
      <span className="rail__icon">
        <Icon size={22} strokeWidth={active ? 2.2 : 1.9} />
      </span>
      <span className="rail__label">{section.short}</span>
      {badge > 0 && <span className="badge rail__badge">{badge > 99 ? '99+' : badge}</span>}
    </NavLink>
  );
}

export function Rail({ current }: { current: NavSection }) {
  const me = useSession((s) => s.me);
  const theme = usePrefs((s) => s.theme);
  const setPrefs = usePrefs((s) => s.set);
  const isDark = theme === 'dark' || (theme === 'system' && document.documentElement.dataset.theme === 'dark');
  return (
    <nav className="rail pane" aria-label="Разделы">
      <Link to="/" className="rail__logo" aria-label="Sunnet — на главную">
        <Logo size={44} />
      </Link>
      {sections
        .filter((s) => s.id !== 'settings' && s.id !== 'profile')
        .map((s) => (
          <RailItem key={s.id} section={s} active={current.id === s.id} />
        ))}
      <div className="rail__spacer" />
      <button className="rail__tool" onClick={() => setPrefs({ theme: isDark ? 'light' : 'dark' })} aria-label="Сменить тему" title={isDark ? 'Светлая тема' : 'Тёмная тема'}>
        {isDark ? <Sun size={20} /> : <Moon size={20} />}
      </button>
      <RailItem section={sections.find((s) => s.id === 'settings')!} active={current.id === 'settings'} />
      {me && <AccountButton me={me} active={current.id === 'profile'} />}
    </nav>
  );
}

/** Аватар внизу рельса: меню аккаунта с профилем, настройками и выходом. */
function AccountButton({ me, active }: { me: Me; active: boolean }) {
  const navigate = useNavigate();
  const menu = useMenu();
  return (
    <>
      <button
        type="button"
        className={cn('rail__me', (active || menu.anchor) && 'rail__me--active')}
        aria-label="Мой аккаунт"
        title="Мой аккаунт"
        aria-haspopup="menu"
        aria-expanded={!!menu.anchor}
        // Повторное нажатие закрывает меню: не даём «клику мимо меню» закрыть его и тут же открыть снова
        onPointerDown={(e) => menu.anchor && e.nativeEvent.stopPropagation()}
        onClick={(e) => {
          if (menu.anchor) return menu.close();
          // Меню — справа от рельса, нижним краем на уровне аватара
          const rail = (e.currentTarget.closest('.rail') ?? e.currentTarget).getBoundingClientRect();
          menu.openAt(rail.right + 8, e.currentTarget.getBoundingClientRect().bottom);
        }}
      >
        <Avatar src={me.avatarUrl} name={me.displayName} id={me.id} size={38} />
      </button>
      <Menu
        anchor={menu.anchor}
        onClose={menu.close}
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
          { label: 'Мой профиль', icon: <UserRound size={18} />, onClick: () => navigate('/profile') },
          { label: 'Настройки', icon: <Settings size={18} />, onClick: () => navigate('/settings') },
          { label: 'Скачать приложение', icon: <Download size={18} />, onClick: () => navigate('/download') },
          { label: 'Помощь', icon: <LifeBuoy size={18} />, onClick: () => navigate('/help') },
          'separator',
          { label: 'Выйти', icon: <LogOut size={18} />, danger: true, onClick: () => void confirmLogout() },
        ]}
      />
    </>
  );
}
