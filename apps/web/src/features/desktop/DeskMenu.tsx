/**
 * Меню рабочего стола: те же стили, что у обычного меню Sunnet, но умеет
 * раскрываться вверх (из дока) и вниз (из строки меню), показывает галочки
 * и подсказки сочетаний клавиш. Esc и щелчок мимо закрывают его.
 */
import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Check } from 'lucide-react';
import { useEscape, useOnClickOutside } from '../../shared/hooks';
import { cn } from '../../shared/lib/format';

export interface DeskMenuItem {
  label: string;
  icon?: ReactNode;
  hint?: string;
  checked?: boolean;
  disabled?: boolean;
  danger?: boolean;
  onClick: () => void;
}
export type DeskMenuEntry = DeskMenuItem | 'separator' | { title: string } | false | null | undefined;

export interface MenuAnchor {
  x: number;
  y: number;
  /** below — меню под точкой, above — над ней */
  place?: 'below' | 'above';
  align?: 'start' | 'center' | 'end';
}

export function DeskMenu({ anchor, items, onClose, header, label }: { anchor: MenuAnchor | null; items: DeskMenuEntry[]; onClose: () => void; header?: ReactNode; label?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; origin: string } | null>(null);
  const close = useCallback(() => onClose(), [onClose]);
  useOnClickOutside(ref, close, !!anchor);
  useEscape(close, !!anchor);

  useLayoutEffect(() => {
    setPos(null);
    if (!anchor || !ref.current) return;
    const { offsetWidth: w, offsetHeight: h } = ref.current;
    const pad = 8;
    const place = anchor.place ?? 'below';
    const align = anchor.align ?? 'start';
    let left = align === 'start' ? anchor.x : align === 'end' ? anchor.x - w : anchor.x - w / 2;
    let top = place === 'below' ? anchor.y : anchor.y - h;
    left = Math.max(pad, Math.min(left, window.innerWidth - w - pad));
    top = Math.max(pad, Math.min(top, window.innerHeight - h - pad));
    setPos({ left, top, origin: `${place === 'below' ? 'top' : 'bottom'} ${align === 'end' ? 'right' : align === 'center' ? 'center' : 'left'}` });
  }, [anchor]);

  useLayoutEffect(() => {
    if (pos) ref.current?.querySelector<HTMLElement>('[role="menuitem"]:not(:disabled)')?.focus({ preventScroll: true });
  }, [pos]);

  if (!anchor) return null;
  const list = items.filter((i): i is Exclude<DeskMenuEntry, false | null | undefined> => !!i);
  return createPortal(
    <div
      ref={ref}
      className="menu desk-menu"
      role="menu"
      aria-label={label}
      style={{ left: pos?.left ?? anchor.x, top: pos?.top ?? anchor.y, visibility: pos ? 'visible' : 'hidden', transformOrigin: pos?.origin }}
      onContextMenu={(e) => e.preventDefault()}
      onKeyDown={(e) => {
        const buttons = [...(ref.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? [])];
        const idx = buttons.indexOf(document.activeElement as HTMLButtonElement);
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          buttons[(idx + 1) % buttons.length]?.focus();
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          buttons[(idx - 1 + buttons.length) % buttons.length]?.focus();
        }
      }}
    >
      {header}
      {list.map((item, i) => {
        if (item === 'separator') return <div key={`sep-${i}`} className="menu__sep" />;
        if ('title' in item)
          return (
            <div key={`t-${i}`} className="desk-menu__title">
              {item.title}
            </div>
          );
        return (
          <button
            key={`${item.label}-${i}`}
            type="button"
            role="menuitem"
            disabled={item.disabled}
            className={cn('menu__item', 'desk-menu__item', item.danger && 'menu__item--danger')}
            onClick={() => {
              onClose();
              item.onClick();
            }}
          >
            {item.checked !== undefined ? <span className="desk-menu__check">{item.checked && <Check size={16} />}</span> : item.icon}
            <span className="desk-menu__label ellipsis">{item.label}</span>
            {item.hint && <span className="desk-menu__hint">{item.hint}</span>}
          </button>
        );
      })}
    </div>,
    document.body,
  );
}

/** Состояние меню у кнопки: повторное нажатие закрывает, а не открывает заново. */
export function useDeskMenu() {
  const [anchor, setAnchor] = useState<MenuAnchor | null>(null);
  const close = useCallback(() => setAnchor(null), []);
  return {
    anchor,
    open: setAnchor,
    close,
    /** Свойства для кнопки-переключателя */
    trigger: (place: (r: DOMRect) => MenuAnchor) => ({
      'aria-haspopup': 'menu' as const,
      'aria-expanded': !!anchor,
      onPointerDown: (e: React.PointerEvent) => {
        if (anchor) e.nativeEvent.stopPropagation();
      },
      onClick: (e: React.MouseEvent<HTMLElement>) => {
        if (anchor) return setAnchor(null);
        setAnchor(place(e.currentTarget.getBoundingClientRect()));
      },
    }),
  };
}
