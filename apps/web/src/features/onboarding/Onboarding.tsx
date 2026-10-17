import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ArrowRight, Camera, Check, MailCheck, Moon, Palette, PartyPopper, Sun, UserPlus, Users } from 'lucide-react';
import type { Me, UserSummary } from '@omni/shared';
import { api, ApiError, errorMessage, uploadFile } from '../../shared/api/client';
import { prepareImage } from '../../shared/lib/media';
import { usePrefs } from '../../shared/stores/prefs';
import { useMe, useSession } from '../../shared/stores/session';
import { toast } from '../../shared/stores/ui';
import { cn } from '../../shared/lib/format';
import { AccentPicker, Avatar, Button, CodeInput, Loading, Logo, Notice, PalettePicker, Segmented, Textarea, Verified } from '../../shared/ui';
import { useAuthConfig } from '../../shared/api/config';
import { useCountdown } from '../../shared/hooks';
import './onboarding.css';

type StepId = 'email' | 'profile' | 'theme' | 'people' | 'done';

function EmailStep({ onNext }: { onNext: () => void }) {
  const me = useMe();
  const setMe = useSession((s) => s.setMe);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [resendIn, startResend] = useCountdown();
  const verify = useMutation({
    mutationFn: (c: string) => api.post<Me>('/me/email/verify', { code: c }),
    onSuccess: (m) => {
      setMe(m);
      toast({ text: 'Почта подтверждена', kind: 'success' });
      onNext();
    },
    onError: (e) => {
      setCode('');
      setError(errorMessage(e));
    },
  });
  const resend = useMutation({
    mutationFn: () => api.post('/me/email/send-code'),
    onSuccess: () => {
      startResend(60);
      toast({ text: 'Новый код отправлен', kind: 'success' });
    },
    onError: (e) => {
      if (e instanceof ApiError && e.retryAfter) startResend(e.retryAfter);
      setError(errorMessage(e));
    },
  });
  return (
    <>
      <div className="onb__icon">
        <MailCheck size={30} />
      </div>
      <h1>Подтвердите почту</h1>
      <p className="muted">
        Мы отправили 6-значный код на <b className="onb__email">{me.email}</b>. Почта понадобится, чтобы восстановить доступ и получать коды входа.
      </p>
      <CodeInput
        value={code}
        onChange={(v) => {
          setCode(v);
          setError(null);
        }}
        onComplete={(v) => verify.mutate(v)}
        error={error}
        autoFocus
      />
      <Button size="lg" block loading={verify.isPending} disabled={code.length < 6} onClick={() => verify.mutate(code)}>
        Подтвердить
      </Button>
      <button className="onb__link" disabled={resendIn > 0 || resend.isPending} onClick={() => resend.mutate()}>
        {resendIn > 0 ? `Отправить код ещё раз через ${resendIn} с` : 'Не пришло письмо? Отправить ещё раз'}
      </button>
      <p className="xs faint">Проверьте папку «Спам». Сменить адрес можно позже в настройках аккаунта.</p>
    </>
  );
}

function ProfileStep({ onNext }: { onNext: () => void }) {
  const me = useMe();
  const setMe = useSession((s) => s.setMe);
  const [bio, setBio] = useState(me.bio);
  const [uploading, setUploading] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const save = useMutation({
    mutationFn: (patch: Record<string, unknown>) => api.patch<Me>('/me/profile', patch),
    onSuccess: (m) => setMe(m),
    onError: (e) => toast({ text: errorMessage(e), kind: 'error' }),
  });
  const upload = async (file: File) => {
    setUploading(true);
    try {
      const img = await prepareImage(file, 800);
      const media = await uploadFile(img.blob, img.name, { width: img.width, height: img.height });
      save.mutate({ avatarMediaId: media.id });
    } catch (e) {
      toast({ text: errorMessage(e), kind: 'error' });
    } finally {
      setUploading(false);
    }
  };
  return (
    <>
      <h1>Расскажите о себе</h1>
      <p className="muted">Фото и пару слов о себе — так друзьям будет проще вас найти.</p>
      <button className="onb__avatar" onClick={() => input.current?.click()} aria-label="Выбрать фото профиля">
        <Avatar src={me.avatarUrl} name={me.displayName} id={me.id} size={112} />
        <span className="onb__avatar-badge">{uploading ? <span className="spinner" style={{ width: 16, height: 16 }} /> : <Camera size={18} />}</span>
      </button>
      <input ref={input} type="file" accept="image/*" hidden onChange={(e) => e.target.files?.[0] && void upload(e.target.files[0])} />
      <div className="onb__name">
        {me.displayName} {me.verified && <Verified size={18} />}
        <span className="muted small">@{me.username}</span>
      </div>
      <Textarea label="О себе" value={bio} onChange={(e) => setBio(e.target.value)} maxLength={300} placeholder="Чем занимаетесь, что любите" style={{ minHeight: 84 }} />
      <Button
        size="lg"
        block
        loading={save.isPending}
        icon={<ArrowRight size={18} />}
        onClick={() => {
          if (bio !== me.bio) save.mutate({ bio });
          onNext();
        }}
      >
        Дальше
      </Button>
    </>
  );
}

