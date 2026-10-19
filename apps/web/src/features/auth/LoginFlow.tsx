/**
 * Вход по шагам, по одному полю на экран: почта или телефон → код (письмо и чат
 * Sunnet) → пароль с подсказкой. «Забыли пароль?» — два кода → новый пароль.
 * Отдельно — вход по QR-коду с другого устройства, где вы уже вошли.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { ArrowRight, KeyRound, QrCode as QrIcon, ShieldCheck } from 'lucide-react';
import type { AuthFlowResult, AuthFlowState, QrLoginPoll, QrLoginStart } from '@omni/shared';
import { api, ApiError, errorMessage } from '../../shared/api/client';
import { Avatar, Button, CodeInput, Input, Notice, PasswordInput } from '../../shared/ui';
import { enterSession } from '../../app/session';
import { AuthLayout, AuthLinks, DOWNLOAD_LINK, HELP_LINK, minutes, mmss, PARTNERS_LINK, QrCode, StepTitle, useSecondsLeft } from './ui';

type View =
  | { v: 'identify' }
  | { v: 'code' | 'password' | 'totp' | 'reset_codes' | 'reset_password'; s: AuthFlowState }
  | { v: 'qr' };

/** Ошибка «попытка устарела» — начинаем заново. */
const expired = (e: unknown) => e instanceof ApiError && e.code === 'FLOW_EXPIRED';

export function LoginFlow({ notice: intro }: { notice?: string } = {}) {
  const [params] = useSearchParams();
  const [view, setView] = useState<View>({ v: 'identify' });
  const [login, setLogin] = useState(params.get('login') ?? '');
  const [notice, setNotice] = useState<string | null>(intro ?? null);

  const apply = useCallback((r: AuthFlowResult) => {
    if (r.status === 'ok') return enterSession(r.me);
    setView({ v: r.step, s: r });
  }, []);
  const restart = (message?: string) => {
    setNotice(message ?? null);
    setView({ v: 'identify' });
  };
  const onError = (e: unknown, set: (m: string) => void) => {
    if (expired(e)) restart('Время на вход истекло — начните заново');
    else set(errorMessage(e));
  };

  const back = async (s: AuthFlowState) => {
    try {
      apply(await api.post<AuthFlowState>('/auth/flow/back', { flow: s.flow }));
    } catch (e) {
      if (expired(e)) restart('Время на вход истекло — начните заново');
    }
  };

  const common = [HELP_LINK, DOWNLOAD_LINK];
  let body;
  let links;
  switch (view.v) {
    case 'identify':
      body = <Identify login={login} setLogin={setLogin} notice={notice} onStarted={(s) => (setNotice(null), apply(s))} onQr={() => setView({ v: 'qr' })} />;
      links = [{ label: 'Создать аккаунт', to: `/signup${login.includes('@') ? `?email=${encodeURIComponent(login)}` : ''}` }, DOWNLOAD_LINK, PARTNERS_LINK, HELP_LINK];
      break;
    case 'qr':
      body = <QrLogin onApproved={apply} />;
      links = [{ label: 'Назад', onClick: () => restart() }, ...common];
      break;
    case 'code':
      body = <CodeStep key={view.s.flow} s={view.s} onState={apply} onError={onError} />;
      links = [{ label: 'Назад', onClick: () => restart() }, ...common];
      break;
    case 'password':
      body = <PasswordStep key={view.s.flow} s={view.s} onState={apply} onError={onError} />;
      links = [{ label: 'Назад', onClick: () => restart() }, ...common];
      break;
    case 'totp':
      body = <TotpStep s={view.s} onState={apply} onError={onError} />;
      links = [{ label: 'Назад', onClick: () => void back(view.s) }, ...common];
      break;
    case 'reset_codes':
      body = <ResetCodesStep s={view.s} onState={apply} onError={onError} />;
      links = [{ label: 'Назад', onClick: () => void back(view.s) }, ...common];
      break;
    case 'reset_password':
      body = <NewPasswordStep s={view.s} onState={apply} onError={onError} />;
      links = [{ label: 'Назад', onClick: () => void back(view.s) }, ...common];
      break;
  }
  return (
    <AuthLayout links={<AuthLinks items={links} />}>
      <div key={view.v} className="auth__step">
        {body}
      </div>
    </AuthLayout>
  );
}

