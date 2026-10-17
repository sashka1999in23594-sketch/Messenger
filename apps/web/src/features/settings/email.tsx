import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { BellRing, CheckCircle2, LogIn, Mail, MailWarning, Newspaper, ShieldAlert } from 'lucide-react';
import type { EmailPrefs, Me } from '@omni/shared';
import { api, ApiError, errorMessage } from '../../shared/api/client';
import { useAuthConfig } from '../../shared/api/config';
import { useCountdown } from '../../shared/hooks';
import { useMe, useSession } from '../../shared/stores/session';
import { toast } from '../../shared/stores/ui';
import { Button, CodeInput, Input, Notice, PasswordInput, SettingRow, Switch } from '../../shared/ui';
import { Panel, SettingsPage } from './common';

const EMAIL_PREFS: { key: keyof EmailPrefs; title: string; text: string; icon: React.ReactNode; tile: string }[] = [
  { key: 'loginAlerts', title: 'Вход с нового устройства', text: 'Письмо с устройством, IP и временем входа', icon: <LogIn size={18} />, tile: 'tile-blue' },
  { key: 'securityAlerts', title: 'Изменения безопасности', text: 'Смена пароля, почты, настроек двухфакторной защиты', icon: <ShieldAlert size={18} />, tile: 'tile-red' },
  { key: 'mentions', title: 'Упоминания и ответы', text: 'Когда вас упомянули, пока вы не в сети', icon: <BellRing size={18} />, tile: 'tile-orange' },
  { key: 'digest', title: 'Еженедельная сводка', text: 'Самое интересное от ваших подписок', icon: <Newspaper size={18} />, tile: 'tile-green' },
];

export function EmailSettings() {
  const me = useMe();
  const setMe = useSession((s) => s.setMe);
  const patchMe = useSession((s) => s.patchMe);
  const config = useAuthConfig();
  const mailEnabled = config.data?.mail.enabled ?? true;
  const [code, setCode] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [resendIn, startResend] = useCountdown();
  const [newEmail, setNewEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const onError = (e: unknown) => {
    if (e instanceof ApiError) {
      if (e.fields) setFields(e.fields);
      if (e.retryAfter && e.code === 'RATE_LIMITED') startResend(e.retryAfter);
    }
    toast({ text: errorMessage(e), kind: 'error' });
  };

  const send = useMutation({
    mutationFn: () => api.post<{ emailHint: string }>('/me/email/send-code'),
    onSuccess: () => {
      setCodeSent(true);
      startResend(60);
      toast({ text: 'Код отправлен', kind: 'success' });
    },
    onError,
  });
  const verify = useMutation({
    mutationFn: (c: string) => api.post<Me>('/me/email/verify', { code: c }),
    onSuccess: (m) => {
      setMe(m);
      setCode('');
      setCodeSent(false);
      toast({ text: 'Почта подтверждена', kind: 'success' });
    },
    onError: (e) => {
      setCode('');
      onError(e);
    },
  });
  const change = useMutation({
    mutationFn: () => api.post<{ emailSent: boolean; me: Me }>('/me/email', { email: newEmail, password }),
    onSuccess: (r) => {
      setMe(r.me);
      setNewEmail('');
      setPassword('');
      setFields({});
      setCodeSent(r.emailSent);
      if (r.emailSent) startResend(60);
      toast({ text: r.emailSent ? 'Адрес изменён — мы отправили код подтверждения' : 'Адрес изменён', kind: 'success' });
    },
    onError,
  });
  const prefs = useMutation({
    mutationFn: (patch: Partial<EmailPrefs>) => api.patch<EmailPrefs>('/me/email-prefs', patch),
    onMutate: (patch) => patchMe({ emailPrefs: { ...me.emailPrefs, ...patch } }),
    onSuccess: (emailPrefs) => patchMe({ emailPrefs }),
    onError,
  });

  return (
    <SettingsPage title="Почта" subtitle="Для восстановления доступа, кодов входа и важных уведомлений" icon={<Mail size={22} />}>
      {!mailEnabled && <Notice kind="warning">На этом сервере отправка писем не настроена: подтвердить адрес и получать письма пока нельзя.</Notice>}

      <Panel>
        <div className="email-status">
          <span className={me.emailVerified ? 'email-status__icon email-status__icon--ok' : 'email-status__icon'}>
            {me.emailVerified ? <CheckCircle2 size={26} /> : <MailWarning size={26} />}
          </span>
          <span className="grow" style={{ minWidth: 0 }}>
            <span className="email-status__address">{me.email ?? 'Адрес не указан'}</span>
            <span className={me.emailVerified ? 'tag tag--success' : 'tag tag--warning'}>{me.emailVerified ? 'Подтверждена' : 'Не подтверждена'}</span>
          </span>
        </div>
        {me.email && !me.emailVerified && mailEnabled && (
          <div className="col gap-3" style={{ padding: '0 16px 16px' }}>
            {codeSent ? (
              <>
                <p className="small muted">Введите 6-значный код из письма. Он действует 15 минут.</p>
                <CodeInput value={code} onChange={setCode} onComplete={(v) => verify.mutate(v)} error={fields.code} autoFocus />
                <div className="row wrap">
                  <Button disabled={code.length !== 6} loading={verify.isPending} onClick={() => verify.mutate(code)}>
                    Подтвердить
                  </Button>
                  <Button variant="ghost" disabled={resendIn > 0} loading={send.isPending} onClick={() => send.mutate()}>
                    {resendIn > 0 ? `Ещё раз через ${resendIn} с` : 'Отправить ещё раз'}
                  </Button>
                </div>
              </>
            ) : (
              <Button loading={send.isPending} onClick={() => send.mutate()} style={{ alignSelf: 'flex-start' }}>
                Отправить код подтверждения
              </Button>
            )}
          </div>
        )}
      </Panel>

      <Panel title="Сменить адрес" footer={me.twoFactor.email ? 'Сейчас включён вход по коду из письма — сначала отключите его в настройках двухфакторной защиты.' : 'На прежний адрес придёт уведомление о смене. Новый адрес нужно будет подтвердить.'}>
        <form
          className="col gap-3"
          style={{ padding: 16 }}
          onSubmit={(e) => {
            e.preventDefault();
            change.mutate();
          }}
        >
          <Input label="Новый адрес" type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} autoComplete="email" placeholder="you@example.com" error={fields.email} disabled={me.twoFactor.email} />
          <PasswordInput label="Пароль" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" error={fields.password} disabled={me.twoFactor.email} />
          <Button type="submit" disabled={!newEmail || !password || me.twoFactor.email} loading={change.isPending} style={{ alignSelf: 'flex-start' }}>
            Сменить адрес
          </Button>
        </form>
      </Panel>

      <Panel title="Какие письма присылать" footer="Коды подтверждения и восстановления пароля приходят всегда — их нельзя отключить.">
        {EMAIL_PREFS.map((p) => (
          <SettingRow
            key={p.key}
            icon={p.icon}
            tile={p.tile}
            title={p.title}
            description={p.text}
            control={<Switch checked={me.emailPrefs[p.key]} onChange={(v) => prefs.mutate({ [p.key]: v })} label={p.title} />}
          />
        ))}
      </Panel>
    </SettingsPage>
  );
}
