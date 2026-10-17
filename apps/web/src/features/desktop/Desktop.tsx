/**
 * «Пространство» — режим рабочего стола: бесконечное поле с точками, которое
 * приближается и отдаляется колесом мыши или щипком, и окна разделов на нём.
 * Окно можно двигать за заголовок, тянуть за край, свернуть в док, развернуть
 * на весь экран и закрыть. В каждом окне — полноценный раздел SpaceUp со своей
 * историей переходов (отдельный MemoryRouter), поэтому окна независимы.
 */
import { Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { MemoryRouter, Outlet, useLocation, useNavigate } from 'react-router';
import { ArrowLeft, LayoutGrid, Maximize2, Minimize2, Minus, MonitorX, Plus, X, ZoomIn, ZoomOut } from 'lucide-react';
import { findByPath, sectionFor, sections, type NavSection } from '../../app/navigation';
import { setRealtimeNavigate } from '../../app/realtime';
import { AppRoutes } from '../../app/routes';
import { useBadge } from '../../app/layout/Rail';
import { LockScreen } from '../../app/layout/LockScreen';
import { CallScreen } from '../calls/CallScreen';
import { usePrefs } from '../../shared/stores/prefs';
import { cn } from '../../shared/lib/format';
import { Loading, Logo } from '../../shared/ui';
import { DOCK_W, useDesktop, ZOOM_MAX, ZOOM_MIN, type View, type Win } from './store';
import './desktop.css';

const DOCK_APPS = ['home', 'messenger', 'channels', 'comets', 'video', 'companies', 'communities', 'search', 'notifications', 'stats', 'profile', 'settings'];
const MIN_W = 360;
const MIN_H = 280;
const clampZoom = (z: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));

/** Содержимое окна: те же страницы, что и в обычном режиме, без общей оболочки. */
function WindowLayout() {
  return (
    <div className="content desk-win__content">
      <Suspense fallback={<Loading />}>
        <Outlet />
      </Suspense>
    </div>
  );
}

type Drag = { kind: 'move' | 'e' | 's' | 'se' | 'w' | 'sw'; sx: number; sy: number; ox: number; oy: number; ow: number; oh: number };

