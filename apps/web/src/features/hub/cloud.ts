/**
 * Облако Sunnet = рабочий стол. Здесь — модель данных и действия над ней:
 * папки, файлы, проекты Студии, серверы и добавленные сервисы, их место на
 * сетке, закрепление в доке, разрешения и журнал.
 *
 * Безопасность заложена в модель, а не в интерфейс:
 *  - у каждого приложения своя папка (sandbox) — доступ к файлам вне её
 *    приложение получить не может, даже с разрешением «Файлы»;
 *  - удаление никогда не стирает сразу — элемент уходит в корзину на 30 дней;
 *  - массовое удаление (больше 20 элементов за минуту) от приложения
 *    блокируется и попадает в журнал безопасности;
 *  - камера/микрофон/экран выдаются отдельно каждому приложению и
 *    отзываются в любой момент; каждое изменение пишется в журнал.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { catalogById, type Perm } from './catalog';

export type ItemKind = 'folder' | 'file' | 'project' | 'app' | 'server';
export type LivePerm = 'camera' | 'mic' | 'screen';

export interface DeskItem {
  id: string;
  kind: ItemKind;
  name: string;
  /** Ячейка сетки на столе */
  col: number;
  row: number;
  /** Папка-родитель (null — сам стол) */
  parent: string | null;
  appId?: string;
  mime?: string;
  size?: number;
  /** Файл пришёл из интернета (браузер) — открывается только в песочнице */
  quarantined?: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface PermEvent {
  at: number;
  itemId: string;
  name: string;
  perm: Perm;
  granted: boolean;
}

export interface SecEvent {
  at: number;
  level: 'info' | 'warn' | 'block';
  text: string;
}

export type SortBy = 'manual' | 'name' | 'kind' | 'date';
export type IconSize = 'sm' | 'md' | 'lg';

interface CloudState {
  items: DeskItem[];
  trash: (DeskItem & { deletedAt: number })[];
  pinned: string[];
  grants: Record<string, Partial<Record<Perm, boolean>>>;
  permLog: PermEvent[];
  secLog: SecEvent[];
  installs: { at: number; appId: string; action: 'install' | 'remove' }[];
  sort: SortBy;
  iconSize: IconSize;
  selected: string[];
  renaming: string | null;
  clipboard: { ids: string[]; cut: boolean } | null;

  create: (kind: ItemKind, name?: string, extra?: Partial<DeskItem>) => DeskItem;
  rename: (id: string, name: string) => void;
  move: (id: string, col: number, row: number) => void;
  moveInto: (ids: string[], parent: string | null) => void;
  remove: (ids: string[], by?: string) => void;
  restore: (id: string) => void;
  purge: (id: string) => void;
  copy: (ids: string[], cut?: boolean) => void;
  paste: (parent?: string | null) => void;
  select: (ids: string[]) => void;
  setRenaming: (id: string | null) => void;
  pin: (id: string) => void;
  unpin: (id: string) => void;
  grant: (id: string, perm: Perm, on: boolean) => void;
  setSort: (s: SortBy) => void;
  setIconSize: (s: IconSize) => void;
  install: (appId: string) => DeskItem;
  uninstall: (id: string) => void;
  log: (e: Omit<SecEvent, 'at'>) => void;
}

const uid = () => Math.random().toString(36).slice(2, 10);
const ROWS = 6;

/** Первая свободная ячейка столбцами сверху вниз, слева направо — как в Windows. */
function freeCell(items: DeskItem[]): { col: number; row: number } {
  const taken = new Set(items.filter((i) => !i.parent).map((i) => `${i.col}:${i.row}`));
  for (let col = 0; ; col++) for (let row = 0; row < ROWS; row++) if (!taken.has(`${col}:${row}`)) return { col, row };
}

function uniqueName(items: DeskItem[], base: string, parent: string | null): string {
  const names = new Set(items.filter((i) => i.parent === parent).map((i) => i.name));
  if (!names.has(base)) return base;
  for (let n = 2; ; n++) if (!names.has(`${base} (${n})`)) return `${base} (${n})`;
}

