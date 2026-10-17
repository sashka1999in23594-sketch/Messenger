import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { useMutation } from '@tanstack/react-query';
import QRCode from 'qrcode';
import { CheckCircle2, Copy, Download, KeyRound, Mail, ShieldCheck, Smartphone } from 'lucide-react';
import type { TotpSetup } from '@omni/shared';
import { api, ApiError, errorMessage } from '../../shared/api/client';
import { useAuthConfig } from '../../shared/api/config';
import { useCountdown } from '../../shared/hooks';
import { useMe } from '../../shared/stores/session';
import { toast } from '../../shared/stores/ui';
import { Button, CodeInput, Input, Notice, PasswordInput } from '../../shared/ui';
import { Panel, SettingsPage, useRefreshMe } from './common';

function RecoveryCodes({ codes }: { codes: string[] }) {
  return (
    <div className="col gap-3">
      <Notice kind="warning">Сохраните резервные коды в надёжном месте. Каждый код работает один раз — для входа, если нет доступа к телефону или почте. Больше мы их не покажем.</Notice>
      <div className="recovery-codes">
        {codes.map((c) => (
          <span key={c}>{c}</span>
        ))}
      </div>
      <div className="row wrap">
        <Button variant="secondary" icon={<Copy size={16} />} onClick={() => void navigator.clipboard.writeText(codes.join('\n')).then(() => toast('Коды скопированы'))}>
          Скопировать
        </Button>
        <a className="btn btn--secondary" download="omni-recovery-codes.txt" href={`data:text/plain;charset=utf-8,${encodeURIComponent(`Резервные коды Omni\n\n${codes.join('\n')}\n`)}`}>
          <Download size={16} /> Скачать .txt
        </a>
      </div>
    </div>
  );
}

function useFormErrors() {
  const [fields, setFields] = useState<Record<string, string>>({});
  const onError = (e: unknown) => {
    if (e instanceof ApiError && e.fields) setFields(e.fields);
    toast({ text: errorMessage(e), kind: 'error' });
  };
  return { fields, setFields, onError };
}

/** Приложение-аутентификатор (TOTP): QR-код → код из приложения. */
function TotpSection({ onCodes }: { onCodes: (c: string[]) => void }) {
  const me = useMe();
  const refreshMe = useRefreshMe();
  const [password, setPassword] = useState('');
  const [setup, setSetup] = useState<TotpSetup | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const { fields, setFields, onError } = useFormErrors();
  useEffect(() => {
    if (setup) void QRCode.toDataURL(setup.otpauthUrl, { margin: 1, width: 200 }).then(setQr);
  }, [setup]);
  const begin = useMutation({ mutationFn: () => api.post<TotpSetup>('/security/2fa/setup', { password }), onSuccess: (s) => (setSetup(s), setFields({})), onError });
  const enable = useMutation({
    mutationFn: () => api.post<{ recoveryCodes: string[] }>('/security/2fa/enable', { code }),
    onSuccess: (r) => {
      onCodes(r.recoveryCodes);
      setSetup(null);
      setPassword('');
      setCode('');
      void refreshMe();
      toast({ text: 'Защита приложением включена', kind: 'success' });
    },
    onError,
  });
  const disable = useMutation({
    mutationFn: () => api.post('/security/2fa/disable', { password, code }),
    onSuccess: () => {
      setPassword('');
      setCode('');
      void refreshMe();
      toast('Защита приложением выключена');
    },
    onError,
  });

  return (
    <Panel title="Приложение-аутентификатор" footer="Google Authenticator, Aegis, 1Password, Bitwarden и любое приложение с кодами TOTP. Работает без интернета.">
      <div className="twofa-method">
        <span className="list-item__icon tile-violet">
          <Smartphone size={18} />
        </span>
        <span className="grow">
          <b>Код из приложения</b>
          <span className="small muted" style={{ display: 'block' }}>
            Самый надёжный способ: код меняется каждые 30 секунд
          </span>
        </span>
        {me.twoFactor.totp ? <span className="tag tag--success">Включено</span> : <span className="tag">Выключено</span>}
      </div>
      <div className="col gap-3" style={{ padding: '4px 16px 16px' }}>
        {me.twoFactor.totp ? (
          <>
            <PasswordInput label="Пароль" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" error={fields.password} />
            <Input label="Код из приложения или резервный код" value={code} onChange={(e) => setCode(e.target.value)} placeholder="123456" error={fields.code} autoComplete="one-time-code" />
            <Button variant="danger-ghost" disabled={!password || !code} loading={disable.isPending} onClick={() => disable.mutate()} style={{ alignSelf: 'flex-start' }}>
              Выключить
            </Button>
          </>
        ) : setup ? (
          <>
            <p className="small">Отсканируйте QR-код в приложении-аутентификаторе:</p>
            {qr && <img className="qr" src={qr} alt="QR-код для приложения-аутентификатора" />}
            <div className="small muted">
              Или введите ключ вручную: <span className="mono" style={{ wordBreak: 'break-all', color: 'var(--text)' }}>{setup.secret}</span>
            </div>
            <CodeInput value={code} onChange={setCode} onComplete={() => enable.mutate()} error={fields.code} label="Код из приложения" />
            <Button disabled={code.length !== 6} loading={enable.isPending} onClick={() => enable.mutate()} style={{ alignSelf: 'flex-start' }}>
              Включить
            </Button>
          </>
        ) : (
          <>
            <PasswordInput label="Пароль" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" error={fields.password} />
            <Button disabled={!password} loading={begin.isPending} onClick={() => begin.mutate()} style={{ alignSelf: 'flex-start' }}>
              Подключить приложение
            </Button>
          </>
        )}
      </div>
    </Panel>
  );
}

