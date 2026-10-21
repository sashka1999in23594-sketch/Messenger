/**
 * Помощники раздела «Видео»: главы из описания, таймкоды, локальные настройки
 * плеера, учёт просмотров и общий «тикер» для обратных отсчётов.
 */
import { useEffect, useLayoutEffect, useState } from 'react';
import type { Post, UserSummary } from '@omni/shared';
import { api } from '../../shared/api/client';
import { compactNumber, plural } from '../../shared/lib/format';

// ─── Склонения ──────────────────────────────────────────────────────────────

export const viewersLabel = (n: number) => `${compactNumber(n)} ${plural(n, 'зритель', 'зрителя', 'зрителей')}`;
export const watchingLabel = (n: number) => `${compactNumber(n)} ${plural(n, 'смотрит', 'смотрят', 'смотрят')}`;
export const waitingLabel = (n: number) => `${compactNumber(n)} ${plural(n, 'ждёт', 'ждут', 'ждут')}`;
export const videosLabel = (n: number) => `${compactNumber(n)} видео`;
export const subscribersLabel = (n: number) => `${compactNumber(n)} ${plural(n, 'подписчик', 'подписчика', 'подписчиков')}`;

/** Ссылка на канал автора. */
export const channelPath = (u: Pick<UserSummary, 'username'>) => `/u/${u.username}`;

// ─── Таймкоды и главы ───────────────────────────────────────────────────────

export interface Chapter {
  start: number;
  title: string;
}

/** «1:02:03», «12:05», «0:07» → секунды */
export function parseTime(s: string): number | null {
  const parts = s.split(':').map(Number);
  if (parts.some((p) => !Number.isFinite(p))) return null;
  return parts.reduce((acc, p) => acc * 60 + p, 0);
}

export const TIMESTAMP_RE = /(?<![\d:])(?:(\d{1,2}):)?([0-5]?\d):([0-5]\d)(?![\d:])/g;

/**
 * Главы как у видеохостингов: строки описания, начинающиеся с таймкода,
 * первая — с 0:00, минимум две и по возрастанию.
 */
export function parseChapters(text: string, duration?: number | null): Chapter[] {
  const out: Chapter[] = [];
  for (const line of text.split('\n')) {
    const m = line.trim().match(/^[([]?((?:\d{1,2}:)?[0-5]?\d:[0-5]\d)[)\]]?\s*[-–—:|.]?\s*(.+)$/);
    if (!m) continue;
    const start = parseTime(m[1]!);
    if (start === null) continue;
    if (duration && start >= duration) continue;
    if (out.length && start <= out[out.length - 1]!.start) continue;
    out.push({ start, title: m[2]!.trim().slice(0, 100) });
  }
  if (out.length < 2 || out[0]!.start !== 0) return [];
  return out;
}

export function chapterAt(chapters: Chapter[], t: number): Chapter | null {
  let found: Chapter | null = null;
  for (const c of chapters) if (c.start <= t) found = c;
  return found;
}

// ─── Локальные настройки (переживают перезагрузку, но не обязательны) ──────

export function readLocal<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(`sunnet.video.${key}`);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

export function writeLocal(key: string, value: unknown): void {
  try {
    if (value === undefined || value === null) localStorage.removeItem(`sunnet.video.${key}`);
    else localStorage.setItem(`sunnet.video.${key}`, JSON.stringify(value));
  } catch {
    /* приватный режим — настройка просто не запомнится */
  }
}

/** Состояние в localStorage с React-обновлением. */
export function useLocal<T>(key: string, fallback: T): [T, (v: T) => void] {
  const [v, setV] = useState<T>(() => readLocal(key, fallback));
  return [
    v,
    (next: T) => {
      setV(next);
      writeLocal(key, next);
    },
  ];
}

/** Скрытые «Не интересно» видео — только на этом устройстве. */
export function hiddenVideos(): Set<string> {
  return new Set(readLocal<string[]>('hidden', []));
}
export function setHidden(id: string, hidden: boolean): void {
  const s = hiddenVideos();
  if (hidden) s.add(id);
  else s.delete(id);
  writeLocal('hidden', [...s].slice(-500));
  window.dispatchEvent(new CustomEvent('sunnet:video-hidden'));
}
export function useHiddenVideos(): Set<string> {
  const [set, setSet] = useState(hiddenVideos);
  useEffect(() => {
    const on = () => setSet(hiddenVideos());
    window.addEventListener('sunnet:video-hidden', on);
    return () => window.removeEventListener('sunnet:video-hidden', on);
  }, []);
  return set;
}

