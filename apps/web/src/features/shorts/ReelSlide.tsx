/**
 * Один экран Reels: видео из общего пула, жесты (нажатие — пауза, двойное —
 * «Нравится» с сердцами, удержание — пауза без интерфейса), полоса прогресса
 * с перемоткой, подпись, звук и панель действий.
 */
import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState, type MutableRefObject, type PointerEvent as RPointerEvent } from 'react';
import { Link } from 'react-router';
import { AlertTriangle, Music2, Play, RotateCw, Volume2, VolumeX } from 'lucide-react';
import type { Post } from '@omni/shared';
import { api } from '../../shared/api/client';
import { usePrefs } from '../../shared/stores/prefs';
import { cn, timeAgo } from '../../shared/lib/format';
import { RichText, Verified } from '../../shared/ui';
import { usePostActions } from '../posts/actions';
import { ActionRail, type LikeFx } from './ActionRail';
import { HeartBurst, type Burst } from './Effects';
import { clock, forceMute, setMuted, useSound, type VideoPool } from './lib';

export type SlideStatus = 'active' | 'next' | 'prev' | 'far';

/** Управление текущим роликом с клавиатуры. */
export interface SlideControl {
  toggle: () => void;
  seek: (delta: number) => void;
  like: () => void;
  comments: () => void;
}

interface SlideProps {
  post: Post;
  index: number;
  status: SlideStatus;
  pool: VideoPool;
  /** Окно и вкладка видны — можно играть */
  visible: boolean;
  commentsOpen: boolean;
  onComments: (id: string) => void;
  onClean: (on: boolean) => void;
  control: MutableRefObject<SlideControl | null>;
}

let burstSeq = 0;
const TAP_MS = 260;
const HOLD_MS = 320;

