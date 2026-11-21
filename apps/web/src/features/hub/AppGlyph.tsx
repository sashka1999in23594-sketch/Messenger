/** Значок сервиса: первая буква на цветной плитке (без чужих логотипов). */
import type { CSSProperties } from 'react';
import type { CatalogApp } from './catalog';

export function AppGlyph({ app, size = 44 }: { app: Pick<CatalogApp, 'name' | 'color'>; size?: number }) {
  const letter = app.name.replace(/[^A-Za-zА-Яа-яЁё0-9]/g, '').slice(0, 1).toUpperCase() || '•';
  return (
    <span className="app-glyph" style={{ '--g': app.color, width: size, height: size, fontSize: size * 0.44, borderRadius: size * 0.28 } as CSSProperties} aria-hidden>
      {letter}
    </span>
  );
}