// ─── Просмотры ──────────────────────────────────────────────────────────────

/**
 * Отправляет на сервер просмотр и прогресс: при старте, каждые 15 секунд
 * воспроизведения и на паузе. Возвращает отписку.
 */
export function trackViews(el: HTMLVideoElement, postId: string): () => void {
  let last = -1;
  const report = () => {
    if (!Number.isFinite(el.currentTime)) return;
    void api.post(`/posts/${postId}/view`, { progressSec: Math.floor(el.currentTime) }).catch(() => undefined);
  };
  const onTime = () => {
    if (last < 0 || Math.abs(el.currentTime - last) > 15) {
      last = el.currentTime;
      report();
    }
  };
  const onPause = () => {
    if (!el.ended) report();
  };
  const onEnded = () => {
    void api.post(`/posts/${postId}/view`, { progressSec: Math.floor(el.duration || el.currentTime) }).catch(() => undefined);
  };
  el.addEventListener('timeupdate', onTime);
  el.addEventListener('pause', onPause);
  el.addEventListener('ended', onEnded);
  return () => {
    el.removeEventListener('timeupdate', onTime);
    el.removeEventListener('pause', onPause);
    el.removeEventListener('ended', onEnded);
  };
}

// ─── Время ──────────────────────────────────────────────────────────────────

/** Текущее время, обновляемое раз в interval мс (для отсчётов). */
export function useNow(interval = 1000, active = true): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!active) return;
    const t = window.setInterval(() => setNow(Date.now()), interval);
    return () => window.clearInterval(t);
  }, [interval, active]);
  return now;
}

/** Премьера ещё впереди / идёт / нет */
export function premiereState(post: Post, now = Date.now()): 'upcoming' | 'live' | null {
  if (!post.premiereAt) return null;
  const at = Date.parse(post.premiereAt);
  const dur = (post.media[0]?.durationSec ?? 0) * 1000;
  if (now < at) return 'upcoming';
  if (now < at + dur) return 'live';
  return null;
}

/** «02:13:05» или «3 д 04:05:06» */
export function countdown(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const d = Math.floor(s / 86400);
  const hh = String(Math.floor((s % 86400) / 3600)).padStart(2, '0');
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return d ? `${d} д ${hh}:${mm}:${ss}` : `${hh}:${mm}:${ss}`;
}

/** Метка качества по высоте кадра: 1080p, 720p… */
export function qualityLabel(height: number | null | undefined): string | null {
  if (!height) return null;
  const steps = [4320, 2160, 1440, 1080, 720, 480, 360, 240, 144];
  const h = steps.find((s) => height >= s * 0.92) ?? height;
  return `${h}p`;
}

/** Длительность эфира «12:34» / «1:02:03» */
export function elapsedLabel(fromMs: number, now = Date.now()): string {
  const s = Math.max(0, Math.floor((now - fromMs) / 1000));
  const h = Math.floor(s / 3600);
  return `${h ? `${h}:` : ''}${String(Math.floor((s % 3600) / 60)).padStart(h ? 2 : 1, '0')}:${String(s % 60).padStart(2, '0')}`;
}

// ─── Позиция просмотра (продолжить с того же места) ─────────────────────────

const POS_KEY = 'positions';
const POS_LIMIT = 300;

export function readPosition(id: string): number | null {
  return readLocal<Record<string, number>>(POS_KEY, {})[id] ?? null;
}

export function savePosition(id: string, sec: number | null): void {
  const map = readLocal<Record<string, number>>(POS_KEY, {});
  delete map[id];
  if (sec !== null && sec > 0) map[id] = Math.floor(sec);
  const keys = Object.keys(map);
  for (const k of keys.slice(0, Math.max(0, keys.length - POS_LIMIT))) delete map[k];
  writeLocal(POS_KEY, map);
}

/**
 * Узкий контейнер (окно, телефон): колонки страницы встают друг под друга.
 * Возвращает ref-колбэк, флаг и сам узел (он появляется после загрузки данных).
 */
export function useCompact<T extends HTMLElement>(threshold = 1000): [(el: T | null) => void, boolean, T | null] {
  const [node, setNode] = useState<T | null>(null);
  const [compact, setCompact] = useState(false);
  useLayoutEffect(() => {
    if (!node) return;
    const measure = (w: number) => setCompact(w > 0 && w < threshold);
    measure(node.getBoundingClientRect().width);
    const ro = new ResizeObserver(([e]) => measure(e?.contentRect.width ?? 0));
    ro.observe(node);
    return () => ro.disconnect();
  }, [node, threshold]);
  return [setNode, compact, node];
}
