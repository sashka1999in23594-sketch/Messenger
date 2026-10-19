/**
 * Общее для входа, регистрации и скачивания: на компьютере — голубое небо с
 * солнцем слева вверху и карточка с одним шагом посередине; на телефоне —
 * только поля на весь экран. Маленькие синие ссылки — внизу карточки.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import QRCodeLib from 'qrcode';
import { useAuthConfig } from '../../shared/api/config';
import { useMediaQuery } from '../../shared/hooks';
import { usePrefs } from '../../shared/stores/prefs';
import { Logo } from '../../shared/ui';
import { DevMailbox } from './DevMailbox';
import { Sky } from './Sky';
import './auth.css';

export function AuthLayout({ children, links }: { children: ReactNode; links?: ReactNode }) {
  const reduceMotion = usePrefs((s) => s.reduceMotion);
  const wide = useMediaQuery('(min-width: 900px)');
  return (
    // Днём на небе карточка светлая при любой теме; на телефоне — тема пользователя
    <div className="auth" data-theme={wide ? 'light' : undefined}>
      {wide && <Sky still={reduceMotion} />}
      <main className="auth__main">
        <div className="auth__panel">
          {children}
          {links && <nav className="auth__links">{links}</nav>}
        </div>
      </main>
    </div>
  );
}

/** Заголовок шага. */
export function StepTitle({ title, text }: { title: ReactNode; text?: ReactNode }) {
  return (
    <header className="auth__head">
      <h1 className="auth__title">{title}</h1>
      {text && <p className="auth__text">{text}</p>}
    </header>
  );
}

type LinkItem = { label: string; to?: string; onClick?: () => void; external?: boolean };

/** Маленькие синие ссылки под карточкой. */
export function AuthLinks({ items }: { items: (LinkItem | false | null | undefined)[] }) {
  const config = useAuthConfig();
  const [mailOpen, setMailOpen] = useState(false);
  const list = items.filter(Boolean) as LinkItem[];
  return (
    <>
      {list.map((l) =>
        l.onClick ? (
          <button key={l.label} type="button" className="auth__link" onClick={l.onClick}>
            {l.label}
          </button>
        ) : (
          <Link key={l.label} to={l.to!} className="auth__link" target={l.external ? '_blank' : undefined}>
            {l.label}
          </Link>
        ),
      )}
      {config.data?.mail.dev && (
        <>
          <button type="button" className="auth__link auth__link--dev" onClick={() => setMailOpen(true)}>
            Тестовая почта
          </button>
          <DevMailbox open={mailOpen} onClose={() => setMailOpen(false)} />
        </>
      )}
    </>
  );
}

/** Стандартные ссылки: «Помощь», «Скачать», «Сотрудничество». */
export const HELP_LINK: LinkItem = { label: 'Помощь', to: '/help' };
export const DOWNLOAD_LINK: LinkItem = { label: 'Скачать', to: '/download' };
export const PARTNERS_LINK: LinkItem = { label: 'Сотрудничество', to: '/help/partners' };

/** Обратный отсчёт до момента (секунды с сервера → локальный таймер). */
export function useSecondsLeft(seconds: number | null | undefined, key?: unknown): number {
  const deadline = (s: number | null | undefined) => ({ seconds: s, key, until: s ? Date.now() + s * 1000 : 0 });
  const [base, setBase] = useState(() => deadline(seconds));
  const [, tick] = useState(0);
  // Новое значение с сервера учитываем в этом же рендере: иначе на один кадр
  // остаётся старый срок (или ноль), и зависящие от него эффекты срабатывают зря
  let until = base.until;
  if (base.seconds !== seconds || base.key !== key) {
    const next = deadline(seconds);
    until = next.until;
    setBase(next);
  }
  const left = Math.max(0, Math.ceil((until - Date.now()) / 1000));
  useEffect(() => {
    if (left <= 0) return;
    const t = setTimeout(() => tick((v) => v + 1), 1000);
    return () => clearTimeout(t);
  }, [left]);
  return left;
}

export const mmss = (sec: number) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
export const minutes = (sec: number) => (sec >= 60 ? `${Math.ceil(sec / 60)} мин` : `${sec} с`);

/** QR-код в виде SVG: скруглённые модули и логотип в центре (уровень коррекции H). */
export function QrCode({ value, size = 220 }: { value: string; size?: number }) {
  const qr = useMemo(() => {
    const m = QRCodeLib.create(value, { errorCorrectionLevel: 'H' }).modules;
    return { size: m.size, data: Array.from({ length: m.size }, (_, y) => Array.from({ length: m.size }, (_, x) => !!m.get(y, x))) };
  }, [value]);
  const n = qr.size;
  const finder = (x: number, y: number) => (x < 7 && y < 7) || (x >= n - 7 && y < 7) || (x < 7 && y >= n - 7);
  const hole = Math.round(n * 0.26) | 1;
  const from = Math.floor((n - hole) / 2);
  const inHole = (x: number, y: number) => x >= from && x < from + hole && y >= from && y < from + hole;
  const cells: ReactNode[] = [];
  qr.data.forEach((row, y) =>
    row.forEach((on, x) => {
      if (on && !finder(x, y) && !inHole(x, y)) cells.push(<rect key={`${x}-${y}`} x={x + 0.08} y={y + 0.08} width={0.84} height={0.84} rx={0.32} />);
    }),
  );
  const eye = (x: number, y: number) => (
    <g key={`eye-${x}-${y}`}>
      <rect x={x + 0.5} y={y + 0.5} width={6} height={6} rx={1.8} fill="none" stroke="currentColor" strokeWidth={1} />
      <rect x={x + 2} y={y + 2} width={3} height={3} rx={0.9} />
    </g>
  );
  return (
    <div className="qr" style={{ width: size, height: size }}>
      <svg viewBox={`-1 -1 ${n + 2} ${n + 2}`} width={size} height={size} role="img" aria-label="QR-код для входа">
        <rect x={-1} y={-1} width={n + 2} height={n + 2} rx={3} className="qr__bg" />
        <g className="qr__fg">
          {cells}
          {eye(0, 0)}
          {eye(n - 7, 0)}
          {eye(0, n - 7)}
        </g>
      </svg>
      <span className="qr__logo" style={{ width: (size * hole) / (n + 2), height: (size * hole) / (n + 2) }}>
        <Logo size={Math.round(((size * hole) / (n + 2)) * 0.82)} />
      </span>
    </div>
  );
}
