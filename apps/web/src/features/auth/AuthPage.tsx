import { useState, type FormEvent, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, KeyRound, Mail, MailOpen, RefreshCw, ShieldCheck, Smartphone, Sparkles } from 'lucide-react';
import { registerSchema, type DevMail, type LoginResult, type Me, type TwoFactorMethod } from '@omni/shared';
import { api, ApiError, errorMessage } from '../../shared/api/client';
import { useAuthConfig } from '../../shared/api/config';
import { useCountdown } from '../../shared/hooks';
import { Button, CodeInput, Input, Logo, Modal, Notice, PasswordInput, Segmented } from '../../shared/ui';
import { timeAgo } from '../../shared/lib/format';
import { enterSession } from '../../app/session';
import './auth.css';

type Step =
  | { kind: 'login'; notice?: string }
  | { kind: 'register' }
  | { kind: 'twofa'; challengeId: string; methods: TwoFactorMethod[]; emailHint: string | null; emailSent: boolean; recovery: boolean }
  | { kind: 'forgot' }
  | { kind: 'reset'; login: string };

/** Витрина слева: планета SpaceUp с орбитами и спутниками. */
function Showcase() {
  return (
    <section className="auth__hero" aria-hidden>
      <div className="space-scene">
        <div className="space-scene__orbit space-scene__orbit--1">
          <span className="space-scene__sat" />
        </div>
        <div className="space-scene__orbit space-scene__orbit--2">
          <span className="space-scene__sat space-scene__sat--b" />
        </div>
        <div className="space-scene__orbit space-scene__orbit--3">
          <span className="space-scene__sat space-scene__sat--c" />
        </div>
        <div className="space-scene__planet" />
      </div>
      <div className="auth__hero-text">
        <div className="auth__brand">
          <Logo size={52} />
          <span className="auth__name">SpaceUp</span>
        </div>
        <h2 className="auth__headline">Все на одной орбите</h2>
        <p className="auth__tagline">Чаты и звонки, каналы, компании и сообщества. Сквозное шифрование и защита аккаунта — по умолчанию.</p>
      </div>
    </section>
  );
}

