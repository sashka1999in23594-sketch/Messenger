/**
 * Строка меню вверху экрана — как в macOS: меню Sunnet, меню активного
 * раздела и «Окно», поиск по центру, справа уведомления, тема, часы и аккаунт.
 * Когда одно меню открыто, наведение на соседний заголовок переключает меню.
 */
import { useEffect, useRef, useState } from 'react';
import {
  Bell,
  Copy,
  Info,
  LayoutGrid,
  Lock,
  LogOut,
  Maximize2,
  Minus,
  Moon,
  PanelLeft,
  PanelRight,
  Repeat,
  Search,
  Settings,
  SquarePlus,
  Sun,
  Wallpaper,
  WifiOff,
  X,
  XSquare,
  Eye,
  EyeOff,
} from 'lucide-react';
import { useBadge } from '../../app/layout/Rail';
import { confirmLogout } from '../../app/session';
import { useLock } from '../../shared/lib/passcode';
import { usePrefs } from '../../shared/stores/prefs';
import { useRealtime } from '../../shared/stores/realtime';
import { useUi } from '../../shared/stores/ui';
import { useBrandName } from '../../shared/lib/brand';
import { cn } from '../../shared/lib/format';
import { Logo } from '../../shared/ui';
import { AccountMenu, MeAvatar } from './Account';
import { appFor, isMac, MOD, titleFor } from './apps';
import { DeskMenu, useDeskMenu, type DeskMenuEntry, type MenuAnchor } from './DeskMenu';
import { activate, closeWindow, closeWindows, minimizeWindow, openPath, withGlide } from './fx';
import { activeWin, useDesktop } from './store';

type MenuId = 'sunnet' | 'app' | 'window';

const SNAP_KEYS = isMac ? '⌃⌥' : 'Ctrl+Alt+';

/** Тёмная ли тема сейчас (с учётом «как в системе»). */
export function useIsDark() {
  const theme = usePrefs((s) => s.theme);
  const [systemDark, setSystemDark] = useState(() => matchMedia('(prefers-color-scheme: dark)').matches);
  useEffect(() => {
    const mql = matchMedia('(prefers-color-scheme: dark)');
    const on = () => setSystemDark(mql.matches);
    mql.addEventListener('change', on);
    return () => mql.removeEventListener('change', on);
  }, []);
  return theme === 'dark' || (theme === 'system' && systemDark);
}

export function toggleTheme(dark: boolean) {
  usePrefs.getState().set({ theme: dark ? 'light' : 'dark' });
}

function Clock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    let t: number;
    const tick = () => {
      setNow(new Date());
      t = window.setTimeout(tick, 60_000 - (Date.now() % 60_000) + 50);
    };
    t = window.setTimeout(tick, 60_000 - (Date.now() % 60_000) + 50);
    return () => window.clearTimeout(t);
  }, []);
  const day = new Intl.DateTimeFormat('ru-RU', { weekday: 'short', day: 'numeric', month: 'short' }).format(now).replace(',', '');
  const time = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' }).format(now);
  const full = new Intl.DateTimeFormat('ru-RU', { dateStyle: 'full' }).format(now);
  return (
    <span className="menubar__clock" title={full}>
      <span className="menubar__date">{day.charAt(0).toUpperCase() + day.slice(1)}</span>
      <span className="menubar__time">{time}</span>
    </span>
  );
}

