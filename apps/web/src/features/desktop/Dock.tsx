/**
 * Док внизу экрана — как в macOS: значки разделов увеличиваются под курсором,
 * точка под значком — раздел открыт, справа — свёрнутые окна и аватар.
 * Увеличение считается напрямую в стилях элементов, без перерисовки React.
 */
import { useCallback, useEffect, useRef } from 'react';
import { AppWindow, EyeOff, SquarePlus, X } from 'lucide-react';
import { useBadge } from '../../app/layout/Rail';
import { cn } from '../../shared/lib/format';
import { AccountMenu, MeAvatar } from './Account';
import { AppTile } from './AppTile';
import { appFor, dockApps, titleFor, type DeskApp } from './apps';
import { DeskMenu, useDeskMenu, type DeskMenuEntry } from './DeskMenu';
import { activate, bounce, closeWindows, dockEls, minimizeWindow, motionOn, openPath } from './fx';
import { activeWin, useDesktop } from './store';

const MAX_SCALE = 1.62;

/** Регистрирует элемент значка для анимаций сворачивания и возврата. */
function useDockEl(key: string) {
  return useCallback(
    (el: HTMLElement | null) => {
      if (el) dockEls.set(key, el);
      else dockEls.delete(key);
    },
    [key],
  );
}

/** Подпись над значком; не увеличивается вместе с ним. */
function Tip({ children }: { children: React.ReactNode }) {
  return (
    <span className="dock-item__tip" role="tooltip">
      {children}
    </span>
  );
}

function DockApp({ app }: { app: DeskApp }) {
  // Окна раздела одной строкой — компонент перерисуется, только если они изменились
  const mine = useDesktop((s) =>
    s.wins
      .filter((w) => appFor(w.path).id === app.id)
      .sort((a, b) => b.z - a.z)
      .map((w) => `${w.id}:${w.min ? 1 : 0}`)
      .join(','),
  );
  const isActive = useDesktop((s) => {
    const w = activeWin(s.wins);
    return !!w && appFor(w.path).id === app.id;
  });
  const badge = useBadge(app.badge);
  const tileRef = useDockEl(app.id);
  const tile = useRef<HTMLSpanElement | null>(null);
  const menu = useDeskMenu();
  const wins = mine ? mine.split(',').map((x) => ({ id: x.split(':')[0]!, min: x.endsWith(':1') })) : [];
  const running = wins.length > 0;

  const launch = (newWindow: boolean) => {
    bounce(tile.current);
    openPath(app.path, { newWindow, from: tile.current });
  };
  const onClick = (e: React.MouseEvent) => {
    if (e.shiftKey || e.metaKey || e.ctrlKey || !running) return launch(e.shiftKey || e.metaKey || e.ctrlKey);
    // Как панель задач: активное окно сворачивается, иначе — показывается последнее
    if (isActive) {
      const top = activeWin(useDesktop.getState().wins);
      if (top) void minimizeWindow(top.id);
    } else activate(wins[0]!.id);
  };
  const all = useDesktop.getState().wins;
  const items: DeskMenuEntry[] = [
    { title: app.label },
    ...wins.map((w) => {
      const win = all.find((x) => x.id === w.id);
      return { label: win ? titleFor(win.path).text : app.label, icon: <AppWindow size={18} />, checked: undefined, onClick: () => activate(w.id) };
    }),
    running && 'separator',
    { label: 'Открыть новое окно', icon: <SquarePlus size={18} />, onClick: () => launch(true) },
    wins.some((w) => !w.min) && { label: 'Свернуть все окна', icon: <EyeOff size={18} />, onClick: () => wins.forEach((w) => !w.min && void minimizeWindow(w.id)) },
    running && { label: wins.length > 1 ? 'Закрыть все окна' : 'Закрыть окно', icon: <X size={18} />, danger: true, onClick: () => closeWindows(wins.map((w) => w.id)) },
  ];

  return (
    <div className={cn('dock-item', running && 'dock-item--running', isActive && 'dock-item--active')} data-mag>
      <button
        type="button"
        className="dock-item__btn"
        onClick={onClick}
        onAuxClick={(e) => e.button === 1 && launch(true)}
        onMouseDown={(e) => e.button === 1 && e.preventDefault()}
        onContextMenu={(e) => {
          e.preventDefault();
          const r = e.currentTarget.getBoundingClientRect();
          menu.open({ x: r.left + r.width / 2, y: r.top - 10, place: 'above', align: 'center' });
        }}
        aria-label={badge > 0 ? `${app.label}: ${badge} новых` : app.label}
        aria-pressed={isActive}
      >
        <span
          ref={(el) => {
            tile.current = el;
            tileRef(el);
          }}
          className="dock-item__tile"
        >
          <AppTile app={app} size={48} />
          {badge > 0 && <span className="badge dock-item__badge">{badge > 99 ? '99+' : badge}</span>}
        </span>
      </button>
      <span className="dock-item__dot" aria-hidden />
      {!menu.anchor && <Tip>{app.label}</Tip>}
      <DeskMenu anchor={menu.anchor} onClose={menu.close} items={items} label={app.label} />
    </div>
  );
}

