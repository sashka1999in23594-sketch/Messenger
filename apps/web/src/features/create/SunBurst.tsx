/**
 * Анимированное солнце: ядро с градиентом и мягким свечением, вокруг —
 * вращающиеся лучи. Используется как центральная кнопка публикации в доке и
 * в заголовке окна создания. Рисуется в SVG, чтобы оставаться чётким в любом
 * размере; лучи вращаются и мерцают средствами CSS.
 */
import type { CSSProperties } from 'react';
import { cn } from '../../shared/lib/format';

const RAYS = Array.from({ length: 12 }, (_, i) => i);

export function SunBurst({ size = 48, spin = false, className }: { size?: number; spin?: boolean; className?: string }) {
  const id = `sun-${size}`;
  return (
    <span className={cn('sunburst', spin && 'sunburst--spin', className)} style={{ '--sun-size': `${size}px` } as CSSProperties} aria-hidden>
      <svg viewBox="0 0 100 100" width={size} height={size}>
        <defs>
          <radialGradient id={`${id}-core`} cx="42%" cy="38%" r="68%">
            <stop offset="0%" stopColor="#fff6d6" />
            <stop offset="42%" stopColor="#ffd84d" />
            <stop offset="78%" stopColor="#ff9f1c" />
            <stop offset="100%" stopColor="#f0620f" />
          </radialGradient>
          <linearGradient id={`${id}-ray`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#ffdf6b" />
            <stop offset="100%" stopColor="#ff8a1e" />
          </linearGradient>
        </defs>
        <g className="sunburst__rays">
          {RAYS.map((i) => (
            <rect key={i} x="48" y="3" width="4" height="15" rx="2" fill={`url(#${id}-ray)`} transform={`rotate(${i * 30} 50 50)`} />
          ))}
        </g>
        <circle className="sunburst__halo" cx="50" cy="50" r="30" fill={`url(#${id}-core)`} opacity="0.35" />
        <circle className="sunburst__core" cx="50" cy="50" r="23" fill={`url(#${id}-core)`} />
      </svg>
    </span>
  );
}
