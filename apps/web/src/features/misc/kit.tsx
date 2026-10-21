/**
 * Набор для страниц ленты, профиля, поиска и настроек: шторка действий
 * (на телефоне — снизу, мышью — обычное меню), «Поделиться» с отправкой
 * в личку и QR-кодом, вкладки с подчёркиванием, «потяните, чтобы обновить».
 */
import { useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { NavLink } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Check, Copy, QrCode, Search, Share, X } from 'lucide-react';
import QRCode from 'qrcode';
import type { ChatSummary, UserSummary } from '@omni/shared';
import { api, errorMessage } from '../../shared/api/client';
import { useEscape, useMediaQuery } from '../../shared/hooks';
import { cn, randomId } from '../../shared/lib/format';
import { useMe } from '../../shared/stores/session';
import { toast } from '../../shared/stores/ui';
import { Avatar, Menu, Spinner, type MenuEntry } from '../../shared/ui';
import './kit.css';

/** Сенсорный экран: меню превращаются в шторки, подсказки — в долгие нажатия. */
export const useCoarse = () => useMediaQuery('(pointer: coarse)');

// ─── Шторка снизу ──────────────────────────────────────────────────────────

/** Шторка снизу: смахивается вниз, закрывается по фону и Esc. На широком экране — окно по центру. */
export function Sheet({
  open,
  onClose,
  title,
  children,
  className,
  full,
  locked,
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  className?: string;
  /** Почти на весь экран (редактор, длинные списки) */
  full?: boolean;
  /** Не закрывается по фону, Esc и смахиванию — только своей кнопкой (редактор с несохранённым текстом) */
  locked?: boolean;
}) {
  useEscape(onClose, open && !locked);
  const panel = useRef<HTMLDivElement>(null);
  const drag = useRef<{ y: number; dy: number } | null>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    panel.current?.focus();
    return () => prev?.focus?.();
  }, [open]);
  if (!open) return null;
  const onStart = (e: React.TouchEvent) => {
    if (locked) return;
    const scroller = (e.target as HTMLElement).closest('.pk-sheet__body');
    if (scroller && scroller.scrollTop > 0) return;
    drag.current = { y: e.touches[0]!.clientY, dy: 0 };
  };
  const onMove = (e: React.TouchEvent) => {
    const d = drag.current;
    if (!d || !panel.current) return;
    d.dy = Math.max(0, e.touches[0]!.clientY - d.y);
    panel.current.style.transform = d.dy ? `translateY(${d.dy}px)` : '';
  };
  const onEnd = () => {
    const d = drag.current;
    drag.current = null;
    if (!panel.current) return;
    panel.current.style.transform = '';
    if (d && d.dy > 90) onClose();
  };
  return createPortal(
    <div className="pk-sheet-overlay" onPointerDown={(e) => !locked && e.target === e.currentTarget && onClose()}>
      <div
        ref={panel}
        className={cn('pk-sheet', full && 'pk-sheet--full', className)}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        onTouchStart={onStart}
        onTouchMove={onMove}
        onTouchEnd={onEnd}
      >
        {!locked && <span className="pk-sheet__grip" aria-hidden />}
        {title && (
          <div className="pk-sheet__head">
            <span className="pk-sheet__title">{title}</span>
            <button type="button" className="pk-sheet__x" onClick={onClose} aria-label="Закрыть">
              <X size={20} />
            </button>
          </div>
        )}
        <div className="pk-sheet__body">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

/** Список действий в шторке: крупные строки, опасные — красным. */
export function ActionList({ items, onDone }: { items: MenuEntry[]; onDone: () => void }) {
  const visible = items.filter((i) => i === 'separator' || !i.hidden);
  return (
    <div className="pk-actions" role="menu">
      {visible.map((item, i) =>
        item === 'separator' ? (
          <div key={`sep-${i}`} className="pk-actions__sep" />
        ) : (
          <button
            key={item.label}
            type="button"
            role="menuitem"
            className={cn('pk-actions__item', item.danger && 'pk-actions__item--danger')}
            onClick={() => {
              onDone();
              item.onClick();
            }}
          >
            <span className="pk-actions__icon">{item.icon}</span>
            {item.label}
          </button>
        ),
      )}
    </div>
  );
}

/**
 * Меню «⋯»: на сенсорном экране — шторка снизу, мышью — всплывающее меню у кнопки.
 * Возвращает обработчик для кнопки и элемент, который нужно отрисовать рядом.
 */
export function useOptions(items: MenuEntry[], header?: ReactNode) {
  const coarse = useCoarse();
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);
  const [sheet, setSheet] = useState(false);
  const open = (e: { currentTarget: Element; clientX?: number; clientY?: number; preventDefault?: () => void; stopPropagation?: () => void }) => {
    e.preventDefault?.();
    e.stopPropagation?.();
    if (coarse) return setSheet(true);
    if (e.clientX && e.clientY) return setAnchor({ x: e.clientX, y: e.clientY });
    const r = e.currentTarget.getBoundingClientRect();
    setAnchor({ x: r.right - 230, y: r.bottom + 4 });
  };
  const element = (
    <>
      <Menu anchor={anchor} onClose={() => setAnchor(null)} items={items} header={header} />
      <Sheet open={sheet} onClose={() => setSheet(false)}>
        {header && <div className="pk-actions__header">{header}</div>}
        <ActionList items={items} onDone={() => setSheet(false)} />
      </Sheet>
    </>
  );
  return { open, element, isOpen: !!anchor || sheet };
}

