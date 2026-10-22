/** Лунная сцена Lynnet на весь блок: ракеты, космонавты и флаги (см. shared/lib/moonScene). */
import { useEffect, useRef } from 'react';
import { startMoonScene, type MoonSceneOptions } from '../lib/moonScene';

export function MoonScene({ className, ...options }: MoonSceneOptions & { className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const key = JSON.stringify(options);
  useEffect(() => {
    if (!ref.current) return;
    return startMoonScene(ref.current, JSON.parse(key) as MoonSceneOptions);
  }, [key]);
  return <canvas ref={ref} className={className} aria-hidden />;
}
