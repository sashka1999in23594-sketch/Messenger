import { useState, type ReactNode } from 'react';
import { Link, NavLink } from 'react-router';
import { useMutation } from '@tanstack/react-query';
import { REPORT_REASON_LABELS, REPORT_REASONS, type ReportReason, type UserSummary } from '@omni/shared';
import { api, errorMessage } from '../api/client';
import { useInfiniteScroll } from '../hooks';
import { cn } from '../lib/format';
import { toast } from '../stores/ui';
import { Avatar, Verified } from './Avatar';
import { Button } from './Button';
import { Spinner } from './Feedback';
import { Modal } from './Modal';

export function UserName({ user, className }: { user: UserSummary; className?: string }) {
  return (
    <span className={cn('row gap-1', className)} style={{ display: 'inline-flex' }}>
      <span className="bold ellipsis">{user.displayName}</span>
      {user.verified && <Verified size={15} />}
    </span>
  );
}

export function UserRow({ user, sub, action, onClick, link = true }: { user: UserSummary; sub?: ReactNode; action?: ReactNode; onClick?: () => void; link?: boolean }) {
  const body = (
    <>
      <Avatar src={user.avatarUrl} name={user.displayName} id={user.id} size={44} />
      <span className="list-item__body">
        <UserName user={user} />
        <span className="list-item__sub ellipsis" style={{ display: 'block' }}>
          {sub ?? `@${user.username}`}
        </span>
      </span>
    </>
  );
  return (
    <div className="list-item" style={{ paddingRight: 12 }}>
      {onClick ? (
        <button className="row grow" style={{ gap: 12, textAlign: 'left' }} onClick={onClick}>
          {body}
        </button>
      ) : link ? (
        <Link to={`/u/${user.username}`} className="row grow" style={{ gap: 12, color: 'inherit', textDecoration: 'none' }}>
          {body}
        </Link>
      ) : (
        <span className="row grow" style={{ gap: 12 }}>
          {body}
        </span>
      )}
      {action}
    </div>
  );
}

/** Маячок для бесконечной подгрузки. */
export function LoadMore({ hasMore, loading, onLoad }: { hasMore: boolean; loading: boolean; onLoad: () => void }) {
  const ref = useInfiniteScroll(onLoad, hasMore && !loading);
  if (!hasMore && !loading) return null;
  return (
    <div ref={ref} className="center-fill" style={{ padding: 24 }}>
      {loading && <Spinner />}
    </div>
  );
}

export function TabLinks({ tabs, className }: { tabs: { to: string; label: string; end?: boolean; count?: number }[]; className?: string }) {
  return (
    <nav className={cn('tabs', className)}>
      {tabs.map((t) => (
        <NavLink key={t.to} to={t.to} end={t.end ?? true} className={({ isActive }) => cn('tab', isActive && 'tab--active')}>
          {t.label}
          {t.count ? (
            <span className="badge" style={{ marginLeft: 6 }}>
              {t.count}
            </span>
          ) : null}
        </NavLink>
      ))}
    </nav>
  );
}

export function Segmented<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[] }) {
  return (
    <div className="segmented" role="group">
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={value === o.value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function ReportDialog({
  open,
  onClose,
  entityType,
  entityId,
}: {
  open: boolean;
  onClose: () => void;
  entityType: 'user' | 'post' | 'comment' | 'message' | 'chat' | 'community' | 'story';
  entityId: string;
}) {
  const [reason, setReason] = useState<ReportReason>('spam');
  const [details, setDetails] = useState('');
  const send = useMutation({
    mutationFn: () => api.post('/reports', { entityType, entityId, reason, details }),
    onSuccess: () => {
      toast({ text: 'Жалоба отправлена. Спасибо, что помогаете сделать Sunnet безопаснее', kind: 'success' });
      onClose();
    },
    onError: (e) => toast({ text: errorMessage(e), kind: 'error' }),
  });
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Пожаловаться"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button variant="danger" loading={send.isPending} onClick={() => send.mutate()}>
            Отправить
          </Button>
        </>
      }
    >
      <div className="col" style={{ gap: 4 }}>
        {REPORT_REASONS.map((r) => (
          <label key={r} className="list-item" style={{ cursor: 'pointer', borderRadius: 12, paddingLeft: 8 }}>
            <input type="radio" name="reason" checked={reason === r} onChange={() => setReason(r)} />
            <span>{REPORT_REASON_LABELS[r]}</span>
          </label>
        ))}
        <textarea className="textarea" placeholder="Подробности (необязательно)" value={details} onChange={(e) => setDetails(e.target.value)} maxLength={1000} />
      </div>
    </Modal>
  );
}
