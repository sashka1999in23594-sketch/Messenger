/**
 * «Не интересно»: скрытые из лент публикации. Хранятся только на этом
 * устройстве (до 500 последних) — сервер об этом не знает.
 */
import { create } from 'zustand';

const KEY = 'sunnet-hidden-posts';
const MAX = 500;

function load(): string[] {
  try {
    const raw = localStorage.getItem(KEY);
    const list = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(list) ? list.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function save(ids: string[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(ids));
  } catch {
    // Хранилище недоступно — скрытие действует до перезагрузки
  }
}

interface HiddenState {
  ids: string[];
  hide: (id: string) => void;
  unhide: (id: string) => void;
}

export const useHiddenPosts = create<HiddenState>((set, get) => ({
  ids: load(),
  hide: (id) => {
    const ids = [id, ...get().ids.filter((x) => x !== id)].slice(0, MAX);
    save(ids);
    set({ ids });
  },
  unhide: (id) => {
    const ids = get().ids.filter((x) => x !== id);
    save(ids);
    set({ ids });
  },
}));
