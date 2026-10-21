/**
 * Общие помощники Reels: звук (общий для всех роликов), «меньше движения»,
 * пул видеоэлементов и «Поделиться».
 */
import { useSyncExternalStore } from 'react';
import type { Post } from '@omni/shared';
import { useMediaQuery } from '../../shared/hooks';
import { usePrefs } from '../../shared/stores/prefs';
import { toast } from '../../shared/stores/ui';

// ─── Звук ───────────────────────────────────────────────────────────────────
// Выбор пользователя запоминается на устройстве. Отдельно — «вынужденная»
// тишина: браузер запретил автозапуск со звуком, пока человек не нажал на экран.

const MUTE_KEY = 'sunnet.reels.muted';

function readMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === '1';
  } catch {
    return false;
  }
}

interface SoundState {
  /** Пользователь сам выключил звук */
  muted: boolean;
  /** Браузер не дал включить звук без нажатия */
  forced: boolean;
}

let sound: SoundState = { muted: readMuted(), forced: false };
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function setMuted(muted: boolean): void {
  sound = { muted, forced: false };
  try {
    localStorage.setItem(MUTE_KEY, muted ? '1' : '0');
  } catch {
    /* приватный режим — просто не запоминаем */
  }
  emit();
}

/** Браузер заблокировал звук — показываем «Включить звук». */
export function forceMute(): void {
  if (sound.forced) return;
  sound = { ...sound, forced: true };
  emit();
}

export function useSound(): SoundState & { effective: boolean } {
  const s = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => sound,
  );
  return { ...s, effective: s.muted || s.forced };
}

// ─── Движение ───────────────────────────────────────────────────────────────

/** Системная настройка «уменьшить движение» или такая же настройка Sunnet. */
export function useReducedMotion(): boolean {
  const system = useMediaQuery('(prefers-reduced-motion: reduce)');
  const pref = usePrefs((s) => s.reduceMotion);
  return system || pref;
}

// ─── Пул видеоэлементов ─────────────────────────────────────────────────────
/**
 * Три постоянных <video> на всю ленту: ролик i всегда играет в элементе i % 3,
 * поэтому текущий, следующий и предыдущий ролики живут в разных элементах.
 * Следующий заранее буферизуется, а памяти хватает на любую длину ленты.
 * Ещё одна причина — iOS: разрешение играть со звуком выдаётся элементу
 * один раз при первом нажатии и дальше сохраняется.
 */
export class VideoPool {
  readonly els: HTMLVideoElement[];
  private unlocked = false;

  constructor(size = 3) {
    this.els = Array.from({ length: size }, () => {
      const v = document.createElement('video');
      v.className = 'rl-video';
      v.playsInline = true;
      v.setAttribute('playsinline', '');
      v.setAttribute('webkit-playsinline', '');
      v.setAttribute('disableremoteplayback', '');
      v.setAttribute('aria-hidden', 'true');
      v.disablePictureInPicture = true;
      v.loop = true;
      v.muted = true;
      v.preload = 'metadata';
      v.tabIndex = -1;
      return v;
    });
  }

  for(index: number): HTMLVideoElement {
    return this.els[index % this.els.length]!;
  }

  /** Вызывается в обработчике нажатия: открывает звук всем элементам пула. */
  unlock(): void {
    if (this.unlocked) return;
    this.unlocked = true;
    for (const v of this.els) {
      if (!v.paused) continue;
      const was = v.muted;
      v.muted = false;
      const p = v.play();
      v.pause();
      p?.catch(() => undefined);
      v.muted = was;
    }
  }

  destroy(): void {
    for (const v of this.els) {
      v.pause();
      v.removeAttribute('src');
      delete v.dataset.src;
      v.load();
      v.remove();
    }
  }
}

// ─── Поделиться ─────────────────────────────────────────────────────────────

export const reelUrl = (post: Post) => `${location.origin}/reels?start=${post.id}`;

/** На телефоне — системное меню «Поделиться», на компьютере — копирование ссылки. */
export async function shareReel(post: Post): Promise<void> {
  const url = reelUrl(post);
  const touch = matchMedia('(pointer: coarse)').matches;
  if (touch && typeof navigator.share === 'function') {
    try {
      await navigator.share({ title: `Reels @${post.author.username}`, url });
      return;
    } catch (e) {
      if ((e as DOMException).name === 'AbortError') return;
    }
  }
  await copyReelLink(post);
}

export async function copyReelLink(post: Post): Promise<void> {
  try {
    await navigator.clipboard.writeText(reelUrl(post));
    toast({ text: 'Ссылка на Reels скопирована', kind: 'success' });
  } catch {
    toast({ text: 'Не удалось скопировать ссылку', kind: 'error' });
  }
}

/** Длительность «0:07» для подписи при перемотке. */
export function clock(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const s = Math.floor(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
