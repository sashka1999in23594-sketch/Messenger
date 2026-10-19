import { lazy, Suspense, useEffect } from 'react';
import { BrowserRouter } from 'react-router';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from '../shared/api/query';
import { applyPrefs, usePrefs } from '../shared/stores/prefs';
import { useMediaQuery } from '../shared/hooks';
import { useSession } from '../shared/stores/session';
import { Aurora, ConfirmHost, Loading, Toasts } from '../shared/ui';
import { GuestApp } from '../features/auth/GuestApp';
import { AppRoutes } from './routes';
import { bootstrapSession } from './session';

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

const Desktop = lazy(() => import('../features/desktop/Desktop').then((m) => ({ default: m.Desktop })));

function Gate() {
  const status = useSession((s) => s.status);
  // На компьютере (широкий экран, мышь) Sunnet — это окна на рабочем столе;
  // на телефоне и планшете — привычное мобильное оформление
  const desktop = useMediaQuery('(min-width: 1024px) and (hover: hover) and (pointer: fine)');
  useEffect(() => {
    void bootstrapSession();
  }, []);
  if (status === 'loading') return <Loading label="Sunnet загружается…" />;
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
    </QueryClientProvider>
  );
}
