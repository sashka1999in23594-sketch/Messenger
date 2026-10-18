import { useEffect, useRef, useState } from 'react';
import { createEarthScene, type EarthSceneHandle } from './scene';
import './earth.css';

/** Город на запасной CSS-планете: [x %, y %, задержка с]. */
const FALLBACK_DOTS: readonly (readonly [number, number, number])[] = [
  [38, 30, 0],
  [55, 26, 1.1],
  [64, 44, 2.3],
  [30, 52, 0.7],
  [48, 62, 1.8],
  [70, 30, 2.9],
];

/** Класс, которым страница просит статичный кадр (настройка «Меньше движения»). */
const STILL_CLASS = 'earth--still';

/**
 * Анимированная Земля с Луной для экранов входа, регистрации и загрузки.
 * Заполняет родителя (position: absolute; inset: 0); размер задаёт родитель.
 * Без WebGL — запасная CSS-планета; при prefers-reduced-motion или классе
 * earth--still — один статичный кадр.
 */
export default function EarthScene({ className }: { className?: string }) {
  const glRef = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  const still = !!className?.split(/\s+/).includes(STILL_CLASS);

  useEffect(() => {
    const el = glRef.current;
    if (!el) return;
    let handle: EarthSceneHandle | null = null;
    try {
      handle = createEarthScene(el, {
        still: still || matchMedia('(prefers-reduced-motion: reduce)').matches,
        onLost: () => setFailed(true),
      });
    } catch {
      setFailed(true);
    }
    return () => handle?.dispose();
  }, [still]);

  return (
    <div className={className ? `earth-scene ${className}` : 'earth-scene'} aria-hidden="true">
      <div ref={glRef} className="earth-scene__gl" hidden={failed} />
      {failed && (
        <div className="earth-fallback">
          <div className="earth-fallback__orbit" />
          <div className="earth-fallback__planet">
            {FALLBACK_DOTS.map(([x, y, delay]) => (
              <span
                key={`${x}-${y}`}
                className="earth-fallback__dot"
                style={{ left: `${x}%`, top: `${y}%`, animationDelay: `${delay}s` }}
              />
            ))}
          </div>
          <div className="earth-fallback__orbit earth-fallback__orbit--front" />
          <div className="earth-fallback__track">
            <span className="earth-fallback__moon" />
          </div>
        </div>
      )}
    </div>
  );
}
