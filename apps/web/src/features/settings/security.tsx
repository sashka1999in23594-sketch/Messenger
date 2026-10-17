import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import QRCode from 'qrcode';
import { AlertTriangle, CheckCircle2, Copy, Fingerprint, KeyRound, Laptop, Lock, LogOut, ScrollText, ShieldCheck, Smartphone } from 'lucide-react';
import { SECURITY_EVENT_LABELS, type DeviceKey, type SecurityEvent, type SessionInfo, type TotpSetup } from '@omni/shared';
import { api, ApiError, errorMessage } from '../../shared/api/client';
import { flatPages, useCursorList } from '../../shared/api/query';
import { getIdentity } from '../../shared/crypto/e2e';
import { hashPasscode } from '../../shared/lib/passcode';
import { usePrefs } from '../../shared/stores/prefs';
import { useMe, useSession } from '../../shared/stores/session';
import { toast } from '../../shared/stores/ui';
import { cn, fullDate, timeAgo } from '../../shared/lib/format';
import { Button, ButtonLink, confirm, Input, ListSkeleton, LoadMore, Notice, PasswordInput } from '../../shared/ui';
import { Panel, SettingsPage } from './common';

interface Overview {
  twoFactorEnabled: boolean;
  recoveryCodesLeft: number;
  activeSessions: number;
  deviceKeys: number;
}

export function SecurityOverview() {
  const q = useQuery({ queryKey: ['security-overview'], queryFn: () => api.get<Overview>('/security/overview') });
  const passcode = usePrefs((s) => s.passcode);
  const o = q.data;
  const checks = o
    ? [
        { ok: o.twoFactorEnabled, title: 'Двухфакторная защита', text: o.twoFactorEnabled ? `Включена · резервных кодов: ${o.recoveryCodesLeft}` : 'Не включена — аккаунт защищён только паролем', to: '/settings/security/2fa' },
        { ok: o.twoFactorEnabled && o.recoveryCodesLeft >= 3, title: 'Резервные коды', text: o.recoveryCodesLeft >= 3 ? 'Есть запас на случай потери телефона' : 'Мало или нет — обновите', to: '/settings/security/2fa' },
        { ok: o.activeSessions <= 3, title: 'Активные сеансы', text: `Устройств: ${o.activeSessions}. Завершите незнакомые`, to: '/settings/security/sessions' },
        { ok: o.deviceKeys > 0, title: 'Ключи шифрования', text: o.deviceKeys ? `Зарегистрировано устройств: ${o.deviceKeys}` : 'Нет ключей — секретные чаты недоступны', to: '/settings/security/keys' },
        { ok: !!passcode, title: 'Код-пароль на этом устройстве', text: passcode ? `Автоблокировка через ${passcode.timeoutMin} мин` : 'Не установлен', to: '/settings/security/passcode' },
      ]
    : [];
  const score = checks.length ? Math.round((checks.filter((c) => c.ok).length / checks.length) * 100) : 0;
  return (
    <SettingsPage title="Проверка безопасности" subtitle="Насколько хорошо защищён ваш аккаунт" icon={<ShieldCheck size={22} />}>
      <Panel>
        <div className="row" style={{ padding: 20, gap: 20 }}>
          <div className="score-ring" style={{ background: `conic-gradient(${score >= 80 ? 'var(--success)' : score >= 50 ? 'var(--warning)' : 'var(--danger)'} ${score * 3.6}deg, var(--surface-3) 0)` }}>
            <span className="score-ring__value">{score}%</span>
          </div>
          <div className="col">
            <h3>{score >= 80 ? 'Отличная защита' : score >= 50 ? 'Можно лучше' : 'Аккаунт уязвим'}</h3>
            <span className="muted small">Пароли хранятся в виде scrypt-хэша, сеанс — в httpOnly cookie, все входы записываются в журнал.</span>
          </div>
        </div>
      </Panel>
      <Panel title="Рекомендации">
        {q.isLoading && <ListSkeleton rows={4} />}
        {checks.map((c) => (
          <Link key={c.title} to={c.to} className="check-item list-item">
            <span className={cn('check-item__icon', c.ok ? 'check-item__icon--ok' : 'check-item__icon--warn')}>{c.ok ? <CheckCircle2 size={20} /> : <AlertTriangle size={20} />}</span>
            <span className="list-item__body">
              <span className="list-item__title" style={{ display: 'block' }}>
                {c.title}
              </span>
              <span className="list-item__sub">{c.text}</span>
            </span>
          </Link>
        ))}
      </Panel>
    </SettingsPage>
  );
}

