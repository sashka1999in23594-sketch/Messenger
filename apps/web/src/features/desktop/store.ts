/**
 * Состояние рабочего стола: окна (адрес, место, размер, свёрнуто, развёрнуто,
 * прилипло к краю), обои и вид кнопок окон. Хранится на устройстве — после
 * перезагрузки всё открывается там же, где было. Ключ прежний, чтобы
 * сохранились раскладки из «Пространства».
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { appFor, pathnameOf } from './apps';
import { cascadePlace, clampRect, firstRunLayout, MENUBAR_H, sizeFor, tileRects, useArea, type Rect, type Snap } from './geometry';

/** Когда Sunnet показывает рабочий стол (то же условие, что в App.tsx) */
export const DESKTOP_QUERY = '(min-width: 1024px) and (hover: hover) and (pointer: fine)';

export interface Win {
  id: string;
  path: string;
  /** Обычное положение и размер (к ним окно возвращается из «развёрнуто» и «у края») */
  x: number;
  y: number;
  w: number;
  h: number;
  z: number;
  min: boolean;
  max: boolean;
  /** Окно прилипло к половине или четверти экрана */
  snap?: Exclude<Snap, 'max'> | null;
  /** Боковая панель с деревом раздела (не задано — по умолчанию для раздела) */
  side?: boolean;
  /** Запрос перейти по адресу внутри уже открытого окна */
  go?: { path: string; n: number };
}

export type WallpaperId = 'sky' | 'dawn' | 'night' | 'aurora' | 'plain';
export const WALLPAPERS: { id: WallpaperId; label: string }[] = [
  { id: 'sky', label: 'Солнечное небо' },
  { id: 'dawn', label: 'Рассвет' },
  { id: 'night', label: 'Ночное небо' },
  { id: 'aurora', label: 'Сияние' },
  { id: 'plain', label: 'Однотонные' },
];

/** Кнопки окна: как в macOS (цветные слева) или как в Windows (справа) */
export type ControlsStyle = 'auto' | 'mac' | 'win';

interface OpenOptions {
  /** Всегда новое окно, даже если раздел уже открыт */
  newWindow?: boolean;
  /** Откуда «вылетает» окно (значок в доке) — для анимации */
  origin?: DOMRect | null;
  rect?: Rect;
}

interface DesktopState {
  wins: Win[];
  top: number;
  wallpaper: WallpaperId;
  controls: ControlsStyle;
  /** Окна, свёрнутые кнопкой «Свернуть все» — вернутся повторным нажатием */
  stash: string[] | null;
  open: (path: string, opts?: OpenOptions) => string;
  focus: (id: string) => void;
  close: (id: string) => void;
  closeMany: (ids: string[]) => void;
  minimize: (id: string) => void;
  toggleMax: (id: string) => void;
  snapTo: (id: string, snap: Snap | null, normal?: Rect) => void;
  place: (id: string, rect: Rect) => void;
  setPath: (id: string, path: string) => void;
  /** Перейти по адресу внутри окна */
  go: (id: string, path: string) => void;
  setSide: (id: string, side: boolean) => void;
  arrange: () => void;
  showDesktop: () => void;
  cycle: (dir: 1 | -1) => void;
  setWallpaper: (w: WallpaperId) => void;
  setControls: (c: ControlsStyle) => void;
  reset: () => void;
}

const uid = () => Math.random().toString(36).slice(2, 10);

/** Окна, открытые в этой сессии: при появлении играют анимацию (из дока или из центра). */
export const fresh = new Map<string, DOMRect | null>();

/** Верхнее видимое окно — то, с которым работает пользователь. */
export function activeWin(wins: Win[]): Win | undefined {
  let best: Win | undefined;
  for (const w of wins) if (!w.min && (!best || w.z > best.z)) best = w;
  return best;
}

