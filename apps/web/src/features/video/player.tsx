/**
 * Плеер Sunnet: свои элементы управления как у больших видеохостингов —
 * полоса перемотки с буфером, подсказкой времени и главами, громкость,
 * скорость, качество, кинорежим, полный экран, «картинка в картинке»,
 * горячие клавиши, двойное касание для перемотки, запоминание позиции,
 * громкости и скорости, атмосферная подсветка и Media Session.
 *
 * Работает с файлом (видео, премьера) и с потоком MediaStream (эфир).
 * Элемент <video> создаётся вручную, а не React-ом, — так его можно отдать
 * мини-плееру и забрать обратно без остановки воспроизведения.
 */
import { useCallback, useEffect, useLayoutEffect, useReducer, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Gauge,
  Keyboard,
  Maximize,
  Minimize,
  Pause,
  PictureInPicture2,
  Play,
  RectangleHorizontal,
  Repeat,
  RotateCcw,
  Settings,
  SkipForward,
  SlidersHorizontal,
  Sparkles,
  Volume1,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { cn, duration } from '../../shared/lib/format';
import { chapterAt, readLocal, readPosition, savePosition, useLocal, writeLocal, type Chapter } from './lib';

export type PlayerMode = 'vod' | 'premiere' | 'live';

export interface PlayerProps {
  /** По нему запоминается позиция просмотра (обычно id видео) */
  storageKey?: string;
  src?: string | null;
  stream?: MediaStream | null;
  poster?: string | null;
  mode?: PlayerMode;
  /** Премьера: докуда «идёт показ», сек — дальше перематывать нельзя */
  liveEdge?: number;
  title?: string;
  artist?: string;
  chapters?: Chapter[];
  /** Метка качества (720p), если известна высота кадра */
  quality?: string | null;
  /** Начать с секунды (ссылка с таймкодом, синхронная премьера) */
  startAt?: number | null;
  autoPlay?: boolean;
  theater?: boolean;
  onTheater?: (() => void) | null;
  onNext?: (() => void) | null;
  nextTitle?: string;
  onEnded?: () => void;
  /** Доступ к элементу <video> снаружи: учёт просмотров, синхронизация */
  onElement?: (el: HTMLVideoElement | null) => void;
  /** Уже играющий элемент (из мини-плеера) — продолжаем без паузы */
  adopt?: HTMLVideoElement | null;
  /** Плеер уходит со страницы: true — элемент забрали (мини-плеер) */
  onRelease?: (el: HTMLVideoElement) => boolean;
  /** Плашки в левом верхнем углу: «В эфире», «Премьера» */
  badges?: ReactNode;
  /** Слой поверх видео: «Далее через 5 с», заставки эфира */
  overlay?: ReactNode;
  /** Атмосферная подсветка вокруг плеера */
  ambient?: boolean;
  className?: string;
}

const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
const speedLabel = (s: number) => (s === 1 ? 'Обычная' : String(s).replace('.', ','));

function createVideo(): HTMLVideoElement {
  const v = document.createElement('video');
  v.playsInline = true;
  v.setAttribute('playsinline', '');
  v.preload = 'metadata';
  v.className = 'vp__video';
  return v;
}

/** Последний плеер, с которым взаимодействовали, — ему достаются горячие клавиши. */
let activePlayer: symbol | null = null;

type Bezel = { icon: ReactNode; text?: string; n: number };

export function Player(p: PlayerProps) {
  const mode = p.mode ?? 'vod';
  const live = mode === 'live';
  const premiere = mode === 'premiere';
  const box = useRef<HTMLDivElement>(null);
  const slot = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  const ambA = useRef<HTMLCanvasElement>(null);
  const ambB = useRef<HTMLCanvasElement>(null);
  const [el] = useState(() => p.adopt ?? createVideo());
  const adopted = useRef(!!p.adopt);
  const id = useRef(Symbol('player'));
  const props = useRef(p);
  props.current = p;
  const alive = useRef(false);
  const [, rerender] = useReducer((x: number) => x + 1, 0);

  const [active, setActive] = useState(true);
  const [menu, setMenu] = useState<null | 'main' | 'speed'>(null);
  const [help, setHelp] = useState(false);
  const [hover, setHover] = useState<{ t: number; x: number } | null>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const dragRef = useRef<number | null>(null);
  const [bezel, setBezel] = useState<Bezel | null>(null);
  const [ripple, setRipple] = useState<{ side: 'l' | 'r'; sec: number; n: number } | null>(null);
  const [fs, setFs] = useState(false);
  const [pip, setPip] = useState(false);
  const [buffering, setBuffering] = useState(false);
  const [started, setStarted] = useState(!!p.adopt);
  const [needUnmute, setNeedUnmute] = useState(false);
  const [resumed, setResumed] = useState<number | null>(null);
  const [ambientOn, setAmbientOn] = useLocal('ambient', true);
  const [loop, setLoop] = useState(false);
  const [failed, setFailed] = useState(false);
  const hideTimer = useRef(0);
  const menuRef = useRef(menu);
  menuRef.current = menu;

  // ─── Элемент: вставка, источник, события ─────────────────────────────────

  useLayoutEffect(() => {
    slot.current?.appendChild(el);
    props.current.onElement?.(el);
    alive.current = true;
    return () => {
      alive.current = false;
      props.current.onElement?.(null);
      if (props.current.storageKey && mode === 'vod' && !el.ended && el.currentTime > 0) savePosition(props.current.storageKey, el.currentTime);
      // Уход со страницы: пока элемент ещё в документе, его может забрать мини-плеер
      if (props.current.onRelease?.(el)) return;
      // StrictMode монтирует повторно — гасим видео, только если плеер действительно ушёл
      window.setTimeout(() => {
        if (alive.current || el.isConnected) return;
        el.pause();
        el.removeAttribute('src');
        el.srcObject = null;
        el.load();
      }, 0);
    };
  }, [el]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (p.stream !== undefined) {
      if (el.srcObject !== p.stream) el.srcObject = p.stream;
    } else if (p.src && el.getAttribute('src') !== p.src) {
      el.src = p.src;
      setFailed(false);
    }
  }, [el, p.src, p.stream]);

  useEffect(() => {
    if (p.poster) el.poster = p.poster;
    else el.removeAttribute('poster');
  }, [el, p.poster]);

  useEffect(() => {
    el.loop = loop;
  }, [el, loop]);

  // Громкость и скорость — общие для всех видео
  useEffect(() => {
    if (adopted.current) return;
    const v = readLocal<{ volume: number; muted: boolean }>('volume', { volume: 1, muted: false });
    el.volume = Math.min(1, Math.max(0, v.volume));
    el.muted = v.muted;
    if (mode === 'vod') el.playbackRate = readLocal('speed', 1);
  }, [el, mode]);

  useEffect(() => {
    const on = () => rerender();
    const onWaiting = () => setBuffering(true);
    const onReady = () => setBuffering(false);
    const onPlay = () => {
      setStarted(true);
      setFailed(false);
    };
    const onVolume = () => {
      writeLocal('volume', { volume: el.volume, muted: el.muted });
      if (!el.muted) setNeedUnmute(false);
      rerender();
    };
    const onRate = () => {
      if (mode === 'vod') writeLocal('speed', el.playbackRate);
      rerender();
    };
    const onEnded = () => {
      if (props.current.storageKey) savePosition(props.current.storageKey, null);
      setActive(true);
      props.current.onEnded?.();
      rerender();
    };
    const onError = () => {
      if (el.error && el.getAttribute('src')) setFailed(true);
    };
    const onPipIn = () => setPip(true);
    const onPipOut = () => setPip(false);
    let lastSave = 0;
    const onTime = () => {
      const key = props.current.storageKey;
      if (key && mode === 'vod' && Math.abs(el.currentTime - lastSave) > 5) {
        lastSave = el.currentTime;
        savePosition(key, el.currentTime);
      }
      rerender();
    };
    const evs = ['play', 'pause', 'durationchange', 'loadedmetadata', 'progress', 'seeking', 'seeked', 'emptied'] as const;
    evs.forEach((e) => el.addEventListener(e, on));
    el.addEventListener('timeupdate', onTime);
    el.addEventListener('waiting', onWaiting);
    ['playing', 'canplay', 'pause', 'seeked'].forEach((e) => el.addEventListener(e, onReady));
    el.addEventListener('play', onPlay);
    el.addEventListener('volumechange', onVolume);
    el.addEventListener('ratechange', onRate);
    el.addEventListener('ended', onEnded);
    el.addEventListener('error', onError);
    el.addEventListener('enterpictureinpicture', onPipIn);
    el.addEventListener('leavepictureinpicture', onPipOut);
    return () => {
      evs.forEach((e) => el.removeEventListener(e, on));
      el.removeEventListener('timeupdate', onTime);
      el.removeEventListener('waiting', onWaiting);
      ['playing', 'canplay', 'pause', 'seeked'].forEach((e) => el.removeEventListener(e, onReady));
      el.removeEventListener('play', onPlay);
      el.removeEventListener('volumechange', onVolume);
      el.removeEventListener('ratechange', onRate);
      el.removeEventListener('ended', onEnded);
      el.removeEventListener('error', onError);
      el.removeEventListener('enterpictureinpicture', onPipIn);
      el.removeEventListener('leavepictureinpicture', onPipOut);
    };
  }, [el, mode]);

  // Плавная полоса: позиция — CSS-переменная, без лишних перерисовок React
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      box.current?.style.setProperty('--vp-t', String(dragRef.current ?? (el.currentTime || 0)));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [el]);

  // Старт: с таймкода, с сохранённого места или с начала; автозапуск
  useEffect(() => {
    const startMode = props.current.mode ?? 'vod';
    if (adopted.current || startMode === 'live') return;
    const apply = () => {
      let t = props.current.startAt ?? null;
      const key = props.current.storageKey;
      if (t === null && key && startMode === 'vod') {
        const saved = readPosition(key);
        if (saved && saved > 5 && (!el.duration || saved < el.duration - 8)) {
          t = saved;
          setResumed(saved);
        }
      }
      if (t && Number.isFinite(t)) el.currentTime = t;
    };
    if (el.readyState >= 1) apply();
    else el.addEventListener('loadedmetadata', apply, { once: true });
    return () => el.removeEventListener('loadedmetadata', apply);
  }, [el]);

  useEffect(() => {
    if (!resumed) return;
    const t = window.setTimeout(() => setResumed(null), 7000);
    return () => window.clearTimeout(t);
  }, [resumed]);

  useEffect(() => {
    if (!p.autoPlay || adopted.current) return;
    if (!p.src && !p.stream) return;
    el.play().catch((err: unknown) => {
      // Браузер не дал включить звук без касания — играем без звука и предлагаем включить
      if ((err as DOMException)?.name === 'NotAllowedError' && !el.muted) {
        el.muted = true;
        setNeedUnmute(true);
        void el.play().catch(() => undefined);
      }
    });
  }, [el, p.autoPlay, p.src, p.stream]);

  // Премьера: дальше «эфира» перемотать нельзя
  useEffect(() => {
    if (!premiere) return;
    const clampToEdge = () => {
      const edge = props.current.liveEdge;
      if (edge !== undefined && el.currentTime > edge + 2) el.currentTime = edge;
    };
    el.addEventListener('seeking', clampToEdge);
    return () => el.removeEventListener('seeking', clampToEdge);
  }, [el, premiere]);

  // Полный экран и «картинка в картинке»
  useEffect(() => {
    const on = () => setFs(!!box.current && document.fullscreenElement === box.current);
    document.addEventListener('fullscreenchange', on);
    return () => document.removeEventListener('fullscreenchange', on);
  }, []);

  // Media Session: название и кнопки на экране блокировки и в шторке
  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    const ms = navigator.mediaSession;
    const set = (action: MediaSessionAction, fn: MediaSessionActionHandler | null) => {
      try {
        ms.setActionHandler(action, fn);
      } catch {
        /* действие не поддерживается */
      }
    };
    const onPlay = () => {
      try {
        ms.metadata = new MediaMetadata({
          title: props.current.title ?? '',
          artist: props.current.artist ?? 'Sunnet',
          artwork: props.current.poster ? [{ src: new URL(props.current.poster, location.href).href }] : [],
        });
      } catch {
        /* старый браузер */
      }
      set('play', () => void el.play());
      set('pause', () => el.pause());
      if (!live) {
        set('seekbackward', () => (el.currentTime = Math.max(0, el.currentTime - 10)));
        set('seekforward', () => (el.currentTime = Math.min(el.duration || 0, el.currentTime + 10)));
      }
      set('nexttrack', props.current.onNext ? () => props.current.onNext?.() : null);
    };
    el.addEventListener('play', onPlay);
    return () => el.removeEventListener('play', onPlay);
  }, [el, live]);

  // Атмосферная подсветка: уменьшенный кадр, размытый за плеером, со сменой раз в секунду
  const ambientActive = !!p.ambient && ambientOn && !live && !fs;
  useEffect(() => {
    if (!ambientActive) return;
    const canvases = [ambA.current, ambB.current];
    let i = 0;
    const draw = () => {
      const c = canvases[i];
      if (!c || el.readyState < 2) return;
      try {
        c.getContext('2d')?.drawImage(el, 0, 0, c.width, c.height);
      } catch {
        return;
      }
      c.classList.add('vp-ambient--on');
      canvases[1 - i]?.classList.remove('vp-ambient--on');
      i = 1 - i;
    };
    draw();
    const t = window.setInterval(() => !el.paused && draw(), 1100);
    el.addEventListener('seeked', draw);
    el.addEventListener('loadeddata', draw);
    return () => {
      window.clearInterval(t);
      el.removeEventListener('seeked', draw);
      el.removeEventListener('loadeddata', draw);
    };
  }, [el, ambientActive]);

  // ─── Действия ────────────────────────────────────────────────────────────

  const dur = Number.isFinite(el.duration) ? el.duration : 0;
  const edge = premiere ? Math.min(dur || Infinity, p.liveEdge ?? dur) : dur;

  const flash = useCallback((icon: ReactNode, text?: string) => setBezel((b) => ({ icon, text, n: (b?.n ?? 0) + 1 })), []);

  const poke = useCallback(() => {
    setActive(true);
    window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => {
      if (!el.paused && !menuRef.current && dragRef.current === null) setActive(false);
    }, 2800);
  }, [el]);

  useEffect(() => () => window.clearTimeout(hideTimer.current), []);

  const play = useCallback(() => {
    if (el.ended && !live) el.currentTime = 0;
    void el.play().catch(() => undefined);
  }, [el, live]);

  const toggle = useCallback(() => {
    if (el.paused || el.ended) {
      play();
      flash(<Play size={30} fill="currentColor" />);
    } else {
      el.pause();
      flash(<Pause size={30} fill="currentColor" />);
    }
    poke();
  }, [el, play, flash, poke]);

  const seek = useCallback(
    (t: number) => {
      if (live) return;
      const max = premiere ? edge : el.duration || 0;
      el.currentTime = Math.max(0, Math.min(Number.isFinite(max) ? max : 0, t));
    },
    [el, live, premiere, edge],
  );

  const seekBy = useCallback(
    (d: number) => {
      seek(el.currentTime + d);
      poke();
    },
    [el, seek, poke],
  );

  const setVolume = useCallback(
    (v: number) => {
      el.volume = Math.max(0, Math.min(1, v));
      el.muted = el.volume === 0;
    },
    [el],
  );

  const toggleMute = useCallback(() => {
    if (el.muted && el.volume === 0) el.volume = 0.5;
    el.muted = !el.muted;
    flash(el.muted ? <VolumeX size={30} /> : <Volume2 size={30} />);
  }, [el, flash]);

  const toggleFs = useCallback(() => {
    const node = box.current;
    if (!node) return;
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => undefined);
      return;
    }
    if (node.requestFullscreen) {
      node
        .requestFullscreen()
        .then(() => {
          // На телефоне горизонтальное видео — в горизонтальную ориентацию
          const o = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
          if (el.videoWidth > el.videoHeight) void o.lock?.('landscape').catch(() => undefined);
        })
        .catch(() => undefined);
    } else {
      (el as HTMLVideoElement & { webkitEnterFullscreen?: () => void }).webkitEnterFullscreen?.();
    }
  }, [el]);

  const pipSupported = typeof document !== 'undefined' && 'pictureInPictureEnabled' in document && document.pictureInPictureEnabled;
  const togglePip = useCallback(() => {
    if (document.pictureInPictureElement === el) void document.exitPictureInPicture().catch(() => undefined);
    else void el.requestPictureInPicture?.().catch(() => undefined);
  }, [el]);

  const setSpeed = useCallback(
    (s: number) => {
      el.playbackRate = s;
      flash(<Gauge size={26} />, `${String(s).replace('.', ',')}×`);
    },
    [el, flash],
  );

  // ─── Горячие клавиши ─────────────────────────────────────────────────────

  useEffect(() => {
    activePlayer = id.current;
    const mine = id.current;
    const onKey = (e: KeyboardEvent) => {
      if (activePlayer !== mine || e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
      const node = box.current;
      if (!node || !node.isConnected || node.offsetParent === null) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable="true"], .modal, .menu')) return;
      const inside = !!target && node.contains(target);
      if ((e.key === ' ' || e.key === 'Enter') && target?.closest('button, a, [role="slider"]')) return;
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      const handled = () => {
        e.preventDefault();
        poke();
      };
      switch (k) {
        case ' ':
        case 'k':
        case 'л':
          handled();
          toggle();
          break;
        case 'j':
        case 'о':
          if (live) return;
          handled();
          seekBy(-10);
          flash(<RotateCcw size={26} />, '−10 с');
          break;
        case 'l':
        case 'д':
          if (live) return;
          handled();
          seekBy(10);
          flash(<RotateCcw size={26} style={{ transform: 'scaleX(-1)' }} />, '+10 с');
          break;
        case 'ArrowLeft':
          if (live) return;
          handled();
          seekBy(-5);
          flash(<ChevronLeft size={30} />, '−5 с');
          break;
        case 'ArrowRight':
          if (live) return;
          handled();
          seekBy(5);
          flash(<ChevronRight size={30} />, '+5 с');
          break;
        case 'ArrowUp':
        case 'ArrowDown': {
          if (!inside) return;
          handled();
          setVolume(el.volume + (k === 'ArrowUp' ? 0.05 : -0.05));
          if (el.muted && k === 'ArrowUp') el.muted = false;
          flash(<Volume2 size={28} />, `${Math.round(el.volume * 100)}%`);
          break;
        }
        case 'm':
        case 'ь':
          handled();
          toggleMute();
          break;
        case 'f':
        case 'а':
          handled();
          toggleFs();
          break;
        case 't':
        case 'е':
          if (!props.current.onTheater || fs) return;
          handled();
          props.current.onTheater();
          break;
        case 'i':
        case 'ш':
          if (!pipSupported) return;
          handled();
          togglePip();
          break;
        case 'Home':
          if (live || !inside) return;
          handled();
          seek(0);
          break;
        case 'End':
          if (live || !inside) return;
          handled();
          seek(premiere ? edge : el.duration);
          break;
        case '>':
        case '<': {
          if (mode !== 'vod') return;
          handled();
          const i = SPEEDS.indexOf(el.playbackRate);
          const next = SPEEDS[Math.max(0, Math.min(SPEEDS.length - 1, (i < 0 ? 3 : i) + (k === '>' ? 1 : -1)))]!;
          setSpeed(next);
          break;
        }
        case ',':
        case '.':
          if (live || !el.paused) return;
          handled();
          seek(el.currentTime + (k === '.' ? 1 / 30 : -1 / 30));
          break;
        case 'N':
          if (!e.shiftKey || !props.current.onNext) return;
          handled();
          props.current.onNext();
          break;
        case '?':
          handled();
          setHelp((h) => !h);
          break;
        case 'Escape':
          if (menuRef.current || help) {
            e.preventDefault();
            setMenu(null);
            setHelp(false);
          }
          break;
        default:
          if (/^[0-9]$/.test(k) && !live && (el.duration || 0) > 0) {
            handled();
            seek(((premiere ? edge : el.duration) * Number(k)) / 10);
          }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      if (activePlayer === mine) activePlayer = null;
    };
  }, [el, live, mode, premiere, edge, fs, help, pipSupported, toggle, seekBy, seek, setVolume, toggleMute, toggleFs, togglePip, setSpeed, flash, poke]);

  // ─── Полоса перемотки ────────────────────────────────────────────────────

  const timeAt = (clientX: number) => {
    const r = bar.current!.getBoundingClientRect();
    const f = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
    return { t: f * (dur || 0), x: clientX - r.left, w: r.width };
  };

  const chapters = p.chapters ?? [];
  const segments = chapters.length ? chapters.map((c, i) => ({ s: c.start, e: chapters[i + 1]?.start ?? dur, title: c.title })) : [{ s: 0, e: dur, title: '' }];
  let bufEnd = 0;
  for (let i = 0; i < el.buffered.length; i++) if (el.buffered.start(i) <= el.currentTime + 1) bufEnd = Math.max(bufEnd, el.buffered.end(i));
  const shown = drag ?? el.currentTime;
  const current = chapterAt(chapters, shown);
  const hoverChapter = hover ? chapterAt(chapters, hover.t) : null;
  const atEdge = premiere && edge - el.currentTime < 6;

  const tipLeft = (x: number, w: number) => Math.max(44, Math.min(w - 44, x));
  const barWidth = bar.current?.getBoundingClientRect().width ?? 0;

  const paused = el.paused || el.ended;
  const idle = !active && !paused && !menu && !help;
  const vol = el.muted ? 0 : el.volume;
  const VolumeIcon = vol === 0 ? VolumeX : vol < 0.5 ? Volume1 : Volume2;

  // ─── Касания: двойное — перемотка, одиночное — показать/скрыть панель ─────

  const lastTap = useRef(0);
  const onSurfaceUp = (e: React.PointerEvent) => {
    activePlayer = id.current;
    if (menu) {
      setMenu(null);
      return;
    }
    if (e.pointerType === 'mouse') {
      if (e.button === 0) toggle();
      return;
    }
    const r = box.current!.getBoundingClientRect();
    const rel = (e.clientX - r.left) / r.width;
    const now = Date.now();
    if (!live && now - lastTap.current < 320 && (rel < 0.38 || rel > 0.62)) {
      const side = rel < 0.5 ? 'l' : 'r';
      seekBy(side === 'l' ? -10 : 10);
      setRipple((x) => ({ side, sec: x && x.side === side && now - lastTap.current < 700 ? x.sec + 10 : 10, n: (x?.n ?? 0) + 1 }));
      lastTap.current = now;
      return;
    }
    lastTap.current = now;
    if (active && !paused) {
      setActive(false);
      window.clearTimeout(hideTimer.current);
    } else poke();
  };

  useEffect(() => {
    if (!ripple) return;
    const t = window.setTimeout(() => setRipple(null), 650);
    return () => window.clearTimeout(t);
  }, [ripple]);

  const style = { '--vp-d': String(dur || 1), '--vp-edge': String(edge || 0) } as CSSProperties;

  return (
    <div className={cn('vp-shell', p.className)}>
      {ambientActive && (
        <div className="vp-ambient" aria-hidden>
          {p.poster && <div className="vp-ambient__poster" style={{ backgroundImage: `url("${p.poster}")` }} />}
          <canvas ref={ambA} width={48} height={27} />
          <canvas ref={ambB} width={48} height={27} />
        </div>
      )}
      <div
        ref={box}
        className={cn('vp', idle && 'vp--idle', paused && 'vp--paused', fs && 'vp--fs', live && 'vp--live', !started && 'vp--fresh')}
        style={style}
        tabIndex={-1}
        onPointerDown={() => (activePlayer = id.current)}
        onPointerMove={(e) => e.pointerType === 'mouse' && poke()}
        onPointerLeave={(e) => {
          if (e.pointerType === 'mouse' && !paused && !menu) setActive(false);
        }}
        onDoubleClick={(e) => {
          if ((e.target as HTMLElement).closest('.vp__surface')) toggleFs();
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          setMenu('main');
          poke();
        }}
      >
        <div className="vp__slot" ref={slot} />
        <div className="vp__surface" onPointerUp={onSurfaceUp} aria-hidden />
        <div className="vp__shade vp__shade--top" aria-hidden />
        <div className="vp__shade vp__shade--bottom" aria-hidden />

        {fs && p.title && <div className="vp__fs-title ellipsis">{p.title}</div>}
        {p.badges && <div className="vp__badges">{p.badges}</div>}

        {needUnmute && (
          <button type="button" className="vp__unmute" onClick={() => ((el.muted = false), setNeedUnmute(false))}>
            <VolumeX size={18} /> Включить звук
          </button>
        )}
        {resumed !== null && !needUnmute && (
          <div className="vp__resumed">
            Продолжаем с {duration(resumed)}
            <button
              type="button"
              onClick={() => {
                seek(0);
                setResumed(null);
              }}
            >
              С начала
            </button>
          </div>
        )}

        {bezel && (
          <div key={bezel.n} className="vp__bezel" onAnimationEnd={() => setBezel(null)} aria-hidden>
            <span className="vp__bezel-icon">{bezel.icon}</span>
            {bezel.text && <span className="vp__bezel-text">{bezel.text}</span>}
          </div>
        )}
        {ripple && (
          <div key={ripple.n} className={cn('vp__ripple', `vp__ripple--${ripple.side}`)} aria-hidden>
            <span>{ripple.side === 'l' ? '«' : '»'}</span>
            {ripple.sec} с
          </div>
        )}
        {buffering && !paused && <span className="vp__spinner" aria-label="Загрузка" />}
        {failed && (
          <div className="vp__error">
            <b>Не удалось воспроизвести видео</b>
            <span>Проверьте подключение и попробуйте ещё раз</span>
            <button
              type="button"
              className="vp__pill"
              onClick={() => {
                setFailed(false);
                el.load();
                play();
              }}
            >
              <RotateCcw size={16} /> Повторить
            </button>
          </div>
        )}

        {!p.overlay && !failed && (
          <div className="vp__center" aria-hidden={!paused && !active}>
            {!live && (
              <button type="button" className="vp__center-btn vp__center-btn--sm" onClick={() => seekBy(-10)} aria-label="Назад на 10 секунд">
                <RotateCcw size={22} />
              </button>
            )}
            <button type="button" className="vp__center-btn" onClick={toggle} aria-label={paused ? 'Смотреть' : 'Пауза'}>
              {el.ended ? <RotateCcw size={30} /> : paused ? <Play size={30} fill="currentColor" /> : <Pause size={30} fill="currentColor" />}
            </button>
            {!live && (
              <button type="button" className="vp__center-btn vp__center-btn--sm" onClick={() => seekBy(10)} aria-label="Вперёд на 10 секунд">
                <RotateCcw size={22} style={{ transform: 'scaleX(-1)' }} />
              </button>
            )}
          </div>
        )}
        {p.overlay}

        <div className="vp__controls" onPointerDown={() => poke()}>
          {!live && (
            <div
              ref={bar}
              className={cn('vp-bar', drag !== null && 'vp-bar--drag', premiere && 'vp-bar--premiere')}
              role="slider"
              tabIndex={0}
              aria-label="Перемотка"
              aria-valuemin={0}
              aria-valuemax={Math.round(dur)}
              aria-valuenow={Math.round(shown)}
              aria-valuetext={`${duration(shown)} из ${duration(dur)}`}
              onKeyDown={(e) => {
                if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                  e.preventDefault();
                  e.stopPropagation();
                  seekBy(e.key === 'ArrowLeft' ? -5 : 5);
                }
              }}
              onPointerDown={(e) => {
                if (!dur) return;
                e.currentTarget.setPointerCapture(e.pointerId);
                const { t } = timeAt(e.clientX);
                const clamped = premiere ? Math.min(t, edge) : t;
                dragRef.current = clamped;
                setDrag(clamped);
              }}
              onPointerMove={(e) => {
                if (!dur) return;
                const { t, x } = timeAt(e.clientX);
                setHover({ t, x });
                if (dragRef.current !== null) {
                  const clamped = premiere ? Math.min(t, edge) : t;
                  dragRef.current = clamped;
                  setDrag(clamped);
                }
              }}
              onPointerLeave={() => dragRef.current === null && setHover(null)}
              onPointerUp={(e) => {
                if (dragRef.current !== null) seek(dragRef.current);
                dragRef.current = null;
                setDrag(null);
                if (e.pointerType !== 'mouse') setHover(null);
              }}
              onPointerCancel={() => {
                dragRef.current = null;
                setDrag(null);
                setHover(null);
              }}
            >
              <div className="vp-bar__track">
                {segments.map((s) => {
                  const len = Math.max(0.001, s.e - s.s);
                  const buf = Math.max(0, Math.min(1, (bufEnd - s.s) / len));
                  const hov = hover ? Math.max(0, Math.min(1, (hover.t - s.s) / len)) : 0;
                  const hoverOn = hover && hover.t >= s.s && hover.t < s.e;
                  return (
                    <div key={s.s} className={cn('vp-seg', hoverOn && chapters.length > 0 && 'vp-seg--hover')} style={{ flexGrow: len, '--s': s.s, '--l': len } as CSSProperties}>
                      <span className="vp-seg__buf" style={{ width: `${buf * 100}%` }} />
                      {hover && <span className="vp-seg__hov" style={{ width: `${hov * 100}%` }} />}
                      <span className="vp-seg__play" />
                    </div>
                  );
                })}
                {premiere && dur > 0 && edge < dur && <span className="vp-bar__future" style={{ left: `${(edge / dur) * 100}%` }} />}
              </div>
              <span className="vp-bar__thumb" />
              {hover && dur > 0 && (
                <span className="vp-bar__tip" style={{ left: tipLeft(hover.x, barWidth) }}>
                  {hoverChapter && <span className="vp-bar__tip-chapter ellipsis">{hoverChapter.title}</span>}
                  <b>{duration(premiere ? Math.min(hover.t, edge) : hover.t)}</b>
                </span>
              )}
            </div>
          )}
          <div className="vp__row">
            <button type="button" className="vp-btn" onClick={toggle} data-tip={paused ? 'Смотреть (k)' : 'Пауза (k)'} aria-label={paused ? 'Смотреть' : 'Пауза'}>
              {el.ended ? <RotateCcw size={22} /> : paused ? <Play size={22} fill="currentColor" /> : <Pause size={22} fill="currentColor" />}
            </button>
            {p.onNext && (
              <button type="button" className="vp-btn vp-btn--next" onClick={p.onNext} data-tip={p.nextTitle ? `Далее: ${p.nextTitle}` : 'Следующее (Shift+N)'} aria-label="Следующее видео">
                <SkipForward size={21} fill="currentColor" />
              </button>
            )}
            <div className="vp-vol">
              <button type="button" className="vp-btn" onClick={toggleMute} data-tip={el.muted ? 'Включить звук (m)' : 'Без звука (m)'} aria-label={el.muted ? 'Включить звук' : 'Выключить звук'}>
                <VolumeIcon size={22} />
              </button>
              <input
                className="vp-vol__range"
                type="range"
                min={0}
                max={1}
                step={0.02}
                value={vol}
                onChange={(e) => setVolume(Number(e.target.value))}
                aria-label="Громкость"
                style={{ '--v': vol } as CSSProperties}
              />
            </div>
            {live ? (
              <span className="vp__time vp__time--live">
                <span className="vp__dot" /> В ЭФИРЕ
              </span>
            ) : (
              <span className="vp__time">
                {duration(shown)} <span className="vp__time-sep">/</span> {duration(dur)}
              </span>
            )}
            {premiere && (
              <button type="button" className={cn('vp__edge', atEdge && 'vp__edge--on')} onClick={() => seek(edge)} data-tip="К общему показу">
                <span className="vp__dot" /> ПРЕМЬЕРА
              </button>
            )}
            {current && !live && (
              <span className="vp__chapter ellipsis">
                <span className="vp__chapter-dot">•</span> {current.title}
              </span>
            )}
            <span className="vp__grow" />
            {(mode === 'vod' || p.ambient || p.quality) && (
              <button
                type="button"
                className={cn('vp-btn vp-btn--gear', menu && 'vp-btn--on')}
                onClick={() => setMenu(menu ? null : 'main')}
                data-tip="Настройки"
                aria-label="Настройки"
                aria-expanded={!!menu}
              >
                <Settings size={21} />
                {p.quality && Number.parseInt(p.quality) >= 720 && <span className="vp-btn__hd">HD</span>}
              </button>
            )}
            {pipSupported && (
              <button type="button" className={cn('vp-btn vp-btn--pip', pip && 'vp-btn--on')} onClick={togglePip} data-tip="Картинка в картинке (i)" aria-label="Картинка в картинке">
                <PictureInPicture2 size={20} />
              </button>
            )}
            {p.onTheater && !fs && (
              <button type="button" className="vp-btn vp-btn--theater" onClick={p.onTheater} data-tip={p.theater ? 'Обычный режим (t)' : 'Кинорежим (t)'} aria-label="Кинорежим">
                <RectangleHorizontal size={22} strokeWidth={p.theater ? 2.6 : 2} />
              </button>
            )}
            <button type="button" className="vp-btn" onClick={toggleFs} data-tip={fs ? 'Выйти из полноэкранного режима (f)' : 'Во весь экран (f)'} aria-label="Во весь экран">
              {fs ? <Minimize size={21} /> : <Maximize size={21} />}
            </button>
          </div>
        </div>

        {menu && (
          <div className="vp-menu" role="menu" onPointerDown={(e) => e.stopPropagation()}>
            {menu === 'main' ? (
              <>
                {p.ambient && !live && (
                  <button type="button" className="vp-menu__item" role="menuitemcheckbox" aria-checked={ambientOn} onClick={() => setAmbientOn(!ambientOn)}>
                    <Sparkles size={18} /> <span className="vp__grow">Атмосферная подсветка</span>
                    <span className={cn('vp-switch', ambientOn && 'vp-switch--on')} />
                  </button>
                )}
                {mode === 'vod' && (
                  <button type="button" className="vp-menu__item" role="menuitemcheckbox" aria-checked={loop} onClick={() => setLoop(!loop)}>
                    <Repeat size={18} /> <span className="vp__grow">Повтор</span>
                    <span className={cn('vp-switch', loop && 'vp-switch--on')} />
                  </button>
                )}
                {mode === 'vod' && (
                  <button type="button" className="vp-menu__item" role="menuitem" onClick={() => setMenu('speed')}>
                    <Gauge size={18} /> <span className="vp__grow">Скорость</span>
                    <span className="vp-menu__value">{speedLabel(el.playbackRate)}</span>
                    <ChevronRight size={16} />
                  </button>
                )}
                <div className="vp-menu__item vp-menu__item--static">
                  <SlidersHorizontal size={18} /> <span className="vp__grow">Качество</span>
                  <span className="vp-menu__value">{live ? 'Авто' : (p.quality ?? (el.videoHeight ? `${el.videoHeight}p` : 'Авто'))}</span>
                </div>
                <button
                  type="button"
                  className="vp-menu__item"
                  role="menuitem"
                  onClick={() => {
                    setMenu(null);
                    setHelp(true);
                  }}
                >
                  <Keyboard size={18} /> <span className="vp__grow">Горячие клавиши</span>
                  <span className="vp-menu__value">?</span>
                </button>
              </>
            ) : (
              <>
                <button type="button" className="vp-menu__head" onClick={() => setMenu('main')}>
                  <ChevronLeft size={18} /> Скорость воспроизведения
                </button>
                {SPEEDS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    className="vp-menu__item vp-menu__item--opt"
                    role="menuitemradio"
                    aria-checked={el.playbackRate === s}
                    onClick={() => {
                      setSpeed(s);
                      setMenu(null);
                    }}
                  >
                    <span className="vp-menu__check">{el.playbackRate === s && <Check size={16} />}</span>
                    {speedLabel(s)}
                  </button>
                ))}
              </>
            )}
          </div>
        )}

        {help && <ShortcutsHelp live={live} onClose={() => setHelp(false)} />}
      </div>
    </div>
  );
}

