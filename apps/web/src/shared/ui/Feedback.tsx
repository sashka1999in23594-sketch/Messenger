import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, Info } from 'lucide-react';
import { useUi } from '../stores/ui';
import { cn } from '../lib/format';
import { errorMessage } from '../api/client';
import { Button } from './Button';
import { brandName, useBrand } from '../lib/brand';

export function Spinner({ large }: { large?: boolean }) {
  return <span className={cn('spinner', large && 'spinner--lg')} role="status" aria-label="Загрузка" />;
}

export function Loading({ label }: { label?: string }) {
  return (
    <div className="center-fill" style={{ gap: 12 }}>
      <Spinner large />
      {label && <span>{label}</span>}
    </div>
  );
}

/**
 * Неравномерный веер солнечных лучей: лучи разной ширины и яркости выглядят
 * как настоящие, а не ровной «звёздочкой». Считается один раз, детерминированно,
 * цвет берётся из переменной сцены --ss-ray, поэтому ночью лучи холодные.
 */
function rayFan(seed: number, maxAlpha: number): string {
  let s = seed >>> 0;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const stops: string[] = [];
  for (let a = 0; a < 360; ) {
    const w = 0.5 + rnd() * 3;
    const alpha = ((0.2 + rnd() * 0.8) * maxAlpha).toFixed(3);
    stops.push(`transparent ${a.toFixed(2)}deg`, `rgba(var(--ss-ray), ${alpha}) ${(a + w / 2).toFixed(2)}deg`, `transparent ${(a + w).toFixed(2)}deg`);
    a += w + 1.4 + rnd() * 6;
  }
  return `conic-gradient(from 0deg, ${stops.join(',')})`;
}
const RAY_FAN_1 = rayFan(20261022, 0.5);
const RAY_FAN_2 = rayFan(73510944, 0.34);

/**
 * Полноэкранная заставка при старте и пробуждении сервера: реалистичный закат
 * Sunnet — встающее солнце с короной, живыми лучами-веерами, бликами объектива,
 * плывущими облаками, искрами света и прогрессом снизу. Ночью сцена лунная (Lynnet).
 */
export function SunSplash({ label }: { label?: string }) {
  const night = useBrand((s) => s.night);
  const [pct, setPct] = useState(6);
  useEffect(() => {
    // Прогресс «догоняет» загрузку: быстро в начале, плавно замедляется к ~94%.
    const t = setInterval(() => setPct((p) => (p >= 94 ? p : p + Math.max(0.5, (95 - p) * 0.06))), 110);
    return () => clearInterval(t);
  }, []);
  return (
    <div className={cn('sun-splash', night && 'sun-splash--night')} role="status" aria-live="polite">
      <div className="sun-splash__sky" aria-hidden />
      <div className="sun-splash__rays sun-splash__rays--1" style={{ backgroundImage: RAY_FAN_1 } as CSSProperties} aria-hidden />
      <div className="sun-splash__rays sun-splash__rays--2" style={{ backgroundImage: RAY_FAN_2 } as CSSProperties} aria-hidden />
      <div className="sun-splash__clouds" aria-hidden>
        <span className="sun-splash__cloud sun-splash__cloud--1" />
        <span className="sun-splash__cloud sun-splash__cloud--2" />
        <span className="sun-splash__cloud sun-splash__cloud--3" />
      </div>
      <div className="sun-splash__sun" aria-hidden>
        <span className="sun-splash__sun-corona" />
        <span className="sun-splash__sun-core" />
      </div>
      <div className="sun-splash__flares" aria-hidden>
        <span className="sun-splash__flare sun-splash__flare--1" />
        <span className="sun-splash__flare sun-splash__flare--2" />
        <span className="sun-splash__flare sun-splash__flare--3" />
        <span className="sun-splash__flare sun-splash__flare--4" />
      </div>
      <div className="sun-splash__dust" aria-hidden>
        {Array.from({ length: 20 }, (_, i) => (
          <span key={i} style={{ '--i': i } as CSSProperties} />
        ))}
      </div>
      <div className="sun-splash__content">
        <div className="sun-splash__name">{brandName()}</div>
        {label && <div className="sun-splash__label">{label}</div>}
        <div className="sun-splash__bar">
          <span className="sun-splash__fill" style={{ width: `${pct}%` }} />
        </div>
        <div className="sun-splash__pct">{Math.round(pct)}%</div>
      </div>
    </div>
  );
}

export function EmptyState({ icon, title, text, action }: { icon?: ReactNode; title: string; text?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      {icon && <div className="empty__icon">{icon}</div>}
      <div className="empty__title">{title}</div>
      {text && <div className="empty__text">{text}</div>}
      {action}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <EmptyState
      icon={<AlertTriangle size={28} />}
      title="Не удалось загрузить"
      text={errorMessage(error)}
      action={
        onRetry && (
          <Button variant="secondary" onClick={onRetry}>
            Повторить
          </Button>
        )
      }
    />
  );
}

export function Skeleton({ width, height, radius, className }: { width?: number | string; height?: number | string; radius?: number; className?: string }) {
  return <span className={cn('skeleton', className)} style={{ display: 'block', width: width ?? '100%', height: height ?? 14, borderRadius: radius }} />;
}

export function ListSkeleton({ rows = 6, avatar = 44 }: { rows?: number; avatar?: number }) {
  return (
    <div aria-hidden>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="row" style={{ padding: '10px 16px', gap: 12 }}>
          <Skeleton width={avatar} height={avatar} radius={avatar} />
          <div className="col grow" style={{ gap: 8 }}>
            <Skeleton width={`${40 + ((i * 17) % 40)}%`} height={13} />
            <Skeleton width={`${55 + ((i * 23) % 35)}%`} height={11} />
          </div>
        </div>
      ))}
    </div>
  );
}

export function Toasts() {
  const toasts = useUi((s) => s.toasts);
  const dismiss = useUi((s) => s.dismiss);
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={cn('toast', t.kind === 'error' && 'toast--error', t.kind === 'success' && 'toast--success')}>
          {t.kind === 'success' ? <CheckCircle2 size={18} /> : t.kind === 'error' ? <AlertTriangle size={18} /> : <Info size={18} />}
          <span className="grow">{t.text}</span>
          {t.action && (
            <button
              className="toast__action"
              onClick={() => {
                t.action!.onClick();
                dismiss(t.id);
              }}
            >
              {t.action.label}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

export function Notice({ kind = 'info', children, icon }: { kind?: 'info' | 'warning' | 'danger' | 'success'; children: ReactNode; icon?: ReactNode }) {
  return (
    <div className={cn('notice', kind !== 'info' && `notice--${kind}`)}>
      {icon ?? (kind === 'success' ? <CheckCircle2 size={18} /> : kind === 'info' ? <Info size={18} /> : <AlertTriangle size={18} />)}
      <div>{children}</div>
    </div>
  );
}

export function PageHeader({ title, subtitle, actions, icon }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="page-header">
      {icon && <div className="page-icon">{icon}</div>}
      <div className="page-header__text">
        <h1>{title}</h1>
        {subtitle && <div className="page-header__sub">{subtitle}</div>}
      </div>
      {actions && <div className="row">{actions}</div>}
    </div>
  );
}
