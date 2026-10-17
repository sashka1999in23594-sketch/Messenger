import type { ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, Info } from 'lucide-react';
import { useUi } from '../stores/ui';
import { cn } from '../lib/format';
import { errorMessage } from '../api/client';
import { Button } from './Button';

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
