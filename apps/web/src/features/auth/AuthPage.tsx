import { useState, type FormEvent } from 'react';
import { Camera, Clapperboard, Lock, MessageCircle, Newspaper, ShieldCheck, SquarePlay } from 'lucide-react';
import { registerSchema, type LoginResult } from '@omni/shared';
import { api, ApiError, errorMessage } from '../../shared/api/client';
import { Button, Input, Notice, PasswordInput } from '../../shared/ui';
import { enterSession } from '../../app/session';
import './auth.css';

type Mode = 'login' | 'register';

const FEATURES = [
  { icon: MessageCircle, title: 'Мессенджер', text: 'Личные чаты, группы и каналы' },
  { icon: Lock, title: 'Секретные чаты', text: 'Сквозное шифрование на устройстве' },
  { icon: Newspaper, title: 'Лента', text: 'Посты, обсуждения и тренды' },
  { icon: SquarePlay, title: 'Видео', text: 'Плейлисты и студия автора' },
  { icon: Clapperboard, title: 'Клипы', text: 'Короткие вертикальные видео' },
  { icon: Camera, title: 'Фото и истории', text: 'Делитесь моментами' },
];

export function AuthPage() {
  const [mode, setMode] = useState<Mode>('login');
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [challenge, setChallenge] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handle = async (fn: () => Promise<LoginResult>) => {
    setBusy(true);
    setError(null);
    setFields({});
    try {
      const res = await fn();
      if (res.status === 'two_factor_required') {
        setChallenge(res.challengeId);
      } else {
        enterSession(res.me);
      }
    } catch (err) {
      if (err instanceof ApiError && err.fields) setFields(err.fields);
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (challenge) {
      void handle(() => api.post<LoginResult>('/auth/login/2fa', { challengeId: challenge, code }));
      return;
    }
    if (mode === 'register') {
      const parsed = registerSchema.safeParse({ username, displayName, password });
      if (!parsed.success) {
        const f: Record<string, string> = {};
        for (const i of parsed.error.issues) f[String(i.path[0])] ??= i.message;
        setFields(f);
        return;
      }
      void handle(() => api.post<LoginResult>('/auth/register', parsed.data));
    } else {
      void handle(() => api.post<LoginResult>('/auth/login', { username, password }));
    }
  };

  return (
    <div className="auth">
      <section className="auth__hero" aria-hidden>
        <div className="auth__brand">
          <img src="/icons/icon-192.png" alt="" width={56} height={56} />
          <div>
            <div className="auth__name">Omni</div>
            <div className="auth__tagline">Всё общение — в одном месте</div>
          </div>
        </div>
        <div className="auth__features">
          {FEATURES.map((f) => (
            <div key={f.title} className="auth__feature">
              <f.icon size={22} />
              <div>
                <div className="bold">{f.title}</div>
                <div className="small">{f.text}</div>
              </div>
            </div>
          ))}
        </div>
        <div className="auth__security">
          <ShieldCheck size={18} />
          Пароли — scrypt, сеансы — httpOnly cookie, защита от CSRF и перебора, 2FA и журнал входов.
        </div>
      </section>

      <section className="auth__panel">
        <form className="auth__form" onSubmit={submit} noValidate>
          <img className="auth__mobile-logo" src="/icons/icon-192.png" alt="Omni" width={64} height={64} />
          {challenge ? (
            <>
              <h1>Подтверждение входа</h1>
              <p className="muted">Введите 6-значный код из приложения-аутентификатора или один из резервных кодов.</p>
              <Input
                label="Код"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                inputMode="text"
                autoComplete="one-time-code"
                autoFocus
                placeholder="123456"
                error={fields.code}
              />
              {error && <Notice kind="danger">{error}</Notice>}
              <Button type="submit" size="lg" block loading={busy}>
                Подтвердить
              </Button>
              <Button variant="ghost" block onClick={() => setChallenge(null)}>
                Назад
              </Button>
            </>
          ) : (
            <>
              <h1>{mode === 'login' ? 'С возвращением!' : 'Создать аккаунт'}</h1>
              <p className="muted">{mode === 'login' ? 'Войдите, чтобы продолжить' : 'Это займёт меньше минуты'}</p>
              <Input
                label="Имя пользователя"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                placeholder="например, sasha"
                error={fields.username}
                hint={mode === 'register' ? 'Латинские буквы, цифры и _' : undefined}
                autoFocus
              />
              {mode === 'register' && (
                <Input label="Как вас зовут" value={displayName} onChange={(e) => setDisplayName(e.target.value)} autoComplete="name" error={fields.displayName} />
              )}
              <PasswordInput
                label="Пароль"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                error={fields.password}
                showStrength={mode === 'register'}
                hint={mode === 'register' ? 'Минимум 10 символов. Лучше — фраза из нескольких слов' : undefined}
              />
              {error && <Notice kind="danger">{error}</Notice>}
              <Button type="submit" size="lg" block loading={busy}>
                {mode === 'login' ? 'Войти' : 'Зарегистрироваться'}
              </Button>
              <div className="auth__switch">
                {mode === 'login' ? 'Нет аккаунта?' : 'Уже есть аккаунт?'}{' '}
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  onClick={() => {
                    setMode(mode === 'login' ? 'register' : 'login');
                    setError(null);
                    setFields({});
                  }}
                >
                  {mode === 'login' ? 'Создать' : 'Войти'}
                </button>
              </div>
              {mode === 'login' && (
                <Notice>
                  Демо-доступ после <span className="mono">npm run seed</span>: <b>sasha</b> / <span className="mono">omni-demo-2026</span>
                </Notice>
              )}
            </>
          )}
        </form>
      </section>
    </div>
  );
}
