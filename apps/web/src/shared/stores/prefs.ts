/**
 * Локальные настройки интерфейса (хранятся на устройстве): тема, акцент,
 * размер текста, плотность, поведение чатов, закреплённые разделы, код-пароль.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type Theme = 'system' | 'light' | 'dark';
export type Palette = 'aurora' | 'sunset' | 'ocean' | 'forest' | 'sakura' | 'midnight' | 'graphite';
export type Accent = 'auto' | 'violet' | 'blue' | 'cyan' | 'green' | 'yellow' | 'orange' | 'red' | 'pink' | 'purple';
export type AuroraMode = 'animated' | 'static' | 'off';
export type Wallpaper = 'aurora' | 'plain' | 'mesh' | 'sunset' | 'ocean' | 'forest' | 'night' | 'candy' | 'grid' | 'waves';

/** Настройки, которые влияют на внешний вид и применяются к <html>. */
export type VisualPrefs = Pick<PrefsState, 'theme' | 'palette' | 'accent' | 'fontScale' | 'density' | 'reduceMotion' | 'glass' | 'aurora'>;

interface PrefsState {
  theme: Theme;
  palette: Palette;
  accent: Accent;
  /** Эффект матового стекла у панелей (выключение ускоряет слабые устройства) */
  glass: boolean;
  aurora: AuroraMode;
  fontScale: number;
  density: 'comfortable' | 'compact';
  reduceMotion: boolean;
  enterToSend: boolean;
  /** Обои переписки: общие и отдельные для чатов */
  wallpaper: Wallpaper;
  chatWallpapers: Record<string, Wallpaper>;
  /** Размер текста сообщений, % */
  messageScale: number;
  autoplayVideo: boolean;
  dataSaver: boolean;
  navCollapsed: boolean;
  /** Закреплённые пункты навигации (id узлов) */
  favorites: string[];
  /** Недавно открытые разделы */
  recent: string[];
  /** Недавние эмодзи */
  recentEmoji: string[];
  /** Развёрнутые группы дерева */
  expanded: Record<string, boolean>;
  /** Хэш код-пароля (PBKDF2) и таймаут блокировки в минутах */
  passcode: { hash: string; salt: string; timeoutMin: number } | null;
  set: (patch: Partial<Omit<PrefsState, 'set' | 'toggleFavorite' | 'pushRecent' | 'toggleExpanded' | 'pushEmoji'>>) => void;
  pushEmoji: (emoji: string) => void;
  toggleFavorite: (id: string) => void;
  pushRecent: (id: string) => void;
  toggleExpanded: (id: string, value?: boolean) => void;
}

export const usePrefs = create<PrefsState>()(
  persist(
    (set) => ({
      theme: 'dark',
      palette: 'aurora',
      accent: 'auto',
      glass: true,
      aurora: 'animated',
      fontScale: 1,
      density: 'comfortable',
      reduceMotion: false,
      enterToSend: true,
      wallpaper: 'aurora',
      chatWallpapers: {},
      messageScale: 100,
      autoplayVideo: true,
      dataSaver: false,
      navCollapsed: false,
      favorites: [],
      recent: [],
      recentEmoji: [],
      expanded: {},
      passcode: null,
      set: (patch) => set(patch),
      toggleFavorite: (id) =>
        set((s) => ({ favorites: s.favorites.includes(id) ? s.favorites.filter((f) => f !== id) : [...s.favorites, id].slice(-12) })),
      pushRecent: (id) => set((s) => ({ recent: [id, ...s.recent.filter((r) => r !== id)].slice(0, 8) })),
      pushEmoji: (emoji) => set((s) => ({ recentEmoji: [emoji, ...(s.recentEmoji ?? []).filter((e) => e !== emoji)].slice(0, 32) })),
      toggleExpanded: (id, value) => set((s) => ({ expanded: { ...s.expanded, [id]: value ?? !s.expanded[id] } })),
    }),
    {
      name: 'omni.prefs',
      version: 2,
      // v1 → v2: появились палитры; старый акцент «teal» стал «cyan», тема по умолчанию — тёмная «Аврора»
      migrate: (persisted, version) => {
        const p = (persisted ?? {}) as Record<string, unknown>;
        if (version < 2) {
          if (p.accent === 'teal') p.accent = 'cyan';
          if (p.accent === 'violet') p.accent = 'auto';
          p.palette = 'aurora';
          p.glass = true;
          p.aurora = 'animated';
        }
        return p as unknown as PrefsState;
      },
    },
  ),
);

/** Применяет тему, палитру, акцент и масштаб к <html>. */
export function applyPrefs(p: VisualPrefs) {
  const d = document.documentElement;
  const theme = p.theme === 'system' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : p.theme;
  d.dataset.theme = theme;
  d.dataset.palette = p.palette;
  d.dataset.accent = p.accent;
  d.dataset.density = p.density;
  d.dataset.reduceMotion = String(p.reduceMotion);
  d.dataset.glass = p.glass ? 'on' : 'off';
  d.dataset.aurora = p.reduceMotion && p.aurora === 'animated' ? 'static' : p.aurora;
  d.style.setProperty('--font-scale', String(p.fontScale));
  const bg = getComputedStyle(d).getPropertyValue('--bg').trim() || (theme === 'dark' ? '#07080f' : '#eef0f8');
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute('content', bg));
}
