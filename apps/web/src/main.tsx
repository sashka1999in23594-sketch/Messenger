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
    navigator.serviceWorker.register('/sw.js').catch(() => {
      /* офлайн-режим недоступен — приложение работает и без него */
    });
  });
}
