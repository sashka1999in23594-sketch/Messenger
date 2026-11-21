/**
 * Экран, пока сервер Render просыпается: этапы подключения, время ожидания,
 * а если сервер действительно недоступен — понятное сообщение и «Повторить».
 */
import { useEffect, useState } from 'react';
import { RefreshCw, WifiOff } from 'lucide-react';
import { useSession } from '../shared/stores/session';
import { SunSplash } from '../shared/ui';

export function WakeScreen({ offline, onRetry }: { offline: boolean; onRetry: () => void }) {
  const wake = useSession((s) => s.wake);
  const [now, setNow] = useState(Date.now());
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 500);
    const on = () => setOnline(navigator.onLine);
    window.addEventListener('online', on);
    window.addEventListener('offline', on);
    return () => {
      clearInterval(t);
      window.removeEventListener('online', on);
      window.removeEventListener('offline', on);
    };
  }, []);
  // Интернет вернулся — пробуем сами
  useEffect(() => {
    if (offline && online) onRetry();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online]);
  const sec = wake ? Math.max(0, Math.round((now - wake.since) / 1000)) : 0;

  if (offline)
    return (
      <SunSplash
        stalled
        label={online ? 'Сервер Sunnet не отвечает. Возможно, идут технические работы — данные в безопасности.' : 'Нет подключения к интернету. Проверьте Wi‑Fi или кабель.'}
        footer={
          <div className="wake__actions">
            <span className="wake__badge">
              <WifiOff size={14} /> {online ? 'Сервер недоступен' : 'Нет сети'}
            </span>
            <button type="button" className="btn btn--primary wake__retry" onClick={onRetry}>
              <RefreshCw size={16} /> Повторить
            </button>
          </div>
        }
      />
    );

  const stage = sec < 4 ? 0 : sec < 45 ? 1 : 2;
  return (
    <SunSplash
      label={sec < 4 ? 'Подключаемся к Sunnet…' : `Сервер просыпается после сна — обычно до минуты · ${sec} с`}
      steps={[
        { label: 'Интернет', state: online ? 'done' : 'active' },
        { label: 'Будим сервер', state: stage === 0 ? 'active' : 'done' },
        { label: 'Загружаем аккаунт', state: stage < 1 ? 'wait' : 'active' },
      ]}
      footer={sec > 20 ? <div className="wake__hint">Бесплатный сервер засыпает без посетителей. Вы ничего не потеряли — всё загрузится само.</div> : null}
    />
  );
}
