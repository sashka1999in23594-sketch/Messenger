import { useEffect } from 'react';
import { BrowserRouter } from 'react-router';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from '../shared/api/query';
import { applyPrefs, usePrefs } from '../shared/stores/prefs';
import { useSession } from '../shared/stores/session';
import { ConfirmHost, Loading, Toasts } from '../shared/ui';
import { AuthPage } from '../features/auth/AuthPage';
import { AppRoutes } from './routes';
import { bootstrapSession } from './session';

function PrefsSync() {
  const theme = usePrefs((s) => s.theme);
  const accent = usePrefs((s) => s.accent);
  const fontScale = usePrefs((s) => s.fontScale);
  const density = usePrefs((s) => s.density);
  const reduceMotion = usePrefs((s) => s.reduceMotion);
  useEffect(() => {
    const p = { theme, accent, fontScale, density, reduceMotion };
    applyPrefs(p);
    if (theme !== 'system') return;
    const mql = matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => applyPrefs(p);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [theme, accent, fontScale, density, reduceMotion]);
  return null;
}

function Gate() {
  const status = useSession((s) => s.status);
  useEffect(() => {
    void bootstrapSession();
  }, []);
  if (status === 'loading') return <Loading label="Omni загружается…" />;
  if (status === 'guest') return <AuthPage />;
  return <AppRoutes />;
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <PrefsSync />
        <Gate />
        <Toasts />
        <ConfirmHost />
      </BrowserRouter>
    </QueryClientProvider>
  );
}
