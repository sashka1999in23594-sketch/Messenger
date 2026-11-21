/**
 * Sunnet на компьютере — рабочий стол с окнами разделов. Вверху строка меню
 * с поиском, уведомлениями, часами и аккаунтом, внизу док, на обоях — окна.
 * В каждом окне — полноценный раздел со своей историей переходов, окна можно
 * двигать, тянуть за края, прилеплять к половинам экрана и сворачивать в док.
 */
import { brandName, useBrand } from '../../shared/lib/brand';
import { usePrefs } from '../../shared/stores/prefs';
import { MoonScene } from '../../shared/ui';
import { AppUpdate } from '../../app/layout/AppUpdate';
import { useEffect, useMemo, useRef, useState, type ComponentProps, type CSSProperties } from 'react';
import { createPath, Router } from 'react-router';
import { useShallow } from 'zustand/react/shallow';
import { ArrowDownAZ, Boxes, ClipboardPaste, Compass, Eye, EyeOff, FolderPlus, LayoutGrid, RefreshCw, Server, Settings, ShieldCheck, Terminal, Trash2, XSquare, ZoomIn, ZoomOut } from 'lucide-react';
import { DeskIcons } from '../hub/DeskIcons';
import { SystemDialogs } from '../hub/PermissionPrompt';
import { useCloud, type SortBy, type IconSize } from '../hub/cloud';
import { trackSection } from '../hub/discover';
import '../hub/hub.css';
import { CommandPalette } from '../../app/layout/CommandPalette';
import { LockScreen } from '../../app/layout/LockScreen';
import { setRealtimeNavigate } from '../../app/realtime';
import { CallScreen } from '../calls/CallScreen';
import { RoomScreen } from '../calls/RoomScreen';
import { NotificationsPanel } from '../notifications/NotificationsPanel';
import { appFor, isAppPath, isMac, titleFor } from './apps';
import { DeskMenu, useDeskMenu } from './DeskMenu';
import { Dock } from './Dock';
import { activate, closeWindow, closeWindows, minimizeWindow, openPath, withGlide } from './fx';
import { DOCK_ZONE, firstRunLayout, MENUBAR_H, useArea, type Snap } from './geometry';
import { MenuBar } from './MenuBar';
import { activeWin, useDesktop, WALLPAPERS, ZOOM_MAX, ZOOM_MIN, type Win } from './store';
import { Wallpaper } from './Wallpaper';
import { DeskWindow, SnapPreview } from './Window';
import './desktop.css';

type Navigator = ComponentProps<typeof Router>['navigator'];
type To = Parameters<Navigator['push']>[0];

/** Поиск Ctrl/⌘+K — общая палитра Sunnet, а выбранное открывается в окне. */
function Launcher() {
  const navigator = useMemo<Navigator>(() => {
    const href = (to: To) => (typeof to === 'string' ? to : createPath(to));
    return { createHref: href, go: () => undefined, push: (to) => void openPath(href(to)), replace: (to) => void openPath(href(to)) };
  }, []);
  return (
    <Router location="/" navigator={navigator}>
      <CommandPalette />
    </Router>
  );
}

/** Пустой стол: короткая подсказка над доком, где всё найти. */
function EmptyDesk() {
  const stash = useDesktop((s) => !!s.stash?.length);
  return (
    <div className="desk__empty">
      {stash ? (
        <button type="button" className="desk__pill desk__pill--button" onClick={() => useDesktop.getState().showDesktop()}>
          <Eye size={15} /> Показать окна
        </button>
      ) : (
        <span className="desk__pill">
          Откройте раздел в доке или найдите нужное: <span className="desk__kbd">{isMac ? '⌘K' : 'Ctrl K'}</span>
        </span>
      )}
    </div>
  );
}

