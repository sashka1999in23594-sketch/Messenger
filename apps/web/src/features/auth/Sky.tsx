/**
 * Фон входа на компьютере: голубое небо и солнце в левом верхнем углу —
 * яркая точка без контура и веер золотых лучей разной длины и ширины, как
 * когда солнце светит сквозь листву; рядом — радужная точка-блик. По небу
 * плывут облака, в лучах кружатся пылинки, иногда пролетает стая птиц. За
 * курсором всё чуть смещается на разную глубину, а у самого солнца лучи
 * разгораются ярче. Только CSS и немного JS для курсора.
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

/** Облака: высота (доля экрана), размер, длительность пролёта, задержка, слой (0 — дальний). */
const CLOUDS = [
  { top: 0.12, scale: 1.1, dur: 190, delay: -40, layer: 0, opacity: 0.55 },
  { top: 0.3, scale: 0.7, dur: 160, delay: -120, layer: 0, opacity: 0.45 },
  { top: 0.62, scale: 1.4, dur: 140, delay: -20, layer: 1, opacity: 0.6 },
  { top: 0.78, scale: 1.8, dur: 120, delay: -80, layer: 1, opacity: 0.7 },
  { top: 0.45, scale: 1, dur: 210, delay: -170, layer: 0, opacity: 0.4 },
  { top: 0.88, scale: 2.2, dur: 105, delay: -50, layer: 1, opacity: 0.75 },
];

/** Пылинки в солнечных лучах: смещение от солнца, размер, путь дрейфа. */
const MOTES = (() => {
  const rnd = seeded(77);
  return Array.from({ length: 34 }, () => {
    // Чаще всего — в стороне экрана, куда светит солнце
    const angle = (20 + rnd() * 120) * (Math.PI / 180);
    const dist = 60 + rnd() ** 0.7 * 520;
    return {
      x: Math.round(Math.sin(angle) * dist),
      y: Math.round(-Math.cos(angle) * dist * 0.85),
      size: +(1.5 + rnd() * 3.5).toFixed(1),
      dx: Math.round((rnd() - 0.4) * 90),
      dy: Math.round((rnd() - 0.3) * 70),
      dur: +(9 + rnd() * 12).toFixed(1),
      delay: +(-rnd() * 20).toFixed(1),
      twinkle: +(2 + rnd() * 3).toFixed(1),
    };
  });
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

  // За курсором всё смещается на разную глубину — будто немного поворачиваешь голову;
  // чем ближе курсор к солнцу, тем ярче разгораются лучи
  useEffect(() => {
    const el = ref.current;
    if (!el || still || !matchMedia('(pointer: fine)').matches || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let frame = 0;
    const onMove = (e: PointerEvent) => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        el.style.setProperty('--px', String(Math.round(e.clientX - innerWidth / 2)));
        el.style.setProperty('--py', String(Math.round(e.clientY - innerHeight / 2)));
        const sun = el.querySelector('.sky__sun')?.getBoundingClientRect();
        if (sun) {
          const d = Math.hypot(e.clientX - (sun.left + sun.width / 2), e.clientY - (sun.top + sun.height / 2));
          el.style.setProperty('--near', Math.max(0, 1 - d / 520).toFixed(3));
        }
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
      {[0, 1].map((layer) => (
        <div key={layer} className={`sky__clouds sky__clouds--${layer ? 'near' : 'far'}`}>
          {CLOUDS.filter((c) => c.layer === layer).map((c, i) => (
            <div
              key={i}
              className="sky__cloud-track"
              style={{ '--top': `${c.top * 100}%`, '--dur': `${c.dur}s`, '--delay': `${c.delay}s` } as CSSProperties}
            >
              <div className="sky__cloud" style={{ '--k': c.scale, '--o': c.opacity } as CSSProperties} />
            </div>
          ))}
        </div>
      ))}
      <div className="sky__sunwrap">
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
      {MOTES.map((m, i) => (
        <span
          key={i}
          className="sky__mote"
          style={
            {
              '--x': `${m.x}px`,
              '--y': `${m.y}px`,
              '--s': `${m.size}px`,
              '--dx': `${m.dx}px`,
              '--dy': `${m.dy}px`,
              '--dur': `${m.dur}s`,
              '--delay': `${m.delay}s`,
              '--tw': `${m.twinkle}s`,
            } as CSSProperties
          }
        />
      ))}
      </div>
      <div className="sky__flock">
        {[0, 1, 2, 3, 4].map((i) => (
          <svg key={i} className="sky__bird" viewBox="0 0 40 16" style={{ '--i': i } as CSSProperties}>
            <path d="M1 9 Q 10 1 20 8 Q 30 1 39 9 Q 30 5 20 11 Q 10 5 1 9 Z" />
          </svg>
        ))}
      </div>
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
