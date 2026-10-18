/**
 * Маршруты для тех, кто ещё не вошёл: вход, регистрация, «Скачать», сайт
 * помощи. Ссылка из QR-кода без входа ведёт на вход — после него откроется
 * подтверждение.
 */
import { lazy, Suspense } from 'react';
import { Route, Routes } from 'react-router';
import { Loading } from '../../shared/ui';
import { DownloadPage } from './DownloadPage';
import { LoginFlow } from './LoginFlow';
import { SignupFlow } from './SignupFlow';

const HelpSite = lazy(() => import('../help').then((m) => ({ default: m.HelpSite })));

export function GuestApp() {
  return (
    <Routes>
      <Route path="/signup" element={<SignupFlow />} />
      <Route path="/download" element={<DownloadPage />} />
      <Route
        path="/help/*"
        element={
          <Suspense fallback={<Loading />}>
            <HelpSite />
          </Suspense>
        }
      />
      <Route path="/qr/:token" element={<LoginFlow notice="Войдите, чтобы разрешить вход на другом устройстве по QR-коду" />} />
      <Route path="*" element={<LoginFlow />} />
    </Routes>
  );
}
