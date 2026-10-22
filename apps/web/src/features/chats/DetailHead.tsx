import type { ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { ChevronLeft } from 'lucide-react';

/**
 * Шапка вложенного экрана мессенджера (новый чат, папки, обзор) — видна, когда
 * мессенджер в одну колонку (телефон, узкое окно): «Назад» к списку и заголовок.
 */
export function DetailHead({ title, back, actions }: { title: string; back?: string; actions?: ReactNode }) {
  const navigate = useNavigate();
  const { pathname, key } = useLocation();
  const fallback = back ?? (pathname.startsWith('/channels') ? '/channels' : '/chats');
  return (
    <header className="detail-head">
      <button
        type="button"
        className="chat-back"
        style={{ display: 'inline-flex' }}
        aria-label="Назад"
        onClick={() => (key !== 'default' ? navigate(-1) : navigate(fallback, { replace: true }))}
      >
        <ChevronLeft size={28} strokeWidth={2.2} />
      </button>
      <span className="detail-head__title">{title}</span>
      {actions}
    </header>
  );
}