/** Свёрнутое окно в доке — уменьшенное окошко со значком раздела. */
function DockMin({ id }: { id: string }) {
  const path = useDesktop((s) => s.wins.find((w) => w.id === id)?.path ?? '/');
  const { app, text } = titleFor(path);
  const ref = useDockEl(`win:${id}`);
  const menu = useDeskMenu();
  return (
    <div className="dock-item dock-item--min" data-mag>
      <button
        type="button"
        className="dock-item__btn"
        onClick={() => activate(id)}
        onContextMenu={(e) => {
          e.preventDefault();
          const r = e.currentTarget.getBoundingClientRect();
          menu.open({ x: r.left + r.width / 2, y: r.top - 10, place: 'above', align: 'center' });
        }}
        aria-label={`Вернуть окно «${text}»`}
      >
        <span ref={ref} className="dock-item__tile dock-min">
          <span className="dock-min__bar" />
          <AppTile app={app} size={22} />
        </span>
      </button>
      {!menu.anchor && <Tip>{text}</Tip>}
      <DeskMenu
        anchor={menu.anchor}
        onClose={menu.close}
        label={text}
        items={[
          { title: text },
          { label: 'Вернуть окно', icon: <AppWindow size={18} />, onClick: () => activate(id) },
          { label: 'Закрыть', icon: <X size={18} />, danger: true, onClick: () => closeWindows([id]) },
        ]}
      />
    </div>
  );
}

function DockAccount() {
  const menu = useDeskMenu();
  return (
    <div className="dock-item dock-item--me" data-mag>
      <button
        type="button"
        className={cn('dock-item__btn', menu.anchor && 'dock-item__btn--open')}
        aria-label="Мой аккаунт"
        {...menu.trigger((r) => ({ x: r.left + r.width / 2, y: r.top - 10, place: 'above', align: 'center' }))}
      >
        <span className="dock-item__tile dock-me">
          <MeAvatar size={44} />
        </span>
      </button>
      {!menu.anchor && <Tip>Мой аккаунт</Tip>}
      <AccountMenu anchor={menu.anchor} onClose={menu.close} />
    </div>
  );
}

export function Dock() {
  const navRef = useRef<HTMLElement>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  const frame = useRef(0);
  const minimized = useDesktop((s) =>
    s.wins
      .filter((w) => w.min)
      .map((w) => w.id)
      .join(','),
  );
  const endRef = useDockEl('min-end');

  /** Увеличение под курсором: значок под ним остаётся на месте, соседи расступаются. */
  const magnify = useCallback((clientX: number | null) => {
    const nav = navRef.current;
    const row = rowRef.current;
    if (!nav || !row) return;
    const items = [...row.children] as HTMLElement[];
    const reset = clientX === null || !motionOn();
    if (reset) {
      items.forEach((el) => {
        el.style.setProperty('--s', '1');
        el.style.setProperty('--tx', '0px');
      });
      nav.style.setProperty('--grow-l', '0px');
      nav.style.setProperty('--grow-r', '0px');
      return;
    }
    const px = clientX - row.getBoundingClientRect().left;
    const base = items.map((el) => ({ el, c: el.offsetLeft + el.offsetWidth / 2, w: el.offsetWidth, mag: 'mag' in el.dataset }));
    const size = base.find((b) => b.mag)?.w ?? 48;
    const reach = size * 2.7;
    const extra = base.map((b) => {
      if (!b.mag) return 0;
      const d = Math.abs(px - b.c);
      const s = d >= reach ? 1 : 1 + ((MAX_SCALE - 1) * (Math.cos((Math.PI * d) / reach) + 1)) / 2;
      b.el.style.setProperty('--s', s.toFixed(3));
      return (s - 1) * b.w;
    });
    // Значок под курсором
    let k = 0;
    base.forEach((b, i) => Math.abs(px - b.c) < Math.abs(px - base[k]!.c) && (k = i));
    const f = Math.min(1, Math.max(0, (px - (base[k]!.c - base[k]!.w / 2)) / base[k]!.w));
    const shift = new Array<number>(base.length).fill(0);
    shift[k] = extra[k]! * (0.5 - f);
    let acc = extra[k]! * f;
    for (let i = k - 1; i >= 0; i--) {
      shift[i] = -(acc + extra[i]! / 2);
      acc += extra[i]!;
    }
    const growL = acc;
    acc = extra[k]! * (1 - f);
    for (let i = k + 1; i < base.length; i++) {
      shift[i] = acc + extra[i]! / 2;
      acc += extra[i]!;
    }
    base.forEach((b, i) => {
      if (!b.mag) b.el.style.setProperty('--s', '1');
      b.el.style.setProperty('--tx', `${shift[i]!.toFixed(1)}px`);
    });
    nav.style.setProperty('--grow-l', `${growL.toFixed(1)}px`);
    nav.style.setProperty('--grow-r', `${acc.toFixed(1)}px`);
  }, []);

  const onMove = (e: React.PointerEvent) => {
    if (e.pointerType === 'touch') return;
    const x = e.clientX;
    navRef.current?.classList.add('dock--hover');
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => magnify(x));
  };
  const onLeave = () => {
    cancelAnimationFrame(frame.current);
    navRef.current?.classList.remove('dock--hover');
    magnify(null);
  };
  useEffect(() => () => cancelAnimationFrame(frame.current), []);
  // Состав дока изменился (свернули окно) — пересчитать
  useEffect(() => magnify(null), [minimized, magnify]);

  return (
    <nav ref={navRef} className="dock" aria-label="Док: разделы и свёрнутые окна" onPointerMove={onMove} onPointerLeave={onLeave}>
      <div className="dock__bg" aria-hidden />
      <div ref={rowRef} className="dock__row">
        {dockApps.map((a) => (
          <DockApp key={a.id} app={a} />
        ))}
        <span className="dock__sep" aria-hidden />
        {minimized &&
          minimized.split(',').map((id) => (
            <DockMin key={id} id={id} />
          ))}
        {minimized && <span ref={endRef} className="dock__sep" aria-hidden />}
        {!minimized && <span ref={endRef} className="dock__anchor" aria-hidden />}
        <DockAccount />
      </div>
    </nav>
  );
}
