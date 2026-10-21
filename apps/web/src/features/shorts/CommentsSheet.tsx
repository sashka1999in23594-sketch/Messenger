/**
 * Комментарии к Reels: шторка снизу (телефон, узкое окно) или панель справа
 * (широкое окно). Шторку можно смахнуть вниз за «ручку» или за список, когда он
 * прокручен к началу. Фокус остаётся внутри, Esc закрывает, после закрытия фокус
 * возвращается на кнопку комментариев.
 */
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as RKeyboardEvent, type PointerEvent as RPointerEvent } from 'react';
import { X } from 'lucide-react';
import type { Post } from '@omni/shared';
import { cn, plural } from '../../shared/lib/format';
import { CommentsSection } from '../posts/Comments';
// Стили веток комментариев лежат в posts.css — сам компонент их не подключает
import '../posts/posts.css';

const FOCUSABLE = 'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function CommentsSheet({ post, side, onClose }: { post: Post; side: boolean; onClose: () => void }) {
  const sheet = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<'enter' | 'open' | 'closing'>('enter');
  const [dragY, setDragY] = useState(0);
  const drag = useRef<{ y: number; t: number; dy: number } | null>(null);
  const returnTo = useRef<Element | null>(null);

  const close = () => setState('closing');

  // Появление: кадр в исходном положении, затем — въезд
  useLayoutEffect(() => {
    returnTo.current = document.activeElement;
    const raf = requestAnimationFrame(() => requestAnimationFrame(() => setState('open')));
    sheet.current?.focus({ preventScroll: true });
    return () => cancelAnimationFrame(raf);
  }, []);

  // Закрытие: ждём конца анимации (с запасом — на случай «меньше движения»)
  useEffect(() => {
    if (state !== 'closing') return;
    const t = setTimeout(() => {
      onClose();
      (returnTo.current as HTMLElement | null)?.focus?.({ preventScroll: true });
    }, 300);
    return () => clearTimeout(t);
  }, [state, onClose]);

  // Смахивание за список, когда он прокручен к началу (только касанием)
  useEffect(() => {
    const el = body.current;
    if (!el || side) return;
    let start: { y: number; t: number } | null = null;
    const onStart = (e: TouchEvent) => {
      start = el.scrollTop <= 0 ? { y: e.touches[0]!.clientY, t: performance.now() } : null;
    };
    const onMove = (e: TouchEvent) => {
      if (!start) return;
      const dy = e.touches[0]!.clientY - start.y;
      if (dy <= 0 || el.scrollTop > 0) {
        if (drag.current) setDragY(0);
        drag.current = null;
        return;
      }
      e.preventDefault();
      drag.current = { y: start.y, t: start.t, dy };
      setDragY(dy);
    };
    const onEnd = () => {
      finishDrag();
      start = null;
    };
    el.addEventListener('touchstart', onStart, { passive: true });
    el.addEventListener('touchmove', onMove, { passive: false });
    el.addEventListener('touchend', onEnd);
    el.addEventListener('touchcancel', onEnd);
    return () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onEnd);
      el.removeEventListener('touchcancel', onEnd);
    };
  }, [side]); // eslint-disable-line react-hooks/exhaustive-deps

  const finishDrag = () => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    const h = sheet.current?.offsetHeight ?? 600;
    const speed = d.dy / Math.max(1, performance.now() - d.t);
    if (d.dy > h * 0.28 || (speed > 0.6 && d.dy > 40)) close();
    setDragY(0);
  };

  const handleDown = (e: RPointerEvent) => {
    if (side || (e.pointerType === 'mouse' && e.button !== 0)) return;
    if ((e.target as HTMLElement).closest('button')) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { y: e.clientY, t: performance.now(), dy: 0 };
  };
  const handleMove = (e: RPointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const raw = e.clientY - d.y;
    // Вверх — с «резиновым» сопротивлением
    d.dy = raw > 0 ? raw : raw / 4;
    setDragY(d.dy);
  };

  // Фокус не уходит из шторки; Esc закрывает
  const onKeyDown = (e: RKeyboardEvent) => {
    e.stopPropagation();
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
      return;
    }
    if (e.key !== 'Tab' || !sheet.current) return;
    const items = [...sheet.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((n) => n.offsetParent !== null);
    if (!items.length) return;
    const first = items[0]!;
    const last = items[items.length - 1]!;
    if (e.shiftKey && (document.activeElement === first || document.activeElement === sheet.current)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  const dragging = dragY !== 0;
  return (
    <>
      <div className={cn('rl-scrim', side && 'rl-scrim--side', state === 'open' && 'is-open')} onClick={close} aria-hidden />
      <div
        ref={sheet}
        className={cn('rl-sheet', side ? 'rl-sheet--side' : 'rl-sheet--bottom', state === 'open' && 'is-open', dragging && 'is-dragging')}
        style={dragging ? { transform: `translate3d(0, ${dragY}px, 0)` } : undefined}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`rl-sheet-title-${post.id}`}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        onWheel={(e) => e.stopPropagation()}
      >
        <div className="rl-sheet__head" onPointerDown={handleDown} onPointerMove={handleMove} onPointerUp={finishDrag} onPointerCancel={finishDrag}>
          {!side && <span className="rl-sheet__handle" aria-hidden />}
          <h2 className="rl-sheet__title" id={`rl-sheet-title-${post.id}`}>
            {post.stats.comments ? `${post.stats.comments} ${plural(post.stats.comments, 'комментарий', 'комментария', 'комментариев')}` : 'Комментарии'}
          </h2>
          <button type="button" className="rl-sheet__close" onClick={close} aria-label="Закрыть комментарии">
            <X size={20} />
          </button>
        </div>
        <div className="rl-sheet__body" ref={body}>
          <CommentsSection postId={post.id} postAuthorId={post.author.id} count={post.stats.comments} disabled={post.commentsDisabled} inputAtBottom />
        </div>
      </div>
    </>
  );
}
