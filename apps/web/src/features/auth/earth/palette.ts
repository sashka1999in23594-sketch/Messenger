/** Цвета сцены из CSS-переменных темы (с запасными значениями). */
import { Color } from 'three';

export interface Palette {
  dot: Color;
  orbit: Color;
  atmosphere: Color;
  flame: Color;
}

const TOKENS: Record<keyof Palette, [string, string]> = {
  dot: ['--earth-dot', '#3ee07f'],
  orbit: ['--earth-orbit', '#8fb8ff'],
  atmosphere: ['--earth-atmosphere', '#4f9dff'],
  flame: ['--earth-rocket-flame', '#ffb04a'],
};

// three понимает hex, rgb() и hsl(); прочие форматы (oklch и т. п.) — запасной цвет
const SUPPORTED = /^(#|rgba?\(|hsla?\()/i;

export function readPalette(el: Element, out?: Palette): Palette {
  const cs = getComputedStyle(el);
  const p: Palette = out ?? {
    dot: new Color(),
    orbit: new Color(),
    atmosphere: new Color(),
    flame: new Color(),
  };
  for (const key of Object.keys(TOKENS) as (keyof Palette)[]) {
    const [name, fallback] = TOKENS[key];
    const raw = cs.getPropertyValue(name).trim();
    p[key].setStyle(raw && SUPPORTED.test(raw) ? raw : fallback);
  }
  return p;
}
