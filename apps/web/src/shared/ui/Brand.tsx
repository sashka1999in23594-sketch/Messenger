import { useId } from 'react';

/** Знак SpaceUp: планета на орбите со спутником. */
export function Logo({ size = 40, className }: { size?: number; className?: string }) {
  const id = useId();
  return (
    <svg className={className ? `logo ${className}` : 'logo'} width={size} height={size} viewBox="0 0 48 48" aria-hidden>
      <defs>
        <linearGradient id={`${id}-bg`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" style={{ stopColor: 'var(--brand-bg-1)' }} />
          <stop offset="1" style={{ stopColor: 'var(--brand-bg-2)' }} />
        </linearGradient>
        <radialGradient id={`${id}-pl`} cx="0.35" cy="0.3" r="0.8">
          <stop offset="0" style={{ stopColor: 'var(--brand-light)' }} />
          <stop offset="0.45" style={{ stopColor: 'var(--brand-1)' }} />
          <stop offset="1" style={{ stopColor: 'var(--brand-2)' }} />
        </radialGradient>
        <linearGradient id={`${id}-rg`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" style={{ stopColor: 'var(--brand-star)', stopOpacity: 0.2 }} />
          <stop offset="0.5" style={{ stopColor: 'var(--brand-star)' }} />
          <stop offset="1" style={{ stopColor: 'var(--brand-glow)' }} />
        </linearGradient>
      </defs>
      <rect width="48" height="48" rx="14" fill={`url(#${id}-bg)`} />
      <circle cx="9" cy="11" r="0.8" style={{ fill: 'var(--brand-star)' }} opacity="0.8" />
      <circle cx="38" cy="8" r="0.6" style={{ fill: 'var(--brand-star)' }} opacity="0.6" />
      <circle cx="40" cy="38" r="0.7" style={{ fill: 'var(--brand-star)' }} opacity="0.7" />
      <g transform="rotate(-24 24 24)">
        <path d="M 5 24 A 19 7.2 0 0 1 43 24" fill="none" stroke={`url(#${id}-rg)`} strokeWidth="2.4" strokeLinecap="round" opacity="0.55" />
      </g>
      <circle cx="24" cy="24" r="9.5" fill={`url(#${id}-pl)`} />
      <g transform="rotate(-24 24 24)">
        <path d="M 43 24 A 19 7.2 0 0 1 5 24" fill="none" stroke={`url(#${id}-rg)`} strokeWidth="2.4" strokeLinecap="round" />
        <circle className="logo__sat" cx="41.9" cy="26.5" r="2.7" style={{ fill: 'var(--brand-star)' }} />
      </g>
    </svg>
  );
}

/** Логотип со словом «SpaceUp». */
export function Wordmark({ size = 36 }: { size?: number }) {
  return (
    <span className="row" style={{ gap: size * 0.3 }}>
      <Logo size={size} />
      <span className="wordmark" style={{ fontSize: size * 0.62 }}>
        SpaceUp
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