// ─── Шаг 1: почта или телефон ───────────────────────────────────────────────

function Identify({
  login,
  setLogin,
  notice,
  onStarted,
  onQr,
}: {
  login: string;
  setLogin: (v: string) => void;
  notice: string | null;
  onStarted: (s: AuthFlowState) => void;
  onQr: () => void;
}) {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (login.trim().length < 3) return setError('Введите почту или номер телефона');
    setBusy(true);
    setError(null);
    setNotFound(false);
    try {
      onStarted(await api.post<AuthFlowState>('/auth/flow/start', { login: login.trim() }));
    } catch (err) {
      setNotFound(err instanceof ApiError && err.status === 404);
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="auth__form" onSubmit={submit} noValidate>
      <StepTitle title="Вход в Sunnet" text="Введите почту или номер телефона — пришлём код для входа" />
      {notice && <Notice kind="warning">{notice}</Notice>}
      <Input
        value={login}
        onChange={(e) => setLogin(e.target.value)}
        placeholder="Почта или номер телефона"
        aria-label="Почта или номер телефона"
        hint="Например, anna@mail.ru или +7 999 123-45-67"
        error={error}
        autoComplete="username"
        autoCapitalize="none"
        spellCheck={false}
        autoFocus
       
      />
      {notFound && (
        <button type="button" className="auth__inline-link" onClick={() => navigate(`/signup${login.includes('@') ? `?email=${encodeURIComponent(login.trim())}` : ''}`)}>
          Создать аккаунт с этими данными
        </button>
      )}
      <Button type="submit" block size="lg" loading={busy} icon={<ArrowRight size={18} />}>
        Далее
      </Button>
      <div className="auth__or">
        <span>или</span>
      </div>
      <Button variant="secondary" block icon={<QrIcon size={18} />} onClick={onQr}>
        Войти по QR-коду
      </Button>
    </form>
  );
}

// ─── Шаг 2: код ─────────────────────────────────────────────────────────────

/** Куда ушёл код — понятным языком. */
function deliveryText(s: AuthFlowState): string {
  const email = s.emailHint ?? 'почту';
  if (s.emailSent && s.accountSent) return `Мы отправили код на ${email} и в чат Sunnet на устройствах, где вы уже вошли.`;
  if (s.emailSent) return `Мы отправили код на ${email}. Если письма нет — загляните в «Спам».`;
  if (s.accountSent) return 'Код отправлен в чат Sunnet на устройствах, где вы уже вошли.';
  if (s.limited) return 'Коды на почту можно получить 2 раза за 30 минут — этот лимит исчерпан. Отправьте код в чат Sunnet на ваших устройствах.';
  return 'Не получилось отправить письмо. Попробуйте отправить код снова.';
}

type StepProps = { s: AuthFlowState; onState: (r: AuthFlowResult) => void; onError: (e: unknown, set: (m: string) => void) => void };

