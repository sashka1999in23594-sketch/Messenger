/**
 * Геометрия рабочего стола: рабочая область между верхней строкой и доком,
 * прилипание окон к краям, лесенка новых окон и раскладка «Упорядочить».
 * Все координаты — в пикселях окна браузера.
 */
import { create } from 'zustand';
import { appFor } from './apps';

/** Высота верхней строки меню */
export const MENUBAR_H = 32;
/** Место под док внизу (сам док + отступы) */
export const DOCK_ZONE = 78;
/** Отступ окон, прилипших к краю, от краёв рабочей области и друг от друга */
export const SNAP_GAP = 6;
export const MIN_W = 380;
export const MIN_H = 300;

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Половины, четверти и «на весь экран». */
export type Snap = 'left' | 'right' | 'tl' | 'tr' | 'bl' | 'br' | 'max';

export function workArea(vw = window.innerWidth, vh = window.innerHeight): Rect {
  return { x: 0, y: MENUBAR_H, w: vw, h: Math.max(MIN_H, vh - MENUBAR_H - DOCK_ZONE) };
}

/** Размер окна браузера — один подписчик на всё приложение. */
export const useArea = create<{ area: Rect }>(() => ({ area: typeof window === 'undefined' ? { x: 0, y: MENUBAR_H, w: 1440, h: 790 } : workArea() }));
if (typeof window !== 'undefined') {
  window.addEventListener('resize', () => useArea.setState({ area: workArea() }));
}

export function snapRect(snap: Snap, a: Rect): Rect {
  const g = SNAP_GAP;
  const x0 = a.x + g;
  const y0 = a.y + g;
  const fw = a.w - g * 2;
  const fh = a.h - g * 2;
  const hw = Math.floor((fw - g) / 2);
  const hh = Math.floor((fh - g) / 2);
  switch (snap) {
    case 'max':
      return { x: x0, y: y0, w: fw, h: fh };
    case 'left':
      return { x: x0, y: y0, w: hw, h: fh };
    case 'right':
      return { x: x0 + fw - hw, y: y0, w: hw, h: fh };
    case 'tl':
      return { x: x0, y: y0, w: hw, h: hh };
    case 'tr':
      return { x: x0 + fw - hw, y: y0, w: hw, h: hh };
    case 'bl':
      return { x: x0, y: y0 + fh - hh, w: hw, h: hh };
    case 'br':
      return { x: x0 + fw - hw, y: y0 + fh - hh, w: hw, h: hh };
  }
}

/** Окно остаётся достижимым: заголовок на экране, размер не больше рабочей области. */
export function clampRect(r: Rect, a: Rect): Rect {
  const w = Math.round(Math.min(Math.max(r.w, MIN_W), a.w));
  const h = Math.round(Math.min(Math.max(r.h, MIN_H), a.h + DOCK_ZONE));
  const x = Math.round(Math.min(Math.max(r.x, a.x - w + 140), a.x + a.w - 140));
  const y = Math.round(Math.min(Math.max(r.y, a.y), a.y + a.h + DOCK_ZONE - 56));
  return { x, y, w, h };
}

/** Удобный размер окна под характер раздела. */
export function sizeFor(path: string, a: Rect): { w: number; h: number } {
  const id = appFor(path).id;
  let s = { w: 900, h: 720 };
  if (id === 'reels') s = { w: 460, h: a.h - 24 };
  else if (['messenger', 'channels', 'companies', 'communities'].includes(id)) s = { w: 1060, h: 720 };
  else if (id === 'notifications' || id === 'search') s = { w: 580, h: 720 };
  else if (id === 'home') s = { w: 820, h: a.h - 24 };
  else if (id === 'video') s = { w: 1120, h: 740 };
  else if (id === 'help' || id === 'download') s = { w: 1000, h: 740 };
  else if (['settings', 'stats', 'profile'].includes(id)) s = { w: 1040, h: 740 };
  return { w: Math.min(s.w, a.w - 48), h: Math.min(s.h, a.h - 24) };
}

interface Placed {
  x: number;
  y: number;
  w: number;
  h: number;
  z: number;
  min: boolean;
  max: boolean;
  snap?: Snap | null;
}