function WindowFrame({ win, view, field }: { win: Win; view: View; field: { w: number; h: number } }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { focus, close, minimize, toggleMax, place, setPath } = useDesktop.getState();
  const drag = useRef<Drag | null>(null);
  const path = location.pathname + location.search;
  const section = sectionFor(location.pathname);
  const node = findByPath(location.pathname);
  const Icon = section.icon;
  const title = node && node.node.label !== section.label ? `${section.label} · ${node.node.label}` : section.label;

  // Адрес окна сохраняется — после перезагрузки окно откроется там же
  useEffect(() => setPath(win.id, path), [path, win.id, setPath]);
  // Переход по запросу снаружи (уведомление, док, «Открыть» в тосте)
  useEffect(() => {
    if (win.go) navigate(win.go.path);
  }, [win.go?.n]); // eslint-disable-line react-hooks/exhaustive-deps

  const start = (kind: Drag['kind']) => (e: RPointerEvent) => {
    if (e.button !== 0 || (kind === 'move' && (win.max || (e.target as HTMLElement).closest('button')))) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { kind, sx: e.clientX, sy: e.clientY, ox: win.x, oy: win.y, ow: win.w, oh: win.h };
  };
  const move = (e: RPointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = (e.clientX - d.sx) / view.zoom;
    const dy = (e.clientY - d.sy) / view.zoom;
    if (d.kind === 'move') return place(win.id, { x: Math.round(d.ox + dx), y: Math.round(d.oy + dy) });
    const rect: Partial<Win> = {};
    if (d.kind.includes('e')) rect.w = Math.max(MIN_W, Math.round(d.ow + dx));
    if (d.kind.includes('s')) rect.h = Math.max(MIN_H, Math.round(d.oh + dy));
    if (d.kind.includes('w')) {
      const w = Math.max(MIN_W, Math.round(d.ow - dx));
      rect.w = w;
      rect.x = d.ox + d.ow - w;
    }
    place(win.id, rect);
  };
  const end = () => {
    drag.current = null;
  };

  const style: React.CSSProperties = win.max
    ? {
        // Развёрнутое окно: обратный масштаб — ровно по размеру поля и чёткое при любом приближении
        left: -view.x / view.zoom,
        top: -view.y / view.zoom,
        width: field.w,
        height: field.h,
        transform: `scale(${1 / view.zoom})`,
        transformOrigin: '0 0',
        zIndex: 100_000 + win.z,
      }
    : { left: win.x, top: win.y, width: win.w, height: win.h, zIndex: win.z };

  return (
    <section
      className={cn('desk-win', win.max && 'desk-win--max', win.min && 'desk-win--min')}
      style={style}
      onPointerDownCapture={() => focus(win.id)}
      aria-label={title}
      hidden={win.min}
    >
      <header className="desk-win__bar" onPointerDown={start('move')} onPointerMove={move} onPointerUp={end} onPointerCancel={end} onDoubleClick={(e) => !(e.target as HTMLElement).closest('button') && toggleMax(win.id)}>
        <button type="button" className="desk-win__btn" onClick={() => navigate(-1)} disabled={location.key === 'default'} aria-label="Назад" title="Назад">
          <ArrowLeft size={16} />
        </button>
        <Icon size={16} className="desk-win__icon" />
        <span className="desk-win__title ellipsis">{title}</span>
        <span className="desk-win__controls">
          <button type="button" className="desk-win__btn" onClick={() => minimize(win.id)} aria-label="Свернуть" title="Свернуть">
            <Minus size={16} />
          </button>
          <button type="button" className="desk-win__btn" onClick={() => toggleMax(win.id)} aria-label={win.max ? 'Восстановить' : 'Развернуть'} title={win.max ? 'Восстановить' : 'На весь экран'}>
            {win.max ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
          </button>
          <button type="button" className="desk-win__btn desk-win__btn--close" onClick={() => close(win.id)} aria-label="Закрыть" title="Закрыть">
            <X size={17} />
          </button>
        </span>
      </header>
      <AppRoutes layout={<WindowLayout />} />
      {!win.max &&
        (['e', 's', 'se', 'w', 'sw'] as const).map((k) => (
          <span key={k} className={`desk-win__grip desk-win__grip--${k}`} onPointerDown={start(k)} onPointerMove={move} onPointerUp={end} onPointerCancel={end} aria-hidden />
        ))}
    </section>
  );
}

function DeskWindow(props: { win: Win; view: View; field: { w: number; h: number } }) {
  // Свой роутер у каждого окна: адрес задаётся один раз, дальше окно живёт своей историей
  return (
    <MemoryRouter initialEntries={[props.win.path]}>
      <WindowFrame {...props} />
    </MemoryRouter>
  );
}

function DockApp({ section }: { section: NavSection }) {
  const wins = useDesktop((s) => s.wins);
  const top = useDesktop((s) => s.top);
  const badge = useBadge(section.badge);
  const mine = wins.filter((w) => sectionFor(w.path).id === section.id);
  const active = mine.find((w) => w.z === top && !w.min);
  const Icon = section.icon;
  const onClick = (e: React.MouseEvent) => {
    const { open, minimize, focus } = useDesktop.getState();
    if (e.shiftKey || !mine.length) return void open(section.path, { newWindow: e.shiftKey });
    // Как панель задач: активное окно сворачивается, свёрнутое — разворачивается
    if (active) minimize(active.id);
    else focus([...mine].sort((a, b) => b.z - a.z)[0]!.id);
  };
  return (
    <button
      type="button"
      className={cn('dock-app', mine.length > 0 && 'dock-app--running', active && 'dock-app--active')}
      onClick={onClick}
      title={`${section.label}${mine.length ? '' : ' — открыть'} (Shift — новое окно)`}
      aria-label={section.label}
    >
      <Icon size={22} />
      {badge > 0 && <span className="badge dock-app__badge">{badge > 99 ? '99+' : badge}</span>}
      <span className="dock-app__label">{section.short}</span>
    </button>
  );
}

function Dock({ zoomBy, resetZoom, field }: { zoomBy: (f: number) => void; resetZoom: () => void; field: { w: number; h: number } }) {
  const zoom = useDesktop((s) => s.view.zoom);
  const setPrefs = usePrefs((s) => s.set);
  const apps = DOCK_APPS.map((id) => sections.find((s) => s.id === id)).filter((s): s is NavSection => !!s);
  return (
    <nav className="dock" aria-label="Разделы" style={{ width: DOCK_W }}>
      <span className="dock__logo" title="SpaceUp — Пространство">
        <Logo size={34} />
      </span>
      <div className="dock__apps">
        {apps.map((s) => (
          <DockApp key={s.id} section={s} />
        ))}
      </div>
      <div className="dock__tools">
        <button type="button" className="dock-tool" onClick={() => zoomBy(1.2)} aria-label="Приблизить" title="Приблизить (Ctrl +)">
          <ZoomIn size={18} />
        </button>
        <button type="button" className="dock-tool dock-tool--zoom" onClick={resetZoom} title="Масштаб 100% (Ctrl 0)">
          {Math.round(zoom * 100)}%
        </button>
        <button type="button" className="dock-tool" onClick={() => zoomBy(1 / 1.2)} aria-label="Отдалить" title="Отдалить (Ctrl −)">
          <ZoomOut size={18} />
        </button>
        <button type="button" className="dock-tool" onClick={() => useDesktop.getState().arrange(field)} aria-label="Упорядочить окна" title="Упорядочить окна и показать все">
          <LayoutGrid size={18} />
        </button>
        <button type="button" className="dock-tool" onClick={() => setPrefs({ spaceMode: false })} aria-label="Обычный режим" title="Выйти из «Пространства»">
          <MonitorX size={18} />
        </button>
      </div>
    </nav>
  );
}

export function Desktop() {
  const wins = useDesktop((s) => s.wins);
  const view = useDesktop((s) => s.view);
  const fieldRef = useRef<HTMLDivElement>(null);
  const [field, setField] = useState({ w: 1200, h: 800 });
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ dist: number; zoom: number; mx: number; my: number; vx: number; vy: number } | null>(null);
  const pan = useRef<{ sx: number; sy: number; vx: number; vy: number } | null>(null);

  useLayoutEffect(() => {
    const el = fieldRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => e && setField({ w: Math.round(e.contentRect.width), h: Math.round(e.contentRect.height) }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Первый запуск: главная и чаты рядом
  useEffect(() => {
    const st = useDesktop.getState();
    if (st.wins.length) return;
    st.open('/home', { newWindow: true });
    st.open('/chats', { newWindow: true });
    st.arrange({ w: window.innerWidth - DOCK_W, h: window.innerHeight });
  }, []);

  // Уведомления и звонки открывают нужный раздел в окне
  useEffect(() => {
    setRealtimeNavigate((to) => void useDesktop.getState().open(to));
    document.title = 'SpaceUp · Пространство';
  }, []);

  /** Масштаб вокруг точки (координаты внутри поля): точка под курсором остаётся на месте. */
  const zoomAt = useCallback((px: number, py: number, factor: number) => {
    const v = useDesktop.getState().view;
    const zoom = clampZoom(v.zoom * factor);
    const k = zoom / v.zoom;
    useDesktop.getState().setView({ zoom, x: px - (px - v.x) * k, y: py - (py - v.y) * k });
  }, []);
  const zoomBy = useCallback((f: number) => zoomAt(field.w / 2, field.h / 2, f), [field, zoomAt]);
  const resetZoom = useCallback(() => zoomAt(field.w / 2, field.h / 2, 1 / useDesktop.getState().view.zoom), [field, zoomAt]);

  // Колесо: на пустом поле мышь приближает, тачпад двигает; щипок тачпада (ctrl+колесо) — масштаб везде
  useEffect(() => {
    const el = fieldRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      const r = el.getBoundingClientRect();
      const px = e.clientX - r.left;
      const py = e.clientY - r.top;
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        zoomAt(px, py, Math.exp(-e.deltaY * (e.deltaMode ? 0.05 : 0.01)));
        return;
      }
      if ((e.target as Element).closest('.desk-win')) return; // внутри окна — обычная прокрутка
      e.preventDefault();
      const mouseWheel = e.deltaMode !== 0 || (e.deltaX === 0 && Math.abs(e.deltaY) >= 40 && Number.isInteger(e.deltaY));
      if (mouseWheel) zoomAt(px, py, Math.exp(-e.deltaY * (e.deltaMode ? 0.05 : 0.0015)));
      else {
        const v = useDesktop.getState().view;
        useDesktop.getState().setView({ x: v.x - e.deltaX, y: v.y - e.deltaY });
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomAt]);

  // Клавиши: Ctrl +/−/0 — масштаб поля, Ctrl K — поиск в окне
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.key === '=' || e.key === '+') zoomBy(1.2);
      else if (e.key === '-') zoomBy(1 / 1.2);
      else if (e.key === '0') resetZoom();
      else if (e.key.toLowerCase() === 'k' || e.key.toLowerCase() === 'л') void useDesktop.getState().open('/search');
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [zoomBy, resetZoom]);

  // Перетаскивание пустого поля — сдвиг; два пальца — щипок
  const isBackground = (t: EventTarget) => t === fieldRef.current || (t as HTMLElement).classList?.contains('desk__world');
  const onPointerDown = (e: RPointerEvent<HTMLDivElement>) => {
    if (!isBackground(e.target) && e.button !== 1) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const v = useDesktop.getState().view;
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()] as [{ x: number; y: number }, { x: number; y: number }];
      const r = e.currentTarget.getBoundingClientRect();
      gesture.current = { dist: Math.hypot(a.x - b.x, a.y - b.y), zoom: v.zoom, mx: (a.x + b.x) / 2 - r.left, my: (a.y + b.y) / 2 - r.top, vx: v.x, vy: v.y };
      pan.current = null;
    } else {
      pan.current = { sx: e.clientX, sy: e.clientY, vx: v.x, vy: v.y };
    }
  };
  const onPointerMove = (e: RPointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gesture.current;
    if (g && pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()] as [{ x: number; y: number }, { x: number; y: number }];
      const r = e.currentTarget.getBoundingClientRect();
      const zoom = clampZoom((g.zoom * Math.hypot(a.x - b.x, a.y - b.y)) / g.dist);
      const mx = (a.x + b.x) / 2 - r.left;
      const my = (a.y + b.y) / 2 - r.top;
      const k = zoom / g.zoom;
      useDesktop.getState().setView({ zoom, x: mx - (g.mx - g.vx) * k, y: my - (g.my - g.vy) * k });
      return;
    }
    const p = pan.current;
    if (p) useDesktop.getState().setView({ x: p.vx + e.clientX - p.sx, y: p.vy + e.clientY - p.sy });
  };
  const onPointerUp = (e: RPointerEvent<HTMLDivElement>) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) gesture.current = null;
    if (!pointers.current.size) pan.current = null;
  };

  const grid = 26 * view.zoom;
  return (
    <div className="desk">
      <Dock zoomBy={zoomBy} resetZoom={resetZoom} field={field} />
      <div
        ref={fieldRef}
        className="desk__field"
        style={{ backgroundSize: `${grid}px ${grid}px`, backgroundPosition: `${view.x}px ${view.y}px` }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <div className="desk__world" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})` }}>
          {wins.map((w) => (
            <DeskWindow key={w.id} win={w} view={view} field={field} />
          ))}
        </div>
        {wins.every((w) => w.min) && (
          <div className="desk__hint">
            <Plus size={18} /> Откройте раздел на панели слева. Колесо мыши или два пальца — приблизить и отдалить, перетаскивание пустого места — двигать поле.
          </div>
        )}
      </div>
      <CallScreen />
      <LockScreen />
    </div>
  );
}