function CodeStep({ s, onState, onError }: StepProps) {
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (value = code) => {
    if (value.length < 6) return;
    setBusy(true);
    setError(null);
    try {
      onState(await api.post<AuthFlowState>('/auth/flow/code', { flow: s.flow, code: value }));
    } catch (e) {
      setCode('');
      onError(e, setError);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      className="auth__form"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <StepTitle title="Введите код" text={deliveryText(s)} />
      <CodeInput value={code} onChange={setCode} onComplete={(v) => void submit(v)} error={error} autoFocus label="Код для входа" />
      <Button type="submit" block size="lg" loading={busy} disabled={code.length < 6}>
        Продолжить
      </Button>
      <Resend s={s} onState={onState} onError={(e) => onError(e, setError)} />
    </form>
  );
}

/** «Отправить снова» — один раз через 30 с; при исчерпанном лимите — «только в аккаунт». */
function Resend({ s, onState, onError, reset }: { s: AuthFlowState; onState: (r: AuthFlowState) => void; onError: (e: unknown) => void; reset?: boolean }) {
  const left = useSecondsLeft(s.resendIn, s);
  const limitLeft = useSecondsLeft(s.limitResetIn, s);
  const [busy, setBusy] = useState(false);
  const send = async (to: 'all' | 'account') => {
    setBusy(true);
    try {
      onState(await api.post<AuthFlowState>('/auth/flow/resend', { flow: s.flow, to }));
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  };
  if (s.limited) {
    return (
      <div className="auth__resend">
        <span className="auth__muted">
          {reset ? 'Сбросить пароль можно 4 раза в час.' : 'Лимит писем: 2 кода за 30 минут.'}
          {limitLeft > 0 && ` Снова — через ${minutes(limitLeft)}.`}
        </span>
        {!reset && (
          <button type="button" className="auth__inline-link" disabled={busy} onClick={() => void send('account')}>
            Отправить только в аккаунт
          </button>
        )}
      </div>
    );
  }
  if (s.resendIn === null) return null;
  return (
    <div className="auth__resend">
      {left > 0 ? (
        <span className="auth__muted">Отправить снова можно через {mmss(left)}</span>
      ) : (
        <button type="button" className="auth__inline-link" disabled={busy} onClick={() => void send('all')}>
          {reset ? 'Отправить коды снова' : 'Отправить снова'}
        </button>
      )}
    </div>
  );
}

// ─── Шаг 3: пароль ──────────────────────────────────────────────────────────

function Greeting({ s }: { s: AuthFlowState }) {
  if (!s.user) return null;
  return (
    <div className="auth__user">
      <Avatar src={s.user.avatarUrl} name={s.user.displayName} id={s.user.id} size={44} />
      <div className="col" style={{ gap: 0, minWidth: 0 }}>
        <b className="ellipsis">{s.user.displayName}</b>
        <span className="auth__muted ellipsis">@{s.user.username}</span>
      </div>
    </div>
  );
}

function PasswordStep({ s, onState, onError }: StepProps) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [busy, setBusy] = useState<'login' | 'hint' | 'forgot' | null>(null);
  const run = async (what: 'login' | 'hint' | 'forgot') => {
    setBusy(what);
    setError(null);
    try {
      if (what === 'hint') {
        const r = await api.post<{ hint: string | null }>('/auth/flow/hint', { flow: s.flow });
        setHint(r.hint ?? 'Подсказка не задана');
      } else if (what === 'forgot') {
        onState(await api.post<AuthFlowState>('/auth/flow/forgot', { flow: s.flow }));
      } else {
        onState(await api.post<AuthFlowResult>('/auth/flow/password', { flow: s.flow, password }));
      }
    } catch (e) {
      onError(e, setError);
    } finally {
      setBusy(null);
    }
  };
  return (
    <form
      className="auth__form"
      onSubmit={(e) => {
        e.preventDefault();
        if (password) void run('login');
      }}
    >
      <Greeting s={s} />
      <StepTitle title="Введите пароль" />
      <PasswordInput value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Пароль" aria-label="Пароль" autoComplete="current-password" autoFocus error={error} />
      <div className="auth__row">
        {s.hasHint && (
          <button type="button" className="auth__inline-link" disabled={!!busy} onClick={() => void run('hint')}>
            Подсказка
          </button>
        )}
        <button type="button" className="auth__inline-link" disabled={!!busy} onClick={() => void run('forgot')}>
          Забыли пароль?
        </button>
      </div>
      {hint && (
        <div className="auth__hint" role="status">
          <KeyRound size={16} /> <span>Подсказка: {hint}</span>
        </div>
      )}
      <Button type="submit" block size="lg" loading={busy === 'login'} disabled={!password}>
        Войти
      </Button>
    </form>
  );
}

function TotpStep({ s, onState, onError }: StepProps) {
  const [code, setCode] = useState('');
  const [recovery, setRecovery] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (value = code) => {
    setBusy(true);
    setError(null);
    try {
      onState(await api.post<AuthFlowResult>('/auth/flow/totp', { flow: s.flow, code: value }));
    } catch (e) {
      setCode('');
      onError(e, setError);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      className="auth__form"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <Greeting s={s} />
      <StepTitle title="Код из приложения" text="Аккаунт защищён приложением-аутентификатором. Введите 6 цифр из него." />
      {recovery ? (
        <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="xxxxx-xxxxx" aria-label="Резервный код" autoFocus error={error} />
      ) : (
        <CodeInput value={code} onChange={setCode} onComplete={(v) => void submit(v)} error={error} autoFocus label="Код из приложения" />
      )}
      <Button type="submit" block size="lg" loading={busy} icon={<ShieldCheck size={18} />}>
        Войти
      </Button>
      <button type="button" className="auth__inline-link" onClick={() => (setRecovery(!recovery), setCode(''))}>
        {recovery ? 'Ввести код из приложения' : 'Использовать резервный код'}
      </button>
    </form>
  );
}

// ─── Сброс пароля ───────────────────────────────────────────────────────────

function ResetCodesStep({ s, onState, onError }: StepProps) {
  const [emailCode, setEmailCode] = useState('');
  const [accountCode, setAccountCode] = useState('');
  const [errors, setErrors] = useState<{ emailCode?: string; accountCode?: string; common?: string }>({});
  const [busy, setBusy] = useState(false);
  const ready = emailCode.length === 6 && (!s.needsAccountCode || accountCode.length === 6);
  const submit = async () => {
    if (!ready) return;
    setBusy(true);
    setErrors({});
    try {
      onState(await api.post<AuthFlowState>('/auth/flow/reset-codes', { flow: s.flow, emailCode, accountCode: s.needsAccountCode ? accountCode : undefined }));
    } catch (e) {
      if (e instanceof ApiError && e.fields) setErrors(e.fields);
      else onError(e, (m) => setErrors({ common: m }));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      className="auth__form"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <StepTitle
        title="Сброс пароля"
        text={
          s.needsAccountCode
            ? `Мы отправили два разных кода: один на ${s.emailHint}, другой — в чат Sunnet на устройствах, где вы вошли. Введите оба.`
            : `Мы отправили код на ${s.emailHint}. Других устройств со входом нет, поэтому хватит кода из письма.`
        }
      />
      <div className="auth__code-field">
        <span className="auth__label">Код из письма</span>
        <CodeInput value={emailCode} onChange={setEmailCode} error={errors.emailCode} autoFocus label="Код из письма" />
      </div>
      {s.needsAccountCode && (
        <div className="auth__code-field">
          <span className="auth__label">Код из чата Sunnet</span>
          <CodeInput value={accountCode} onChange={setAccountCode} onComplete={() => undefined} error={errors.accountCode} label="Код из чата Sunnet" />
        </div>
      )}
      {errors.common && <Notice kind="danger">{errors.common}</Notice>}
      <Button type="submit" block size="lg" loading={busy} disabled={!ready}>
        Продолжить
      </Button>
      <Resend s={s} onState={onState} onError={(e) => onError(e, (m) => setErrors({ common: m }))} reset />
    </form>
  );
}

function NewPasswordStep({ s, onState, onError }: StepProps) {
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [hint, setHint] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    const local: Record<string, string> = {};
    if (repeat !== password) local.repeat = 'Пароли не совпадают';
    if (hint.trim().length < 2) local.passwordHint = 'Напишите подсказку — хотя бы 2 символа';
    setErrors(local);
    if (Object.keys(local).length) return;
    setBusy(true);
    try {
      onState(await api.post<AuthFlowResult>('/auth/flow/reset-password', { flow: s.flow, password, repeat, passwordHint: hint }));
    } catch (e) {
      if (e instanceof ApiError && e.fields) setErrors(e.fields);
      else onError(e, (m) => setErrors({ password: m }));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      className="auth__form"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <StepTitle title="Новый пароль" text="Придумайте новый пароль и подсказку к нему. После сохранения все остальные устройства выйдут из аккаунта." />
      <PasswordInput value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Новый пароль" aria-label="Новый пароль" autoComplete="new-password" showStrength autoFocus error={errors.password} />
      <PasswordInput value={repeat} onChange={(e) => setRepeat(e.target.value)} placeholder="Повторите пароль" aria-label="Повторите пароль" autoComplete="new-password" error={errors.repeat} />
      <Input
        value={hint}
        onChange={(e) => setHint(e.target.value)}
        placeholder="Подсказка к паролю"
        aria-label="Подсказка к паролю"
        hint="Её увидите только вы — после ввода кода. Не пишите сам пароль."
        maxLength={100}
        error={errors.passwordHint}
      />
      <Button type="submit" block size="lg" loading={busy}>
        Сохранить и войти
      </Button>
    </form>
  );
}

// ─── Вход по QR-коду ────────────────────────────────────────────────────────

function QrLogin({ onApproved }: { onApproved: (s: AuthFlowState) => void }) {
  const [qr, setQr] = useState<QrLoginStart | null>(null);
  const [status, setStatus] = useState<'pending' | 'expired' | 'rejected' | 'error'>('pending');
  const latest = useRef(0);
  const refresh = useCallback(async () => {
    // Показываем только ответ на последний запрос — ранний не должен подменить новый код
    const n = ++latest.current;
    try {
      const next = await api.post<QrLoginStart>('/auth/qr');
      if (n !== latest.current) return;
      setQr(next);
      setStatus('pending');
    } catch {
      if (n === latest.current) setStatus('error');
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  const ttl = useMemo(() => (qr ? Math.round((Date.parse(qr.expiresAt) - Date.now()) / 1000) : null), [qr]);
  const left = useSecondsLeft(ttl, qr?.token);

  // Спрашиваем раз в 2 секунды, подтвердили ли вход на другом устройстве
  useEffect(() => {
    if (!qr || status !== 'pending') return;
    let stop = false;
    const t = setInterval(async () => {
      try {
        const r = await api.post<QrLoginPoll>(`/auth/qr/${qr.token}/poll`, { secret: qr.secret });
        if (stop) return;
        if (r.status === 'approved') onApproved(r.state);
        else if (r.status !== 'pending') setStatus(r.status);
      } catch {
        // Сеть мигнула — спросим ещё раз
      }
    }, 2000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [qr, status, onApproved]);
  // Устаревший код сразу заменяем новым
  useEffect(() => {
    if (qr && status === 'pending' && left === 0) void refresh();
  }, [left, qr, status, refresh]);

  const url = qr ? `${location.origin}/qr/${qr.token}` : '';
  return (
    <div className="auth__form">
      <StepTitle title="Вход по QR-коду" text="Отсканируйте код устройством, на котором вы уже вошли в Sunnet" />
      <div className="auth__qr">
        {qr ? <QrCode value={url} size={212} /> : <div className="qr qr--loading" style={{ width: 212, height: 212 }} />}
        {status !== 'pending' && (
          <div className="auth__qr-veil">
            <b>{status === 'rejected' ? 'Вход отклонён на другом устройстве' : 'Не удалось получить код'}</b>
            <Button size="sm" onClick={() => void refresh()}>
              Показать новый QR-код
            </Button>
          </div>
        )}
      </div>
      <ol className="auth__steps">
        <li>Откройте камеру на телефоне, где вы уже вошли в Sunnet</li>
        <li>Наведите её на QR-код и откройте ссылку</li>
        <li>Нажмите «Разрешить вход» — останется ввести пароль</li>
      </ol>
      {qr && status === 'pending' && left > 0 && <span className="auth__muted auth__center">Код обновится через {mmss(left)}</span>}
    </div>
  );
}