export const useDesktop = create<DesktopState>()(
  persist(
    (set, get) => {
      const patch = (id: string, f: (w: Win) => Partial<Win>) => set({ wins: get().wins.map((w) => (w.id === id ? { ...w, ...f(w) } : w)) });
      const raise = (id: string, extra: Partial<Win> = {}) => {
        const top = get().top + 1;
        set({ top, wins: get().wins.map((w) => (w.id === id ? { ...w, ...extra, z: top } : w)) });
      };
      return {
        wins: [],
        top: 1,
        wallpaper: 'sky',
        controls: 'auto',
        stash: null,
        open: (path, opts = {}) => {
          const { wins, top } = get();
          const app = appFor(path);
          if (!opts.newWindow) {
            const same = wins.filter((w) => appFor(w.path).id === app.id).sort((a, b) => b.z - a.z)[0];
            if (same) {
              // Корень раздела только показывает окно — открытый в нём чат не теряется
              const nav = path !== same.path && pathnameOf(path) !== app.path;
              raise(same.id, { min: false, go: nav ? { path, n: (same.go?.n ?? 0) + 1 } : same.go });
              return same.id;
            }
          }
          const area = useArea.getState().area;
          const rect = opts.rect ?? cascadePlace(sizeFor(path, area), wins, area);
          const win: Win = { id: uid(), path, ...rect, z: top + 1, min: false, max: false, snap: null };
          fresh.set(win.id, opts.origin ?? null);
          set({ wins: [...wins, win], top: top + 1, stash: null });
          return win.id;
        },
        focus: (id) => {
          const { wins, top } = get();
          const w = wins.find((x) => x.id === id);
          // Верхнее окно не трогаем — но свёрнутое всё равно возвращаем на стол
          if (!w || (w.z === top && !w.min)) return;
          raise(id, { min: false });
        },
        close: (id) => set({ wins: get().wins.filter((w) => w.id !== id), stash: get().stash?.filter((s) => s !== id) ?? null }),
        closeMany: (ids) => set({ wins: get().wins.filter((w) => !ids.includes(w.id)), stash: null }),
        minimize: (id) => patch(id, () => ({ min: true })),
        toggleMax: (id) => {
          const w = get().wins.find((x) => x.id === id);
          if (w) raise(id, { min: false, max: !(w.max || w.snap), snap: null });
        },
        snapTo: (id, snap, normal) =>
          raise(id, {
            ...(normal ?? {}),
            min: false,
            max: snap === 'max',
            snap: snap && snap !== 'max' ? snap : null,
          }),
        place: (id, rect) => patch(id, () => ({ ...rect, max: false, snap: null })),
        setPath: (id, path) => {
          const w = get().wins.find((x) => x.id === id);
          if (w && w.path !== path) patch(id, () => ({ path }));
        },
        go: (id, path) => raise(id, { min: false, go: { path, n: (get().wins.find((w) => w.id === id)?.go?.n ?? 0) + 1 } }),
        setSide: (id, side) => patch(id, () => ({ side })),
        arrange: () => {
          const visible = get()
            .wins.filter((w) => !w.min)
            .sort((a, b) => b.z - a.z);
          if (!visible.length) return;
          const rects = tileRects(visible.length, useArea.getState().area);
          const at = new Map(visible.map((w, i) => [w.id, rects[i]!]));
          set({ wins: get().wins.map((w) => (at.has(w.id) ? { ...w, ...at.get(w.id)!, max: false, snap: null } : w)) });
        },
        showDesktop: () => {
          const { wins, stash } = get();
          const visible = wins.filter((w) => !w.min).map((w) => w.id);
          if (visible.length) set({ stash: visible, wins: wins.map((w) => ({ ...w, min: true })) });
          else if (stash?.length) set({ stash: null, wins: wins.map((w) => (stash.includes(w.id) ? { ...w, min: false } : w)) });
        },
        cycle: (dir) => {
          const visible = get()
            .wins.filter((w) => !w.min)
            .sort((a, b) => a.z - b.z);
          if (visible.length < 2) return;
          if (dir === 1) raise(visible[0]!.id);
          else {
            // Верхнее окно уходит под все остальные
            const low = visible[0]!.z - 1;
            patch(visible[visible.length - 1]!.id, () => ({ z: low }));
          }
        },
        setWallpaper: (wallpaper) => set({ wallpaper }),
        setControls: (controls) => set({ controls }),
        reset: () => {
          set({ wins: [], top: 1, stash: null });
          // На компьютере сразу раскладываем окна, как при первом запуске
          if (typeof window !== 'undefined' && matchMedia(DESKTOP_QUERY).matches) {
            for (const { path, rect } of firstRunLayout(useArea.getState().area)) get().open(path, { newWindow: true, rect });
          }
        },
      };
    },
    {
      name: 'spaceup.desktop',
      version: 2,
      partialize: (s) => ({ wins: s.wins.map(({ go: _go, ...w }) => w), top: s.top, wallpaper: s.wallpaper, controls: s.controls }),
      // v1 («Пространство»): окна на поле с масштабом и доком слева шириной 76 px.
      // Переводим в экранные координаты и возвращаем окна в видимую область.
      migrate: (persisted, version) => {
        const p = (persisted ?? {}) as { wins?: Win[]; view?: { x: number; y: number; zoom: number }; top?: number };
        if (version < 2) {
          const v = p.view ?? { x: 0, y: 0, zoom: 1 };
          const area = useArea.getState().area;
          const order = [...(p.wins ?? [])].sort((a, b) => a.z - b.z).map((w) => w.id);
          const wins = (p.wins ?? []).map((w) => ({
            ...w,
            ...clampRect({ x: 76 + v.x + w.x * v.zoom, y: MENUBAR_H + v.y + w.y * v.zoom, w: w.w, h: w.h }, area),
            z: order.indexOf(w.id) + 1,
            snap: null,
          }));
          return { wins, top: wins.length + 1, wallpaper: 'sky', controls: 'auto' } as unknown as DesktopState;
        }
        return p as unknown as DesktopState;
      },
    },
  ),
);
