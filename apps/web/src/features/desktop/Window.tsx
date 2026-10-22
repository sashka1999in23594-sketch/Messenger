/**
 * Окно рабочего стола. В нём — обычные страницы Sunnet со своей историей
 * переходов. Ссылка на другой раздел открывает (или поднимает) окно этого
 * раздела — как ссылка в одной программе открывает другую. С Ctrl/⌘ или
 * средней кнопкой — новое окно.
 *
 * Перетаскивание и изменение размера идут напрямую через стиль элемента,
 * без перерисовки React; в хранилище результат попадает, когда кнопку отпустили.
 */
import { Component, memo, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentProps, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { create } from 'zustand';
import { createPath, Outlet, Router, UNSAFE_createMemoryHistory as createMemoryHistory } from 'react-router';
import { ArrowLeft, Copy, Maximize2, Minimize2, Minus, PanelLeft, PanelRight, RotateCcw, Search, Square, SquarePlus, X } from 'lucide-react';
import { exactNode, sections } from '../../app/navigation';
import { NavTreeView } from '../../app/layout/NavTree';
import { usePrefs } from '../../shared/stores/prefs';
import { AppRoutes } from '../../app/routes';
import { cn } from '../../shared/lib/format';
import { Loading } from '../../shared/ui';
import { appFor, defaultSide, hasTree, isAppPath, isMac, MOD, parentPath, SIDE_W, titleFor } from './apps';
import { DeskMenu, useDeskMenu, type DeskMenuEntry } from './DeskMenu';
import { closeWindow, minimizeWindow, openPath, playOpen, playRestore, restoreOrigin, winEls, withGlide } from './fx';
import { clampRect, MENUBAR_H, MIN_H, MIN_W, snapRect, useArea, type Rect, type Snap } from './geometry';
import { AppTile } from './AppTile';
import { fresh, useDesktop, visibleArea, type Win } from './store';

type Kind = 'move' | 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';
const GRIPS: Exclude<Kind, 'move'>[] = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];

/** Подсветка места, куда прилипнет перетаскиваемое окно. */
export const usePreview = create<{ rect: Rect | null; z: number }>(() => ({ rect: null, z: 0 }));

/** Зона прилипания под курсором: верх — на весь экран, края — половины, углы — четверти. */
function zoneAt(cx: number, cy: number, a: Rect): Snap | null {
  const edge = 12;
  const corner = Math.min(120, a.h * 0.2);
  if (cy <= a.y + 2) return 'max';
  if (cx <= edge) return cy < a.y + corner ? 'tl' : cy > a.y + a.h - corner ? 'bl' : 'left';
  if (cx >= window.innerWidth - edge) return cy < a.y + corner ? 'tr' : cy > a.y + a.h - corner ? 'br' : 'right';
  return null;
}

/** Ctrl/⌘ или Shift при щелчке: переход откроется в новом окне. */
let newWindowClick = false;

/** Окна по одному на ключ: каждое подписано только на свои данные. */
export const DeskWindow = memo(function DeskWindow({ id }: { id: string }) {
  const win = useDesktop((s) => s.wins.find((w) => w.id === id));
  const active = useDesktop((s) => {
    let top: Win | undefined;
    for (const w of s.wins) if (!w.min && (!top || w.z > top.z)) top = w;
    return top?.id === id;
  });
  const controls = useDesktop((s) => s.controls);
  const area = useArea((s) => s.area);
  if (!win) return null;
  return <WindowShell win={win} active={active} area={area} mac={controls === 'mac' || (controls === 'auto' && isMac)} />;
});

/** Страницы раздела без общей оболочки приложения. */
function WindowLayout() {
  return (
    <div className="content desk-win__content">
      <Suspense fallback={<Loading />}>
        <Outlet />
      </Suspense>
    </div>
  );
}

/** Сбой страницы не роняет весь рабочий стол — только это окно. */
class WindowBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="empty desk-win__error">
        <strong>Не удалось показать это окно</strong>
        <span className="muted">Попробуйте открыть его заново — остальные окна работают.</span>
        <button type="button" className="btn btn--secondary" onClick={() => this.setState({ failed: false })}>
          <RotateCcw size={16} /> Повторить
        </button>
      </div>
    );
  }
}