/** Тестовый почтовый ящик (только в режиме разработки сервера). */
function DevMailbox({ open, onClose }: { open: boolean; onClose: () => void }) {
  const q = useQuery({ queryKey: ['dev-mail'], queryFn: () => api.get<{ items: DevMail[] }>('/dev/mail'), enabled: open, refetchInterval: open ? 3000 : false });
  return (
    <Modal open={open} onClose={onClose} title="Тестовая почта" wide>
      <p className="small muted" style={{ marginBottom: 12 }}>
        Сервер запущен в режиме разработки: письма не уходят наружу, а складываются сюда. В production письма отправляются через Brevo, Resend или SMTP.
      </p>
      {q.data?.items.length === 0 && <Notice>Писем пока нет. Зарегистрируйтесь или запросите код — письмо появится здесь.</Notice>}
      <div className="col gap-3">
        {q.data?.items.map((m) => {
          const code = /Код: (\d{6})/.exec(m.text)?.[1];
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

function Header({ icon, title, text, onBack }: { icon?: ReactNode; title: string; text?: ReactNode; onBack?: () => void }) {
  return (
    <div className="auth__head">
      {onBack && (
        <button type="button" className="auth__back" onClick={onBack} aria-label="Назад">
          <ArrowLeft size={18} />
        </button>
      )}
      {icon && <span className="auth__step-icon">{icon}</span>}
      <h1>{title}</h1>
      {text && <p className="muted">{text}</p>}
    </div>
  );
}

export function AuthPage() {
  const config = useAuthConfig();
  const mailEnabled = config.data?.mail.enabled ?? false;
  const [step, setStep] = useState<Step>({ kind: 'login' });
  const [login, setLogin] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [mailbox, setMailbox] = useState(false);
  const [resendIn, startResend] = useCountdown();

  const go = (next: Step) => {
    setStep(next);
    setError(null);
    setFields({});
    setCode('');
  };

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    setFields({});
    try {
      await fn();
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.fields) setFields(err.fields);
        if (err.retryAfter && err.code === 'RATE_LIMITED') startResend(err.retryAfter);
      }
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const handleLogin = (res: LoginResult) => {
    if (res.status === 'ok') return enterSession(res.me);
    setStep({ kind: 'twofa', challengeId: res.challengeId, methods: res.methods, emailHint: res.emailHint, emailSent: res.emailSent, recovery: false });
    setCode('');
    if (res.emailSent) startResend(60);
  };

  const submitLogin = (e?: FormEvent, creds?: { u: string; p: string }) => {
    e?.preventDefault();
    void run(async () => handleLogin(await api.post<LoginResult>('/auth/login', { username: creds?.u ?? login, password: creds?.p ?? password })));
  };

  const submitRegister = (e: FormEvent) => {
    e.preventDefault();
    const parsed = registerSchema.safeParse({ username, displayName, email, phone, password });
    if (!parsed.success) {
      const f: Record<string, string> = {};
      for (const i of parsed.error.issues) f[String(i.path[0])] ??= i.message;
      setFields(f);
      return;
    }
    void run(async () => handleLogin(await api.post<LoginResult>('/auth/register', parsed.data)));
  };

  const submitCode = (value = code) => {
    if (step.kind !== 'twofa') return;
    void run(async () => handleLogin(await api.post<LoginResult>('/auth/login/2fa', { challengeId: step.challengeId, code: value })));
  };

  const sendLoginEmail = () => {
    if (step.kind !== 'twofa') return;
    void run(async () => {
      const r = await api.post<{ emailHint: string }>('/auth/login/2fa/email', { challengeId: step.challengeId });
      setStep({ ...step, emailSent: true, emailHint: r.emailHint, recovery: false });
      startResend(60);
    });
  };

  const submitForgot = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      await api.post('/auth/password/forgot', { login });
      go({ kind: 'reset', login });
      startResend(60);
    });
  };

  const submitReset = (e: FormEvent) => {
    e.preventDefault();
    if (step.kind !== 'reset') return;
    void run(async () => {
      const r = await api.post<{ status: 'ok'; me: Me } | { status: 'login_required' }>('/auth/password/reset', { login: step.login, code, newPassword: password });
      if (r.status === 'ok') enterSession(r.me);
      else {
        setPassword('');
        go({ kind: 'login', notice: 'Пароль изменён. Войдите с новым паролем и кодом второго фактора.' });
      }
    });
  };

  const demo = config.data?.demo || import.meta.env.DEV;
  const isEntry = step.kind === 'login' || step.kind === 'register';

  return (
    <div className="auth">
      <Showcase />
      <section className="auth__panel">
        <div className="auth__card-wrap">
          <div className="auth__mobile-brand">
            <Logo size={52} />
            <span className="auth__name auth__name--sm">SpaceUp</span>
          </div>
          <div className="auth__form-card">
            {isEntry && (
              <Segmented
                value={step.kind}
                onChange={(v) => go({ kind: v })}
                options={[
                  { value: 'login', label: 'Вход' },
                  { value: 'register', label: 'Регистрация' },
                ]}
              />
            )}

            {step.kind === 'login' && (
              <form className="auth__form" onSubmit={submitLogin} noValidate>
                <Header title="С возвращением!" text="Войдите, чтобы продолжить" />
                {step.notice && <Notice kind="success">{step.notice}</Notice>}
                <Input
                  label="Имя пользователя, почта или телефон"
                  value={login}
                  onChange={(e) => setLogin(e.target.value)}
                  autoComplete="username"
                  autoCapitalize="none"
                  spellCheck={false}
                  placeholder="Имя пользователя, почта или телефон"
                  error={fields.username}
                  autoFocus
                />
                <PasswordInput label="Пароль" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" error={fields.password} />
                <button type="button" className="auth__link auth__forgot" onClick={() => go({ kind: 'forgot' })}>
                  Забыли пароль?
                </button>
                {error && <Notice kind="danger">{error}</Notice>}
                <Button type="submit" size="lg" block loading={busy}>
                  Войти
                </Button>
                {demo && (
                  <button
                    type="button"
                    className="auth__demo"
                    onClick={() => {
                      setLogin('sasha');
                      setPassword('spaceup-demo-2026');
                      submitLogin(undefined, { u: 'sasha', p: 'spaceup-demo-2026' });
                    }}
                  >
                    <Sparkles size={18} />
                    <span>
                      <b>Войти в демо-аккаунт</b>
                      <span className="xs muted" style={{ display: 'block' }}>
                        sasha / spaceup-demo-2026 — с готовыми чатами и публикациями
                      </span>
                    </span>
                  </button>
                )}
              </form>
            )}

            {step.kind === 'register' && (
              <form className="auth__form" onSubmit={submitRegister} noValidate>
                <Header title="Создать аккаунт" text="Это займёт меньше минуты" />
                <Input label="Как вас зовут" value={displayName} onChange={(e) => setDisplayName(e.target.value)} autoComplete="name" error={fields.displayName} placeholder="Александр" autoFocus />
                <Input
                  label="Имя пользователя"
                  value={username}
                  onChange={(e) => setUsername(e.target.value.toLowerCase())}
                  autoComplete="username"
                  autoCapitalize="none"
                  spellCheck={false}
                  placeholder="your_name"
                  error={fields.username}
                  hint="Латинские буквы, цифры и _ — по нему вас найдут"
                />
                <Input
                  label="Почта"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                  autoCapitalize="none"
                  spellCheck={false}
                  placeholder="you@example.com"
                  error={fields.email}
                  hint={mailEnabled ? 'Пришлём код подтверждения. Почта нужна для восстановления доступа' : 'Для восстановления доступа и уведомлений о безопасности'}
                />
                <Input
                  label="Телефон"
                  type="tel"
                  inputMode="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  autoComplete="tel"
                  placeholder="+7 999 123-45-67"
                  error={fields.phone}
                  hint="По номеру вас смогут найти знакомые — это можно отключить в настройках приватности"
                />
                <PasswordInput
                  label="Пароль"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="new-password"
                  error={fields.password}
                  showStrength
                  hint="Минимум 10 символов. Лучше — фраза из нескольких слов"
                />
                {error && <Notice kind="danger">{error}</Notice>}
                <Button type="submit" size="lg" block loading={busy}>
                  Зарегистрироваться
                </Button>
                <p className="xs faint" style={{ textAlign: 'center' }}>
                  Пароль хранится только в виде стойкого хэша (scrypt). Мы никогда не попросим его в письме.
                </p>
              </form>
            )}

            {step.kind === 'twofa' && (
              <form
                className="auth__form"
                onSubmit={(e) => {
                  e.preventDefault();
                  submitCode();
                }}
                noValidate
              >
                <Header
                  onBack={() => go({ kind: 'login' })}
                  icon={step.recovery ? <KeyRound size={26} /> : step.methods.includes('totp') && !step.emailSent ? <Smartphone size={26} /> : <MailOpen size={26} />}
                  title={step.recovery ? 'Резервный код' : 'Подтверждение входа'}
                  text={
                    step.recovery
                      ? 'Введите один из 10 резервных кодов, которые вы сохранили при включении защиты. Каждый код работает один раз.'
                      : step.emailSent
                        ? `Мы отправили 6-значный код на ${step.emailHint}. Он действует 10 минут.`
                        : step.methods.includes('totp')
                          ? 'Введите 6-значный код из приложения-аутентификатора.'
                          : 'Не удалось отправить письмо с кодом. Попробуйте ещё раз или используйте резервный код.'
                  }
                />
                {step.recovery ? (
                  <Input label="Резервный код" value={code} onChange={(e) => setCode(e.target.value)} placeholder="abcde-fghij" autoComplete="one-time-code" autoFocus error={fields.code} />
                ) : (
                  <CodeInput value={code} onChange={setCode} onComplete={(v) => submitCode(v)} error={fields.code} autoFocus />
                )}
                {error && <Notice kind="danger">{error}</Notice>}
                <Button type="submit" size="lg" block loading={busy} disabled={!step.recovery && code.length < 6}>
                  Подтвердить
                </Button>
                <div className="auth__alt">
                  {step.methods.includes('email') && (
                    <button type="button" className="auth__link" disabled={resendIn > 0 || busy} onClick={sendLoginEmail}>
                      <Mail size={15} />
                      {resendIn > 0 ? `Отправить код ещё раз через ${resendIn} с` : step.emailSent ? 'Отправить код ещё раз' : `Прислать код на почту${step.emailHint ? ` ${step.emailHint}` : ''}`}
                    </button>
                  )}
                  {step.methods.includes('totp') && step.emailSent && (
                    <button type="button" className="auth__link" onClick={() => setStep({ ...step, emailSent: false, recovery: false })}>
                      <Smartphone size={15} /> Код из приложения
                    </button>
                  )}
                  <button type="button" className="auth__link" onClick={() => setStep({ ...step, recovery: !step.recovery })}>
                    <KeyRound size={15} /> {step.recovery ? 'Ввести код из 6 цифр' : 'Использовать резервный код'}
                  </button>
                </div>
              </form>
            )}

            {step.kind === 'forgot' && (
              <form className="auth__form" onSubmit={submitForgot} noValidate>
                <Header onBack={() => go({ kind: 'login' })} icon={<KeyRound size={26} />} title="Восстановление пароля" text="Пришлём код на почту, привязанную к аккаунту. Почта должна быть подтверждена." />
                {!mailEnabled && config.data && <Notice kind="warning">На этом сервере отправка писем не настроена — восстановить пароль по почте сейчас нельзя.</Notice>}
                <Input
                  label="Имя пользователя, почта или телефон"
                  value={login}
                  onChange={(e) => setLogin(e.target.value)}
                  autoComplete="username"
                  autoCapitalize="none"
                  spellCheck={false}
                  error={fields.login}
                  autoFocus
                />
                {error && <Notice kind="danger">{error}</Notice>}
                <Button type="submit" size="lg" block loading={busy} disabled={!login.trim() || !mailEnabled}>
                  Получить код
                </Button>
              </form>
            )}

            {step.kind === 'reset' && (
              <form className="auth__form" onSubmit={submitReset} noValidate>
                <Header
                  onBack={() => go({ kind: 'forgot' })}
                  icon={<MailOpen size={26} />}
                  title="Проверьте почту"
                  text="Если аккаунт существует и к нему привязана подтверждённая почта, мы отправили туда код. Он действует 30 минут."
                />
                <CodeInput value={code} onChange={setCode} error={fields.code} autoFocus />
                <PasswordInput label="Новый пароль" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" error={fields.newPassword} showStrength />
                {error && <Notice kind="danger">{error}</Notice>}
                <Button type="submit" size="lg" block loading={busy} disabled={code.length < 6 || password.length < 10}>
                  Сменить пароль
                </Button>
                <div className="auth__alt">
                  <button
                    type="button"
                    className="auth__link"
                    disabled={resendIn > 0 || busy}
                    onClick={() =>
                      void run(async () => {
                        await api.post('/auth/password/forgot', { login: step.login });
                        startResend(60);
                      })
                    }
                  >
                    <RefreshCw size={15} /> {resendIn > 0 ? `Отправить ещё раз через ${resendIn} с` : 'Отправить код ещё раз'}
                  </button>
                </div>
                <p className="xs faint">После смены пароля все остальные сеансы будут завершены.</p>
              </form>
            )}
          </div>

          <div className="auth__footer">
            <span className="row gap-1">
              <ShieldCheck size={14} /> Защита: scrypt · httpOnly-cookie · CSRF · 2FA · E2E
            </span>
            {config.data?.mail.dev && (
              <button type="button" className="auth__link" onClick={() => setMailbox(true)}>
                <Mail size={14} /> Тестовая почта
              </button>
            )}
          </div>
        </div>
      </section>
      <DevMailbox open={mailbox} onClose={() => setMailbox(false)} />
    </div>
  );
}
