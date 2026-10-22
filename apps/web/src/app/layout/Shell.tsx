import { Suspense, useEffect, useRef } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router';
import { exactNode, sectionFor } from '../navigation';
import { setRealtimeNavigate } from '../realtime';
import { usePrefs } from '../../shared/stores/prefs';
import { useUi } from '../../shared/stores/ui';
import { cn } from '../../shared/lib/format';
import { Loading } from '../../shared/ui';
import { CallScreen } from '../../features/calls/CallScreen';
import { RoomScreen } from '../../features/calls/RoomScreen';
import { CommandPalette } from './CommandPalette';
import { LockScreen } from './LockScreen';
import { BottomTabs, MobileDrawer } from './Mobile';
import { SectionNav } from './NavTree';
import { Rail } from './Rail';
import { TopBar } from './TopBar';
import { brandName } from '../../shared/lib/brand';

/**
 * Видимая область экрана (на телефоне её сжимает клавиатура). Пишем размеры
 * в CSS-переменные --vvh/--vvt, а на <html> — data-kb="open", пока клавиатура
 * открыта: оболочка садится ровно над клавиатурой, поле ввода не уезжает.
 */
export function useVisualViewport() {
  useEffect(() => {
    const vv = window.visualViewport;
    const root = document.documentElement;
    if (!vv) return;
    let frame = 0;
    const apply = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        root.style.setProperty('--vvh', `${Math.round(vv.height)}px`);
        root.style.setProperty('--vvt', `${Math.round(vv.offsetTop)}px`);
        const kb = window.innerHeight - vv.height > 140 && matchMedia('(pointer: coarse)').matches;
        if (kb) root.dataset.kb = 'open';
        else delete root.dataset.kb;
        // iOS прокручивает документ при фокусе — возвращаем, вся прокрутка внутри панелей
        if (!kb && window.scrollY) window.scrollTo(0, 0);
      });
    };
    apply();
    vv.addEventListener('resize', apply);
    vv.addEventListener('scroll', apply);
    return () => {
      cancelAnimationFrame(frame);
      vv.removeEventListener('resize', apply);
      vv.removeEventListener('scroll', apply);
      root.style.removeProperty('--vvh');
      root.style.removeProperty('--vvt');
      delete root.dataset.kb;
    };
  }, []);
}

export function Shell() {
  const { pathname } = useLocation();
  const mainRef = useRef<HTMLElement>(null);
  useVisualViewport();
  // Крупный заголовок страницы ушёл под шапку — показываем короткий заголовок в шапке
  useEffect(() => {
    const main = mainRef.current;
    if (!main) return;
    const onScroll = (e: Event) => {
      const el = e.target as HTMLElement;
      // Только вертикальные прокрутки страницы (не ленты чипсов и не шапка)
      if (!(el instanceof HTMLElement) || el.closest('.topbar') || el.scrollHeight - el.clientHeight < 8) return;
      const scrolled = el.scrollTop > 40;
      if (scrolled !== (main.dataset.scrolled === '1')) {
        if (scrolled) main.dataset.scrolled = '1';
        else delete main.dataset.scrolled;
      }
    };
    main.addEventListener('scroll', onScroll, { capture: true, passive: true });
    return () => main.removeEventListener('scroll', onScroll, { capture: true });
  }, []);
  useEffect(() => {
    if (mainRef.current) delete mainRef.current.dataset.scrolled;
  }, [pathname]);
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
      document.title = `${node.node.label} · ${brandName()}`;
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
      <main className="main pane" ref={mainRef}>
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
      <CallScreen />
      <RoomScreen />
      <LockScreen />
    </div>
  );
}

/** Страница, которой нужен весь экран на телефоне (переписка, Reels). */
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
