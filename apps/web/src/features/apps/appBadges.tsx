/**
 * Непрочитанные из сторонних приложений, открытых во встроенном браузере Sunnet
 * (только в приложении для компьютера). Окно приложения сообщает счётчик из
 * заголовка страницы — «(3) WhatsApp», — и он появляется в общем списке чатов.
 * Само содержимое переписок Sunnet не читает: только число, которое показывает сервис.
 */
import type { CSSProperties } from 'react';
import { create } from 'zustand';
import { CATALOG } from './catalog';
import { openWeb } from './openWeb';

interface Badge {
  id: string;
  name: string;
  count: number;
}
interface BadgesState {
  apps: Record<string, Badge>;
  set: (b: Badge & { closed?: boolean }) => void;
}

export const useAppBadges = create<BadgesState>((set) => ({
  apps: {},
  set: (b) =>
    set((s) => {
      const apps = { ...s.apps };
      if (b.closed) delete apps[b.id];
      else apps[b.id] = { id: b.id, name: b.name, count: Math.max(0, Math.min(99_999, b.count | 0)) };
      return { apps };
    }),
}));

// Мост от приложения для компьютера: принимаем только простые значения
if (typeof window !== 'undefined') {
  (window as unknown as { __sunnetAppBadge?: (b: unknown) => void }).__sunnetAppBadge = (raw) => {
    const b = raw as Partial<Badge & { closed: boolean }>;
    if (typeof b?.id !== 'string' || !/^[a-z0-9-]{1,32}$/.test(b.id)) return;
    useAppBadges.getState().set({ id: b.id, name: String(b.name ?? b.id).slice(0, 40), count: Number(b.count) || 0, closed: !!b.closed });
  };
}

/** Строки «Telegram · 3 новых» вверху списка чатов. Нажатие — открыть окно приложения. */
export function AppInboxes() {
  const apps = Object.values(useAppBadges((s) => s.apps));
  if (!apps.length) return null;
  return (
    <div className="app-inbox" aria-label="Сообщения в приложениях">
      {apps.map((a) => {
        const entry = CATALOG.find((c) => c.id === a.id);
        return (
          <button
            key={a.id}
            type="button"
            className="bridge-item app-inbox__row"
            onClick={() => entry && openWeb(entry.url, entry)}
            style={{ '--c1': entry?.color[0] ?? '#4aa3ff', '--c2': entry?.color[1] ?? '#2f78f0' } as CSSProperties}
          >
            <span className="app-inbox__icon" aria-hidden>
              {a.name.slice(0, 1).toUpperCase()}
            </span>
            <span className="app-inbox__body">
              <b>{a.name}</b>
              <span>{a.count ? `${a.count} ${a.count % 10 === 1 && a.count % 100 !== 11 ? 'новое сообщение' : 'новых сообщений'}` : 'Открыто в Sunnet · новых нет'}</span>
            </span>
            {a.count > 0 && <span className="app-inbox__count">{a.count > 99 ? '99+' : a.count}</span>}
          </button>
        );
      })}
    </div>
  );
}