/** Код на почту: пароль → код из письма → готово. */
function EmailSection({ onCodes }: { onCodes: (c: string[]) => void }) {
  const me = useMe();
  const refreshMe = useRefreshMe();
  const config = useAuthConfig();
  const [password, setPassword] = useState('');
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [resendIn, startResend] = useCountdown();
  const { fields, setFields, onError } = useFormErrors();
  const action = me.twoFactor.email ? 'disable' : 'enable';
  const send = useMutation({
    mutationFn: () => api.post<{ emailHint: string }>('/security/2fa/email/send', { action, password }),
    onSuccess: (r) => {
      setSentTo(r.emailHint);
      setFields({});
      startResend(60);
    },
    onError: (e) => {
      if (e instanceof ApiError && e.retryAfter) startResend(e.retryAfter);
      onError(e);
    },
  });
  const confirm = useMutation({
    mutationFn: (c: string) => api.post<{ recoveryCodes: string[] | null }>('/security/2fa/email/confirm', { action, code: c }),
    onSuccess: (r) => {
      if (r.recoveryCodes) onCodes(r.recoveryCodes);
      setSentTo(null);
      setPassword('');
      setCode('');
      void refreshMe();
      toast({ text: action === 'enable' ? 'Вход по коду из письма включён' : 'Вход по коду из письма выключен', kind: 'success' });
    },
    onError: (e) => {
      setCode('');
      onError(e);
    },
  });
  const mailOff = config.data && !config.data.mail.enabled;

  return (
    <Panel title="Код на почту" footer="При входе с нового устройства мы пришлём 6-значный код на подтверждённую почту.">
      <div className="twofa-method">
        <span className="list-item__icon tile-blue">
          <Mail size={18} />
        </span>
        <span className="grow">
          <b>Код из письма</b>
          <span className="small muted" style={{ display: 'block' }}>
            {me.email ? `Почта: ${me.email}` : 'Почта не указана'}
          </span>
        </span>
        {me.twoFactor.email ? <span className="tag tag--success">Включено</span> : <span className="tag">Выключено</span>}
      </div>
      <div className="col gap-3" style={{ padding: '4px 16px 16px' }}>
        {mailOff ? (
          <Notice kind="warning">На этом сервере отправка писем не настроена.</Notice>
        ) : !me.emailVerified ? (
          <Notice kind="warning">
            Сначала <Link to="/settings/account/email">подтвердите почту</Link> — коды будут приходить на неё.
          </Notice>
        ) : sentTo ? (
          <>
            <p className="small">
              Отправили код на <b>{sentTo}</b>. Введите его, чтобы {action === 'enable' ? 'включить' : 'выключить'} вход по коду из письма.
            </p>
            <CodeInput value={code} onChange={setCode} onComplete={(v) => confirm.mutate(v)} error={fields.code} autoFocus />
            <div className="row wrap">
              <Button variant={action === 'enable' ? 'primary' : 'danger'} disabled={code.length !== 6} loading={confirm.isPending} onClick={() => confirm.mutate(code)}>
                {action === 'enable' ? 'Включить' : 'Выключить'}
              </Button>
              <Button variant="ghost" disabled={resendIn > 0} loading={send.isPending} onClick={() => send.mutate()}>
                {resendIn > 0 ? `Ещё раз через ${resendIn} с` : 'Отправить ещё раз'}
              </Button>
            </div>
          </>
        ) : (
          <>
            <PasswordInput label="Пароль" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" error={fields.password} />
            <Button variant={action === 'enable' ? 'primary' : 'danger-ghost'} disabled={!password} loading={send.isPending} onClick={() => send.mutate()} style={{ alignSelf: 'flex-start' }}>
              {action === 'enable' ? 'Включить: прислать код' : 'Выключить: прислать код'}
            </Button>
          </>
        )}
      </div>
    </Panel>
  );
}

