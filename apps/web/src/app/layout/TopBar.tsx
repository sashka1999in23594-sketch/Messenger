import { Fragment } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { Bell, ChevronLeft, ChevronRight, PanelLeftOpen, Search, WifiOff } from 'lucide-react';
import { exactNode, findByPath, sections, type NavSection } from '../navigation';
import { usePrefs } from '../../shared/stores/prefs';
import { useRealtime } from '../../shared/stores/realtime';
import { useSession } from '../../shared/stores/session';
import { useUi } from '../../shared/stores/ui';
import { useIsDesktop } from '../../shared/hooks';
import { Avatar, IconButton } from '../../shared/ui';
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

/**
 * Куда ведёт «Назад», если в истории окна некуда возвращаться (открыли по ссылке):
 * ближайший раздел выше по дереву навигации, иначе — корень раздела.
 */
export function parentPath(pathname: string, section: NavSection): string {
  const found = findByPath(pathname);
  if (found) {
    const exact = found.node.path === pathname;
    const chain = exact ? found.trail : [...found.trail, found.node];
    for (let i = chain.length - 1; i >= 0; i--) {
      const p = chain[i]!.path;
      if (p && p !== pathname) return p;
    }
  }
  return pathname === section.path ? '/' : section.path;
}

/** «Назад»: по истории, а если её нет — на уровень выше. */
export function useBack(section: NavSection) {
  const navigate = useNavigate();
  const location = useLocation();
  return () => (location.key !== 'default' ? navigate(-1) : navigate(parentPath(location.pathname, section), { replace: true }));
}

export function TopBar({ section }: { section: NavSection }) {
  const { pathname } = useLocation();
  const isDesktop = useIsDesktop();
  const navCollapsed = usePrefs((s) => s.navCollapsed);
  const setPrefs = usePrefs((s) => s.set);
  const setDrawer = useUi((s) => s.setDrawer);
  const setNavOpen = useUi((s) => s.setNavOpen);
  const navOpen = useUi((s) => s.navOpen);
  const setPalette = useUi((s) => s.setPalette);
  const setNotif = useUi((s) => s.setNotif);
  const status = useRealtime((s) => s.status);
  const me = useSession((s) => s.me);
  const notifications = useBadge('notifications');
  // Корень раздела — вкладки внизу и аватар слева; глубже — кнопка «Назад»
  const exact = exactNode(pathname);
  const isRoot =
    pathname === section.path ||
    sections.some((s) => s.path === pathname) ||
    (!!exact && exact.trail.length === 1 && pathname.startsWith(`${section.path}/`));
  const bare = useUi((s) => s.bare);
  const back = useBack(section);

  return (
    <header className="topbar">
      <span className="mobile-only topbar__lead">
        {isRoot ? (
          me && (
            <button type="button" className="topbar__me" onClick={() => setDrawer(true)} aria-label="Мой аккаунт и все разделы">
              <Avatar src={me.avatarUrl} name={me.displayName} id={me.id} size={32} />
            </button>
          )
        ) : (
          <button type="button" className="topbar__back" onClick={back} aria-label="Назад">
            <ChevronLeft size={28} strokeWidth={2.2} />
          </button>
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
          <Search size={22} />
        </IconButton>
      </span>
      {me && (
        <IconButton label="Уведомления" className="topbar__bell" onClick={() => setNotif(true)}>
          <Bell size={22} />
          {notifications > 0 && <span className="badge badge--red">{notifications > 99 ? '99+' : notifications}</span>}
        </IconButton>
      )}
    </header>
  );
}
