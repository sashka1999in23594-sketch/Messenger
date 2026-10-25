/**
 * Пока приложение открыто — даже в фоновой вкладке — раз в несколько минут тихо
 * дёргаем /health. Бесплатный хостинг усыпляет сервер после простоя; пинг держит
 * его тёплым, чтобы переходы по разделам и возвращение к вкладке не упирались в
 * долгое пробуждение, а сеанс реже терялся из-за перезапуска уснувшего сервера.
 */
import { API_PREFIX } from '@omni/shared';

/** Бесплатный тариф усыпляет сервер после ~15 минут простоя — пингуем с запасом. */
const PING_MS = 4 * 60 * 1000;
let timer: ReturnType<typeof setInterval> | null = null;

function ping(): void {
  void fetch(`${API_PREFIX}/health`, {
    cache: 'no-store',
    credentials: 'same-origin',
    signal: AbortSignal.timeout(20_000),
  }).catch(() => undefined);
}

/** Вернулись к вкладке — сразу будим сервер, чтобы следующий запрос не ждал. */
function onVisible(): void {
  if (document.visibilityState === 'visible') ping();
}

export function startKeepAwake(): void {
  if (timer !== null) return;
  ping();
  timer = setInterval(ping, PING_MS);
  document.addEventListener('visibilitychange', onVisible);
}

export function stopKeepAwake(): void {
  if (timer !== null) {
    clearInterval(timer);
    timer = null;
  }
  document.removeEventListener('visibilitychange', onVisible);
}
