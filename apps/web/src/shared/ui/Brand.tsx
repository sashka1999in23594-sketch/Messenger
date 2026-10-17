import { useId } from 'react';

/** Знак Omni: «орбита» на градиенте текущего акцента. */
export function Logo({ size = 40, className }: { size?: number; className?: string }) {
  const id = useId();
  return (
    <svg className={className ? `logo ${className}` : 'logo'} width={size} height={size} viewBox="0 0 48 48" aria-hidden>
      <defs>
        <linearGradient id={`${id}-g`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" style={{ stopColor: 'var(--accent)' }} />
          <stop offset="1" style={{ stopColor: 'var(--accent-2)' }} />
        </linearGradient>
        <linearGradient id={`${id}-s`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0.35" />
          <stop offset="0.5" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
      </defs>
      <rect x="2" y="2" width="44" height="44" rx="15" fill={`url(#${id}-g)`} />
      <rect x="2" y="2" width="44" height="44" rx="15" fill={`url(#${id}-s)`} />
      <circle cx="23" cy="25" r="10" fill="none" stroke="#fff" strokeWidth="4.6" />
      <circle cx="33.2" cy="14.8" r="3.8" fill="#fff" />
    </svg>
  );
}

/** Логотип со словом «Omni». */
export function Wordmark({ size = 36 }: { size?: number }) {
  return (
    <span className="row" style={{ gap: size * 0.3 }}>
      <Logo size={size} />
      <span className="wordmark" style={{ fontSize: size * 0.62 }}>
        Omni
      </span>
    </span>
  );
}

/** Фон «северное сияние» — один на всё приложение. */
export function Aurora() {
  return (
    <div className="aurora" aria-hidden>
      <div className="aurora__blob aurora__blob--1" />
      <div className="aurora__blob aurora__blob--2" />
      <div className="aurora__blob aurora__blob--3" />
      <div className="aurora__noise" />
    </div>
  );
}