function ThemeStep({ onNext }: { onNext: () => void }) {
  const theme = usePrefs((s) => s.theme);
  const set = usePrefs((s) => s.set);
  return (
    <>
      <h1>Выберите оформление</h1>
      <p className="muted">Палитра меняет цвета сияния, акцент — кнопки и сообщения. Всё можно поменять в любой момент.</p>
      <div className="row center">
        <Segmented
          value={theme === 'light' ? 'light' : 'dark'}
          onChange={(v) => set({ theme: v })}
          options={[
            { value: 'dark', label: 'Тёмная' },
            { value: 'light', label: 'Светлая' },
          ]}
        />
        <span className="faint">{theme === 'light' ? <Sun size={18} /> : <Moon size={18} />}</span>
      </div>
      <div className="onb__pickers">
        <PalettePicker />
        <AccentPicker />
      </div>
      <Button size="lg" block icon={<ArrowRight size={18} />} onClick={onNext}>
        Дальше
      </Button>
    </>
  );
}

function PeopleStep({ onNext }: { onNext: () => void }) {
  const q = useQuery({ queryKey: ['suggestions'], queryFn: () => api.get<{ items: UserSummary[] }>('/users/suggestions') });
  const [followed, setFollowed] = useState<Record<string, boolean>>({});
  const toggle = async (u: UserSummary) => {
    const on = !followed[u.id];
    setFollowed((f) => ({ ...f, [u.id]: on }));
    try {
      if (on) await api.post(`/users/${u.id}/follow`);
      else await api.del(`/users/${u.id}/follow`);
    } catch (e) {
      setFollowed((f) => ({ ...f, [u.id]: !on }));
      toast({ text: errorMessage(e), kind: 'error' });
    }
  };
  const count = Object.values(followed).filter(Boolean).length;
  return (
    <>
      <h1>На кого подписаться</h1>
      <p className="muted">Их публикации, видео и истории появятся в ваших лентах.</p>
      <div className="onb__people">
        {q.isLoading && <span className="spinner" />}
        {q.data?.items.length === 0 && <Notice>Пока некого предложить — загляните в «Обзор» позже.</Notice>}
        {q.data?.items.slice(0, 8).map((u) => (
          <button key={u.id} className={cn('onb__person', followed[u.id] && 'onb__person--on')} onClick={() => void toggle(u)}>
            <Avatar src={u.avatarUrl} name={u.displayName} id={u.id} size={52} />
            <span className="onb__person-name">
              <span className="ellipsis">{u.displayName}</span> {u.verified && <Verified size={14} />}
            </span>
            <span className="xs muted ellipsis">@{u.username}</span>
            <span className="onb__person-btn">{followed[u.id] ? <Check size={16} /> : <UserPlus size={16} />}</span>
          </button>
        ))}
      </div>
      <Button size="lg" block icon={<ArrowRight size={18} />} onClick={onNext}>
        {count ? `Дальше · подписок: ${count}` : 'Дальше'}
      </Button>
    </>
  );
}

function DoneStep({ onFinish, finishing }: { onFinish: () => void; finishing: boolean }) {
  const me = useMe();
  return (
    <>
      <div className="onb__icon onb__icon--party">
        <PartyPopper size={34} />
      </div>
      <h1>Всё готово, {me.displayName.split(' ')[0]}!</h1>
      <p className="muted">Подсказка: нажмите Ctrl+K в любом месте — найдёте любой раздел, человека или канал за секунду.</p>
      <div className="onb__tips">
        <span>
          <Users size={16} /> Создайте группу или канал
        </span>
        <span>
          <Palette size={16} /> Настройте тему под себя
        </span>
        <span>
          <MailCheck size={16} /> Включите вход по коду
        </span>
      </div>
      <Button size="lg" block loading={finishing} onClick={onFinish}>
        Начать общение
      </Button>
    </>
  );
}

/** Знакомство с приложением после регистрации. Любой шаг можно пропустить. */
export function Onboarding() {
  const me = useMe();
  const setMe = useSession((s) => s.setMe);
  const config = useAuthConfig();
  const finish = useMutation({
    mutationFn: () => api.post<Me>('/me/onboarded'),
    onSuccess: (m) => setMe(m),
    onError: (e) => toast({ text: errorMessage(e), kind: 'error' }),
  });
  // Набор шагов фиксируется один раз: после подтверждения почты шаг «почта» не должен исчезнуть из-под ног
  const [steps, setSteps] = useState<StepId[] | null>(null);
  useEffect(() => {
    if (steps || !config.data) return;
    const needEmail = !!me.email && !me.emailVerified && config.data.mail.enabled;
    setSteps([...(needEmail ? (['email'] as const) : []), 'profile', 'theme', 'people', 'done']);
  }, [config.data, me.email, me.emailVerified, steps]);
  const [index, setIndex] = useState(0);
  if (!steps) return <Loading />;
  const step = steps[Math.min(index, steps.length - 1)]!;
  const next = () => setIndex((i) => Math.min(i + 1, steps.length - 1));

  return (
    <div className="onb">
      <div className="onb__top">
        <Logo size={36} />
        <div className="onb__progress" aria-label={`Шаг ${index + 1} из ${steps.length}`}>
          {steps.map((s, i) => (
            <span key={s} className={cn(i <= index && 'onb__progress--on')} />
          ))}
        </div>
        {step !== 'done' ? (
          <button className="onb__link" onClick={() => (step === 'email' ? next() : setIndex(steps.length - 1))}>
            Пропустить
          </button>
        ) : (
          <span style={{ width: 80 }} />
        )}
      </div>
      <div className="onb__card" key={step}>
        {step === 'email' && <EmailStep onNext={next} />}
        {step === 'profile' && <ProfileStep onNext={next} />}
        {step === 'theme' && <ThemeStep onNext={next} />}
        {step === 'people' && <PeopleStep onNext={next} />}
        {step === 'done' && <DoneStep onFinish={() => finish.mutate()} finishing={finish.isPending} />}
      </div>
    </div>
  );
}