export function PasswordSettings() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const save = useMutation({
    mutationFn: () => api.post('/security/password', { currentPassword: current, newPassword: next }),
    onSuccess: () => {
      setCurrent('');
      setNext('');
      setRepeat('');
      setFields({});
      toast({ text: 'Пароль изменён. Остальные сеансы завершены', kind: 'success' });
    },
    onError: (e) => {
      if (e instanceof ApiError && e.fields) setFields(e.fields);
      toast({ text: errorMessage(e), kind: 'error' });
    },
  });
  const mismatch = repeat.length > 0 && repeat !== next;
  return (
    <SettingsPage title="Пароль" subtitle="После смены все остальные устройства выйдут из аккаунта" icon={<KeyRound size={22} />}>
      <Panel footer="Совет: используйте фразу из 3–4 случайных слов — её легко запомнить и сложно подобрать.">
        <form
          className="col gap-3"
          style={{ padding: 16 }}
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <PasswordInput label="Текущий пароль" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" error={fields.currentPassword} />
          <PasswordInput label="Новый пароль" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" showStrength error={fields.newPassword} />
          <PasswordInput label="Повторите новый пароль" value={repeat} onChange={(e) => setRepeat(e.target.value)} autoComplete="new-password" error={mismatch ? 'Пароли не совпадают' : null} />
          <Button type="submit" disabled={!current || next.length < 10 || next !== repeat} loading={save.isPending} style={{ alignSelf: 'flex-start' }}>
            Сменить пароль
          </Button>
        </form>
      </Panel>
    </SettingsPage>
  );
}

function RecoveryCodes({ codes }: { codes: string[] }) {
  return (
    <div className="col gap-3">
      <Notice kind="warning">Сохраните резервные коды в надёжном месте. Каждый код работает один раз — для входа, если телефон потерян. Больше мы их не покажем.</Notice>
      <div className="recovery-codes">
        {codes.map((c) => (
          <span key={c}>{c}</span>
        ))}
      </div>
      <div className="row">
        <Button variant="secondary" icon={<Copy size={16} />} onClick={() => void navigator.clipboard.writeText(codes.join('\n')).then(() => toast('Коды скопированы'))}>
          Скопировать
        </Button>
        <a
          className="btn btn--secondary"
          download="omni-recovery-codes.txt"
          href={`data:text/plain;charset=utf-8,${encodeURIComponent(`Резервные коды Omni\n\n${codes.join('\n')}\n`)}`}
        >
          Скачать .txt
        </a>
      </div>
    </div>
  );
}