export const ReelSlide = memo(function ReelSlide({ post, index, status, pool, visible, commentsOpen, onComments, onClean, control }: SlideProps) {
  const active = status === 'active';
  const m = post.media[0];
  const poster = m?.posterUrl ?? undefined;
  const autoplay = usePrefs((s) => s.autoplayVideo);
  const dataSaver = usePrefs((s) => s.dataSaver);
  const sound = useSound();
  const { like } = usePostActions(post);

  const stage = useRef<HTMLDivElement>(null);
  const slot = useRef<HTMLDivElement>(null);
  const [video, setVideo] = useState<HTMLVideoElement | null>(null);
  const [userPaused, setUserPaused] = useState(!autoplay);
  const [holding, setHolding] = useState(false);
  const [scrubbing, setScrubbing] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [buffering, setBuffering] = useState(false);
  const [failed, setFailed] = useState(false);
  const [wideVideo, setWideVideo] = useState(false);
  const [resumeFx, setResumeFx] = useState(0);
  const [bursts, setBursts] = useState<Burst[]>([]);
  const [likeFx, setLikeFx] = useState<LikeFx | null>(null);
  const likedRef = useRef(post.viewer.liked);
  likedRef.current = post.viewer.liked;

  // ─── Видео из пула ────────────────────────────────────────────────────────
  useLayoutEffect(() => {
    const host = slot.current;
    if (status === 'far' || !m || !host) {
      setVideo(null);
      return;
    }
    const v = pool.for(index);
    if (v.dataset.src !== m.url) {
      v.pause();
      v.muted = true;
      v.src = m.url;
      v.dataset.src = m.url;
      if (m.posterUrl) v.poster = m.posterUrl;
      else v.removeAttribute('poster');
    }
    if (v.parentElement !== host) host.appendChild(v);
    setVideo(v);
    return () => {
      if (v.parentElement === host) v.remove();
    };
  }, [status === 'far', m?.url, index, pool]); // eslint-disable-line react-hooks/exhaustive-deps

  // Следующий ролик буферизуется заранее (кроме режима экономии трафика)
  useEffect(() => {
    if (video) video.preload = active || (status === 'next' && !dataSaver) ? 'auto' : 'metadata';
  }, [video, active, status, dataSaver]);

  useEffect(() => {
    if (!video) return;
    const onMeta = () => setWideVideo(video.videoWidth > 0 && video.videoWidth / video.videoHeight > 0.8);
    const onPlaying = () => {
      setPlaying(true);
      setBuffering(false);
      setFailed(false);
    };
    const onPause = () => setPlaying(false);
    const onWaiting = () => setBuffering(true);
    const onReady = () => setBuffering(false);
    const onError = () => setFailed(true);
    if (video.readyState >= 1) onMeta();
    setPlaying(!video.paused);
    video.addEventListener('loadedmetadata', onMeta);
    video.addEventListener('playing', onPlaying);
    video.addEventListener('pause', onPause);
    video.addEventListener('waiting', onWaiting);
    video.addEventListener('canplay', onReady);
    video.addEventListener('error', onError);
    return () => {
      video.removeEventListener('loadedmetadata', onMeta);
      video.removeEventListener('playing', onPlaying);
      video.removeEventListener('pause', onPause);
      video.removeEventListener('waiting', onWaiting);
      video.removeEventListener('canplay', onReady);
      video.removeEventListener('error', onError);
    };
  }, [video]);

  // Стал текущим — снова играем (если автозапуск не выключен); ушли — сначала
  const wasActive = useRef(false);
  useEffect(() => {
    if (active) {
      setUserPaused(!autoplay);
      wasActive.current = true;
      return;
    }
    if (!wasActive.current) return;
    wasActive.current = false;
    setHolding(false);
    setScrubbing(false);
    setBursts([]);
    const v = pool.for(index);
    if (v.dataset.src === m?.url) {
      // Отметим, до какого места досмотрели (история просмотров)
      if (v.currentTime > 1) void api.post(`/posts/${post.id}/view`, { progressSec: Math.floor(v.currentTime) }).catch(() => undefined);
      v.pause();
      if (v.currentTime > 0) v.currentTime = 0;
    }
  }, [active]); // eslint-disable-line react-hooks/exhaustive-deps

  // Просмотр засчитывается, когда ролик стал текущим
  const counted = useRef(false);
  useEffect(() => {
    if (!active || counted.current) return;
    counted.current = true;
    void api.post(`/posts/${post.id}/view`, { progressSec: 0 }).catch(() => undefined);
  }, [active, post.id]);

  const shouldPlay = active && visible && !userPaused && !holding && !scrubbing && !failed;
  useEffect(() => {
    if (!video) return;
    if (!active) {
      video.muted = true;
      video.pause();
      return;
    }
    video.muted = sound.effective;
    if (!shouldPlay) {
      video.pause();
      return;
    }
    video.play()?.catch((err: DOMException) => {
      if (err.name !== 'NotAllowedError') return;
      if (!video.muted) {
        // Браузер не разрешил звук без нажатия — играем без звука и предлагаем включить
        forceMute();
        video.muted = true;
        video.play().catch(() => setUserPaused(true));
      } else setUserPaused(true);
    });
  }, [video, active, shouldPlay, sound.effective]);

  const clean = holding || scrubbing;
  useEffect(() => {
    if (active) onClean(clean);
  }, [active, clean, onClean]);

  // ─── Действия ─────────────────────────────────────────────────────────────
  const setLike = useCallback(
    (on: boolean) => {
      likedRef.current = on;
      setLikeFx({ k: Date.now(), on });
      like.mutate(on);
    },
    [like],
  );

  const toggle = useCallback(() => {
    setUserPaused((p) => {
      if (p) setResumeFx((k) => k + 1);
      return !p;
    });
  }, []);

  const heartAt = (clientX: number, clientY: number) => {
    const el = stage.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    // Окно на рабочем столе может быть масштабировано — переводим в свои пиксели
    const k = el.offsetWidth / (r.width || 1);
    const b: Burst = { id: ++burstSeq, x: (clientX - r.left) * k, y: (clientY - r.top) * k, rot: Math.random() * 36 - 18 };
    setBursts((list) => [...list.slice(-5), b]);
    setTimeout(() => setBursts((list) => list.filter((x) => x.id !== b.id)), 1100);
    if (!likedRef.current) setLike(true);
  };

  const seek = (delta: number) => {
    if (video?.duration) video.currentTime = Math.max(0, Math.min(video.duration - 0.05, video.currentTime + delta));
  };

  if (active) {
    control.current = {
      toggle,
      seek,
      like: () => {
        if (!likedRef.current) {
          const el = stage.current;
          if (el) {
            const r = el.getBoundingClientRect();
            return heartAt(r.left + r.width / 2, r.top + r.height / 2);
          }
        }
        setLike(!likedRef.current);
      },
      comments: () => onComments(post.id),
    };
  }

  // ─── Жесты ────────────────────────────────────────────────────────────────
  const gesture = useRef<{ id: number; x: number; y: number; t: number; moved: boolean; held: boolean; timer: number } | null>(null);
  const lastTap = useRef<{ t: number; x: number; y: number } | null>(null);
  const tapTimer = useRef(0);
  useEffect(() => () => clearTimeout(tapTimer.current), []);

  const onDown = (e: RPointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const g = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now(), moved: false, held: false, timer: 0 };
    // Удержание пальцем — пауза и чистый экран, пока палец на видео
    if (e.pointerType !== 'mouse' && active)
      g.timer = window.setTimeout(() => {
        g.held = true;
        setHolding(true);
      }, HOLD_MS);
    gesture.current = g;
  };
  const onMove = (e: RPointerEvent) => {
    const g = gesture.current;
    if (!g || g.id !== e.pointerId || g.moved) return;
    if (Math.hypot(e.clientX - g.x, e.clientY - g.y) > 10) {
      g.moved = true;
      if (!g.held) clearTimeout(g.timer);
    }
  };
  const onUp = (e: RPointerEvent, cancelled: boolean) => {
    const g = gesture.current;
    if (!g || g.id !== e.pointerId) return;
    gesture.current = null;
    clearTimeout(g.timer);
    if (g.held) {
      setHolding(false);
      return;
    }
    if (cancelled || g.moved || performance.now() - g.t > 450) return;
    const now = performance.now();
    const last = lastTap.current;
    if (last && now - last.t < 320 && Math.hypot(e.clientX - last.x, e.clientY - last.y) < 90) {
      // Двойное (и каждое следующее быстрое) нажатие — сердце в точке касания
      clearTimeout(tapTimer.current);
      lastTap.current = { t: now, x: e.clientX, y: e.clientY };
      heartAt(e.clientX, e.clientY);
      return;
    }
    lastTap.current = { t: now, x: e.clientX, y: e.clientY };
    clearTimeout(tapTimer.current);
    tapTimer.current = window.setTimeout(toggle, TAP_MS);
  };

  const toggleSound = () => {
    const next = !sound.effective;
    setMuted(next);
    if (video) {
      // Прямо в обработчике нажатия — так браузер разрешит звук
      video.muted = next;
      if (!next && shouldPlay) void video.play().catch(() => undefined);
    }
  };

  const retry = () => {
    setFailed(false);
    video?.load();
  };

  const showPaused = active && userPaused && !holding && !scrubbing;
  return (
    <section
      className={cn('rl-slide', active && 'is-active', clean && 'is-clean')}
      data-index={index}
      aria-roledescription="слайд"
      aria-label={`Reels @${post.author.username}`}
      inert={!active}
    >
      <div className="rl-slide__inner">
        <div className={cn('rl-stage', wideVideo && 'rl-stage--contain')} ref={stage}>
          {poster && wideVideo && <img className="rl-stage__backdrop" src={poster} alt="" aria-hidden draggable={false} />}
          {poster && <img className="rl-stage__poster" src={poster} alt="" draggable={false} loading={status === 'far' ? 'lazy' : 'eager'} decoding="async" />}
          <div className="rl-stage__slot" ref={slot} />
          <div className="rl-stage__shade" aria-hidden />
          <div
            className="rl-gesture"
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={(e) => onUp(e, false)}
            onPointerCancel={(e) => onUp(e, true)}
            onContextMenu={(e) => e.preventDefault()}
            aria-hidden
          />

          {showPaused && (
            <div className="rl-center is-in" aria-hidden>
              <Play size={40} fill="currentColor" strokeWidth={0} />
            </div>
          )}
          {!showPaused && resumeFx > 0 && (
            <div key={resumeFx} className="rl-center is-out" aria-hidden>
              <Play size={40} fill="currentColor" strokeWidth={0} />
            </div>
          )}
          {active && buffering && !userPaused && !failed && <span className="rl-spinner" role="status" aria-label="Загрузка видео" />}

          {(failed || !m) && (
            <div className="rl-failed" role="alert">
              <AlertTriangle size={26} />
              <span>Видео не воспроизводится</span>
              {m && (
                <button type="button" className="rl-pill" onClick={retry}>
                  <RotateCw size={15} /> Повторить
                </button>
              )}
            </div>
          )}

          {bursts.map((b) => (
            <HeartBurst key={b.id} burst={b} />
          ))}

          {active && (
            <div className="rl-sound-ctl">
              <button type="button" className="rl-glass-btn" onClick={toggleSound} aria-label={sound.effective ? 'Включить звук' : 'Выключить звук'} aria-pressed={!sound.effective}>
                {sound.effective ? <VolumeX size={19} /> : <Volume2 size={19} />}
              </button>
              {sound.forced && !sound.muted && (
                <button type="button" className="rl-pill rl-pill--unmute" onClick={toggleSound}>
                  Включить звук
                </button>
              )}
            </div>
          )}

          <Info post={post} active={active} />
          <Progress video={video} active={active} paused={!playing} onScrub={setScrubbing} />
        </div>

        <ActionRail
          post={post}
          near={status !== 'far'}
          playing={active && playing}
          likeFx={likeFx}
          onLike={setLike}
          onComments={() => onComments(post.id)}
          commentsOpen={commentsOpen}
        />
      </div>
    </section>
  );
});