/** Сочетания клавиш как у окон Windows: ←/→ — половины, ↑ — развернуть, ↓ — вернуть или свернуть. */
function snapByKey(w: Win, key: string): Snap | null | 'min' | undefined {
  const s: Snap | null = w.max ? 'max' : (w.snap ?? null);
  const table: Record<string, Partial<Record<Snap | 'none', Snap | null | 'min'>>> = {
    ArrowLeft: { none: 'left', max: 'left', right: null, tr: 'tl', br: 'bl' },
    ArrowRight: { none: 'right', max: 'right', left: null, tl: 'tr', bl: 'br' },
    ArrowUp: { none: 'max', left: 'tl', right: 'tr', bl: 'left', br: 'right', tl: 'max', tr: 'max' },
    ArrowDown: { none: 'min', max: null, left: 'bl', right: 'br', tl: 'left', tr: 'right', bl: 'min', br: 'min' },
  };
  return table[key]?.[s ?? 'none'];
}

function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      // Открыт диалог или поиск — клавиши принадлежат им
      if (document.querySelector('.overlay, [aria-modal="true"]')) return;
      const st = useDesktop.getState();
      const a = activeWin(st.wins);
      const mod = e.ctrlKey || e.metaKey;
      if (mod && !e.altKey && !e.shiftKey && e.code === 'KeyW') {
        if (!a) return;
        e.preventDefault();
        void closeWindow(a.id);
      } else if (mod && !e.altKey && !e.shiftKey && e.code === 'KeyM') {
        if (!a) return;
        e.preventDefault();
        void minimizeWindow(a.id);
      } else if (e.ctrlKey && !e.altKey && e.code === 'Backquote') {
        e.preventDefault();
        st.cycle(e.shiftKey ? -1 : 1);
        const next = activeWin(useDesktop.getState().wins);
        if (next) activate(next.id);
      } else if (mod && !e.altKey && (e.code === 'Equal' || e.code === 'Minus' || e.code === 'Digit0' || e.code === 'NumpadAdd' || e.code === 'NumpadSubtract')) {
        // Масштаб стола: Ctrl + / Ctrl − / Ctrl 0
        e.preventDefault();
        const z = st.view.zoom;
        if (e.code === 'Digit0') st.zoomTo(1);
        else st.zoomTo(e.code === 'Equal' || e.code === 'NumpadAdd' ? z + 0.1 : z - 0.1);
      } else if (e.ctrlKey && e.altKey && a && e.code.startsWith('Arrow')) {
        const to = snapByKey(a, e.code);
        if (to === undefined) return;
        e.preventDefault();
        if (to === 'min') void minimizeWindow(a.id);
        else withGlide(() => st.snapTo(a.id, to));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

/** Адрес и заголовок вкладки браузера — как у активного окна (ссылку можно скопировать). */
function syncLocation(w: Win | undefined) {
  const path = w?.path ?? '/';
  if (window.location.pathname + window.location.search !== path) window.history.replaceState(window.history.state, '', path);
  document.title = w ? `${titleFor(w.path).text} · ${brandName()}` : brandName();
}

/** Ctrl + колесо или щипок на тачпаде — масштаб вокруг курсора; перетаскивание обоев — сдвиг отдалённого стола. */
function useZoomGestures(ref: React.RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const st = useDesktop.getState();
      const step = Math.max(-0.25, Math.min(0.25, -e.deltaY * (e.deltaMode === 1 ? 0.04 : 0.0012)));
      st.zoomTo(st.view.zoom * (1 + step), { x: e.clientX, y: e.clientY });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [ref]);
}

/** Масштаб над доком: виден, только когда стол отдалён или приближен. */
function ZoomPill() {
  const zoom = useDesktop((s) => s.view.zoom);
  if (zoom === 1) return null;
  const st = useDesktop.getState;
  return (
    <div className="desk__zoom" role="group" aria-label="Масштаб стола">
      <button type="button" onClick={() => st().zoomTo(zoom - 0.1)} disabled={zoom <= ZOOM_MIN} aria-label="Отдалить">
        <ZoomOut size={15} />
      </button>
      <button type="button" className="desk__zoom-value" onClick={() => st().zoomTo(1)} title="Вернуть 100 %">
        {Math.round(zoom * 100)} %
      </button>
      <button type="button" onClick={() => st().zoomTo(zoom + 0.1)} disabled={zoom >= ZOOM_MAX} aria-label="Приблизить">
        <ZoomIn size={15} />
      </button>
    </div>
  );
}

