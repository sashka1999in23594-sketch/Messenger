/**
 * Регистрация слайдами — по одному полю: почта → код из письма → телефон →
 * имя → @имя → дата рождения и пол → пароль → повтор → подсказка.
 */
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { ArrowRight, AtSign, Cake, Check, X } from 'lucide-react';
import {
  birthDate as birthDateSchema,
  checkPasswordPolicy,
  LIMITS,
  normalizePhone,
  sanitizeName,
  sanitizeUsername,
  USERNAME_RE,
  type AuthFlowResult,
  type Gender,
  type SignupState,
} from '@omni/shared';
import { api, ApiError, errorMessage } from '../../shared/api/client';
import { Button, CodeInput, Input, PasswordInput, Segmented } from '../../shared/ui';
import { enterSession } from '../../app/session';
import { AuthLayout, AuthLinks, DOWNLOAD_LINK, HELP_LINK, minutes, mmss, PARTNERS_LINK, StepTitle, useSecondsLeft } from './ui';

const SLIDES = ['email', 'code', 'phone', 'name', 'username', 'birth', 'password', 'repeat', 'hint'] as const;
type Slide = (typeof SLIDES)[number];
/** Поле ответа сервера → слайд, где его исправлять */
const FIELD_SLIDE: Record<string, Slide> = {
  email: 'email',
  code: 'code',
  phone: 'phone',
  displayName: 'name',
  username: 'username',
  birthDate: 'birth',
  gender: 'birth',
  password: 'password',
  repeat: 'repeat',
  passwordHint: 'hint',
};

/** Самая поздняя дата рождения (регистрация — с 14 лет). */
function maxBirthDate(): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() - LIMITS.minAge);
  return d.toISOString().slice(0, 10);
}