/** Содержимое окна не перерисовывается, когда окно двигают или поднимают наверх. */
const WindowBody = memo(function WindowBody() {
  return (
    <div className="desk-win__body">
      <WindowBoundary>
        <AppRoutes layout={<WindowLayout />} />
      </WindowBoundary>
    </div>
  );
});

type Navigator = ComponentProps<typeof Router>['navigator'];

function useWindowRouter(win: Win) {
  const [history] = useState(() => createMemoryHistory({ initialEntries: [win.path], v5Compat: true }));
  const [state, setState] = useState({ action: history.action, location: history.location });
  useLayoutEffect(() => history.listen((u) => setState({ action: u.action, location: u.location })), [history]);
  const path = state.location.pathname + state.location.search;
  const pathRef = useRef(path);
  pathRef.current = path;

  const navigator = useMemo<Navigator>(
    () => ({
      createHref: history.createHref,
      createURL: history.createURL,
      encodeLocation: history.encodeLocation,
      go: history.go,
      push: (to, st) => {
        const target = typeof to === 'string' ? to : createPath(to);
        if (newWindowClick) {
          newWindowClick = false;
          openPath(target, { newWindow: true });
          return;
        }
        // Другой раздел — в его окне; адрес этого окна не меняется
        if (appFor(target).id !== appFor(pathRef.current).id) {
          openPath(target);
          return;
        }
        history.push(to, st);
      },
      replace: (to, st) => history.replace(to, st),
    }),
    [history],
  );

  // Переход по запросу снаружи: уведомление, поиск, ссылка из другого окна
  useEffect(() => {
    if (win.go && win.go.path !== pathRef.current) history.push(win.go.path);
  }, [win.go?.n]); // eslint-disable-line react-hooks/exhaustive-deps

  // Адрес окна сохраняется — после перезагрузки окно откроется там же;
  // открытый подраздел попадает в «Недавние» поиска Ctrl+K
  const setPath = useDesktop((s) => s.setPath);
  useEffect(() => {
    setPath(win.id, path);
    const node = exactNode(state.location.pathname);
    if (node) usePrefs.getState().pushRecent(node.node.id);
  }, [path, win.id, setPath]); // eslint-disable-line react-hooks/exhaustive-deps

  return { history, navigator, state, path };
}

interface Gesture {
  kind: Kind;
  sx: number;
  sy: number;
  start: Rect;
  /** Обычное положение до перетаскивания — к нему окно вернётся из «у края» */
  origin: Rect;
  moved: boolean;
  zone: Snap | null;
}

function applyRect(el: HTMLElement | null, r: Rect) {
  if (!el) return;
  el.style.translate = `${r.x}px ${r.y}px`;
  el.style.width = `${r.w}px`;
  el.style.height = `${r.h}px`;
}

