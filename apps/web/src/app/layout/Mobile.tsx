import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { NavLink, useLocation, useNavigate } from 'react-router';
import { Bookmark, ChevronRight, Download, LayoutGrid, LifeBuoy, LogOut, Moon, Settings, Sun } from 'lucide-react';
import { mobileTabs, sectionFor, sections, type NavSection } from '../navigation';
import { usePrefs } from '../../shared/stores/prefs';
import { useSession } from '../../shared/stores/session';
import { useUi } from '../../shared/stores/ui';
import { useEscape } from '../../shared/hooks';
import { Avatar } from '../../shared/ui';
import { cn } from '../../shared/lib/format';
import { confirmLogout } from '../session';
import { NavTreeView } from './NavTree';
import { useBadge } from './Rail';

const fmtBadge = (n: number) => (n > 99 ? '99+' : String(n));

function Tab({ id }: { id: (typeof mobileTabs)[number] }) {
  const section = sections.find((s) => s.id === id)!;
  const badge = useBadge(section.badge);
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const active = sectionFor(pathname).id === id;
  const Icon = section.icon;
  return (
    <NavLink
      to={section.path}
      className={cn('bottom-tabs__item', active && 'bottom-tabs__item--active')}
      aria-current={active ? 'page' : undefined}
      onClick={(e) => {
        // Повторное нажатие на активную вкладку — к началу раздела (и наверх списка)
        if (active && pathname === section.path) {
          e.preventDefault();
          document.querySelector('.content .chats__scroll, .content .scroll')?.scrollTo({ top: 0, behavior: 'smooth' });
        } else if (active) {
          e.preventDefault();
          navigate(section.path);
        }
      }}
    >
      <span className="bottom-tabs__icon">
        <Icon size={24} strokeWidth={active ? 2.2 : 1.8} />
        {badge > 0 && <span className="badge badge--red bottom-tabs__badge">{fmtBadge(badge)}</span>}
      </span>
      <span className="bottom-tabs__label">{section.short}</span>
    </NavLink>
  );
}

export function BottomTabs() {
  const setDrawer = useUi((s) => s.setDrawer);
  const drawerOpen = useUi((s) => s.drawerOpen);
  const notif = useBadge('notifications');
  const { pathname } = useLocation();
  // «Ещё» подсвечена, когда открыт раздел не из вкладок (видео, настройки…)
  const inMore = !mobileTabs.includes(sectionFor(pathname).id as (typeof mobileTabs)[number]);
  return (
    <nav className="bottom-tabs" aria-label="Основные разделы">
      {mobileTabs.map((id) => (
        <Tab key={id} id={id} />
      ))}
      <button
        type="button"
        className={cn('bottom-tabs__item', (inMore || drawerOpen) && 'bottom-tabs__item--active')}
        onClick={() => setDrawer(true)}
        aria-haspopup="dialog"
      >
        <span className="bottom-tabs__icon">
          <LayoutGrid size={23} strokeWidth={inMore || drawerOpen ? 2.2 : 1.8} />
          {notif > 0 && <span className="badge badge--red bottom-tabs__badge">{fmtBadge(notif)}</span>}
        </span>
        <span className="bottom-tabs__label">Ещё</span>
      </button>
    </nav>
  );
}

/** Плитка раздела в шторке «Ещё». */
function SectionTile({ section, active, onGo }: { section: NavSection; active: boolean; onGo: () => void }) {
  const badge = useBadge(section.badge);
  const Icon = section.icon;
  return (
    <NavLink to={section.path} className={cn('more-tile', active && 'more-tile--active')} onClick={onGo}>
      <span className={cn('more-tile__icon', `more-tile__icon--${section.id}`)}>
        <Icon size={22} strokeWidth={2} />
        {badge > 0 && <span className="badge badge--red more-tile__badge">{fmtBadge(badge)}</span>}
      </span>
      <span className="more-tile__label">{section.short}</span>
    </NavLink>
  );
}

/**
 * Шторка «Ещё»: аккаунт, все разделы плитками, подразделы текущего раздела,
 * быстрые ссылки и выход. Смахивается вниз.
 */
