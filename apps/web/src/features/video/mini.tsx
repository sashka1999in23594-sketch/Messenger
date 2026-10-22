/**
 * Мини-плеер: если уйти со страницы просмотра, пока видео играет, оно
 * продолжается в углу экрана (на телефоне — полоской над вкладками).
 * Тот же элемент <video> переезжает из плеера сюда и обратно, поэтому
 * воспроизведение не прерывается. В режиме окон на компьютере не нужен:
 * окно с видео можно просто уменьшить.
 */
import { useEffect, useLayoutEffect, useReducer, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { create } from 'zustand';
import { Maximize2, Pause, Play, X } from 'lucide-react';
import type { Post } from '@omni/shared';
import { trackViews } from './lib';
import './video.css';

interface MiniState {
  post: Post | null;
  el: HTMLVideoElement | null;
  go: ((path: string) => void) | null;
}

export const useMini = create<MiniState>(() => ({ post: null, el: null, go: null }));

let root: Root | null = null;
let holder: HTMLDivElement | null = null;

function ensureRoot(): HTMLDivElement {
  if (!root || !holder) {
    // Временное место для видео, пока мини-плеер не отрисовался: элемент должен
    // оставаться в документе, иначе браузер поставит его на паузу
    holder = document.createElement('div');
    holder.className = 'vmini-holder';
    document.body.appendChild(holder);
    const host = document.createElement('div');
    host.className = 'vmini-root';
    document.body.appendChild(host);
    root = createRoot(host);
    root.render(<MiniHost />);
  }
  return holder;
}

/** Передать играющее видео мини-плееру. false — видео на паузе, не нужно. */
export function handOff(post: Post, el: HTMLVideoElement, go: (path: string) => void): boolean {
  if (el.paused || el.ended || !el.getAttribute('src')) return false;
  const prev = useMini.getState().el;
  if (prev && prev !== el) stop(prev);
  ensureRoot().appendChild(el);
  useMini.setState({ post, el, go });
  return true;
}

/** Видео этого поста сейчас в мини-плеере — его можно забрать. */
export function peekMini(postId: string): HTMLVideoElement | null {
  const s = useMini.getState();
  return s.post?.id === postId ? s.el : null;
}

/** Плеер забрал элемент обратно — мини-плеер закрывается без остановки. */
export function releaseMini(el: HTMLVideoElement): void {
  if (useMini.getState().el === el) useMini.setState({ post: null, el: null, go: null });
}

export function closeMini(): void {
  const { el } = useMini.getState();
  if (el) stop(el);
  useMini.setState({ post: null, el: null, go: null });
}

function stop(el: HTMLVideoElement) {
  el.pause();
  el.removeAttribute('src');
  el.load();
  el.remove();
}

function MiniHost() {
  const { post, el, go } = useMini();
  const slot = useRef<HTMLDivElement>(null);
  const [, rerender] = useReducer((x: number) => x + 1, 0);

  useLayoutEffect(() => {
    if (el && slot.current && el.parentElement !== slot.current) slot.current.appendChild(el);
  }, [el, post]);

  useEffect(() => {
    if (!el || !post) return;
    const off = trackViews(el, post.id);
    const evs = ['play', 'pause', 'timeupdate', 'ended'] as const;
    const on = () => rerender();
    evs.forEach((e) => el.addEventListener(e, on));
    return () => {
      off();
      evs.forEach((e) => el.removeEventListener(e, on));
    };
  }, [el, post]);

  if (!post || !el) return null;
  const expand = () => go?.(`/watch/${post.id}`);
  const pct = el.duration ? (el.currentTime / el.duration) * 100 : 0;
  const paused = el.paused || el.ended;
  return (
    <div className="vmini" role="region" aria-label="Мини-плеер">
      <div className="vmini__media" onClick={expand} title="Развернуть">
        <div className="vmini__slot" ref={slot} />
        <span className="vmini__expand" aria-hidden>
          <Maximize2 size={18} />
        </span>
        <span className="vmini__progress" aria-hidden>
          <span style={{ width: `${pct}%` }} />
        </span>
      </div>
      <div className="vmini__info" onClick={expand}>
        <b className="vmini__title ellipsis">{post.title ?? post.text}</b>
        <span className="vmini__author ellipsis">{post.author.displayName}</span>
      </div>
      <button type="button" className="vmini__btn vmini__btn--play" onClick={() => (paused ? void el.play() : el.pause())} aria-label={paused ? 'Смотреть' : 'Пауза'}>
        {paused ? <Play size={20} fill="currentColor" /> : <Pause size={20} fill="currentColor" />}
      </button>
      <button type="button" className="vmini__btn vmini__btn--close" onClick={closeMini} aria-label="Закрыть мини-плеер">
        <X size={20} />
      </button>
    </div>
  );
}