function WindowShell({ win, active, area, mac }: { win: Win; active: boolean; area: Rect; mac: boolean }) {
  const ref = useRef<HTMLElement>(null);
  const live = useRef<Rect | null>(null);
  const gesture = useRef<Gesture | null>(null);
  const [busy, setBusy] = useState<false | 'move' | 'resize'>(false);
  const { history, navigator, state, path } = useWindowRouter(win);
  const store = useDesktop.getState();
  const menu = useDeskMenu();

  const { app, sub, text: title } = titleFor(path);
  const view = useDesktop((s) => s.view);
  // Стол отдалён или приближен: окна живут в его координатах, а не экрана
  const box = visibleArea(area, view);

  // При обычном масштабе окно всегда достижимо; при отдалении размер не трогаем
  const normal = view.zoom === 1 ? clampRect(win, area) : { x: win.x, y: win.y, w: win.w, h: win.h };
  const fixed = win.max ? snapRect('max', area) : win.snap ? snapRect(win.snap, area) : null;
  const shown = live.current ?? fixed ?? normal;
  const isMax = !busy && win.max;
  const stuck = !busy && !!win.snap;

  // Регистрация для анимаций и фокуса
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    winEls.set(win.id, el);
    if (fresh.has(win.id)) {
      playOpen(el, fresh.get(win.id) ?? null);
      fresh.delete(win.id);
    }
    return () => void winEls.delete(win.id);
  }, [win.id]);

  // Возврат из дока: окно «вылетает» из своего значка
  const wasMin = useRef(win.min);
  const restoreFrom = useRef<DOMRect | null>(null);
  if (wasMin.current && !win.min && !restoreFrom.current) restoreFrom.current = restoreOrigin(win.id);
  useLayoutEffect(() => {
    if (wasMin.current && !win.min && ref.current) playRestore(ref.current, restoreFrom.current);
    wasMin.current = win.min;
    restoreFrom.current = null;
  }, [win.min]);

  // Esc во время перетаскивания — вернуть окно на место
  useEffect(() => {
    if (!busy) return;
    const onKey = (e: KeyboardEvent) => {
      const g = gesture.current;
      if (e.key !== 'Escape' || !g) return;
      gesture.current = null;
      live.current = null;
      usePreview.setState({ rect: null });
      setBusy(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy]);

  const begin = (kind: Kind) => (e: React.PointerEvent<HTMLElement>) => {
    if (e.button !== 0) return;
    if (kind === 'move' && (e.target as HTMLElement).closest('button, a, input')) return;
    if (kind !== 'move' && win.max) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    if (!ref.current?.contains(document.activeElement)) ref.current?.focus({ preventScroll: true });
    gesture.current = { kind, sx: e.clientX, sy: e.clientY, start: shown, origin: { x: win.x, y: win.y, w: win.w, h: win.h }, moved: false, zone: null };
  };

  const move = (e: React.PointerEvent<HTMLElement>) => {
    const g = gesture.current;
    if (!g) return;
    const dx = (e.clientX - g.sx) / view.zoom;
    const dy = (e.clientY - g.sy) / view.zoom;
    if (!g.moved) {
      if (Math.abs(dx) + Math.abs(dy) < 5) return;
      g.moved = true;
      if (g.kind === 'move' && (win.max || win.snap)) {
        // Окно «отлипает» от края: обычный размер, курсор на той же доле заголовка
        const w = Math.min(win.w, box.w);
        const h = Math.min(win.h, box.h);
        const sx = (g.sx - view.x) / view.zoom;
        const ratio = (sx - g.start.x) / g.start.w;
        g.start = { x: sx - ratio * w, y: g.start.y, w, h };
      }
      setBusy(g.kind === 'move' ? 'move' : 'resize');
    }
    let r: Rect;
    if (g.kind === 'move') {
      r = { ...g.start, x: Math.round(g.start.x + dx), y: Math.round(Math.max(view.zoom === 1 ? MENUBAR_H : box.y, g.start.y + dy)) };
      // Прилипание к краям — только при обычном масштабе
      const zone = view.zoom === 1 ? zoneAt(e.clientX, e.clientY, area) : null;
      if (zone !== g.zone) {
        g.zone = zone;
        usePreview.setState({ rect: zone ? snapRect(zone, area) : null, z: win.z });
      }
    } else {
      const s = g.start;
      r = { ...s };
      const k = g.kind;
      const maxW = box.x + box.w;
      if (k.includes('e')) r.w = Math.min(Math.max(MIN_W, s.w + dx), maxW - Math.max(box.x, s.x));
      if (k.includes('w')) {
        r.w = Math.min(Math.max(MIN_W, s.w - dx), s.x + s.w - box.x);
        r.x = s.x + s.w - r.w;
      }
      if (k.includes('s')) r.h = Math.max(MIN_H, s.h + dy);
      if (k.includes('n')) {
        r.h = Math.min(Math.max(MIN_H, s.h - dy), s.y + s.h - box.y);
        r.y = s.y + s.h - r.h;
      }
      r = { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h) };
    }
    live.current = r;
    applyRect(ref.current, r);
  };

  const end = () => {
    const g = gesture.current;
    gesture.current = null;
    if (!g?.moved) return;
    const r = live.current;
    usePreview.setState({ rect: null });
    if (g.kind === 'move' && g.zone) {
      const zone = g.zone;
      const normalRect = win.max || win.snap ? undefined : g.origin;
      withGlide(() => {
        live.current = null;
        store.snapTo(win.id, zone, normalRect);
        setBusy(false);
      });
      return;
    }
    live.current = null;
    if (r) store.place(win.id, g.kind === 'move' && view.zoom === 1 ? clampRect(r, area) : r);
    setBusy(false);
  };

  const toggleMax = () => withGlide(() => store.toggleMax(win.id));
  const snap = (s: Snap) => withGlide(() => store.snapTo(win.id, s));
  const restore = () => withGlide(() => store.snapTo(win.id, null));

  // Ссылки: Ctrl/⌘/Shift или средняя кнопка — новое окно; обычные <a> без роутера — тоже внутри окна
  const internalHref = (e: React.MouseEvent): string | null => {
    const a = (e.target as HTMLElement).closest('a[href]') as HTMLAnchorElement | null;
    if (!a || (a.target && a.target !== '_self') || a.hasAttribute('download')) return null;
    const url = new URL(a.href, window.location.href);
    if (url.origin !== window.location.origin) return null;
    const p = url.pathname + url.search + url.hash;
    return isAppPath(p) ? p : null;
  };
  const onClickCapture = (e: React.MouseEvent) => {
    if (!(e.ctrlKey || e.metaKey || e.shiftKey)) return;
    const href = internalHref(e);
    if (href) {
      e.preventDefault();
      openPath(href, { newWindow: true });
      return;
    }
    // Кнопка, которая сама переходит по адресу: переход уйдёт в новое окно
    newWindowClick = true;
    window.setTimeout(() => (newWindowClick = false), 0);
  };
  const onClick = (e: React.MouseEvent) => {
    if (e.defaultPrevented || e.button !== 0) return;
    const href = internalHref(e);
    if (!href) return;
    e.preventDefault();
    navigator.push(href);
  };
  const onAuxClick = (e: React.MouseEvent) => {
    if (e.button !== 1) return;
    const href = internalHref(e);
    if (!href) return;
    e.preventDefault();
    openPath(href, { newWindow: true });
  };

  const up = parentPath(path);
  const canBack = history.index > 0 || !!up;
  const back = () => (history.index > 0 ? history.go(-1) : up && history.replace(up));
  const tree = hasTree(app.id);
  const sideOpen = tree && (win.side ?? defaultSide(app.id, shown.w));
  const sideOverlay = shown.w < SIDE_W + 520;

  const menuItems: DeskMenuEntry[] = [
    { label: 'Свернуть', icon: <Minus size={18} />, hint: `${MOD}M`, onClick: () => void minimizeWindow(win.id) },
    win.max || win.snap
      ? { label: 'Восстановить размер', icon: <Copy size={18} />, onClick: restore }
      : { label: 'Развернуть', icon: <Maximize2 size={18} />, onClick: toggleMax },
    'separator',
    { label: 'Слева', icon: <PanelLeft size={18} />, hint: `${isMac ? '⌃⌥' : 'Ctrl+Alt+'}←`, onClick: () => snap('left') },
    { label: 'Справа', icon: <PanelRight size={18} />, hint: `${isMac ? '⌃⌥' : 'Ctrl+Alt+'}→`, onClick: () => snap('right') },
    'separator',
    { label: `Новое окно «${app.label}»`, icon: <SquarePlus size={18} />, onClick: () => openPath(app.path, { newWindow: true }) },
    'separator',
    { label: 'Закрыть', icon: <X size={18} />, hint: `${MOD}W`, danger: true, onClick: () => void closeWindow(win.id) },
  ];

  const buttons = (
    <WindowButtons
      mac={mac}
      max={win.max}
      onClose={() => void closeWindow(win.id)}
      onMin={() => void minimizeWindow(win.id)}
      onMax={toggleMax}
      onSnap={snap}
    />
  );

  return (
    <section
      ref={ref}
      className={cn(
        'desk-win',
        mac ? 'desk-win--mac' : 'desk-win--win',
        active && 'desk-win--active',
        isMax && 'desk-win--max',
        stuck && 'desk-win--snapped',
        busy && `desk-win--${busy}`,
      )}
      style={{ translate: `${shown.x}px ${shown.y}px`, width: shown.w, height: shown.h, zIndex: win.z }}
      hidden={win.min}
      tabIndex={-1}
      aria-label={title}
      data-win={win.id}
      onPointerDownCapture={() => store.focus(win.id)}
      onClickCapture={onClickCapture}
      onClick={onClick}
      onAuxClick={onAuxClick}
    >
      <Router location={state.location} navigationType={state.action} navigator={navigator}>
        <header
          className="desk-win__bar"
          onPointerDown={begin('move')}
          onPointerMove={move}
          onPointerUp={end}
          onPointerCancel={end}
          onDoubleClick={(e) => !(e.target as HTMLElement).closest('button') && toggleMax()}
          onContextMenu={(e) => {
            if ((e.target as HTMLElement).closest('button')) return;
            e.preventDefault();
            menu.open({ x: e.clientX, y: e.clientY });
          }}
        >
          <span className="desk-win__lead">
            {mac && buttons}
            {tree && (
              <button
                type="button"
                className={cn('desk-win__tool', sideOpen && 'desk-win__tool--on')}
                onClick={() => store.setSide(win.id, !sideOpen)}
                aria-pressed={sideOpen}
                aria-label="Подразделы"
                title={sideOpen ? 'Скрыть подразделы' : 'Показать подразделы'}
              >
                <PanelLeft size={17} />
              </button>
            )}
            <button type="button" className="desk-win__tool" onClick={back} disabled={!canBack} aria-label="Назад" title={history.index > 0 ? 'Назад' : 'На уровень выше'}>
              <ArrowLeft size={17} />
            </button>
          </span>
          <span className="desk-win__title">
            <AppTile app={app} size={20} />
            <span className="ellipsis">
              <span className="desk-win__app">{app.label}</span>
              {sub && <span className="desk-win__sub"> — {sub}</span>}
            </span>
          </span>
          {mac ? <span className="desk-win__trail" aria-hidden /> : buttons}
        </header>
        <div className="desk-win__main">
          {sideOpen && (
            <>
              {sideOverlay && <div className="desk-side__scrim" onClick={() => store.setSide(win.id, false)} aria-hidden />}
              <WindowSidebar appId={app.id} overlay={sideOverlay} onNavigate={() => sideOverlay && store.setSide(win.id, false)} />
            </>
          )}
          <WindowBody />
        </div>
      </Router>
      {!isMax &&
        GRIPS.map((k) => <span key={k} className={`desk-win__grip desk-win__grip--${k}`} onPointerDown={begin(k)} onPointerMove={move} onPointerUp={end} onPointerCancel={end} aria-hidden />)}
      <DeskMenu anchor={menu.anchor} onClose={menu.close} items={menuItems} label="Окно" />
    </section>
  );
}

