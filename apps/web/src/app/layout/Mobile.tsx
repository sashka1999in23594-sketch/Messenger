import { useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router';
import { Ellipsis, LogOut } from 'lucide-react';
import { mobileTabs, sectionFor, sections } from '../navigation';
import { useSession } from '../../shared/stores/session';
import { useUi } from '../../shared/stores/ui';
import { useEscape } from '../../shared/hooks';
import { Avatar, Button, Logo } from '../../shared/ui';
import { cn } from '../../shared/lib/format';
import { logout } from '../session';
import { NavTreeView } from './NavTree';
import { RailItem, useBadge } from './Rail';

function Tab({ id }: { id: (typeof mobileTabs)[number] }) {
  const section = sections.find((s) => s.id === id)!;
  const badge = useBadge(section.badge);
  const { pathname } = useLocation();
  const active = sectionFor(pathname).id === id;
  const Icon = section.icon;
  return (
    <NavLink to={section.path} className={cn('bottom-tabs__item', active && 'bottom-tabs__item--active')}>
      <Icon size={23} strokeWidth={active ? 2.3 : 1.9} />
      {section.short}
      {badge > 0 && <span className="badge bottom-tabs__badge">{badge > 99 ? '99+' : badge}</span>}
    </NavLink>
  );
}

export function BottomTabs() {
  const setDrawer = useUi((s) => s.setDrawer);
  const notif = useBadge('notifications');
  return (
    <nav className="bottom-tabs" aria-label="Основные разделы">
      {mobileTabs.map((id) => (
        <Tab key={id} id={id} />
      ))}
      <button className="bottom-tabs__item" onClick={() => setDrawer(true)}>
        <Ellipsis size={24} />
        Ещё
        {notif > 0 && <span className="badge badge--dot bottom-tabs__badge" />}
      </button>
    </nav>
  );
}

/** Шторка со всем деревом разделов — на телефоне здесь «живёт» весь лабиринт. */
export function MobileDrawer() {
  const open = useUi((s) => s.drawerOpen);
  const setDrawer = useUi((s) => s.setDrawer);
  const me = useSession((s) => s.me);
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [picked, setPicked] = useState<string | null>(null);
  useEscape(() => setDrawer(false), open);
  if (!open || !me) return null;
  const section = sections.find((s) => s.id === picked) ?? sectionFor(pathname);
  const close = () => {
    setDrawer(false);
    setPicked(null);
  };
  return (
    <div className="drawer" onClick={(e) => e.target === e.currentTarget && close()}>
      <div className="drawer__panel" role="dialog" aria-label="Навигация">
        <button
          className="drawer__me"
          onClick={() => {
            navigate('/profile');
            close();
          }}
        >
          <Avatar src={me.avatarUrl} name={me.displayName} id={me.id} size={54} />
          <span className="col grow" style={{ gap: 0, textAlign: 'left' }}>
            <span className="bold" style={{ fontSize: 'var(--fs-lg)' }}>{me.displayName}</span>
            <span className="small muted">@{me.username}</span>
          </span>
          <Logo size={34} />
        </button>
        <div className="drawer__sections">
          {sections.map((s) => (
            <div
              key={s.id}
              onClickCapture={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setPicked(s.id);
              }}
            >
              <RailItem section={s} active={section.id === s.id} />
            </div>
          ))}
        </div>
        <div className="section-nav__scroll">
          <div className="section-nav__group-label">{section.label}</div>
          <NavTreeView section={section} onNavigate={close} />
        </div>
        <div style={{ padding: 12, borderTop: '1px solid var(--border)' }}>
          <Button variant="danger-ghost" block icon={<LogOut size={18} />} onClick={() => void logout()}>
            Выйти
          </Button>
        </div>
      </div>
    </div>
  );
}
