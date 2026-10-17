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
export type FontFamily = 'inter' | 'system' | 'rounded' | 'serif' | 'mono';
export type Corners = 'sharp' | 'normal' | 'round';
export type StartPage = '/home' | '/chats' | '/feed' | '/photos' | '/shorts';

export interface SoundPrefs {
  /** Входящие сообщения и уведомления */
  messages: boolean;
  /** Звук отправки */
  sent: boolean;
  /** Мелодия звонка */
  calls: boolean;
  /** Громкость 0…1 */
  volume: number;
}

export interface QuietHours {
  enabled: boolean;
  /** Время «с» и «до», ЧЧ:ММ по местному времени */
  from: string;
  to: string;
}

/** Настройки, которые влияют на внешний вид и применяются к <html>. */
export type VisualPrefs = Pick<PrefsState, 'theme' | 'palette' | 'accent' | 'fontScale' | 'density' | 'reduceMotion' | 'glass' | 'aurora' | 'fontFamily' | 'corners'>;

interface PrefsState {
  theme: Theme;
  palette: Palette;
  accent: Accent;
  /** Эффект матового стекла у панелей (выключение ускоряет слабые устройства) */
  glass: boolean;
  aurora: AuroraMode;
  fontScale: number;
  fontFamily: FontFamily;
  corners: Corners;
  density: 'comfortable' | 'compact';
  reduceMotion: boolean;
  enterToSend: boolean;
  /** Обои переписки: общие и отдельные для чатов */
  wallpaper: Wallpaper;
  chatWallpapers: Record<string, Wallpaper>;
  /** Размер текста сообщений, % */
  messageScale: number;
  /** Сообщение из одних эмодзи — крупно */
  jumboEmoji: boolean;
  /** Проверка орфографии в полях ввода */
  spellcheck: boolean;
  /** Куда попадать при открытии приложения */
  startPage: StartPage;
  sounds: SoundPrefs;
  quietHours: QuietHours;
  /** Системные уведомления, когда вкладка в фоне */
  desktopNotify: boolean;
  /** Недавние поисковые запросы */
  recentSearches: string[];
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
      fontFamily: 'inter',
      corners: 'normal',
      density: 'comfortable',
      reduceMotion: false,
      enterToSend: true,
      wallpaper: 'aurora',
      chatWallpapers: {},
      messageScale: 100,
      jumboEmoji: true,
      spellcheck: true,
      startPage: '/home',
      sounds: { messages: true, sent: true, calls: true, volume: 0.6 },
      quietHours: { enabled: false, from: '23:00', to: '08:00' },
      desktopNotify: false,
      recentSearches: [],
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
  d.dataset.font = p.fontFamily ?? 'inter';
  d.dataset.corners = p.corners ?? 'normal';
  const bg = getComputedStyle(d).getPropertyValue('--bg').trim() || (theme === 'dark' ? '#07080f' : '#eef0f8');
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute('content', bg));
}

/** Сейчас «Не беспокоить» по расписанию? (интервал может переходить через полночь) */
export function isQuietNow(q: QuietHours | undefined, now = new Date()): boolean {
  if (!q?.enabled) return false;
  const toMin = (t: string) => {
    const [h, m] = t.split(':').map(Number);
    return (h ?? 0) * 60 + (m ?? 0);
  };
  const cur = now.getHours() * 60 + now.getMinutes();
  const from = toMin(q.from);
  const to = toMin(q.to);
  return from <= to ? cur >= from && cur < to : cur >= from || cur < to;
}
