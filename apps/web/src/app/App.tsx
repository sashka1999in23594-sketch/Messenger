import { lazyRetry } from '../shared/lib/lazyRetry';
import { lazy, Suspense, useEffect } from 'react';
import { BrowserRouter } from 'react-router';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from '../shared/api/query';
import { applyPrefs, usePrefs } from '../shared/stores/prefs';
import { useMediaQuery } from '../shared/hooks';
import { useSession } from '../shared/stores/session';
import { Aurora, ConfirmHost, Loading, SunSplash, Toasts } from '../shared/ui';
import { UploadFx } from '../shared/ui/UploadFx';
import { GuestApp } from '../features/auth/GuestApp';
import { AppRoutes } from './routes';
import { bootstrapSession, retryBootstrap } from './session';
import { useEffect as useTick, useState } from 'react';

/** Внешний вид применяется к <html> при любом изменении настроек. */
function PrefsSync() {
  const theme = usePrefs((s) => s.theme);
  const palette = usePrefs((s) => s.palette);
  const accent = usePrefs((s) => s.accent);
  const fontScale = usePrefs((s) => s.fontScale);
  const density = usePrefs((s) => s.density);
  const reduceMotion = usePrefs((s) => s.reduceMotion);
  const glass = usePrefs((s) => s.glass);
  const aurora = usePrefs((s) => s.aurora);
  const fontFamily = usePrefs((s) => s.fontFamily);
  const corners = usePrefs((s) => s.corners);
  useEffect(() => {
    const p = { theme, palette, accent, fontScale, density, reduceMotion, glass, aurora, fontFamily, corners };
    applyPrefs(p);
    if (theme !== 'system') return;
    const mql = matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => applyPrefs(p);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [theme, palette, accent, fontScale, density, reduceMotion, glass, aurora, fontFamily, corners]);
  return null;
}

/**
 * Ленивая загрузка с повтором: после выхода новой версии старые файлы сборки исчезают,
 * и импорт падал — рабочий стол не открывался («белый экран»). Пробуем трижды,
 * затем один раз перезагружаем страницу, чтобы получить свежую сборку.
 */
const Desktop = lazy(() => lazyRetry(() => import('../features/desktop/Desktop')).then((m) => ({ default: m.Desktop })));

/** Экран пробуждения: этапы и таймер, чтобы было видно, что идёт работа. */
function WakeSplash() {
  const since = useSession((s) => s.wakingSince);
  const seen = useSession((s) => s.serverSeen);
  const [now, setNow] = useState(Date.now());
  useTick(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const sec = since ? (now - since) / 1000 : 0;
  return (
    <SunSplash
      label="Сервер отдыхал после простоя и сейчас просыпается. Обычно это до минуты — вход сохранён."
      elapsed={sec}
      stages={[
        { label: 'Интернет', state: 'done' },
        { label: 'Сервер найден', state: seen || sec > 6 ? 'done' : 'now' },
        { label: 'Запуск', state: seen || sec > 6 ? 'now' : 'wait' },
        { label: 'Ваш сеанс', state: 'wait' },
      ]}
    />
  );
}

function Gate() {
  const status = useSession((s) => s.status);
  // На компьютере (широкий экран, мышь) Sunnet — это окна на рабочем столе;
  // на телефоне и планшете — привычное мобильное оформление
  const desktop = useMediaQuery('(min-width: 1024px) and (hover: hover) and (pointer: fine)');
  useEffect(() => {
    void bootstrapSession();
  }, []);
  if (status === 'loading') return <SunSplash label="Загружаем…" />;
  if (status === 'waking') return <WakeSplash />;
  if (status === 'offline')
    return (
      <SunSplash
        offline={{
          title: 'Сервер Sunnet не отвечает',
          text: navigator.onLine
            ? 'Мы ждали 2,5 минуты. Сервер остановлен или перегружен. Ваш вход сохранён — ничего не потеряно.'
            : 'Нет подключения к интернету. Проверьте сеть — вход сохранён.',
        }}
        onRetry={retryBootstrap}
      />
    );
  if (status === 'guest')
    return (
      <BrowserRouter>
        <GuestApp />
      </BrowserRouter>
    );
  // У каждого окна свой роутер, поэтому рабочий стол живёт вне общего BrowserRouter
  if (desktop)
    return (
      <Suspense fallback={<Loading label="Открываем рабочий стол…" />}>
        <Desktop />
      </Suspense>
    );
  return (
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  );
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <PrefsSync />
      <Aurora />
      <Gate />
      <Toasts />
      <ConfirmHost />
      <UploadFx />
    </QueryClientProvider>
  );
}
