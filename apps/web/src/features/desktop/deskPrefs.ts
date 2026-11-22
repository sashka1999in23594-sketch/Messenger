/**
 * Настройки рабочего стола, общие для всех устройств: состав панели задач,
 * размер значков и сортировка. Хранятся на сервере (/desk/prefs).
 */
import { create } from 'zustand';
import { api } from '../../shared/api/client';
import { confirm } from '../../shared/ui/Modal';
import { toast } from '../../shared/stores/ui';
import { useSession } from '../../shared/stores/session';
import { DOCK_APPS, appById, type DeskApp } from './apps';
import { createItem, moveItem, useDeskItemsCache, type DeskItem } from './cloud';
import { openPath } from './fx';

export type IconSize = 's' | 'm' | 'l';
export type SortBy = 'manual' | 'name' | 'kind' | 'date';

interface Prefs {
  dock: string[] | null;
  iconSize: IconSize;
  sort: SortBy;
  loaded: boolean;
  load: () => Promise<void>;
  set: (p: Partial<Pick<Prefs, 'dock' | 'iconSize' | 'sort'>>) => void;
}

let saveTimer: ReturnType<typeof setTimeout> | undefined;

export const useDeskPrefs = create<Prefs>((set, get) => ({
  dock: null,
  iconSize: 'm',
  sort: 'manual',
  loaded: false,
  load: async () => {
    try {
      const { prefs } = await api.get<{ prefs: Partial<Prefs> }>('/desk/prefs');
      set({ dock: prefs.dock ?? null, iconSize: prefs.iconSize ?? 'm', sort: prefs.sort ?? 'manual', loaded: true });
    } catch {
      set({ loaded: true });
    }
  },
  set: (p) => {
    set(p);
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      const { dock, iconSize, sort } = get();
      void api.put('/desk/prefs', { ...(dock ? { dock } : {}), iconSize, sort }).catch(() => toast({ text: 'Не удалось сохранить настройки стола', kind: 'error' }));
    }, 500);
  },
}));

/** «+» (каталог приложений) всегда последний и не открепляется. */
const FIXED = 'apps';

export function dockIds(dock: string[] | null): string[] {
  // Браузер живёт на рабочем столе (значок, который нельзя удалить), поиск — в солнце
  // в центре дока, поэтому из сохранённых наборов они тоже убираются
  const ids = (dock ?? [...DOCK_APPS]).filter((id) => id !== FIXED && id !== 'browser' && id !== 'search' && appById(id));
  return [...ids, FIXED];
}

/** Открепить: значок уходит с панели задач и появляется на рабочем столе. */
export async function unpinFromDock(app: DeskApp) {
  if (app.id === FIXED) return;
  const ids = dockIds(useDeskPrefs.getState().dock).filter((id) => id !== app.id && id !== FIXED);
  useDeskPrefs.getState().set({ dock: ids });
  await createItem({ kind: 'link', name: app.label, url: app.path });
  toast({ text: `«${app.label}» — теперь на рабочем столе` });
}

/** Закрепить ярлык раздела Sunnet со стола: он переезжает на панель задач. */
export async function pinToDock(item: DeskItem) {
  const app = item.url?.startsWith('/') ? appById(sectionIdFor(item.url)) : undefined;
  if (!app) return toast({ text: 'Закрепить можно разделы и приложения Sunnet', kind: 'error' });
  const ids = dockIds(useDeskPrefs.getState().dock).filter((id) => id !== FIXED);
  if (!ids.includes(app.id)) useDeskPrefs.getState().set({ dock: [...ids, app.id] });
  const { trashItem } = await import('./cloud');
  await trashItem(item, true);
  toast({ text: `«${app.label}» закреплён на панели задач` });
}

function sectionIdFor(path: string): string {
  // Ярлык хранит путь раздела, например «/servers»
  const hit = [...DOCK_APPS, 'cloud', 'apps', 'calls', 'help', 'download'].find((id) => appById(id)?.path === path);
  return hit ?? '';
}

/**
 * «Запуск от имени администратора». Пункт виден всем (так задумано), но с повышенными
 * правами окно открывается только у администратора и после явного подтверждения.
 */
export async function runAsAdmin(path: string, label: string) {
  const role = useSession.getState().me?.role;
  if (role !== 'admin') {
    toast({ text: 'Нужны права администратора. Их выдаёт владелец платформы командой /role.grant', kind: 'error' });
    return;
  }
  const ok = await confirm({
    title: `Разрешить «${label}» работать с правами администратора?`,
    text: 'Окно получит доступ к инструментам модерации. Действия записываются в журнал аудита.',
    confirmLabel: 'Да, запустить',
  });
  if (ok) void openPath(path.includes('?') ? `${path}&admin=1` : `${path}?admin=1`, { newWindow: true });
}

/** Упорядочить значки: раскладывает по столбцам в выбранном порядке и сохраняет позиции. */
export function arrangeIcons(by: SortBy) {
  useDeskPrefs.getState().set({ sort: by });
  if (by === 'manual') return;
  const items = useDeskItemsCache().filter((i) => !i.parentId);
  const kindOrder = { folder: 0, project: 1, link: 2, file: 3 } as const;
  const sorted = [...items].sort((a, b) =>
    by === 'name' ? a.name.localeCompare(b.name, 'ru') : by === 'kind' ? kindOrder[a.kind] - kindOrder[b.kind] || a.name.localeCompare(b.name, 'ru') : b.updatedAt.localeCompare(a.updatedAt),
  );
  const rows = Math.max(3, Math.floor((window.innerHeight - 160) / 106));
  sorted.forEach((it, i) => {
    const x = Math.floor(i / rows);
    const y = i % rows;
    if (it.x !== x || it.y !== y) moveItem(it.id, { x, y });
  });
}
