/**
 * Облако рабочего стола: данные на сервере (/desk/items), поэтому стол одинаков
 * на любом устройстве. Здесь — запросы и небольшие действия над значками.
 */
import { useQuery } from '@tanstack/react-query';
import type { MediaItem } from '@omni/shared';
import { api, errorMessage, uploadFile } from '../../shared/api/client';
import { queryClient } from '../../shared/api/query';
import { toast } from '../../shared/stores/ui';

export interface DeskItem {
  id: string;
  parentId: string | null;
  kind: 'folder' | 'file' | 'project' | 'link';
  name: string;
  url: string | null;
  media: MediaItem | null;
  x: number | null;
  y: number | null;
  trashed: boolean;
  updatedAt: string;
}

export const DESK_KEY = ['desk-items'] as const;

export function useDeskItems() {
  return useQuery({
    queryKey: DESK_KEY,
    queryFn: () => api.get<{ items: DeskItem[] }>('/desk/items').then((r) => r.items),
    staleTime: 15_000,
    refetchOnWindowFocus: true,
  });
}

export function useTrash(enabled = true) {
  return useQuery({ queryKey: ['desk-trash'], queryFn: () => api.get<{ items: DeskItem[] }>('/desk/items?trash=1').then((r) => r.items), enabled });
}

const refresh = () => {
  void queryClient.invalidateQueries({ queryKey: DESK_KEY });
  void queryClient.invalidateQueries({ queryKey: ['desk-trash'] });
};

/** Сдвинуть значок (оптимистично — без ожидания сервера). */
export function moveItem(id: string, patch: { x?: number; y?: number; parentId?: string | null }) {
  queryClient.setQueryData<DeskItem[]>(DESK_KEY, (list) => list?.map((i) => (i.id === id ? { ...i, ...patch } : i)));
  api.patch(`/desk/items/${id}`, patch).catch((e) => {
    toast({ text: errorMessage(e), kind: 'error' });
    refresh();
  });
}

export async function createItem(body: { kind: DeskItem['kind']; name: string; parentId?: string | null; mediaId?: string; url?: string; x?: number; y?: number }) {
  try {
    const item = await api.post<DeskItem>('/desk/items', body);
    queryClient.setQueryData<DeskItem[]>(DESK_KEY, (list) => [...(list ?? []), item]);
    return item;
  } catch (e) {
    toast({ text: errorMessage(e), kind: 'error' });
    return null;
  }
}

export async function renameItem(id: string, name: string) {
  const n = name.trim();
  if (!n) return;
  queryClient.setQueryData<DeskItem[]>(DESK_KEY, (list) => list?.map((i) => (i.id === id ? { ...i, name: n } : i)));
  await api.patch(`/desk/items/${id}`, { name: n }).catch((e) => toast({ text: errorMessage(e), kind: 'error' }));
}

/** Значки из кэша (без запроса). */
export const useDeskItemsCache = () => queryClient.getQueryData<DeskItem[]>(DESK_KEY) ?? [];

/** В корзину; silent — ярлык переехал на панель задач: убираем совсем и без сообщения. */
export async function trashItem(item: DeskItem, silent = false) {
  queryClient.setQueryData<DeskItem[]>(DESK_KEY, (list) => list?.filter((i) => i.id !== item.id));
  try {
    await api.del(`/desk/items/${item.id}`);
    if (silent) await api.del(`/desk/items/${item.id}?forever=1`);
    else toast({ text: `«${item.name}» — в корзине`, action: { label: 'Вернуть', onClick: () => void restoreItem(item.id) } });
  } catch (e) {
    toast({ text: errorMessage(e), kind: 'error' });
  }
  refresh();
}

export async function restoreItem(id: string) {
  await api.post(`/desk/items/${id}/restore`).catch((e) => toast({ text: errorMessage(e), kind: 'error' }));
  refresh();
}

export async function deleteForever(id: string) {
  await api.del(`/desk/items/${id}?forever=1`).catch((e) => toast({ text: errorMessage(e), kind: 'error' }));
  refresh();
}

/** Загрузить файлы из системы на стол (по одному, с проверкой на сервере). */
export async function uploadToDesk(files: File[], at: { x: number; y: number }, parentId: string | null = null) {
  let col = at.x;
  let row = at.y;
  for (const f of files.slice(0, 20)) {
    toast({ text: `Загружаем «${f.name}» в облако…` });
    try {
      const media = await uploadFile(f, f.name);
      await createItem({ kind: 'file', name: f.name.slice(0, 120), mediaId: media.id, parentId, x: col, y: row });
      row++;
      if (row > 6) ((row = 0), col++);
    } catch (e) {
      toast({ text: `«${f.name}»: ${errorMessage(e)}`, kind: 'error' });
    }
  }
}

/** Открыть значок: папка — окно облака, файл — в новой вкладке, ярлык — сайт сервиса. */
export function openItemUrl(item: DeskItem): string | null {
  if (item.kind === 'file') return item.media?.url ?? null;
  if (item.kind === 'link' && item.url?.startsWith('https://')) return item.url;
  return null;
}

/** Ярлык на раздел Sunnet («/servers») открывается окном, а не вкладкой. */
export const isInternal = (item: DeskItem) => item.kind === 'link' && !!item.url?.startsWith('/');
