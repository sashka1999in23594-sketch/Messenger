/**
 * Подтверждение входа по QR-коду на устройстве, где вы уже вошли: телефон
 * открывает ссылку из QR-кода, человек видит, какое устройство просит войти,
 * и разрешает или отклоняет вход.
 */
import { useState } from 'react';
import { useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, Monitor, ShieldAlert, XCircle } from 'lucide-react';
import type { QrLoginInfo } from '@omni/shared';
import { api, errorMessage } from '../../shared/api/client';
import { fullDate } from '../../shared/lib/format';
import { toast } from '../../shared/stores/ui';
import { Button, ButtonLink, EmptyState, Loading } from '../../shared/ui';
import './auth.css';

export function QrApprovePage() {
  const { token = '' } = useParams();
  const q = useQuery({ queryKey: ['qr-login', token], queryFn: () => api.get<QrLoginInfo>(`/auth/qr/${token}`), retry: false, staleTime: Infinity });
  const [done, setDone] = useState<'approved' | 'rejected' | null>(null);
  const [busy, setBusy] = useState<'approve' | 'reject' | null>(null);

  const decide = async (approve: boolean) => {
    setBusy(approve ? 'approve' : 'reject');
    try {
      await api.post(`/auth/qr/${token}/${approve ? 'approve' : 'reject'}`);
      setDone(approve ? 'approved' : 'rejected');
    } catch (e) {
      toast({ text: errorMessage(e), kind: 'error' });
    } finally {
      setBusy(null);
    }
  };

  let body;
  if (done) {
    body = (
      <EmptyState
        icon={done === 'approved' ? <CheckCircle2 size={30} /> : <XCircle size={30} />}
        title={done === 'approved' ? 'Вход разрешён' : 'Вход отклонён'}
        text={done === 'approved' ? 'На новом устройстве осталось ввести пароль.' : 'Новое устройство не получит доступ к аккаунту.'}
        action={<ButtonLink to="/">Вернуться в Sunnet</ButtonLink>}
      />
    );
  } else if (q.isLoading) {
    body = <Loading />;
  } else if (q.isError || !q.data) {
    body = (
      <EmptyState
        icon={<ShieldAlert size={30} />}
        title="QR-код устарел"
        text="Код действует 2 минуты. Попросите показать новый QR-код на устройстве, где вы входите."
        action={<ButtonLink to="/">Вернуться в Sunnet</ButtonLink>}
      />
    );
  } else {
    const d = q.data;
    body = (
      <div className="qr-approve">
        <span className="qr-approve__icon">
          <Monitor size={30} />
        </span>
        <h1 className="auth__title">Разрешить вход?</h1>
        <p className="auth__text">На этом устройстве хотят войти в ваш аккаунт по QR-коду:</p>
        <dl className="qr-approve__info">
          <dt>Система</dt>
          <dd>{d.os}</dd>
          <dt>Браузер</dt>
          <dd>{d.browser}</dd>
          <dt>IP-адрес</dt>
          <dd>{d.ip}</dd>
          <dt>Время</dt>
          <dd>{fullDate(d.createdAt)}</dd>
        </dl>
        <p className="qr-approve__warn">
          <ShieldAlert size={16} />
          Разрешайте, только если это вы сейчас входите. Не сканируйте QR-коды, которые вам прислали другие люди.
        </p>
        <div className="row gap-2" style={{ width: '100%' }}>
          <Button variant="secondary" block loading={busy === 'reject'} disabled={!!busy} onClick={() => void decide(false)}>
            Отклонить
          </Button>
          <Button block loading={busy === 'approve'} disabled={!!busy} onClick={() => void decide(true)}>
            Разрешить вход
          </Button>
        </div>
      </div>
    );
  }
  return (
    <div className="scroll">
      <div className="page qr-approve__page">{body}</div>
    </div>
  );
}
