/**
 * Обои рабочего стола в духе знака Sunnet: небо, солнце с веером лучей и
 * мягкие облака у горизонта. Днём (светлая тема) — ясное небо, в тёмной теме —
 * вечернее. Цвета — из токенов, поэтому обои следуют теме без перерисовки.
 */
import { memo, useId } from 'react';
import type { WallpaperId } from './store';

/** Веер лучей: длинные узкие клинья из центра солнца, расходятся неравномерно. */
const RAYS = Array.from({ length: 36 }, (_, i) => {
  const a = (i / 36) * Math.PI * 2 + (i % 3) * 0.035;
  const half = (i % 2 ? 0.9 : 1.7) * (Math.PI / 180);
  const r = i % 4 === 0 ? 100 : i % 2 ? 72 : 88;
  const p = (ang: number, rad: number) => `${(Math.cos(ang) * rad).toFixed(2)} ${(Math.sin(ang) * rad).toFixed(2)}`;
  return `M0 0L${p(a - half, r)}L${p(a + half, r)}Z`;
}).join('');

export const Wallpaper = memo(function Wallpaper({ kind }: { kind: WallpaperId }) {
  const id = useId();
  // «Сияние» — общий фон приложения, он уже нарисован под рабочим столом
  if (kind === 'aurora') return <div className="wall wall--aurora" aria-hidden />;
  return (
    <div className={`wall wall--${kind}`} aria-hidden>
      <div className="wall__sky" />
      {kind !== 'plain' && (
        <>
          {kind === 'night' && <div className="wall__stars" />}
          {kind !== 'night' && (
            <svg className="wall__rays" viewBox="-100 -100 200 200" preserveAspectRatio="xMidYMid meet">
              <defs>
                <radialGradient id={`${id}-ray`} cx="0" cy="0" r="100" gradientUnits="userSpaceOnUse">
                  <stop offset="0.04" style={{ stopColor: 'var(--desk-ray)', stopOpacity: 0.9 }} />
                  <stop offset="0.35" style={{ stopColor: 'var(--desk-ray)', stopOpacity: 0.35 }} />
                  <stop offset="1" style={{ stopColor: 'var(--desk-ray)', stopOpacity: 0 }} />
                </radialGradient>
              </defs>
              <path d={RAYS} fill={`url(#${id}-ray)`} />
            </svg>
          )}
          <div className="wall__sun" />
          <div className="wall__haze" />
          <div className="wall__clouds">
            <span className="wall__cloud wall__cloud--1" />
            <span className="wall__cloud wall__cloud--2" />
            <span className="wall__cloud wall__cloud--3" />
            <span className="wall__cloud wall__cloud--4" />
          </div>
        </>
      )}
    </div>
  );
});