/** Место нового окна: по центру, если стол пуст, иначе — лесенкой от верхнего окна. */
export function cascadePlace(size: { w: number; h: number }, wins: Placed[], a: Rect): Rect {
  const step = 32;
  const free = wins.filter((w) => !w.min && !w.max && !w.snap).sort((p, q) => q.z - p.z);
  let x: number;
  let y: number;
  if (!free.length) {
    x = a.x + (a.w - size.w) / 2;
    y = a.y + Math.max(SNAP_GAP, ((a.h - size.h) / 2) * 0.6);
  } else {
    x = free[0]!.x + step;
    y = free[0]!.y + step;
    if (x + size.w > a.x + a.w - 8 || y + size.h > a.y + a.h - 8) {
      const n = wins.length % 6;
      x = a.x + 24 + n * step;
      y = a.y + SNAP_GAP + n * step;
    }
  }
  // Не кладём окно ровно поверх другого — заголовки должны быть видны
  for (let i = 0; i < 12 && wins.some((w) => !w.min && Math.abs(w.x - x) < 6 && Math.abs(w.y - y) < 6); i++) {
    x += step;
    y += step;
  }
  return clampRect({ x, y, ...size }, a);
}

/**
 * «Упорядочить окна»: как раскладки Windows 11. Два окна — пополам, три —
 * одно слева и два справа, четыре — четвертями, дальше — сеткой.
 * Первым идёт окно, которое сейчас сверху: ему достаётся самое большое место.
 */
export function tileRects(n: number, a: Rect): Rect[] {
  const g = SNAP_GAP;
  if (n <= 0) return [];
  if (n === 1) {
    const w = Math.min(a.w - g * 2, Math.max(980, Math.round(a.w * 0.62)));
    return [{ x: a.x + Math.round((a.w - w) / 2), y: a.y + g, w, h: a.h - g * 2 }];
  }
  if (n === 2) return [snapRect('left', a), snapRect('right', a)];
  if (n === 3) {
    const r = snapRect('right', a);
    return [snapRect('left', a), snapRect('tr', a), snapRect('br', a)].map((x, i) => (i === 0 ? x : { ...x, x: r.x, w: r.w }));
  }
  const cols = n === 4 ? 2 : n <= 6 ? 3 : 4;
  const rows = Math.ceil(n / cols);
  const ch = Math.floor((a.h - g * (rows + 1)) / rows);
  const out: Rect[] = [];
  for (let r = 0; r < rows; r++) {
    const inRow = Math.min(cols, n - r * cols);
    const cw = Math.floor((a.w - g * (inRow + 1)) / inRow);
    for (let c = 0; c < inRow; c++) out.push({ x: a.x + g + c * (cw + g), y: a.y + g + r * (ch + g), w: cw, h: ch });
  }
  return out;
}

/**
 * Первый запуск: Чаты слева, Главная рядом, на широком экране справа ещё
 * Уведомления. Возвращается в порядке открытия — последнее окно будет сверху.
 */
export function firstRunLayout(a: Rect): { path: string; rect: Rect }[] {
  const g = 12;
  const y = a.y + SNAP_GAP;
  const h = a.h - SNAP_GAP * 2;
  if (a.w >= 1760) {
    const inner = a.w - g * 4;
    const chats = Math.round(inner * 0.41);
    const home = Math.round(inner * 0.34);
    const notif = inner - chats - home;
    return [
      { path: '/notifications', rect: { x: a.x + g * 3 + chats + home, y, w: notif, h } },
      { path: '/chats', rect: { x: a.x + g, y, w: chats, h } },
      { path: '/home', rect: { x: a.x + g * 2 + chats, y, w: home, h } },
    ];
  }
  if (a.w >= 1280) {
    const inner = a.w - g * 3;
    const chats = Math.round(inner * 0.53);
    return [
      { path: '/chats', rect: { x: a.x + g, y, w: chats, h } },
      { path: '/home', rect: { x: a.x + g * 2 + chats, y, w: inner - chats, h } },
    ];
  }
  // Небольшой экран: Чаты пошире, Главная поверх справа
  const chats = Math.round(a.w * 0.64);
  const home = Math.max(MIN_W + 40, Math.round(a.w * 0.46));
  return [
    { path: '/chats', rect: { x: a.x + SNAP_GAP, y, w: chats, h } },
    { path: '/home', rect: { x: a.x + a.w - home - SNAP_GAP, y: y + 20, w: home, h: h - 20 } },
  ];
}
