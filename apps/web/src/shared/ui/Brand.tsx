import { DAY_NAME, NIGHT_NAME, useBrand } from '../lib/brand';
import './brand.css';

/**
 * Знак Sunnet — закат: солнце в облаках с лучами. При наведении солнце
 * разгорается, лучи мерцают, а кадр чуть приближается к солнцу. Ночью в
 * установленном приложении — Lynnet: реалистичная луна на звёздном небе.
 */
export function Logo({ size = 40, className }: { size?: number; className?: string }) {
  const night = useBrand((s) => s.night);
  const cls = ['logo', night ? 'logo--night' : 'logo--day', className].filter(Boolean).join(' ');
  return (
    <span className={cls} style={{ width: size, height: size }} aria-hidden>
      <img className="logo__img" src={night ? '/brand/night.webp' : '/brand/day.webp'} alt="" draggable={false} />
      <span className="logo__beams" />
      <span className="logo__glow" />
    </span>
  );
}

/** Логотип со словом: Sunnet днём, Lynnet ночью в установленном приложении. */
export function Wordmark({ size = 36 }: { size?: number }) {
  const night = useBrand((s) => s.night);
  return (
    <span className="row" style={{ gap: size * 0.3 }}>
      <Logo size={size} />
      <span className="wordmark" style={{ fontSize: size * 0.62 }}>
        {night ? NIGHT_NAME : DAY_NAME}
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
