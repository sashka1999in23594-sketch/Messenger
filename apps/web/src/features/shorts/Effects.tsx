/**
 * Эффекты Reels: залитые иконки панели действий, «взрыв» сердец при двойном
 * нажатии, кольцо частиц у кнопки «Нравится» и счётчик, который «прокручивается».
 * Все анимации — только transform и opacity.
 */
import { memo, useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import { cn, compactNumber } from '../../shared/lib/format';

type IconProps = { size?: number; className?: string };

const HEART = 'M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z';

/** Сердце; liked — заливка фирменным градиентом «Нравится». */
export function HeartIcon({ size = 30, className, liked }: IconProps & { liked?: boolean }) {
  const id = useId();
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" aria-hidden focusable="false">
      {liked && (
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" style={{ stopColor: 'var(--reels-like-2)' }} />
            <stop offset="0.55" style={{ stopColor: 'var(--reels-like)' }} />
            <stop offset="1" style={{ stopColor: 'var(--reels-like-3)' }} />
          </linearGradient>
        </defs>
      )}
      <path d={HEART} fill={liked ? `url(#${id})` : 'currentColor'} />
    </svg>
  );
}

/** Облачко комментариев с тремя точками-«прорезями». */
export function CommentIcon({ size = 30, className }: IconProps) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" aria-hidden focusable="false">
      <path
        fillRule="evenodd"
        fill="currentColor"
        d="M12 2.6C6.36 2.6 1.9 6.5 1.9 11.35c0 2.5 1.2 4.74 3.12 6.33-.17 1.33-.8 2.55-1.84 3.47 2.2.12 4.13-.6 5.55-1.67 1.04.27 2.13.41 3.27.41 5.64 0 10.1-3.9 10.1-8.54S17.64 2.6 12 2.6zM7.4 12.9a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zm4.6 0a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zm4.6 0a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z"
      />
    </svg>
  );
}

export function BookmarkIcon({ size = 28, className, saved }: IconProps & { saved?: boolean }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" aria-hidden focusable="false">
      <path
        fill={saved ? 'var(--reels-save)' : 'currentColor'}
        d="M6.2 2.4h11.6c.94 0 1.7.76 1.7 1.7v16.86c0 .7-.8 1.1-1.36.69L12 17.27l-6.14 4.38c-.56.4-1.36 0-1.36-.69V4.1c0-.94.76-1.7 1.7-1.7z"
      />
    </svg>
  );
}

/** Изогнутая стрелка «Поделиться». */
export function ShareIcon({ size = 28, className }: IconProps) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" aria-hidden focusable="false">
      <path
        fill="currentColor"
        d="M13.2 3.55v4.18C6.86 8.4 2.84 12.6 2.3 19.62c-.03.42.5.62.76.3 2.4-2.96 5.72-4.45 10.14-4.5v4.03c0 .6.72.9 1.15.49l7.97-7.6a.8.8 0 0 0 0-1.16l-7.97-7.86c-.43-.42-1.15-.12-1.15.48z"
      />
    </svg>
  );
}

export function MoreIcon({ size = 26, className }: IconProps) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" aria-hidden focusable="false">
      <circle cx="5" cy="12" r="2.1" fill="currentColor" />
      <circle cx="12" cy="12" r="2.1" fill="currentColor" />
      <circle cx="19" cy="12" r="2.1" fill="currentColor" />
    </svg>
  );
}

// ─── Взрыв сердец ───────────────────────────────────────────────────────────

export interface Burst {
  id: number;
  x: number;
  y: number;
  rot: number;
}

const PARTICLES = 10;

/** Большое сердце в точке двойного нажатия и разлетающиеся маленькие сердечки. */
export const HeartBurst = memo(function HeartBurst({ burst }: { burst: Burst }) {
  // Разброс частиц фиксируется при появлении, чтобы не «прыгал» при перерисовке
  const [parts] = useState(() =>
    Array.from({ length: PARTICLES }, (_, i) => ({
      a: (360 / PARTICLES) * i + (Math.random() * 24 - 12),
      d: 70 + Math.random() * 46,
      s: 0.55 + Math.random() * 0.6,
      delay: Math.random() * 60,
      tone: i % 4,
    })),
  );
  return (
    <div className="rl-burst" style={{ transform: `translate3d(${burst.x}px, ${burst.y}px, 0)` }} aria-hidden>
      <span className="rl-burst__ring" />
      {parts.map((p, i) => (
        <span
          key={i}
          className={cn('rl-burst__p', `rl-burst__p--${p.tone}`)}
          style={{ '--a': `${p.a}deg`, '--d': `${p.d}px`, '--s': p.s, animationDelay: `${p.delay}ms` } as CSSProperties}
        >
          <HeartIcon size={14} />
        </span>
      ))}
      <span className="rl-burst__heart" style={{ '--rot': `${burst.rot}deg` } as CSSProperties}>
        <HeartIcon size={104} liked />
      </span>
    </div>
  );
});

/** Кольцо из точек вокруг кнопки «Нравится» в момент отметки. */
export function ParticleRing({ tone = 'like' }: { tone?: 'like' | 'save' }) {
  return (
    <span className={cn('rl-ring', `rl-ring--${tone}`)} aria-hidden>
      <span className="rl-ring__wave" />
      {Array.from({ length: 8 }, (_, i) => (
        <span key={i} className="rl-ring__dot" style={{ '--a': `${i * 45}deg` } as CSSProperties} />
      ))}
    </span>
  );
}

// ─── Счётчик ────────────────────────────────────────────────────────────────

/** Число в формате «1,2 тыс.»; при изменении старое уезжает, новое въезжает. */
export function RollingCount({ value, fallback }: { value: number; fallback?: string }) {
  const prev = useRef(value);
  const [anim, setAnim] = useState<{ from: number; up: boolean; k: number } | null>(null);
  const label = (n: number) => (n === 0 && fallback ? fallback : compactNumber(n));
  useEffect(() => {
    if (prev.current === value) return;
    // 1 201 → 1 202 выглядит одинаково («1,2 тыс.») — тогда не анимируем
    if (label(prev.current) !== label(value)) setAnim({ from: prev.current, up: value > prev.current, k: Date.now() });
    prev.current = value;
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <span className="rl-count">
      {anim && (
        <span key={`o${anim.k}`} className={cn('rl-count__old', anim.up ? 'is-up' : 'is-down')} aria-hidden>
          {label(anim.from)}
        </span>
      )}
      <span key={`n${anim?.k ?? 0}`} className={cn('rl-count__new', anim && (anim.up ? 'is-up' : 'is-down'))}>
        {label(value)}
      </span>
    </span>
  );
}
