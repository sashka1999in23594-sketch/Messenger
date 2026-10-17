import { useEffect } from 'react';
import { BrowserRouter } from 'react-router';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from '../shared/api/query';
import { applyPrefs, usePrefs } from '../shared/stores/prefs';
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
  useEffect(() => {
    const p = { theme, palette, accent, fontScale, density, reduceMotion, glass, aurora };
    applyPrefs(p);
    if (theme !== 'system') return;
    const mql = matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => applyPrefs(p);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [theme, palette, accent, fontScale, density, reduceMotion, glass, aurora]);
  return null;
}

function Gate() {
  const status = useSession((s) => s.status);
  const onboarded = useSession((s) => s.me?.onboarded ?? true);
  useEffect(() => {
    void bootstrapSession();
  }, []);
  if (status === 'loading') return <Loading label="Omni загружается…" />;
  if (status === 'guest') return <AuthPage />;
  if (!onboarded) return <Onboarding />;
  return <AppRoutes />;
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <PrefsSync />
        <Aurora />
        <Gate />
        <Toasts />
        <ConfirmHost />
      </BrowserRouter>
    </QueryClientProvider>
  );
}
