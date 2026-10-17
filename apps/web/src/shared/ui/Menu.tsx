import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useEscape, useOnClickOutside } from '../hooks';
import { cn } from '../lib/format';

export interface MenuItem {
  label: string;
  icon?: ReactNode;
  onClick: () => void;
  danger?: boolean;
  hidden?: boolean;
}

export type MenuEntry = MenuItem | 'separator';

interface MenuProps {
  anchor: { x: number; y: number } | null;
  items: MenuEntry[];
  onClose: () => void;
  header?: ReactNode;
}

/** Контекстное меню, позиционируется у точки клика и не выходит за экран. */
export function Menu({ anchor, items, onClose, header }: MenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  useOnClickOutside(ref, onClose, !!anchor);
  useEscape(onClose, !!anchor);

  useLayoutEffect(() => {
    if (!anchor || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    const pad = 8;
    setPos({
      left: Math.max(pad, Math.min(anchor.x, window.innerWidth - r.width - pad)),
      top: Math.max(pad, Math.min(anchor.y, window.innerHeight - r.height - pad)),
    });
    ref.current.querySelector<HTMLElement>('button')?.focus();
  }, [anchor]);

  if (!anchor) return null;
  const visible = items.filter((i) => i === 'separator' || !i.hidden);
  return createPortal(
    <div
      ref={ref}
      className="menu"
      role="menu"
      style={{ left: pos?.left ?? anchor.x, top: pos?.top ?? anchor.y, visibility: pos ? 'visible' : 'hidden' }}
      onKeyDown={(e) => {
        const buttons = [...(ref.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])];
        const idx = buttons.indexOf(document.activeElement as HTMLButtonElement);
        if (e.key === 'ArrowDown') buttons[(idx + 1) % buttons.length]?.focus();
        if (e.key === 'ArrowUp') buttons[(idx - 1 + buttons.length) % buttons.length]?.focus();
      }}
    >
      {header}
      {visible.map((item, i) =>
        item === 'separator' ? (
          <div key={`sep-${i}`} className="menu__sep" />
        ) : (
          <button
            key={item.label}
            role="menuitem"
            className={cn('menu__item', item.danger && 'menu__item--danger')}
            onClick={() => {
              onClose();
              item.onClick();
            }}
          >
            {item.icon}
            {item.label}
          </button>
        ),
      )}
    </div>,
    document.body,
  );
}

/** Хелпер: открыть меню по кнопке или правому клику / долгому нажатию. */
export function useMenu() {
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);
  return {
    anchor,
    close: () => setAnchor(null),
    openAt: (x: number, y: number) => setAnchor({ x, y }),
    openFromEvent: (e: { currentTarget: Element; clientX?: number; clientY?: number; preventDefault?: () => void }) => {
      e.preventDefault?.();
      if (e.clientX && e.clientY) return setAnchor({ x: e.clientX, y: e.clientY });
      const r = e.currentTarget.getBoundingClientRect();
      setAnchor({ x: r.right - 220, y: r.bottom + 4 });
    },
  };
}
