import { useQuery } from '@tanstack/react-query';
import type { DevMail } from '@omni/shared';
import { api } from '../../shared/api/client';
import { timeAgo } from '../../shared/lib/format';
import { Modal, Notice } from '../../shared/ui';

/** Тестовый почтовый ящик (только в режиме разработки сервера). */
export function DevMailbox({ open, onClose }: { open: boolean; onClose: () => void }) {
  const q = useQuery({ queryKey: ['dev-mail'], queryFn: () => api.get<{ items: DevMail[] }>('/dev/mail'), enabled: open, refetchInterval: open ? 3000 : false });
  return (
    <Modal open={open} onClose={onClose} title="Тестовая почта" wide>
      <p className="small muted" style={{ marginBottom: 12 }}>
        Сервер запущен в режиме разработки: письма не уходят наружу, а складываются сюда. В production письма уходят с Gmail через Google Apps Script, Brevo, Resend или SMTP.
      </p>
      {q.data?.items.length === 0 && <Notice>Писем пока нет. Зарегистрируйтесь или запросите код — письмо появится здесь.</Notice>}
      <div className="col gap-3">
        {q.data?.items.map((m) => {
          const code = /(\d{6})/.exec(m.subject)?.[1];
          return (
            <div key={m.id} className="card card--pad col gap-2">
              <div className="row between wrap">
                <b>{m.subject}</b>
                <span className="xs faint">{timeAgo(m.createdAt)}</span>
              </div>
              <div className="xs muted">Кому: {m.to}</div>
              {code && <div className="dev-mail__code">{code}</div>}
              <details>
                <summary className="small muted" style={{ cursor: 'pointer' }}>
                  Текст письма
                </summary>
                <pre className="dev-mail__text">{m.text}</pre>
              </details>
            </div>
          );
        })}
      </div>
    </Modal>
  );
}