const SHORTCUTS: [string, string, boolean?][] = [
  ['Пробел / K', 'Пауза и воспроизведение'],
  ['J / L', 'Назад / вперёд на 10 секунд', true],
  ['← / →', 'Назад / вперёд на 5 секунд', true],
  ['↑ / ↓', 'Громкость (когда плеер в фокусе)'],
  ['M', 'Без звука'],
  ['F', 'Во весь экран'],
  ['T', 'Кинорежим'],
  ['I', 'Картинка в картинке'],
  ['0…9', 'Перейти к 0–90% видео', true],
  ['< / >', 'Медленнее / быстрее', true],
  [', / .', 'Кадр назад / вперёд на паузе', true],
  ['Shift + N', 'Следующее видео', true],
];

function ShortcutsHelp({ live, onClose }: { live: boolean; onClose: () => void }) {
  return (
    <div className="vp-help" role="dialog" aria-label="Горячие клавиши" onPointerUp={(e) => e.target === e.currentTarget && onClose()}>
      <div className="vp-help__card">
        <div className="vp-help__head">
          <b>Горячие клавиши</b>
          <button type="button" className="vp-btn" onClick={onClose} aria-label="Закрыть">
            ✕
          </button>
        </div>
        <div className="vp-help__list">
          {SHORTCUTS.filter(([, , seekOnly]) => !(live && seekOnly)).map(([k, v]) => (
            <div key={k} className="vp-help__row">
              <kbd>{k}</kbd>
              <span>{v}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
