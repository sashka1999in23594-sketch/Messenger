import { Fragment } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { ArrowLeft, Bell, ChevronRight, Menu as MenuIcon, PanelLeftOpen, Search, WifiOff } from 'lucide-react';
import { findByPath, type NavSection } from '../navigation';
import { usePrefs } from '../../shared/stores/prefs';
import { useRealtime } from '../../shared/stores/realtime';
import { useSession } from '../../shared/stores/session';
import { useUi } from '../../shared/stores/ui';
import { useIsDesktop } from '../../shared/hooks';
import { IconButton } from '../../shared/ui';
import { useBadge } from './Rail';

/** Хлебные крошки: где я в «лабиринте» разделов и как вернуться на уровень выше. */
function Breadcrumbs({ section }: { section: NavSection }) {
  const { pathname } = useLocation();
  const crumb = useUi((s) => s.crumb);
  const found = findByPath(pathname);
  const exact = found?.node.path === pathname;
  const trail = found ? [...found.trail.slice(1), found.node] : [];
  const extra = !exact ? (crumb ?? pageTitleFromPath(pathname)) : null;
  return (
    <nav className="crumbs" aria-label="Вы здесь">
      <Link to={section.path} className={trail.length === 0 && !extra ? 'crumbs__current' : undefined}>
        {section.label}
      </Link>
      {trail.map((n, i) => {
        const last = i === trail.length - 1 && !extra;
        return (
          <Fragment key={n.id}>
            <ChevronRight size={14} className="crumbs__sep" />
            {n.path && !last ? (
              <Link to={n.path}>{n.label}</Link>
            ) : (
              <span className={last ? 'crumbs__current' : undefined}>{n.label}</span>
            )}
          </Fragment>
        );
      })}
      {extra && (
        <>
          <ChevronRight size={14} className="crumbs__sep" />
          <span className="crumbs__current">{extra}</span>
        </>
      )}
    </nav>
  );
}

function pageTitleFromPath(pathname: string): string | null {
  if (pathname.startsWith('/chats/')) return 'Переписка';
  if (pathname.startsWith('/post/')) return 'Публикация';
  if (pathname.startsWith('/watch/')) return 'Просмотр';
  if (pathname.startsWith('/u/')) return `@${decodeURIComponent(pathname.split('/')[2] ?? '')}`;
  if (pathname.startsWith('/tag/')) return `#${decodeURIComponent(pathname.split('/')[2] ?? '')}`;
  if (pathname.startsWith('/playlist/')) return 'Плейлист';
  return null;
}

export function TopBar({ section }: { section: NavSection }) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const isDesktop = useIsDesktop();
  const navCollapsed = usePrefs((s) => s.navCollapsed);
  const setPrefs = usePrefs((s) => s.set);
  const setDrawer = useUi((s) => s.setDrawer);
  const setNavOpen = useUi((s) => s.setNavOpen);
  const navOpen = useUi((s) => s.navOpen);
  const setPalette = useUi((s) => s.setPalette);
  const status = useRealtime((s) => s.status);
  const me = useSession((s) => s.me);
  const notifications = useBadge('notifications');
  const isRoot = pathname === section.path;
  const bare = useUi((s) => s.bare);

  return (
    <header className="topbar">
      <span className="mobile-only">
        {isRoot ? (
          <IconButton label="Меню" onClick={() => setDrawer(true)}>
            <MenuIcon size={22} />
          </IconButton>
        ) : (
          <IconButton label="Назад" onClick={() => (history.length > 1 ? navigate(-1) : navigate(section.path))}>
            <ArrowLeft size={22} />
          </IconButton>
        )}
      </span>
      {(!isDesktop || navCollapsed || bare) && (
        <span className="desktop-only">
          <IconButton
            label="Показать разделы"
            onClick={() => (isDesktop && !bare ? setPrefs({ navCollapsed: false }) : setNavOpen(!navOpen))}
          >
            <PanelLeftOpen size={20} />
          </IconButton>
        </span>
      )}
      <Breadcrumbs section={section} />
      {status === 'offline' && (
        <span className="tag tag--warning" title="Нет соединения — переподключаемся">
          <WifiOff size={14} /> <span className="desktop-only">Нет связи</span>
        </span>
      )}
      <button className="topbar__search" onClick={() => setPalette(true)}>
        <Search size={16} />
        Поиск и навигация
        <span className="kbd">Ctrl K</span>
      </button>
      <span className="mobile-only">
        <IconButton label="Поиск" onClick={() => setPalette(true)}>
          <Search size={21} />
        </IconButton>
      </span>
      {me && (
        <IconButton label="Уведомления" className="topbar__bell" onClick={() => navigate('/notifications')}>
          <Bell size={21} />
          {notifications > 0 && <span className="badge">{notifications > 99 ? '99+' : notifications}</span>}
        </IconButton>
      )}
    </header>
  );
}