export function TwoFactorSettings() {
  const me = useMe();
  const patchMe = useSession((s) => s.patchMe);
  const [password, setPassword] = useState('');
  const [setup, setSetup] = useState<TotpSetup | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [codes, setCodes] = useState<string[] | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const onError = (e: unknown) => {
    if (e instanceof ApiError && e.fields) setFields(e.fields);
    toast({ text: errorMessage(e), kind: 'error' });
  };
  useEffect(() => {
    if (setup) void QRCode.toDataURL(setup.otpauthUrl, { margin: 1, width: 200 }).then(setQr);
  }, [setup]);

  const begin = useMutation({ mutationFn: () => api.post<TotpSetup>('/security/2fa/setup', { password }), onSuccess: (s) => (setSetup(s), setFields({})), onError });
  const enable = useMutation({
    mutationFn: () => api.post<{ recoveryCodes: string[] }>('/security/2fa/enable', { code }),
    onSuccess: (r) => {
      setCodes(r.recoveryCodes);
      setSetup(null);
      setPassword('');
      setCode('');
      patchMe({ twoFactorEnabled: true });
      toast({ text: 'Двухфакторная защита включена', kind: 'success' });
    },
    onError,
  });
  const disable = useMutation({
    mutationFn: () => api.post('/security/2fa/disable', { password, code }),
    onSuccess: () => {
      patchMe({ twoFactorEnabled: false });
      setPassword('');
      setCode('');
      toast('Двухфакторная защита выключена');
    },
    onError,
  });
  const regen = useMutation({ mutationFn: () => api.post<{ recoveryCodes: string[] }>('/security/2fa/recovery-codes', { password }), onSuccess: (r) => (setCodes(r.recoveryCodes), setPassword('')), onError });

  return (
    <SettingsPage title="Двухфакторная защита" subtitle="Код из приложения-аутентификатора при каждом входе с нового устройства" icon={<Smartphone size={22} />}>
      {codes && (
        <Panel title="Резервные коды">
          <div style={{ padding: 16 }}>
            <RecoveryCodes codes={codes} />
          </div>
        </Panel>
      )}
      {me.twoFactorEnabled ? (
        <>
          <Notice kind="success">Двухфакторная защита включена. Даже зная пароль, злоумышленник не войдёт без кода.</Notice>
          <Panel title="Управление" footer="Для любых изменений нужен пароль.">
            <div className="col gap-3" style={{ padding: 16 }}>
              <PasswordInput label="Пароль" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" error={fields.password} />
              <div className="row wrap">
                <Button variant="secondary" disabled={!password} loading={regen.isPending} onClick={() => regen.mutate()}>
                  Новые резервные коды
                </Button>
              </div>
              <Input label="Код для отключения" value={code} onChange={(e) => setCode(e.target.value)} placeholder="123456" error={fields.code} autoComplete="one-time-code" />
              <Button variant="danger-ghost" disabled={!password || !code} loading={disable.isPending} onClick={() => disable.mutate()} style={{ alignSelf: 'flex-start' }}>
                Выключить 2FA
              </Button>
            </div>
          </Panel>
        </>
      ) : setup ? (
        <Panel title="Шаг 2 из 2: подключите приложение">
          <div className="col gap-4" style={{ padding: 16 }}>
            <p>Отсканируйте QR-код в Google Authenticator, Aegis, 1Password, Bitwarden или любом TOTP-приложении:</p>
            {qr && <img className="qr" src={qr} alt="QR-код для приложения-аутентификатора" />}
            <div className="small muted">
              Или введите ключ вручную: <span className="mono" style={{ wordBreak: 'break-all', color: 'var(--text)' }}>{setup.secret}</span>
            </div>
            <Input label="Код из приложения" value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" placeholder="123456" autoComplete="one-time-code" error={fields.code} />
            <Button disabled={code.replace(/\s/g, '').length !== 6} loading={enable.isPending} onClick={() => enable.mutate()} style={{ alignSelf: 'flex-start' }}>
              Включить
            </Button>
          </div>
        </Panel>
      ) : (
        <Panel title="Шаг 1 из 2: подтвердите пароль">
          <div className="col gap-3" style={{ padding: 16 }}>
            <PasswordInput label="Пароль" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" error={fields.password} />
            <Button disabled={!password} loading={begin.isPending} onClick={() => begin.mutate()} style={{ alignSelf: 'flex-start' }}>
              Продолжить
            </Button>
          </div>
        </Panel>
      )}
    </SettingsPage>
  );
}