export function MenuBar() {
  const brand = useBrandName();
  const [open, setOpen] = useState<{ id: MenuId; anchor: MenuAnchor } | null>(null);
  const refs = useRef<Record<MenuId, HTMLButtonElement | null>>({ sunnet: null, app: null, window: null });
  const active = useDesktop((s) => activeWin(s.wins));
  const count = useDesktop((s) => s.wins.length);
  const stash = useDesktop((s) => !!s.stash?.length && s.wins.every((w) => w.min));
  const passcode = usePrefs((s) => !!s.passcode);
  const notif = useBadge('notifications');
  const offline = useRealtime((s) => s.status === 'offline');
  const dark = useIsDark();
  const account = useDeskMenu();
  const app = active ? appFor(active.path) : null;

  const anchorOf = (id: MenuId): MenuAnchor => {
    const r = refs.current[id]!.getBoundingClientRect();
    return { x: r.left, y: r.bottom + 4, place: 'below', align: 'start' };
  };
  const toggle = (id: MenuId) => setOpen((o) => (o?.id === id ? null : { id, anchor: anchorOf(id) }));
  const close = () => setOpen(null);
  const store = useDesktop.getState;

  const trigger = (id: MenuId) => ({
    ref: (el: HTMLButtonElement | null) => void (refs.current[id] = el),
    className: cn('menubar__menu', open?.id === id && 'menubar__menu--open'),
    'aria-haspopup': 'menu' as const,
    'aria-expanded': open?.id === id,
    onPointerDown: (e: React.PointerEvent) => open && e.nativeEvent.stopPropagation(),
    onClick: () => toggle(id),
    onPointerEnter: () => open && open.id !== id && setOpen({ id, anchor: anchorOf(id) }),
  });

  const desktopItems: DeskMenuEntry[] = [
    { label: 'Упорядочить окна', icon: <LayoutGrid size={18} />, disabled: !count, onClick: () => withGlide(() => store().arrange()) },
    stash
      ? { label: 'Показать окна', icon: <Eye size={18} />, onClick: () => store().showDesktop() }
      : { label: 'Свернуть все', icon: <EyeOff size={18} />, disabled: !count, onClick: () => store().showDesktop() },
    { label: 'Закрыть все окна', icon: <XSquare size={18} />, disabled: !count, onClick: () => closeWindows(store().wins.map((w) => w.id)) },
  ];

  const items: Record<MenuId, DeskMenuEntry[]> = {
    sunnet: [
      { label: `О ${brand}`, icon: <Info size={18} />, onClick: () => openPath('/settings/about') },
      { label: 'Настройки', icon: <Settings size={18} />, onClick: () => openPath('/settings') },
      { label: 'Рабочий стол и обои', icon: <Wallpaper size={18} />, onClick: () => openPath('/settings/space') },
      'separator',
      { label: dark ? 'Светлая тема' : 'Тёмная тема', icon: dark ? <Sun size={18} /> : <Moon size={18} />, onClick: () => toggleTheme(dark) },
      'separator',
      passcode && { label: 'Заблокировать', icon: <Lock size={18} />, onClick: () => useLock.getState().lock() },
      { label: 'Выйти', icon: <LogOut size={18} />, danger: true, onClick: () => void confirmLogout() },
    ],
    app: app
      ? [
          { label: 'Новое окно', icon: <SquarePlus size={18} />, onClick: () => openPath(app.path, { newWindow: true }) },
          { label: 'В начало раздела', icon: <app.icon size={18} />, disabled: active?.path === app.path, onClick: () => active && store().go(active.id, app.path) },
          'separator',
          { label: 'Свернуть', icon: <Minus size={18} />, hint: `${MOD}M`, onClick: () => active && void minimizeWindow(active.id) },
          { label: 'Закрыть окно', icon: <X size={18} />, hint: `${MOD}W`, onClick: () => active && void closeWindow(active.id) },
        ]
      : desktopItems,
    window: [
      { label: 'Свернуть', icon: <Minus size={18} />, hint: `${MOD}M`, disabled: !active, onClick: () => active && void minimizeWindow(active.id) },
      active?.max || active?.snap
        ? { label: 'Восстановить размер', icon: <Copy size={18} />, onClick: () => active && withGlide(() => store().snapTo(active.id, null)) }
        : { label: 'Развернуть', icon: <Maximize2 size={18} />, hint: `${SNAP_KEYS}↑`, disabled: !active, onClick: () => active && withGlide(() => store().toggleMax(active.id)) },
      { label: 'Слева', icon: <PanelLeft size={18} />, hint: `${SNAP_KEYS}←`, disabled: !active, onClick: () => active && withGlide(() => store().snapTo(active.id, 'left')) },
      { label: 'Справа', icon: <PanelRight size={18} />, hint: `${SNAP_KEYS}→`, disabled: !active, onClick: () => active && withGlide(() => store().snapTo(active.id, 'right')) },
      { label: 'Следующее окно', icon: <Repeat size={18} />, hint: isMac ? '⌃`' : 'Ctrl+`', disabled: count < 2, onClick: () => store().cycle(1) },
      'separator',
      ...desktopItems,
      count > 0 && 'separator',
      ...useDesktop
        .getState()
        .wins.slice()
        .sort((a, b) => a.z - b.z)
        .map((w) => ({ label: titleFor(w.path).text, checked: w.id === active?.id, onClick: () => activate(w.id) })),
    ],
  };

  return (
    <header className="menubar" onDoubleClick={(e) => e.target === e.currentTarget && store().showDesktop()}>
      <div className="menubar__left">
        <button type="button" {...trigger('sunnet')} aria-label={`Меню ${brand}`}>
          <Logo size={18} />
        </button>
        <button type="button" {...trigger('app')}>
          <strong>{app ? app.label : 'Рабочий стол'}</strong>
        </button>
        <button type="button" {...trigger('window')}>
          Окно
        </button>
      </div>
      <button type="button" className="menubar__search" onClick={() => useUi.getState().setPalette(true)} aria-label="Поиск и переход">
        <Search size={15} />
        <span className="ellipsis">Поиск по {brand}</span>
        <span className="menubar__kbd">{isMac ? '⌘K' : 'Ctrl K'}</span>
      </button>
      <div className="menubar__right">
        {offline && (
          <span className="menubar__offline" title="Нет соединения — переподключаемся">
            <WifiOff size={15} /> Нет связи
          </span>
        )}
        <button type="button" className="menubar__icon" onClick={() => openPath('/notifications')} aria-label={notif ? `Уведомления: ${notif} новых` : 'Уведомления'} title="Уведомления">
          <Bell size={16} />
          {notif > 0 && <span className="badge menubar__badge">{notif > 99 ? '99+' : notif}</span>}
        </button>
        <button type="button" className="menubar__icon" onClick={() => toggleTheme(dark)} aria-label="Сменить тему" title={dark ? 'Светлая тема' : 'Тёмная тема'}>
          {dark ? <Sun size={16} /> : <Moon size={16} />}
        </button>
        <Clock />
        <button type="button" className={cn('menubar__me', account.anchor && 'menubar__me--open')} aria-label="Мой аккаунт" title="Мой аккаунт" {...account.trigger((r) => ({ x: r.right, y: r.bottom + 6, place: 'below', align: 'end' }))}>
          <MeAvatar size={22} />
        </button>
      </div>
      {open && <DeskMenu anchor={open.anchor} onClose={close} items={items[open.id]} label={open.id === 'window' ? 'Окно' : open.id === 'app' ? app?.label : brand} />}
      <AccountMenu anchor={account.anchor} onClose={account.close} />
    </header>
  );
}
