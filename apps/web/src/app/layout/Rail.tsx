import { Link, NavLink } from 'react-router';
import { Moon, Sun } from 'lucide-react';
import { sections, type NavSection } from '../navigation';
import { useSession } from '../../shared/stores/session';
import { usePrefs } from '../../shared/stores/prefs';
import { Avatar, Logo } from '../../shared/ui';
import { cn } from '../../shared/lib/format';

export function useBadge(kind: NavSection['badge']): number {
  const counters = useSession((s) => s.me?.counters);
  if (!counters || !kind) return 0;
  if (kind === 'chats') return counters.unreadChats;
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
      <Link to="/" className="rail__logo" aria-label="Omni — на главную">
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
      {me && (
        <Link to="/profile" className={cn('rail__me', current.id === 'profile' && 'rail__me--active')} aria-label="Мой профиль" title="Мой профиль">
          <Avatar src={me.avatarUrl} name={me.displayName} id={me.id} size={38} />
        </Link>
      )}
    </nav>
  );
}
