/**
 * Локальные настройки интерфейса (хранятся на устройстве): тема, акцент,
 * размер текста, плотность, поведение чатов, закреплённые разделы, код-пароль.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type Theme = 'system' | 'light' | 'dark';
export type Accent = 'violet' | 'blue' | 'green' | 'orange' | 'pink' | 'teal';

interface PrefsState {
  theme: Theme;
  accent: Accent;
  fontScale: number;
  density: 'comfortable' | 'compact';
  reduceMotion: boolean;
  enterToSend: boolean;
  autoplayVideo: boolean;
  dataSaver: boolean;
  navCollapsed: boolean;
  /** Закреплённые пункты навигации (id узлов) */
  favorites: string[];
  /** Недавно открытые разделы */
  recent: string[];
  /** Развёрнутые группы дерева */
  expanded: Record<string, boolean>;
  /** Хэш код-пароля (PBKDF2) и таймаут блокировки в минутах */
  passcode: { hash: string; salt: string; timeoutMin: number } | null;
  set: (patch: Partial<Omit<PrefsState, 'set' | 'toggleFavorite' | 'pushRecent' | 'toggleExpanded'>>) => void;
  toggleFavorite: (id: string) => void;
  pushRecent: (id: string) => void;
  toggleExpanded: (id: string, value?: boolean) => void;
}

export const usePrefs = create<PrefsState>()(
  persist(
    (set) => ({
      theme: 'system',
      accent: 'violet',
      fontScale: 1,
      density: 'comfortable',
      reduceMotion: false,
      enterToSend: true,
      autoplayVideo: true,
      dataSaver: false,
      navCollapsed: false,
      favorites: [],
      recent: [],
      expanded: {},
      passcode: null,
      set: (patch) => set(patch),
      toggleFavorite: (id) =>
        set((s) => ({ favorites: s.favorites.includes(id) ? s.favorites.filter((f) => f !== id) : [...s.favorites, id].slice(-12) })),
      pushRecent: (id) => set((s) => ({ recent: [id, ...s.recent.filter((r) => r !== id)].slice(0, 8) })),
      toggleExpanded: (id, value) => set((s) => ({ expanded: { ...s.expanded, [id]: value ?? !s.expanded[id] } })),
    }),
    { name: 'omni.prefs', version: 1 },
  ),
);

/** Применяет тему/акцент/масштаб к <html>. */
export function applyPrefs(p: Pick<PrefsState, 'theme' | 'accent' | 'fontScale' | 'density' | 'reduceMotion'>) {
  const d = document.documentElement;
  const theme = p.theme === 'system' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : p.theme;
  d.dataset.theme = theme;
  d.dataset.accent = p.accent;
  d.dataset.density = p.density;
  d.dataset.reduceMotion = String(p.reduceMotion);
  d.style.setProperty('--font-scale', String(p.fontScale));
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute('content', theme === 'dark' ? '#0b0d14' : '#f4f5fa'));
}
