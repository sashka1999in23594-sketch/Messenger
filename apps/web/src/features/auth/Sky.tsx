/**
 * Фон входа на компьютере: голубое небо и солнце в левом верхнем углу —
 * яркая точка без контура и веер золотых лучей разной длины и ширины, как
 * когда солнце светит сквозь листву; рядом — радужная точка-блик. Только CSS.
 */
import { useEffect, useRef, type CSSProperties } from 'react';

/** Детерминированный генератор: лучи одинаковые при каждом открытии. */
function seeded(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Ray {
  angle: number;
  length: number;
  width: number;
  opacity: number;
  delay: number;
  period: number;
}

const RAYS: Ray[] = (() => {
  const rnd = seeded(20261019);
  const rays: Ray[] = [];
  const count = 58;
  for (let i = 0; i < count; i++) {
    // 0° — вверх, 90° — вправо, 180° — вниз; лучи в сторону экрана длиннее
    const angle = (i / count) * 360 + (rnd() - 0.5) * 9;
    const intoScreen = angle > 75 && angle < 200;
    const hero = rnd() < 0.16;
    const length = (hero ? 560 + rnd() * 380 : 170 + rnd() * 340) * (intoScreen ? 1.35 : 0.8);
    const width = hero ? 26 + rnd() * 30 : 3 + rnd() ** 2 * 22;
    const opacity = hero ? 0.32 + rnd() * 0.2 : 0.22 + rnd() * 0.5;
    rays.push({ angle, length: Math.round(length), width: Math.round(width), opacity: +opacity.toFixed(2), delay: +(rnd() * 6).toFixed(2), period: +(4 + rnd() * 5).toFixed(2) });
  }
  return rays;
})();

/** Блики вдоль линии «солнце → центр экрана»: t — доля пути (больше 1 — за центром). */
const GHOSTS: { t: number; size: number; kind: 'disc' | 'ring' | 'hex' | 'rainbow'; color: number; opacity: number }[] = [
  { t: 0.24, size: 14, kind: 'disc', color: 2, opacity: 0.6 },
  { t: 0.42, size: 42, kind: 'rainbow', color: 0, opacity: 0.8 },
  { t: 0.58, size: 64, kind: 'hex', color: 1, opacity: 0.14 },
  { t: 1.28, size: 52, kind: 'ring', color: 1, opacity: 0.28 },
  { t: 1.62, size: 16, kind: 'rainbow', color: 0, opacity: 0.6 },
];

export function Sky({ still }: { still?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);

  // Блики чуть смещаются за курсором — будто немного поворачиваешь голову
  useEffect(() => {
    const el = ref.current;
    if (!el || still || !matchMedia('(pointer: fine)').matches || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let frame = 0;
    const onMove = (e: PointerEvent) => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        el.style.setProperty('--px', String(Math.round(e.clientX - innerWidth / 2)));
        el.style.setProperty('--py', String(Math.round(e.clientY - innerHeight / 2)));
      });
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('pointermove', onMove);
    };
  }, [still]);

  return (
    <div ref={ref} className={still ? 'sky sky--still' : 'sky'} aria-hidden="true">
      <div className="sky__glow" />
      <div className="sky__rays">
        {RAYS.map((r, i) => (
          <span
            key={i}
            className="sky__ray"
            style={{ '--a': `${r.angle}deg`, '--l': `${r.length}px`, '--w': `${r.width}px`, '--o': r.opacity, '--d': `${r.delay}s`, '--p': `${r.period}s` } as CSSProperties}
          />
        ))}
      </div>
      <div className="sky__sun" />
      {GHOSTS.map((g, i) => (
        <span
          key={i}
          className={`sky__ghost sky__ghost--${g.kind}`}
          style={{ '--t': g.t, '--s': `${g.size}px`, '--c': `var(--flare-${g.color})`, '--o': g.opacity, '--d': `${(i % 4) * 1.3}s` } as CSSProperties}
        />
      ))}
    </div>
  );
}