export function MobileDrawer() {
  const open = useUi((s) => s.drawerOpen);
  const setDrawer = useUi((s) => s.setDrawer);
  const me = useSession((s) => s.me);
  const theme = usePrefs((s) => s.theme);
  const setPrefs = usePrefs((s) => s.set);
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const panel = useRef<HTMLDivElement>(null);
  const drag = useRef<{ y: number; dy: number } | null>(null);
  const close = () => setDrawer(false);
  useEscape(close, open);
  useEffect(() => {
    if (open) panel.current?.focus();
  }, [open]);
  if (!open || !me) return null;
  const section = sectionFor(pathname);
  const isDark = theme === 'dark' || (theme === 'system' && document.documentElement.dataset.theme === 'dark');
  const others = sections.filter((s) => !mobileTabs.includes(s.id as (typeof mobileTabs)[number]));
  const go = (to: string) => {
    navigate(to);
    close();
  };

  return createPortal(
    <div className="more-sheet-layer" onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <div
        ref={panel}
        className="more-sheet"
        role="dialog"
        aria-modal="true"
        aria-label="Ещё: аккаунт и разделы"
        tabIndex={-1}
        onTouchStart={(e) => {
          const body = panel.current?.querySelector('.more-sheet__body');
          if (body && body.scrollTop > 0 && !(e.target as HTMLElement).closest('.more-sheet__grip')) return;
          drag.current = { y: e.touches[0]!.clientY, dy: 0 };
        }}
        onTouchMove={(e) => {
          const d = drag.current;
          if (!d || !panel.current) return;
          d.dy = Math.max(0, e.touches[0]!.clientY - d.y);
          if (d.dy > 6) panel.current.style.transform = `translateY(${d.dy}px)`;
        }}
        onTouchEnd={() => {
          const d = drag.current;
          drag.current = null;
          if (!d || !panel.current) return;
          if (d.dy > 110) return close();
          panel.current.style.transform = '';
        }}
      >
        <span className="more-sheet__grip" aria-hidden />
        <div className="more-sheet__body">
          <button type="button" className="more-me" onClick={() => go('/profile')}>
            <Avatar src={me.avatarUrl} name={me.displayName} id={me.id} size={56} />
            <span className="more-me__text">
              <span className="more-me__name">{me.displayName}</span>
              <span className="more-me__user">@{me.username}</span>
            </span>
            <ChevronRight size={20} className="more-me__chevron" />
          </button>

          <div className="more-grid" aria-label="Разделы">
            {others.map((s) => (
              <SectionTile key={s.id} section={s} active={section.id === s.id} onGo={close} />
            ))}
          </div>

          {section.children.length > 1 && (
            <section className="more-card">
              <div className="more-card__title">{section.label}</div>
              <div className="more-tree">
                <NavTreeView section={section} onNavigate={close} />
              </div>
            </section>
          )}

          <section className="more-card more-list">
            <button type="button" className="more-row" onClick={() => go('/chats/saved')}>
              <span className="more-row__icon more-row__icon--sun">
                <Bookmark size={18} />
              </span>
              <span className="more-row__label">Избранное</span>
              <ChevronRight size={18} className="more-row__chevron" />
            </button>
            <button type="button" className="more-row" onClick={() => setPrefs({ theme: isDark ? 'light' : 'dark' })}>
              <span className="more-row__icon more-row__icon--night">{isDark ? <Sun size={18} /> : <Moon size={18} />}</span>
              <span className="more-row__label">{isDark ? 'Светлая тема' : 'Тёмная тема'}</span>
            </button>
            <button type="button" className="more-row" onClick={() => go('/settings')}>
              <span className="more-row__icon more-row__icon--gray">
                <Settings size={18} />
              </span>
              <span className="more-row__label">Настройки</span>
              <ChevronRight size={18} className="more-row__chevron" />
            </button>
            <button type="button" className="more-row" onClick={() => go('/download')}>
              <span className="more-row__icon more-row__icon--green">
                <Download size={18} />
              </span>
              <span className="more-row__label">Скачать приложение</span>
              <ChevronRight size={18} className="more-row__chevron" />
            </button>
            <button type="button" className="more-row" onClick={() => go('/help')}>
              <span className="more-row__icon more-row__icon--blue">
                <LifeBuoy size={18} />
              </span>
              <span className="more-row__label">Помощь</span>
              <ChevronRight size={18} className="more-row__chevron" />
            </button>
          </section>

          <section className="more-card more-list">
            <button
              type="button"
              className="more-row more-row--danger"
              onClick={() => {
                close();
                void confirmLogout();
              }}
            >
              <span className="more-row__icon more-row__icon--red">
                <LogOut size={18} />
              </span>
              <span className="more-row__label">Выйти</span>
            </button>
          </section>
        </div>
      </div>
    </div>,
    document.body,
  );
}
