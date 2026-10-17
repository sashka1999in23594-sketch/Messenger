import { lazy, Suspense, useEffect } from 'react';
import { BrowserRouter } from 'react-router';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from '../shared/api/query';
import { applyPrefs, usePrefs } from '../shared/stores/prefs';
import { useMediaQuery } from '../shared/hooks';
import { useSession } from '../shared/stores/session';
import { Aurora, ConfirmHost, Loading, Toasts } from '../shared/ui';
import { AuthPage } from '../features/auth/AuthPage';
import { Onboarding } from '../features/onboarding/Onboarding';
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
  const onboarded = useSession((s) => s.me?.onboarded ?? true);
  // «Пространство» — только на экранах, где помещаются окна (планшет и компьютер)
  const spaceMode = usePrefs((s) => s.spaceMode ?? false);
  const wide = useMediaQuery('(min-width: 900px)');
  useEffect(() => {
    void bootstrapSession();
  }, []);
  if (status === 'loading') return <Loading label="SpaceUp загружается…" />;
  if (status === 'guest') return <BrowserRouter><AuthPage /></BrowserRouter>;
  if (!onboarded) return <BrowserRouter><Onboarding /></BrowserRouter>;
  // У каждого окна свой роутер, поэтому рабочий стол живёт вне общего BrowserRouter
  if (spaceMode && wide)
    return (
      <Suspense fallback={<Loading label="Открываем Пространство…" />}>
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
