import type { CSSProperties } from 'react';
import { cn } from '../../shared/lib/format';
import type { DeskApp } from './apps';

/** Значок приложения — цветная плитка с белым символом, как в доке macOS. */
export function AppTile({ app, size = 44, className }: { app: DeskApp; size?: number; className?: string }) {
  const Icon = app.icon;
  return (
    <span className={cn('desk-tile', `desk-tile--${app.id}`, className)} style={{ '--tile-size': `${size}px` } as CSSProperties} aria-hidden>
      <Icon size={Math.round(size * 0.54)} strokeWidth={size < 28 ? 2.3 : 2} />
    </span>
  );
}