const DEFAULT_NAME: Record<ItemKind, string> = { folder: 'Новая папка', file: 'Файл', project: 'Проект №1', app: 'Приложение', server: 'Мой сервер' };

/** Окно массового удаления — защита от приложения, которое пытается стереть облако */
const recentDeletes: { at: number; by: string }[] = [];

export const useCloud = create<CloudState>()(
  persist(
    (set, get) => ({
      items: [],
      trash: [],
      pinned: [],
      grants: {},
      permLog: [],
      secLog: [],
      installs: [],
      sort: 'manual',
      iconSize: 'md',
      selected: [],
      renaming: null,
      clipboard: null,

      create: (kind, name, extra = {}) => {
        const items = get().items;
        let base = name ?? DEFAULT_NAME[kind];
        if (kind === 'project' && !name) {
          const n = items.filter((i) => i.kind === 'project').length + 1;
          base = `Проект №${n}`;
        }
        const item: DeskItem = {
          id: uid(),
          kind,
          name: uniqueName(items, base, extra.parent ?? null),
          parent: null,
          ...freeCell(items),
          createdAt: Date.now(),
          updatedAt: Date.now(),
          ...extra,
        };
        set({ items: [...items, item], selected: [item.id] });
        return item;
      },
      rename: (id, name) => {
        const clean = name.replace(/[\\/:*?"<>|]/g, '').trim().slice(0, 120);
        if (!clean) return set({ renaming: null });
        set({ items: get().items.map((i) => (i.id === id ? { ...i, name: clean, updatedAt: Date.now() } : i)), renaming: null });
      },
      move: (id, col, row) => {
        const items = get().items;
        const busy = items.find((i) => !i.parent && i.id !== id && i.col === col && i.row === row);
        const me = items.find((i) => i.id === id);
        if (!me) return;
        // Ячейка занята — меняемся местами
        set({
          items: items.map((i) => (i.id === id ? { ...i, col, row, parent: null } : busy && i.id === busy.id ? { ...i, col: me.col, row: me.row } : i)),
          sort: 'manual',
        });
      },
      moveInto: (ids, parent) => {
        // Папку нельзя положить в саму себя или в своё содержимое
        const items = get().items;
        const inside = (pid: string | null): boolean => {
          if (!pid) return false;
          if (ids.includes(pid)) return true;
          return inside(items.find((i) => i.id === pid)?.parent ?? null);
        };
        if (inside(parent)) return;
        set({ items: items.map((i) => (ids.includes(i.id) ? { ...i, parent } : i)) });
      },
      remove: (ids, by = 'user') => {
        const now = Date.now();
        if (by !== 'user') {
          while (recentDeletes.length && now - recentDeletes[0]!.at > 60e3) recentDeletes.shift();
          const mine = recentDeletes.filter((d) => d.by === by).length;
          if (mine + ids.length > 20) {
            get().log({ level: 'block', text: `Приложение «${by}» пыталось удалить ${ids.length} файлов — заблокировано` });
            return;
          }
          ids.forEach(() => recentDeletes.push({ at: now, by }));
        }
        const items = get().items;
        // Вместе с папкой — всё её содержимое
        const all = new Set(ids);
        let grew = true;
        while (grew) {
          grew = false;
          for (const i of items) if (i.parent && all.has(i.parent) && !all.has(i.id)) (all.add(i.id), (grew = true));
        }
        const gone = items.filter((i) => all.has(i.id)).map((i) => ({ ...i, deletedAt: now }));
        set({
          items: items.filter((i) => !all.has(i.id)),
          trash: [...gone, ...get().trash].filter((t) => now - t.deletedAt < 30 * 86400e3),
          pinned: get().pinned.filter((p) => !all.has(p)),
          selected: [],
        });
      },
      restore: (id) => {
        const t = get().trash.find((x) => x.id === id);
        if (!t) return;
        const { deletedAt: _d, ...item } = t;
        const parentAlive = !item.parent || get().items.some((i) => i.id === item.parent);
        const back = parentAlive ? item : { ...item, parent: null, ...freeCell(get().items) };
        set({ items: [...get().items, back], trash: get().trash.filter((x) => x.id !== id) });
      },
      purge: (id) => set({ trash: get().trash.filter((x) => x.id !== id) }),
      copy: (ids, cut = false) => set({ clipboard: { ids, cut } }),
      paste: (parent = null) => {
        const clip = get().clipboard;
        if (!clip) return;
        if (clip.cut) {
          get().moveInto(clip.ids, parent);
          return set({ clipboard: null });
        }
        for (const id of clip.ids) {
          const src = get().items.find((i) => i.id === id);
          if (src) get().create(src.kind, `${src.name} — копия`, { ...src, id: uid(), parent, ...freeCell(get().items), createdAt: Date.now() });
        }
      },
      select: (selected) => set({ selected }),
      setRenaming: (renaming) => set({ renaming }),
      pin: (id) => {
        if (!get().pinned.includes(id)) set({ pinned: [...get().pinned, id] });
      },
      unpin: (id) => set({ pinned: get().pinned.filter((p) => p !== id) }),
      grant: (id, perm, on) => {
        const name = get().items.find((i) => i.id === id)?.name ?? id;
        set({
          grants: { ...get().grants, [id]: { ...get().grants[id], [perm]: on } },
          permLog: [{ at: Date.now(), itemId: id, name, perm, granted: on }, ...get().permLog].slice(0, 300),
        });
      },
      setSort: (sort) => {
        if (sort === 'manual') return set({ sort });
        const desk = get().items.filter((i) => !i.parent);
        const order = [...desk].sort((a, b) =>
          sort === 'name' ? a.name.localeCompare(b.name, 'ru') : sort === 'kind' ? a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name, 'ru') : b.updatedAt - a.updatedAt,
        );
        const at = new Map(order.map((i, n) => [i.id, { col: Math.floor(n / ROWS), row: n % ROWS }]));
        set({ sort, items: get().items.map((i) => (at.has(i.id) ? { ...i, ...at.get(i.id)! } : i)) });
      },
      setIconSize: (iconSize) => set({ iconSize }),
      install: (appId) => {
        const app = catalogById.get(appId);
        const existing = get().items.find((i) => i.kind === 'app' && i.appId === appId);
        if (existing) return existing;
        const item = get().create('app', app?.name ?? appId, { appId });
        set({ installs: [{ at: Date.now(), appId, action: 'install' as const }, ...get().installs].slice(0, 200) });
        get().log({ level: 'info', text: `Установлено: ${item.name}` });
        return item;
      },
      uninstall: (id) => {
        const item = get().items.find((i) => i.id === id);
        if (!item) return;
        // Удаляются ярлык, разрешения и данные самого приложения — но не файлы пользователя
        const grants = { ...get().grants };
        delete grants[id];
        set({
          items: get().items.filter((i) => i.id !== id),
          pinned: get().pinned.filter((p) => p !== id),
          grants,
          installs: [{ at: Date.now(), appId: item.appId ?? id, action: 'remove' as const }, ...get().installs].slice(0, 200),
        });
        get().log({ level: 'info', text: `Удалено приложение: ${item.name} (ваши файлы не тронуты)` });
      },
      log: (e) => set({ secLog: [{ ...e, at: Date.now() }, ...get().secLog].slice(0, 500) }),
    }),
    {
      name: 'sunnet.cloud',
      partialize: (s) => ({ items: s.items, trash: s.trash, pinned: s.pinned, grants: s.grants, permLog: s.permLog, secLog: s.secLog, installs: s.installs, sort: s.sort, iconSize: s.iconSize }),
    },
  ),
);

export const LIVE_PERMS: LivePerm[] = ['camera', 'mic', 'screen'];