export function SessionsSettings() {
  const q = useQuery({ queryKey: ['sessions'], queryFn: () => api.get<{ items: SessionInfo[] }>('/security/sessions') });
  const revoke = async (s: SessionInfo) => {
    if (!(await confirm({ title: `Завершить сеанс «${s.deviceName}»?`, confirmLabel: 'Завершить', danger: true }))) return;
    await api.del(`/security/sessions/${s.id}`);
    void q.refetch();
  };
  const revokeOthers = async () => {
    if (!(await confirm({ title: 'Завершить все другие сеансы?', text: 'Все устройства, кроме этого, выйдут из аккаунта.', confirmLabel: 'Завершить', danger: true }))) return;
    const r = await api.post<{ revoked: number }>('/security/sessions/revoke-others');
    toast({ text: `Завершено сеансов: ${r.revoked}`, kind: 'success' });
    void q.refetch();
  };
  const current = q.data?.items.find((s) => s.current);
  const others = q.data?.items.filter((s) => !s.current) ?? [];
  const Row = ({ s }: { s: SessionInfo }) => (
    <div className="list-item">
      <span className="list-item__icon">{/iPhone|Android/.test(s.deviceName) ? <Smartphone size={18} /> : <Laptop size={18} />}</span>
      <span className="list-item__body">
        <span className="list-item__title" style={{ display: 'block' }}>
          {s.deviceName} {s.current && <span className="tag tag--success">это устройство</span>}
        </span>
        <span className="list-item__sub" title={s.userAgent}>
          IP {s.ip} · активность {timeAgo(s.lastSeenAt)} · вход {fullDate(s.createdAt)}
        </span>
      </span>
      {!s.current && (
        <Button size="sm" variant="danger-ghost" onClick={() => void revoke(s)}>
          Завершить
        </Button>
      )}
    </div>
  );
  return (
    <SettingsPage title="Устройства и сеансы" subtitle="Где выполнен вход в ваш аккаунт" icon={<Smartphone size={22} />}>
      {current && (
        <Panel title="Текущий сеанс">
          <Row s={current} />
        </Panel>
      )}
      <Panel title={`Другие сеансы (${others.length})`} footer="Не узнаёте устройство? Завершите сеанс и смените пароль.">
        {q.isLoading && <ListSkeleton rows={2} />}
        {others.map((s) => (
          <Row key={s.id} s={s} />
        ))}
        {others.length === 0 && !q.isLoading && <p className="muted small" style={{ padding: '0 16px 12px' }}>Других активных сеансов нет</p>}
        {others.length > 0 && (
          <div style={{ padding: '4px 16px 12px' }}>
            <Button variant="danger-ghost" icon={<LogOut size={16} />} onClick={() => void revokeOthers()}>
              Завершить все другие
            </Button>
          </div>
        )}
      </Panel>
    </SettingsPage>
  );
}

export function KeysSettings() {
  const q = useQuery({ queryKey: ['device-keys'], queryFn: () => api.get<{ items: DeviceKey[] }>('/keys/devices') });
  const mine = useQuery({ queryKey: ['device-id'], queryFn: async () => (await getIdentity()).deviceId });
  return (
    <SettingsPage title="Ключи шифрования" subtitle="Публичные ключи устройств для секретных чатов" icon={<Fingerprint size={22} />}>
      <Notice icon={<Lock size={18} />}>
        Приватный ключ создаётся в браузере как неизвлекаемый и никогда не покидает устройство. Сервер хранит только публичную часть. Отзыв ключа делает секретные чаты на том устройстве недоступными для новых сообщений.
      </Notice>
      <Panel title="Устройства">
        {q.data?.items.map((k) => (
          <div key={k.deviceId} className="list-item">
            <span className="list-item__icon">
              <Fingerprint size={18} />
            </span>
            <span className="list-item__body">
              <span className="list-item__title mono small" style={{ display: 'block' }}>
                {k.deviceId.slice(0, 22)}… {k.deviceId === mine.data && <span className="tag tag--success">это устройство</span>}
              </span>
              <span className="list-item__sub">
                {k.algorithm} · создан {fullDate(k.createdAt)}
              </span>
            </span>
            {k.deviceId !== mine.data && (
              <Button
                size="sm"
                variant="danger-ghost"
                onClick={async () => {
                  if (!(await confirm({ title: 'Отозвать ключ устройства?', danger: true, confirmLabel: 'Отозвать' }))) return;
                  await api.del(`/keys/devices/${k.deviceId}`);
                  void q.refetch();
                }}
              >
                Отозвать
              </Button>
            )}
          </div>
        ))}
      </Panel>
    </SettingsPage>
  );
}

