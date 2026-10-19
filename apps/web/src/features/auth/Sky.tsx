/**
 * Фон входа на компьютере: голубое небо и солнце в левом верхнем углу с
 * бликами объектива — цепочка «зайчиков» от солнца через центр экрана и
 * радужная точка, как когда смотришь на солнце. Только CSS, без WebGL.
 */
import { useEffect, useRef, type CSSProperties } from 'react';

type GhostKind = 'disc' | 'ring' | 'hex' | 'rainbow' | 'halo';

/** Блики вдоль линии «солнце → центр экрана»: t — доля пути (больше 1 — за центром). */
const GHOSTS: { t: number; size: number; kind: GhostKind; color: number; opacity: number }[] = [
  { t: 0.16, size: 18, kind: 'disc', color: 3, opacity: 0.55 },
  { t: 0.27, size: 34, kind: 'hex', color: 5, opacity: 0.3 },
  { t: 0.38, size: 12, kind: 'disc', color: 2, opacity: 0.7 },
  { t: 0.48, size: 44, kind: 'rainbow', color: 0, opacity: 0.85 },
  { t: 0.6, size: 70, kind: 'hex', color: 4, opacity: 0.16 },
  { t: 0.72, size: 22, kind: 'disc', color: 6, opacity: 0.4 },
  { t: 1.22, size: 54, kind: 'ring', color: 5, opacity: 0.32 },
  { t: 1.38, size: 26, kind: 'hex', color: 1, opacity: 0.32 },
  { t: 1.52, size: 120, kind: 'disc', color: 4, opacity: 0.12 },
  { t: 1.7, size: 16, kind: 'rainbow', color: 0, opacity: 0.7 },
  { t: 1.9, size: 300, kind: 'halo', color: 0, opacity: 0.38 },
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
      <div className="sky__halo" />
      <div className="sky__rays" />
      <div className="sky__rays sky__rays--fine" />
      <div className="sky__streak" />
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
