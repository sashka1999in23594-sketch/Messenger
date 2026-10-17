/**
 * Состояние «Пространства»: окна (адрес, место, размер, свёрнуто/развёрнуто)
 * и вид поля (сдвиг и масштаб). Хранится на устройстве — после перезагрузки
 * всё открывается там же, где было.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { sectionFor } from '../../app/navigation';

export interface Win {
  id: string;
  path: string;
  x: number;
  y: number;
  w: number;
  h: number;
  z: number;
  min: boolean;
  max: boolean;
  /** Запрос перейти по адресу внутри уже открытого окна */
  go?: { path: string; n: number };
}

export interface View {
  x: number;
  y: number;
  zoom: number;
}

export const ZOOM_MIN = 0.25;
export const ZOOM_MAX = 2;
export const DOCK_W = 76;

/** Размер окна по умолчанию — под характер раздела. */
function sizeFor(path: string): { w: number; h: number } {
  const s = sectionFor(path).id;
  if (s === 'comets') return { w: 440, h: 760 };
  if (['messenger', 'channels', 'companies', 'communities'].includes(s)) return { w: 1040, h: 680 };
  if (s === 'notifications' || s === 'search') return { w: 560, h: 680 };
  return { w: 860, h: 660 };
}

interface DesktopState {
  wins: Win[];
  view: View;
  top: number;
  open: (path: string, opts?: { newWindow?: boolean; at?: { x: number; y: number } }) => string;
  focus: (id: string) => void;
  close: (id: string) => void;
  minimize: (id: string) => void;
  toggleMax: (id: string) => void;
  place: (id: string, rect: Partial<Pick<Win, 'x' | 'y' | 'w' | 'h'>>) => void;
  setPath: (id: string, path: string) => void;
  setView: (v: Partial<View>) => void;
  arrange: (field: { w: number; h: number }) => void;
  reset: () => void;
}

const uid = () => Math.random().toString(36).slice(2, 10);

export const useDesktop = create<DesktopState>()(
  persist(
    (set, get) => ({
      wins: [],
      view: { x: 40, y: 32, zoom: 1 },
      top: 1,
      open: (path, opts = {}) => {
        const { wins, view, top } = get();
        const section = sectionFor(path).id;
        const same = opts.newWindow ? undefined : wins.find((w) => sectionFor(w.path).id === section);
        if (same) {
          set({
            top: top + 1,
            wins: wins.map((w) =>
              w.id === same.id ? { ...w, z: top + 1, min: false, go: w.path === path ? w.go : { path, n: (w.go?.n ?? 0) + 1 } } : w,
            ),
          });
          return same.id;
        }
        const size = sizeFor(path);
        const visible = wins.filter((w) => !w.min).length;
        // Новое окно — в видимой части поля, лесенкой от уже открытых
        const fieldW = (typeof window !== 'undefined' ? window.innerWidth : 1440) - DOCK_W;
        const fieldH = typeof window !== 'undefined' ? window.innerHeight : 900;
        const cx = (opts.at?.x ?? fieldW / 2 - view.x) / view.zoom;
        const cy = (opts.at?.y ?? fieldH / 2 - view.y) / view.zoom;
        const win: Win = {
          id: uid(),
          path,
          x: Math.round(cx - size.w / 2 + (visible % 6) * 32),
          y: Math.round(Math.max(cy - size.h / 2 + (visible % 6) * 32, 0)),
          ...size,
          z: top + 1,
          min: false,
          max: false,
        };
        set({ wins: [...wins, win], top: top + 1 });
        return win.id;
      },
      focus: (id) => {
        const { wins, top } = get();
        const w = wins.find((x) => x.id === id);
        // Верхнее окно не трогаем — но свёрнутое всё равно возвращаем на поле
        if (!w || (w.z === top && !w.min)) return;
        set({ top: top + 1, wins: wins.map((w) => (w.id === id ? { ...w, z: top + 1, min: false } : w)) });
      },
      close: (id) => set({ wins: get().wins.filter((w) => w.id !== id) }),
      minimize: (id) => set({ wins: get().wins.map((w) => (w.id === id ? { ...w, min: true } : w)) }),
      toggleMax: (id) => {
        const { wins, top } = get();
        set({ top: top + 1, wins: wins.map((w) => (w.id === id ? { ...w, max: !w.max, min: false, z: top + 1 } : w)) });
      },
      place: (id, rect) => set({ wins: get().wins.map((w) => (w.id === id ? { ...w, ...rect } : w)) }),
      setPath: (id, path) => set({ wins: get().wins.map((w) => (w.id === id && w.path !== path ? { ...w, path } : w)) }),
      setView: (v) => set({ view: { ...get().view, ...v } }),
      /** Разложить открытые окна сеткой и показать их все. */
      arrange: (field) => {
        const open = get().wins.filter((w) => !w.min);
        if (!open.length) return;
        const cols = Math.ceil(Math.sqrt(open.length));
        const gap = 32;
        const cellW = Math.max(...open.map((w) => w.w));
        const cellH = Math.max(...open.map((w) => w.h));
        const placed = new Map(open.map((w, i) => [w.id, { x: (i % cols) * (cellW + gap), y: Math.floor(i / cols) * (cellH + gap) }]));
        const rows = Math.ceil(open.length / cols);
        const totalW = cols * cellW + (cols - 1) * gap;
        const totalH = rows * cellH + (rows - 1) * gap;
        const zoom = Math.min(1, Math.max(ZOOM_MIN, Math.min((field.w - 64) / totalW, (field.h - 64) / totalH)));
        set({
          wins: get().wins.map((w) => (placed.has(w.id) ? { ...w, ...placed.get(w.id)!, max: false } : w)),
          view: { zoom, x: (field.w - totalW * zoom) / 2, y: (field.h - totalH * zoom) / 2 },
        });
      },
      reset: () => set({ wins: [], view: { x: 40, y: 32, zoom: 1 }, top: 1 }),
    }),
    {
      name: 'spaceup.desktop',
      version: 1,
      partialize: (s) => ({ wins: s.wins.map(({ go: _go, ...w }) => w), view: s.view, top: s.top }),
    },
  ),
);