export function PasscodeSettings() {
  const passcode = usePrefs((s) => s.passcode);
  const set = usePrefs((s) => s.set);
  const [code, setCode] = useState('');
  const [repeat, setRepeat] = useState('');
  const [timeout, setTimeoutMin] = useState(passcode?.timeoutMin ?? 5);
  const valid = /^\d{4,6}$/.test(code) && code === repeat;
  return (
    <SettingsPage title="Код-пароль" subtitle="Блокирует Omni на этом устройстве, если вы отошли" icon={<Lock size={22} />}>
      <Panel footer="Код хранится только на этом устройстве в виде PBKDF2-хэша (600 000 итераций). Если забудете код — придётся выйти и войти снова.">
        <div className="col gap-3" style={{ padding: 16 }}>
          {passcode && <Notice kind="success">Код-пароль установлен. Автоблокировка через {passcode.timeoutMin} мин бездействия.</Notice>}
          <Input label={passcode ? 'Новый код (4–6 цифр)' : 'Код (4–6 цифр)'} type="password" inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
          <Input label="Повторите код" type="password" inputMode="numeric" maxLength={6} value={repeat} onChange={(e) => setRepeat(e.target.value.replace(/\D/g, ''))} error={repeat && repeat !== code ? 'Коды не совпадают' : null} />
          <label className="col" style={{ gap: 6 }}>
            <span className="field__label">Автоблокировка</span>
            <select className="select" value={timeout} onChange={(e) => setTimeoutMin(Number(e.target.value))}>
              {[1, 5, 15, 60, 240].map((m) => (
                <option key={m} value={m}>
                  через {m < 60 ? `${m} мин` : `${m / 60} ч`}
                </option>
              ))}
            </select>
          </label>
          <div className="row wrap">
            <Button
              disabled={!valid}
              onClick={async () => {
                const h = await hashPasscode(code);
                set({ passcode: { ...h, timeoutMin: timeout } });
                setCode('');
                setRepeat('');
                toast({ text: 'Код-пароль установлен', kind: 'success' });
              }}
            >
              {passcode ? 'Сменить код' : 'Установить'}
            </Button>
            {passcode && (
              <Button variant="danger-ghost" onClick={() => (set({ passcode: null }), toast('Код-пароль выключен'))}>
                Выключить
              </Button>
            )}
          </div>
        </div>
      </Panel>
    </SettingsPage>
  );
}

export function SecurityLogSettings() {
  const list = useCursorList<SecurityEvent>(['security-log'], '/security/events');
  const items = flatPages(list.data);
  return (
    <SettingsPage title="Журнал безопасности" subtitle="Все входы и важные изменения аккаунта" icon={<ScrollText size={22} />}>
      <Panel>
        {list.isLoading && <ListSkeleton />}
        {items.map((e) => {
          const bad = /failed|locked/.test(e.type);
          return (
            <div key={e.id} className="list-item">
              <span className={cn('check-item__icon', bad ? 'check-item__icon--warn' : 'check-item__icon--ok')}>{bad ? <AlertTriangle size={18} /> : <ShieldCheck size={18} />}</span>
              <span className="list-item__body">
                <span className="list-item__title" style={{ display: 'block' }}>
                  {SECURITY_EVENT_LABELS[e.type] ?? e.type}
                </span>
                <span className="list-item__sub">
                  {fullDate(e.createdAt)} · IP {e.ip || '—'}
                </span>
              </span>
            </div>
          );
        })}
        <LoadMore hasMore={!!list.hasNextPage} loading={list.isFetchingNextPage} onLoad={() => void list.fetchNextPage()} />
      </Panel>
      <ButtonLink to="/settings/security/sessions" variant="secondary" style={{ alignSelf: 'flex-start' }}>
        Перейти к активным сеансам
      </ButtonLink>
    </SettingsPage>
  );
}