/** Боковая панель окна: дерево подразделов — то же, что в обычном оформлении. */
function WindowSidebar({ appId, overlay, onNavigate }: { appId: string; overlay: boolean; onNavigate: () => void }) {
  const [filter, setFilter] = useState('');
  const section = sections.find((x) => x.id === appId);
  if (!section) return null;
  return (
    <aside className={cn('desk-side', overlay && 'desk-side--overlay')} aria-label={`Подразделы: ${section.label}`}>
      <div className="desk-side__search">
        <div className="input-group">
          <Search size={15} className="input-group__icon" />
          <input className="input" placeholder="Найти подраздел" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Найти подраздел" />
          {filter && (
            <button type="button" className="icon-btn icon-btn--sm input-group__action" onClick={() => setFilter('')} aria-label="Очистить">
              <X size={15} />
            </button>
          )}
        </div>
      </div>
      <div className="desk-side__scroll">
        <NavTreeView section={section} filter={filter} onNavigate={onNavigate} />
      </div>
    </aside>
  );
}

/** Кнопки окна: цветные «светофоры» macOS слева или привычные кнопки Windows справа. */
function WindowButtons({ mac, max, onClose, onMin, onMax, onSnap }: { mac: boolean; max: boolean; onClose: () => void; onMin: () => void; onMax: () => void; onSnap: (s: Snap) => void }) {
  const maxRef = useRef<HTMLButtonElement>(null);
  const [flyout, setFlyout] = useState<DOMRect | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const hover = () => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => maxRef.current && setFlyout(maxRef.current.getBoundingClientRect()), 550);
  };
  const leave = () => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setFlyout(null), 260);
  };
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const maxLabel = max ? 'Восстановить' : 'Развернуть';
  const maxBtn = (
    <button
      ref={maxRef}
      type="button"
      className={mac ? 'desk-light desk-light--max' : 'desk-cap'}
      onClick={() => {
        setFlyout(null);
        onMax();
      }}
      onPointerEnter={hover}
      onPointerLeave={leave}
      aria-label={maxLabel}
      title={mac ? undefined : maxLabel}
    >
      {mac ? max ? <Minimize2 size={8} strokeWidth={3} /> : <Maximize2 size={8} strokeWidth={3} /> : max ? <Copy size={13} /> : <Square size={12} />}
    </button>
  );
  const fly = flyout && (
    <SnapFlyout
      at={flyout}
      onEnter={() => window.clearTimeout(timer.current)}
      onLeave={leave}
      onPick={(s) => {
        setFlyout(null);
        onSnap(s);
      }}
    />
  );
  if (mac)
    return (
      <span className="desk-win__lights">
        <button type="button" className="desk-light desk-light--close" onClick={onClose} aria-label="Закрыть">
          <X size={8} strokeWidth={3} />
        </button>
        <button type="button" className="desk-light desk-light--min" onClick={onMin} aria-label="Свернуть">
          <Minus size={8} strokeWidth={3} />
        </button>
        {maxBtn}
        {fly}
      </span>
    );
  return (
    <span className="desk-win__caps">
      <button type="button" className="desk-cap" onClick={onMin} aria-label="Свернуть" title="Свернуть">
        <Minus size={15} />
      </button>
      {maxBtn}
      <button type="button" className="desk-cap desk-cap--close" onClick={onClose} aria-label="Закрыть" title="Закрыть">
        <X size={16} />
      </button>
      {fly}
    </span>
  );
}

