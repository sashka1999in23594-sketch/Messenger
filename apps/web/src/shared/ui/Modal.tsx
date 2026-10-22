import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { create } from 'zustand';
import { useEscape } from '../hooks';
import { cn } from '../lib/format';
import { Button, IconButton } from './Button';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
  /** На телефоне — шторка снизу */
  sheet?: boolean;
  className?: string;
}

/** Шторку на телефоне можно смахнуть вниз — за «ручку» или заголовок. */
function useSheetDrag(panel: React.RefObject<HTMLDivElement | null>, onClose: () => void, enabled: boolean) {
  const drag = useRef<{ y: number; dy: number } | null>(null);
  if (!enabled) return {};
  return {
    onTouchStart: (e: React.TouchEvent) => {
      const el = panel.current;
      const t = e.touches[0];
      if (!el || !t || window.innerWidth > 767) return;
      const top = el.getBoundingClientRect().top;
      // Тянуть можно за верхнюю полосу (ручка и заголовок)
      if (t.clientY - top > 60) return;
      drag.current = { y: t.clientY, dy: 0 };
      el.classList.add('modal--dragging');
    },
    onTouchMove: (e: React.TouchEvent) => {
      const d = drag.current;
      const t = e.touches[0];
      if (!d || !t || !panel.current) return;
      d.dy = Math.max(0, t.clientY - d.y);
      panel.current.style.transform = `translateY(${d.dy}px)`;
    },
    onTouchEnd: () => {
      const d = drag.current;
      const el = panel.current;
      drag.current = null;
      if (!d || !el) return;
      el.classList.remove('modal--dragging');
      if (d.dy > 110) {
        onClose();
        return;
      }
      el.classList.add('modal--releasing');
      el.style.transform = '';
      setTimeout(() => el.classList.remove('modal--releasing'), 250);
    },
  };
}

export function Modal({ open, onClose, title, children, footer, wide, sheet = true, className }: ModalProps) {
  useEscape(onClose, open);
  const panel = useRef<HTMLDivElement>(null);
  const dragHandlers = useSheetDrag(panel, onClose, sheet);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    // Фокус внутрь окна (доступность с клавиатуры), по закрытию — обратно
    const first = panel.current?.querySelector<HTMLElement>('input, textarea, select, button:not([data-close])');
    (first ?? panel.current)?.focus();
    return () => prev?.focus?.();
  }, [open]);
  if (!open) return null;
  return createPortal(
    <div className={cn('overlay', sheet && 'overlay--sheet')} onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={panel} className={cn('modal', wide && 'modal--wide', className)} role="dialog" aria-modal="true" tabIndex={-1} {...dragHandlers}>
        {title !== undefined && (
          <div className="modal__header">
            <div className="modal__title">{title}</div>
            <IconButton label="Закрыть" onClick={onClose} data-close>
              <X size={20} />
            </IconButton>
          </div>
        )}
        <div className="modal__body">{children}</div>
        {footer && <div className="modal__footer">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

// ─── Диалог подтверждения (императивный API) ───────────────────────────────

interface ConfirmOptions {
  title: string;
  text?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  /** Требует ввести слово для подтверждения опасного действия */
  typeToConfirm?: string;
}

interface ConfirmState {
  current: (ConfirmOptions & { resolve: (v: boolean) => void }) | null;
}

const useConfirmStore = create<ConfirmState>(() => ({ current: null }));

export function confirm(opts: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => useConfirmStore.setState({ current: { ...opts, resolve } }));
}

export function ConfirmHost() {
  const current = useConfirmStore((s) => s.current);
  const [typed, setTyped] = useState('');
  useEffect(() => setTyped(''), [current]);
  if (!current) return null;
  const close = (v: boolean) => {
    current.resolve(v);
    useConfirmStore.setState({ current: null });
  };
  const blocked = !!current.typeToConfirm && typed !== current.typeToConfirm;
  return (
    <Modal
      open
      onClose={() => close(false)}
      title={current.title}
      footer={
        <>
          <Button variant="ghost" onClick={() => close(false)}>
            {current.cancelLabel ?? 'Отмена'}
          </Button>
          <Button variant={current.danger ? 'danger' : 'primary'} onClick={() => close(true)} disabled={blocked}>
            {current.confirmLabel ?? 'Подтвердить'}
          </Button>
        </>
      }
    >
      {current.text && <div className="muted">{current.text}</div>}
      {current.typeToConfirm && (
        <input
          className="input"
          style={{ marginTop: 12 }}
          placeholder={`Введите «${current.typeToConfirm}»`}
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
        />
      )}
    </Modal>
  );
}