export function SignupFlow() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [slide, setSlide] = useState<Slide>('email');
  const [state, setState] = useState<SignupState | null>(null);
  const [email, setEmail] = useState(params.get('email') ?? '');
  const [code, setCode] = useState('');
  const [phone, setPhone] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [birth, setBirth] = useState('');
  const [gender, setGender] = useState<Gender>('unspecified');
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [hint, setHint] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [usernameFree, setUsernameFree] = useState<boolean | null>(null);

  const index = SLIDES.indexOf(slide);
  const go = (to: Slide, err: string | null = null) => {
    setError(err);
    setSlide(to);
  };
  const fail = (e: unknown) => {
    if (e instanceof ApiError && e.code === 'FLOW_EXPIRED') {
      setState(null);
      return go('email', 'Время на регистрацию истекло — начните заново');
    }
    if (e instanceof ApiError && e.fields) {
      const [field, message] = Object.entries(e.fields)[0] ?? [];
      if (field && FIELD_SLIDE[field]) return go(FIELD_SLIDE[field], message ?? null);
    }
    setError(errorMessage(e));
  };
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  // Свободно ли @имя — проверяем на лету
  useEffect(() => {
    setUsernameFree(null);
    if (!USERNAME_RE.test(username)) return;
    const t = setTimeout(() => {
      api
        .get<{ username?: boolean }>(`/auth/signup/available?username=${username}`)
        .then((r) => setUsernameFree(r.username ?? null))
        .catch(() => undefined);
    }, 400);
    return () => clearTimeout(t);
  }, [username]);

  const verifyCode = (value: string) => {
    if (value.length < 6 || !state) return;
    void run(async () => {
      setState(await api.post<SignupState>('/auth/signup/verify', { flow: state.flow, code: value }));
      go('phone');
    });
  };

  const next = (e?: FormEvent) => {
    e?.preventDefault();
    switch (slide) {
      case 'email':
        if (!/^\S+@\S+\.\S+$/.test(email.trim())) return setError('Проверьте адрес почты');
        return void run(async () => {
          setState(await api.post<SignupState>('/auth/signup/start', { email: email.trim() }));
          setCode('');
          go('code');
        });
      case 'code':
        return verifyCode(code);
      case 'phone': {
        const normalized = normalizePhone(phone);
        if (!normalized) return setError('Укажите номер в международном формате, например +7 999 123-45-67');
        return void run(async () => {
          const r = await api.get<{ phone?: boolean }>(`/auth/signup/available?phone=${encodeURIComponent(normalized)}`);
          if (r.phone === false) return setError('Этот номер уже привязан к другому аккаунту');
          go('name');
        });
      }
      case 'name':
        if (!/\p{L}/u.test(displayName)) return setError('Напишите, как вас зовут');
        return go('username');
      case 'username':
        if (!USERNAME_RE.test(username)) return setError('От 3 до 32 символов: латинские буквы, цифры и _');
        if (usernameFree === false) return setError('Это имя уже занято');
        return go('birth');
      case 'birth': {
        const r = birthDateSchema.safeParse(birth);
        if (!r.success) return setError(r.error.issues[0]?.message ?? 'Укажите дату рождения');
        return go('password');
      }
      case 'password': {
        const problem = checkPasswordPolicy(password, [username, displayName]);
        if (problem) return setError(problem);
        return go('repeat');
      }
      case 'repeat':
        if (repeat !== password) return setError('Пароли не совпадают');
        return go('hint');
      case 'hint':
        if (hint.trim().length < 2) return setError('Напишите подсказку — хотя бы 2 символа');
        return void run(async () => {
          const r = await api.post<AuthFlowResult>('/auth/signup/complete', {
            flow: state!.flow,
            phone,
            displayName: displayName.trim(),
            username,
            birthDate: birth,
            gender,
            password,
            repeat,
            passwordHint: hint.trim(),
          });
          if (r.status === 'ok') enterSession(r.me);
        });
    }
  };

  const back = () => {
    if (slide === 'phone' || slide === 'code') {
      // Почту подтверждаем заново, если вернуться к ней
      setState(null);
      return go('email');
    }
    go(SLIDES[Math.max(0, index - 1)]!);
  };

  let content: ReactNode;
  switch (slide) {
    case 'email':
      content = (
        <>
          <StepTitle title="Создайте аккаунт" text="Начнём с почты — пришлём на неё код подтверждения" />
          <Input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Почта"
            aria-label="Почта"
            autoComplete="email"
            autoCapitalize="none"
            spellCheck={false}
            autoFocus
            error={error}
          />
          {error?.includes('войдите') && (
            <button type="button" className="auth__inline-link" onClick={() => navigate(`/login?login=${encodeURIComponent(email.trim())}`)}>
              Войти с этой почтой
            </button>
          )}
        </>
      );
      break;
    case 'code':
      content = (
        <>
          <StepTitle title="Подтвердите почту" text={`Мы отправили код на ${email.trim()}. Если письма нет — загляните в «Спам».`} />
          <CodeInput value={code} onChange={setCode} onComplete={verifyCode} error={error} autoFocus label="Код из письма" />
          {state && <SignupResend state={state} onState={setState} onError={fail} />}
        </>
      );
      break;
    case 'phone':
      content = (
        <>
          <StepTitle title="Ваш номер телефона" text="По нему вас смогут найти друзья, и по нему же можно входить" />
          <Input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+7 999 123-45-67" aria-label="Номер телефона" autoComplete="tel" autoFocus error={error} />
        </>
      );
      break;
    case 'name':
      content = (
        <>
          <StepTitle title="Как вас зовут?" text="Это имя увидят собеседники и подписчики" />
          <Input
            value={displayName}
            onChange={(e) => setDisplayName(sanitizeName(e.target.value, LIMITS.displayNameMax))}
            placeholder="Имя и фамилия"
            aria-label="Имя"
            autoComplete="name"
            hint="Только буквы, цифры, пробел и дефис — без эмодзи"
            autoFocus
            error={error}
          />
        </>
      );
      break;
    case 'username':
      content = (
        <>
          <StepTitle title="Придумайте имя пользователя" text="По нему вас найдут и упомянут: @имя" />
          <div className="auth__username">
            <AtSign size={18} className="auth__username-at" />
            <Input
              value={username}
              onChange={(e) => setUsername(sanitizeUsername(e.target.value, LIMITS.usernameMax))}
              placeholder="username"
              aria-label="Имя пользователя"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              autoFocus
              error={error}
              hint={
                usernameFree === true ? (
                  <span className="auth__ok">
                    <Check size={14} /> Свободно
                  </span>
                ) : usernameFree === false ? (
                  <span className="auth__bad">
                    <X size={14} /> Уже занято
                  </span>
                ) : (
                  'Латинские буквы, цифры и _ — от 3 до 32 символов'
                )
              }
            />
          </div>
        </>
      );
      break;
    case 'birth':
      content = (
        <>
          <StepTitle title="Дата рождения и пол" />
          <Input type="date" value={birth} onChange={(e) => setBirth(e.target.value)} min="1906-01-01" max={maxBirthDate()} aria-label="Дата рождения" autoFocus error={error} />
          <Segmented<Gender>
            value={gender}
            onChange={setGender}
            options={[
              { value: 'male', label: 'Мужской' },
              { value: 'female', label: 'Женский' },
              { value: 'unspecified', label: 'Не указывать' },
            ]}
          />
          <p className="auth__why">
            <Cake size={16} />
            <span>
              Зачем это нужно: чтобы ваши подписчики, контакты и все, с кем вы общаетесь в чатах, могли поздравить вас с днём рождения. В этот день мы пришлём вам письмо и поздравим в
              приложении. Дату никто не видит — друзья просто получат напоминание.
            </span>
          </p>
        </>
      );
      break;
    case 'password':
      content = (
        <>
          <StepTitle title="Придумайте пароль" text={`Не короче ${LIMITS.passwordMin} символов. Лучше всего — несколько случайных слов`} />
          <PasswordInput value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Пароль" aria-label="Пароль" autoComplete="new-password" showStrength autoFocus error={error} />
        </>
      );
      break;
    case 'repeat':
      content = (
        <>
          <StepTitle title="Повторите пароль" text="Чтобы точно не ошибиться" />
          <PasswordInput value={repeat} onChange={(e) => setRepeat(e.target.value)} placeholder="Пароль ещё раз" aria-label="Повторите пароль" autoComplete="new-password" autoFocus error={error} />
        </>
      );
      break;
    case 'hint':
      content = (
        <>
          <StepTitle title="Подсказка к паролю" text="Если забудете пароль, подсказка поможет вспомнить. Её увидите только вы — после ввода кода" />
          <Input value={hint} onChange={(e) => setHint(e.target.value)} placeholder="Например: кличка первой собаки" aria-label="Подсказка к паролю" maxLength={LIMITS.passwordHintMax} autoFocus error={error} />
          <p className="auth__consent">
            Нажимая «Создать аккаунт», вы соглашаетесь с{' '}
            <a href="/help/terms" target="_blank" rel="noreferrer">
              Условиями использования
            </a>{' '}
            и{' '}
            <a href="/help/privacy" target="_blank" rel="noreferrer">
              Политикой конфиденциальности
            </a>
            .
          </p>
        </>
      );
      break;
  }

  const links =
    slide === 'email'
      ? [{ label: 'Войти в аккаунт', to: '/login' }, DOWNLOAD_LINK, PARTNERS_LINK, HELP_LINK]
      : [{ label: 'Назад', onClick: back }, HELP_LINK, DOWNLOAD_LINK];
  return (
    <AuthLayout links={<AuthLinks items={links} />}>
      <form key={slide} className="auth__form auth__step" onSubmit={next} noValidate>
        <div className="auth__progress" aria-label={`Шаг ${index + 1} из ${SLIDES.length}`}>
          {SLIDES.map((s, i) => (
            <span key={s} className={i <= index ? 'is-done' : undefined} />
          ))}
        </div>
        {content}
        <Button type="submit" block size="lg" loading={busy} icon={slide === 'hint' ? undefined : <ArrowRight size={18} />} disabled={slide === 'code' && code.length < 6}>
          {slide === 'hint' ? 'Создать аккаунт' : 'Далее'}
        </Button>
      </form>
    </AuthLayout>
  );
}

function SignupResend({ state, onState, onError }: { state: SignupState; onState: (s: SignupState) => void; onError: (e: unknown) => void }) {
  const left = useSecondsLeft(state.resendIn, state);
  const limitLeft = useSecondsLeft(state.limitResetIn, state);
  const [busy, setBusy] = useState(false);
  if (state.resendIn === null || state.limited) {
    return state.limited ? (
      <span className="auth__muted auth__center">Код на этот адрес можно получить 2 раза за 30 минут{limitLeft > 0 ? ` — снова через ${minutes(limitLeft)}` : ''}.</span>
    ) : null;
  }
  return (
    <div className="auth__resend">
      {left > 0 ? (
        <span className="auth__muted">Отправить снова можно через {mmss(left)}</span>
      ) : (
        <button
          type="button"
          className="auth__inline-link"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              onState(await api.post<SignupState>('/auth/signup/resend', { flow: state.flow }));
            } catch (e) {
              onError(e);
            } finally {
              setBusy(false);
            }
          }}
        >
          Отправить снова
        </button>
      )}
    </div>
  );
}