export function Desktop() {
  const ids = useDesktop(useShallow((s) => s.wins.map((w) => w.id)));
  const view = useDesktop((s) => s.view);
  const deskRef = useRef<HTMLDivElement>(null);
  const panning = useRef<{ x: number; y: number } | null>(null);
  useZoomGestures(deskRef);
  const empty = useDesktop((s) => s.wins.every((w) => w.min));
  const wallpaper = useDesktop((s) => s.wallpaper);
  // В часы Lynnet на обоях — луна с ракетами
  const moon = useBrand((s) => s.night);
  const reduceMotion = usePrefs((s) => s.reduceMotion);
  const ctx = useDeskMenu();
  useShortcuts();

  useEffect(() => {
    const st = useDesktop.getState();
    // Ссылка, по которой пришли (письмо, уведомление системы), — до раскладки
    const initial = window.location.pathname + window.location.search;
    // Первый запуск: Чаты слева, Главная рядом (на широком экране ещё Уведомления)
    if (!st.wins.length) {
      for (const { path, rect } of firstRunLayout(useArea.getState().area)) st.open(path, { newWindow: true, rect });
    }
    if (!['/', '/login', '/register', '/signup', '/home'].includes(window.location.pathname) && isAppPath(initial)) {
      const a = activeWin(useDesktop.getState().wins);
      if (a?.path !== initial) openPath(initial);
    }
    syncLocation(activeWin(useDesktop.getState().wins));
    const unsub = useDesktop.subscribe((s, prev) => {
      const a = activeWin(s.wins);
      const p = activeWin(prev.wins);
      if (a?.id !== p?.id || a?.path !== p?.path) syncLocation(a);
      if (a && a.id !== p?.id) trackSection(appFor(a.path).id);
    });
    // Только в разработке: доступ к столу для автоматических скриншотов (scripts/shots)
    if (import.meta.env.DEV) (window as unknown as { __desk: typeof useDesktop }).__desk = useDesktop;
    // Уведомления и звонки открывают нужный раздел в его окне
    setRealtimeNavigate((to) => void openPath(to));
    return unsub;
  }, []);

  const onContextMenu = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('.desk-win, .dock, .menubar')) return;
    e.preventDefault();
    ctx.open({ x: e.clientX, y: e.clientY });
  };
  const count = ids.length;
  const st = useDesktop.getState;
  const cloud = useCloud.getState;
  const sort = useCloud((s) => s.sort);
  const iconSize = useCloud((s) => s.iconSize);
  const [refreshKey, setRefreshKey] = useState(0);
  const SORTS: [SortBy, string][] = [['name', 'По имени'], ['kind', 'По типу'], ['date', 'По дате изменения'], ['manual', 'Вручную']];
  const SIZES: [IconSize, string][] = [['sm', 'Мелкие значки'], ['md', 'Обычные значки'], ['lg', 'Крупные значки']];

  return (
    <>
      <div
        ref={deskRef}
        className={view.zoom !== 1 ? `desk desk--wp-${wallpaper} desk--zoomed` : `desk desk--wp-${wallpaper}`}
        style={{ '--desk-menubar-h': `${MENUBAR_H}px`, '--desk-dock-zone': `${DOCK_ZONE}px` } as CSSProperties}
        onContextMenu={onContextMenu}
        onPointerDown={(e) => {
          // Щелчок по обоям снимает фокус с окон
          const t = e.target as HTMLElement;
          if (t === e.currentTarget || t.closest('.wall, .desk__empty')) {
            (document.activeElement as HTMLElement | null)?.blur?.();
            // Отдалённый стол двигается за обои
            if (e.button === 0 && useDesktop.getState().view.zoom !== 1 && !t.closest('button')) {
              panning.current = { x: e.clientX, y: e.clientY };
              e.currentTarget.setPointerCapture(e.pointerId);
            }
          }
        }}
        onPointerMove={(e) => {
          const p = panning.current;
          if (!p) return;
          useDesktop.getState().pan(e.clientX - p.x, e.clientY - p.y);
          panning.current = { x: e.clientX, y: e.clientY };
        }}
        onPointerUp={() => (panning.current = null)}
        onPointerCancel={() => (panning.current = null)}
      >
        {moon ? <MoonScene className="wall wall--moon" still={reduceMotion} landX={0.74} earth={{ x: 0.18, y: 0.2, r: 0.09 }} /> : <Wallpaper kind={wallpaper} />}
        <DeskIcons key={refreshKey} />
        {empty && <EmptyDesk />}
        <div
          className="desk__windows"
          style={view.zoom !== 1 || view.x || view.y ? { transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})` } : undefined}
        >
          <SnapPreview />
          {ids.map((id) => (
            <DeskWindow key={id} id={id} />
          ))}
        </div>
        <MenuBar />
        <ZoomPill />
        <Dock />
        <Launcher />
        <DeskMenu
          anchor={ctx.anchor}
          onClose={ctx.close}
          label="Рабочий стол"
          items={[
            { label: 'Создать папку', icon: <FolderPlus size={18} />, onClick: () => cloud().setRenaming(cloud().create('folder').id) },
            { label: 'Создать проект', icon: <Boxes size={18} />, onClick: () => cloud().create('project') },
            { label: 'Создать сервер', icon: <Server size={18} />, onClick: () => openPath('/servers/new') },
            { label: 'Вставить', icon: <ClipboardPaste size={18} />, hint: 'Ctrl+V', disabled: !cloud().clipboard, onClick: () => cloud().paste(null) },
            { label: 'Обновить', icon: <RefreshCw size={18} />, onClick: () => setRefreshKey((k) => k + 1) },
            'separator',
            { title: 'Сортировка' },
            ...SORTS.map(([id, label]) => ({ label, checked: sort === id, onClick: () => cloud().setSort(id) })),
            { title: 'Вид' },
            ...SIZES.map(([id, label]) => ({ label, checked: iconSize === id, onClick: () => cloud().setIconSize(id) })),
            'separator',
            { label: 'Орбита — добавить приложение', icon: <Compass size={18} />, onClick: () => openPath('/orbit') },
            { label: 'Безопасность и разрешения', icon: <ShieldCheck size={18} />, onClick: () => openPath('/security') },
            { label: 'Корзина', icon: <Trash2 size={18} />, onClick: () => openPath('/security?tab=trash') },
            { label: 'Консоль администратора', icon: <Terminal size={18} />, onClick: () => openPath('/admin/console') },
            'separator',
            { title: 'Окна' },
            { label: 'Упорядочить окна', icon: <LayoutGrid size={18} />, disabled: !count, onClick: () => withGlide(() => st().arrange()) },
            empty && st().stash?.length
              ? { label: 'Показать окна', icon: <Eye size={18} />, onClick: () => st().showDesktop() }
              : { label: 'Свернуть все', icon: <EyeOff size={18} />, disabled: empty, onClick: () => st().showDesktop() },
            { label: 'Закрыть все окна', icon: <XSquare size={18} />, disabled: !count, onClick: () => closeWindows(st().wins.map((w) => w.id)) },
            'separator',
            { title: `Масштаб · ${Math.round(view.zoom * 100)} %` },
            { label: 'Приблизить', icon: <ZoomIn size={18} />, disabled: view.zoom >= ZOOM_MAX, onClick: () => st().zoomTo(view.zoom + 0.1) },
            { label: 'Отдалить', icon: <ZoomOut size={18} />, disabled: view.zoom <= ZOOM_MIN, onClick: () => st().zoomTo(view.zoom - 0.1) },
            { label: 'Обычный масштаб', disabled: view.zoom === 1, onClick: () => st().zoomTo(1) },
            'separator',
            { title: 'Обои' },
            ...WALLPAPERS.map((w) => ({ label: w.label, checked: w.id === wallpaper, onClick: () => st().setWallpaper(w.id) })),
            'separator',
            { label: 'Настройки рабочего стола', icon: <Settings size={18} />, onClick: () => openPath('/settings/space') },
          ]}
        />
      </div>
      <CallScreen />
      <RoomScreen />
      <NotificationsPanel onOpen={(to) => void openPath(to)} />
      <AppUpdate />
      <SystemDialogs />
      <LockScreen />
    </>
  );
}