export function TwoFactorSettings() {
  const me = useMe();
  const [codes, setCodes] = useState<string[] | null>(null);
  const [password, setPassword] = useState('');
  const { fields, onError } = useFormErrors();
  const regen = useMutation({ mutationFn: () => api.post<{ recoveryCodes: string[] }>('/security/2fa/recovery-codes', { password }), onSuccess: (r) => (setCodes(r.recoveryCodes), setPassword('')), onError });

  return (
    <SettingsPage title="Двухфакторная защита" subtitle="Второй шаг при входе с нового устройства: даже зная пароль, злоумышленник не войдёт" icon={<ShieldCheck size={22} />}>
      {me.twoFactorEnabled ? (
        <Notice kind="success" icon={<CheckCircle2 size={18} />}>
          Защита включена. Можно использовать оба способа сразу — при входе вы выберете удобный.
        </Notice>
      ) : (
        <Notice kind="warning">Сейчас аккаунт защищён только паролем. Включите хотя бы один способ.</Notice>
      )}
      {codes && (
        <Panel title="Резервные коды">
          <div style={{ padding: 16 }}>
            <RecoveryCodes codes={codes} />
          </div>
        </Panel>
      )}
      <TotpSection onCodes={setCodes} />
      <EmailSection onCodes={setCodes} />
      {me.twoFactorEnabled && (
        <Panel title="Резервные коды" footer="Новые коды заменят старые — старые перестанут работать.">
          <div className="col gap-3" style={{ padding: 16 }}>
            <div className="row" style={{ gap: 12 }}>
              <span className="list-item__icon tile-orange">
                <KeyRound size={18} />
              </span>
              <span className="small muted grow">10 одноразовых кодов на случай, если нет доступа ни к телефону, ни к почте.</span>
            </div>
            <PasswordInput label="Пароль" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" error={fields.password} />
            <Button variant="secondary" disabled={!password} loading={regen.isPending} onClick={() => regen.mutate()} style={{ alignSelf: 'flex-start' }}>
              Получить новые коды
            </Button>
          </div>
        </Panel>
      )}
    </SettingsPage>
  );
}