// ─── Подпись: автор, текст с «ещё», звук бегущей строкой ────────────────────

function Info({ post, active }: { post: Post; active: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const [truncated, setTruncated] = useState(false);
  const text = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = text.current;
    if (!el || expanded) return;
    const check = () => setTruncated(el.scrollHeight > el.clientHeight + 2);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [post.text, expanded]);

  useEffect(() => {
    if (!active) setExpanded(false);
  }, [active]);

  const sound = `Оригинальный звук — ${post.author.displayName}`;
  return (
    <div className={cn('rl-info', expanded && 'is-expanded')}>
      <div className="rl-info__author">
        <Link to={`/u/${post.author.username}`} className="rl-info__name">
          {post.author.displayName}
        </Link>
        {post.author.verified && <Verified size={15} />}
        <span className="rl-info__meta">· {timeAgo(post.createdAt)}</span>
      </div>
      {post.text && (
        <div className="rl-cap">
          <div ref={text} className="rl-cap__text" onClick={() => expanded && setExpanded(false)}>
            {truncated && !expanded && (
              <button type="button" className="rl-cap__more" onClick={() => setExpanded(true)} aria-expanded={false}>
                ещё
              </button>
            )}
            <RichText text={post.text} />
          </div>
        </div>
      )}
      {expanded && (
        <button type="button" className="rl-cap__less" onClick={() => setExpanded(false)} aria-expanded>
          Свернуть
        </button>
      )}
      <div className="rl-music">
        <Music2 size={14} aria-hidden />
        <span className="sr-only">{sound}</span>
        <div className="rl-marquee" aria-hidden>
          <div className={cn('rl-marquee__track', active && 'is-running')}>
            <span>{sound}</span>
            <span>{sound}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Полоса прогресса с перемоткой ──────────────────────────────────────────

function Progress({ video, active, paused, onScrub }: { video: HTMLVideoElement | null; active: boolean; paused: boolean; onScrub: (on: boolean) => void }) {
  const bar = useRef<HTMLDivElement>(null);
  const fill = useRef<HTMLDivElement>(null);
  const head = useRef<HTMLDivElement>(null);
  const scrubbing = useRef(false);
  const [label, setLabel] = useState<string | null>(null);

  const paint = (r: number) => {
    if (fill.current) fill.current.style.transform = `scaleX(${r})`;
    if (head.current) head.current.style.transform = `translateX(${r * 100}%)`;
  };

  // Прогресс рисуется каждый кадр без перерисовки React
  useEffect(() => {
    if (!active || !video) {
      paint(0);
      return;
    }
    let raf = 0;
    const tick = () => {
      if (!scrubbing.current && video.duration) paint(video.currentTime / video.duration);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active, video]);

  const seekTo = (clientX: number, precise: boolean) => {
    const el = bar.current;
    if (!el || !video?.duration) return;
    const r = el.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - r.left) / (r.width || 1)));
    const t = ratio * video.duration;
    if (!precise && typeof video.fastSeek === 'function') video.fastSeek(t);
    else video.currentTime = t;
    paint(ratio);
    setLabel(`${clock(t)} / ${clock(video.duration)}`);
  };

  const end = () => {
    if (!scrubbing.current) return;
    scrubbing.current = false;
    setLabel(null);
    onScrub(false);
  };

  return (
    <>
      {label && (
        <div className="rl-scrub-time" aria-hidden>
          {label}
        </div>
      )}
      <div
        ref={bar}
        className={cn('rl-progress', (paused || label) && 'is-expanded', label && 'is-scrubbing')}
        role="slider"
        tabIndex={active ? 0 : -1}
        aria-label="Перемотка"
        aria-valuemin={0}
        aria-valuemax={Math.round(video?.duration || 0)}
        aria-valuenow={Math.round(video?.currentTime || 0)}
        aria-valuetext={video ? `${clock(video.currentTime)} из ${clock(video.duration)}` : undefined}
        onKeyDown={(e) => {
          if (!video?.duration || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
          e.preventDefault();
          e.stopPropagation();
          video.currentTime = Math.max(0, Math.min(video.duration, video.currentTime + (e.key === 'ArrowRight' ? 3 : -3)));
        }}
        onPointerDown={(e) => {
          if (!active || (e.pointerType === 'mouse' && e.button !== 0)) return;
          e.stopPropagation();
          e.currentTarget.setPointerCapture(e.pointerId);
          scrubbing.current = true;
          onScrub(true);
          seekTo(e.clientX, false);
        }}
        onPointerMove={(e) => scrubbing.current && seekTo(e.clientX, false)}
        onPointerUp={(e) => {
          if (scrubbing.current) seekTo(e.clientX, true);
          end();
        }}
        onPointerCancel={end}
      >
        <div className="rl-progress__track">
          <div className="rl-progress__fill" ref={fill} />
        </div>
        <div className="rl-progress__head" ref={head}>
          <span />
        </div>
      </div>
    </>
  );
}