const LAYOUTS: { label: string; zones: { snap: Snap; label: string }[] }[] = [
  { label: 'Пополам', zones: [{ snap: 'left', label: 'Слева' }, { snap: 'right', label: 'Справа' }] },
  {
    label: 'Четверти',
    zones: [
      { snap: 'tl', label: 'Вверху слева' },
      { snap: 'tr', label: 'Вверху справа' },
      { snap: 'bl', label: 'Внизу слева' },
      { snap: 'br', label: 'Внизу справа' },
    ],
  },
  { label: 'Весь экран', zones: [{ snap: 'max', label: 'На весь экран' }] },
];

/** Раскладки при наведении на кнопку «Развернуть» — как в Windows 11. */
function SnapFlyout({ at, onPick, onEnter, onLeave }: { at: DOMRect; onPick: (s: Snap) => void; onEnter: () => void; onLeave: () => void }) {
  const w = 236;
  const left = Math.max(8, Math.min(at.left + at.width / 2 - w / 2, window.innerWidth - w - 8));
  return createPortal(
    <div className="desk-snapfly" style={{ left, top: at.bottom + 8, width: w }} onPointerEnter={onEnter} onPointerLeave={onLeave} role="menu" aria-label="Раскладка окна">
      {LAYOUTS.map((l) => (
        <div key={l.label} className={cn('desk-snapfly__layout', `desk-snapfly__layout--${l.zones.length}`)} title={l.label}>
          {l.zones.map((z) => (
            <button key={z.snap} type="button" role="menuitem" className="desk-snapfly__zone" aria-label={z.label} title={z.label} onClick={() => onPick(z.snap)} />
          ))}
        </div>
      ))}
    </div>,
    document.body,
  );
}

/** Подсветка зоны прилипания под перетаскиваемым окном. */
export function SnapPreview() {
  const rect = usePreview((s) => s.rect);
  const z = usePreview((s) => s.z);
  const last = useRef<Rect | null>(null);
  if (rect) last.current = rect;
  const r = rect ?? last.current;
  if (!r) return null;
  return <div className={cn('desk-snap', rect && 'desk-snap--on')} style={{ translate: `${r.x}px ${r.y}px`, width: r.w, height: r.h, zIndex: z }} aria-hidden />;
}