// ─── Поделиться ────────────────────────────────────────────────────────────

const absolute = (path: string) => `${location.origin}${path}`;

export async function copyLink(path: string) {
  try {
    await navigator.clipboard.writeText(absolute(path));
    toast({ text: 'Ссылка скопирована', kind: 'success' });
  } catch {
    toast({ text: absolute(path) });
  }
}

/** Отправить ссылку человеку в личные сообщения. */
async function sendTo(user: UserSummary, text: string) {
  const chat = await api.post<ChatSummary>('/chats/direct', { userId: user.id });
  await api.post(`/chats/${chat.id}/messages`, { clientId: `sh${randomId(12)}`, text });
}

function QrImage({ url }: { url: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    void QRCode.toDataURL(url, { margin: 1, width: 440, errorCorrectionLevel: 'M' }).then((s) => alive && setSrc(s));
    return () => {
      alive = false;
    };
  }, [url]);
  return src ? <img className="pk-share__qr" src={src} alt="QR-код ссылки" /> : <Spinner />;
}

/**
 * «Поделиться», как в Instagram: ряд людей — отправить в личку одним нажатием,
 * ниже — скопировать ссылку, системное меню «Поделиться» и QR-код.
 */
export function ShareSheet({ path, title, onClose }: { path: string; title?: string; onClose: () => void }) {
  const me = useMe();
  const [q, setQ] = useState('');
  const [sent, setSent] = useState<Record<string, 'sending' | 'done'>>({});
  const [qr, setQr] = useState(false);
  const people = useQuery({
    queryKey: ['share-people', me.id],
    queryFn: () => api.get<{ items: UserSummary[] }>(`/users/${me.id}/following?limit=40`),
    staleTime: 5 * 60_000,
  });
  const term = q.trim().toLowerCase();
  const list = (people.data?.items ?? []).filter((u) => !term || u.displayName.toLowerCase().includes(term) || u.username.toLowerCase().includes(term));
  const url = absolute(path);
  const send = async (u: UserSummary) => {
    if (sent[u.id]) return;
    setSent((s) => ({ ...s, [u.id]: 'sending' }));
    try {
      await sendTo(u, title ? `${title}\n${url}` : url);
      setSent((s) => ({ ...s, [u.id]: 'done' }));
    } catch (e) {
      setSent((s) => {
        const next = { ...s };
        delete next[u.id];
        return next;
      });
      toast({ text: errorMessage(e), kind: 'error' });
    }
  };
  const canShare = typeof navigator !== 'undefined' && !!navigator.share;
  return (
    <Sheet open onClose={onClose} title="Поделиться" className="pk-share">
      {qr ? (
        <div className="pk-share__qrbox">
          <QrImage url={url} />
          <span className="pk-share__url">{url.replace(/^https?:\/\//, '')}</span>
          <button type="button" className="pk-pill" onClick={() => setQr(false)}>
            Назад
          </button>
        </div>
      ) : (
        <>
          <label className="pk-search">
            <Search size={17} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Найти человека" aria-label="Найти человека" />
          </label>
          <div className="pk-share__people">
            {people.isLoading && <Spinner />}
            {list.map((u) => (
              <button key={u.id} type="button" className="pk-share__person" onClick={() => void send(u)} aria-label={`Отправить: ${u.displayName}`}>
                <span className="pk-share__avatar">
                  <Avatar src={u.avatarUrl} name={u.displayName} id={u.id} size={58} />
                  {sent[u.id] && <span className="pk-share__sent">{sent[u.id] === 'done' ? <Check size={14} strokeWidth={3} /> : <Spinner />}</span>}
                </span>
                <span className="pk-share__name">{sent[u.id] === 'done' ? 'Отправлено' : u.displayName.split(' ')[0]}</span>
              </button>
            ))}
            {!people.isLoading && !list.length && <span className="pk-share__empty">{term ? 'Никого не нашли' : 'Подпишитесь на друзей, чтобы отправлять им публикации'}</span>}
          </div>
          <div className="pk-share__actions">
            <button type="button" className="pk-share__action" onClick={() => void copyLink(path).then(onClose)}>
              <span>
                <Copy size={22} />
              </span>
              Копировать ссылку
            </button>
            {canShare && (
              <button type="button" className="pk-share__action" onClick={() => void navigator.share({ url, title }).catch(() => undefined)}>
                <span>
                  <Share size={22} />
                </span>
                Ещё…
              </button>
            )}
            <button type="button" className="pk-share__action" onClick={() => setQr(true)}>
              <span>
                <QrCode size={22} />
              </span>
              QR-код
            </button>
          </div>
        </>
      )}
    </Sheet>
  );
}

// ─── Вкладки с подчёркиванием ──────────────────────────────────────────────

export interface UTab {
  to: string;
  label: string;
  icon?: ReactNode;
  end?: boolean;
  count?: number;
}

/** Вкладки во всю ширину с полоской под активной (как в Instagram и Threads). */
export function UnderlineTabs({ tabs, iconsOnly, className, sticky }: { tabs: UTab[]; iconsOnly?: boolean; className?: string; sticky?: boolean }) {
  return (
    <nav className={cn('pk-utabs', iconsOnly && 'pk-utabs--icons', sticky && 'pk-utabs--sticky', className)}>
      {tabs.map((t) => (
        <NavLink
          key={t.to}
          to={t.to}
          end={t.end ?? true}
          replace
          className={({ isActive }) => cn('pk-utab', isActive && 'pk-utab--active')}
          aria-label={iconsOnly ? t.label : undefined}
          title={iconsOnly ? t.label : undefined}
        >
          {t.icon}
          {!iconsOnly && <span>{t.label}</span>}
          {t.count ? <span className="pk-utab__count">{t.count > 99 ? '99+' : t.count}</span> : null}
        </NavLink>
      ))}
    </nav>
  );
}

/** Чипы-фильтры с горизонтальной прокруткой (ссылки). */
export function ChipLinks({ tabs, className }: { tabs: UTab[]; className?: string }) {
  return (
    <nav className={cn('pk-chips', className)}>
      {tabs.map((t) => (
        <NavLink key={t.to} to={t.to} end={t.end ?? true} replace className={({ isActive }) => cn('pk-chip', isActive && 'pk-chip--on')}>
          {t.icon}
          {t.label}
          {t.count ? <span className="pk-chip__count">{t.count > 99 ? '99+' : t.count}</span> : null}
        </NavLink>
      ))}
    </nav>
  );
}

// ─── Потяните, чтобы обновить ──────────────────────────────────────────────

const PULL_MAX = 96;
const PULL_TRIGGER = 64;

/**
 * Обновление жестом вниз от верха списка (только сенсорный экран).
 * Возвращает индикатор, который нужно поставить первым в прокручиваемом блоке.
 */
export function usePullToRefresh(scroller: RefObject<HTMLElement | null>, onRefresh: () => Promise<unknown>) {
  const [pull, setPull] = useState(0);
  const [busy, setBusy] = useState(false);
  const start = useRef<number | null>(null);
  const cb = useRef(onRefresh);
  cb.current = onRefresh;
  const run = useCallback(async () => {
    setBusy(true);
    setPull(PULL_TRIGGER * 0.75);
    try {
      await cb.current();
    } finally {
      setBusy(false);
      setPull(0);
    }
  }, []);
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    let current = 0;
    const onStart = (e: TouchEvent) => {
      start.current = el.scrollTop <= 0 && !busy ? e.touches[0]!.clientY : null;
    };
    const onMove = (e: TouchEvent) => {
      if (start.current === null) return;
      const dy = e.touches[0]!.clientY - start.current;
      if (dy <= 0 || el.scrollTop > 0) {
        current = 0;
        setPull(0);
        return;
      }
      // Сопротивление: чем дальше, тем туже
      current = Math.min(PULL_MAX, dy * 0.5);
      setPull(current);
      if (e.cancelable && dy > 6) e.preventDefault();
    };
    const onEnd = () => {
      if (start.current === null) return;
      start.current = null;
      if (current >= PULL_TRIGGER) void run();
      else setPull(0);
      current = 0;
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
  }, [scroller, busy, run]);
  const indicator = (
    <div className="pk-ptr" style={{ height: pull }} aria-hidden={!busy}>
      <span className={cn('pk-ptr__spin', busy && 'pk-ptr__spin--on')} style={{ transform: `rotate(${pull * 4}deg)`, opacity: Math.min(1, pull / PULL_TRIGGER) }} />
    </div>
  );
  return { indicator, refreshing: busy };
}

// ─── Мелочи ────────────────────────────────────────────────────────────────

/** Короткое время, как в Instagram: «5 мин», «3 ч», «2 д», «4 нед.», дальше — дата. */
export function shortAgo(iso: string): string {
  const diff = (Date.now() - Date.parse(iso)) / 1000;
  if (diff < 60) return 'сейчас';
  if (diff < 3600) return `${Math.floor(diff / 60)} мин`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} ч`;
  if (diff < 7 * 86400) return `${Math.floor(diff / 86400)} д`;
  if (diff < 35 * 86400) return `${Math.floor(diff / (7 * 86400))} нед.`;
  const d = new Date(iso);
  return d.toLocaleDateString('ru', d.getFullYear() === new Date().getFullYear() ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Заголовок раздела списка (мелкими заглавными, как в настройках iOS). */
export function GroupTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="pk-group-title">
      <span>{children}</span>
      {action}
    </div>
  );
}

/** Крупный заголовок страницы для узкого экрана (иконка — только на широком). */
export function LargeTitle({ title, sub, actions }: { title: ReactNode; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="pk-large-title">
      <div className="pk-large-title__text">
        <h1>{title}</h1>
        {sub && <p>{sub}</p>}
      </div>
      {actions && <div className="pk-large-title__actions">{actions}</div>}
    </header>
  );
}
