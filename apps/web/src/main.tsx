import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/tokens.css';
import './styles/base.css';
import './styles/components.css';
import './styles/layout.css';
import './styles/theme.css';
import { App } from './app/App';
import { startBrandClock } from './shared/lib/brand';

// Sunnet днём, Lynnet ночью — в установленном приложении
startBrandClock();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Service Worker — только в production-сборке (в разработке мешает горячей перезагрузке)
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    // updateViaCache: 'none' — сам sw.js никогда не берётся из HTTP-кэша, поэтому
    // новая версия всегда замечается. Когда новый SW берёт управление — один раз
    // перезагружаем страницу, чтобы свежая версия применилась сама, без очистки кэша.
    const hadController = !!navigator.serviceWorker.controller;
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloaded || !hadController) return;
      reloaded = true;
      window.location.reload();
    });
    navigator.serviceWorker
      .register('/sw.js', { updateViaCache: 'none' })
      .then((reg) => {
        void reg.update().catch(() => undefined);
        // Проверяем обновление при каждом возврате к окну
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') void reg.update().catch(() => undefined);
        });
      })
      .catch(() => {
        /* офлайн-режим недоступен — приложение работает и без него */
      });
  });
}
