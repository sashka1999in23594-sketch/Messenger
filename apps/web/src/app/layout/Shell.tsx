import { Suspense, useEffect } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router';
import { exactNode, sectionFor } from '../navigation';
import { setRealtimeNavigate } from '../realtime';
import { usePrefs } from '../../shared/stores/prefs';
import { useUi } from '../../shared/stores/ui';
import { cn } from '../../shared/lib/format';
import { Loading } from '../../shared/ui';
import { CommandPalette } from './CommandPalette';
import { LockScreen } from './LockScreen';
import { BottomTabs, MobileDrawer } from './Mobile';
import { SectionNav } from './NavTree';
import { Rail } from './Rail';
import { TopBar } from './TopBar';

export function Shell() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const section = sectionFor(pathname);
  const navCollapsed = usePrefs((s) => s.navCollapsed);
  const pushRecent = usePrefs((s) => s.pushRecent);
  const navOpen = useUi((s) => s.navOpen);
  const setNavOpen = useUi((s) => s.setNavOpen);
  const immersive = useUi((s) => s.immersive);
  const bare = useUi((s) => s.bare);

  useEffect(() => setRealtimeNavigate((to) => navigate(to)), [navigate]);
  useEffect(() => {
    const node = exactNode(pathname);
    if (node) {
      pushRecent(node.node.id);
      document.title = `${node.node.label} · Omni`;
    }
    setNavOpen(false);
  }, [pathname, pushRecent, setNavOpen]);

  return (
    <div
      className={cn(
        'shell',
        navCollapsed && !bare && 'shell--nav-collapsed',
        bare && 'shell--bare',
        navOpen && 'shell--nav-open',
        immersive && 'shell--immersive',
      )}
    >
      <Rail current={section} />
      <SectionNav section={section} />
      {navOpen && <div className="nav-scrim" onClick={() => setNavOpen(false)} />}
      <main className="main pane">
        <TopBar section={section} />
        <div className="content">
          <Suspense fallback={<Loading />}>
            <Outlet />
          </Suspense>
        </div>
      </main>
      <BottomTabs />
      <MobileDrawer />
      <CommandPalette />
      <LockScreen />
    </div>
  );
}

/** Страница, которой нужен весь экран на телефоне (переписка, клипы). */
export function useImmersive(on = true) {
  const set = useUi((s) => s.setImmersive);
  useEffect(() => {
    set(on);
    return () => set(false);
  }, [on, set]);
}

/**
 * Страница рисует собственные панели (мессенджер): верхняя панель скрыта,
 * дерево разделов прячется и выезжает по кнопке.
 */
export function useBareLayout(on = true) {
  const set = useUi((s) => s.setBare);
  useEffect(() => {
    set(on);
    return () => set(false);
  }, [on, set]);
}
