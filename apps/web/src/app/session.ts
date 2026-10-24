import type { Me } from '@omni/shared';
import { api, ApiError, onUnauthorized } from '../shared/api/client';
import { queryClient } from '../shared/api/query';
import { registerDevice } from '../shared/crypto/e2e';
import { useSession } from '../shared/stores/session';
import { toast } from '../shared/stores/ui';
import { confirm } from '../shared/ui/Modal';
import { sessionEvents, startRealtime, stopRealtime } from './realtime';

/** Вызывается после успешного входа/регистрации и при старте с живым сеансом. */
export function enterSession(me: Me): void {
  useSession.getState().setMe(me);
  startRealtime();
  // Публикуем ключ шифрования устройства (для секретных чатов)
  void registerDevice();
}

export function leaveSession(): void {
  stopRealtime();
  queryClient.clear();
  useSession.getState().setMe(null);
}

/** Сервер недоступен или ещё просыпается (сеть/5xx/таймаут), а не «не авторизован». */
function serverUnreachable(e: unknown): boolean {
  const s = e instanceof ApiError ? e.status : 0;
  return s === 0 || s === 408 || s >= 500;
}

/**
 * Старт: пока бесплатный сервер просыпается, показываем экран загрузки и ждём,
 * а не выкидываем на вход. Как только сервер ответил — входим или показываем вход.
 */
export async function bootstrapSession(): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      const { me } = await api.get<{ me: Me | null }>('/auth/session');
      if (me) enterSession(me);
      else useSession.getState().setMe(null);
      return;
    } catch (e) {
      if (!serverUnreachable(e)) {
        // Понятная ошибка (не «сервер спит») — показываем вход
        useSession.getState().setMe(null);
        return;
      }
      // Сервер просыпается — держим экран загрузки и пробуем снова (с нарастающей паузой)
      useSession.getState().setWaking(true);
      await new Promise((r) => setTimeout(r, Math.min(1500 + attempt * 500, 4000)));
    }
  }
}

export async function logout(): Promise<void> {
  try {
    await api.post('/auth/logout');
  } finally {
    leaveSession();
  }
}

/** Выход по кнопке «Выйти»: сначала спрашиваем, чтобы не выйти случайным нажатием. */
export async function confirmLogout(): Promise<void> {
  const ok = await confirm({
    title: 'Выйти из аккаунта?',
    text: 'Чтобы войти снова, понадобятся код из письма или чата Sunnet и пароль.',
    confirmLabel: 'Выйти',
    danger: true,
  });
  if (ok) await logout();
}

// Один 401 ещё не значит «выйти»: сервер мог перезапуститься или проснуться.
// Прежде чем выходить, переспрашиваем — и выходим только если сеанс правда недействителен.
let verifying = false;
onUnauthorized(() => {
  if (useSession.getState().status !== 'authenticated' || verifying) return;
  verifying = true;
  void api
    .get<{ me: Me | null }>('/auth/session')
    .then(({ me }) => {
      if (me) return; // сеанс жив — ложная тревога (например, после пробуждения сервера)
      leaveSession();
      toast({ text: 'Сеанс завершён. Войдите снова', kind: 'error' });
    })
    .catch(() => {
      // Сервер недоступен — не выходим, просто сообщаем
      toast({ text: 'Сервер недоступен — переподключаемся…', kind: 'error' });
    })
    .finally(() => {
      verifying = false;
    });
});

sessionEvents.addEventListener('revoked', () => {
  leaveSession();
  toast({ text: 'Этот сеанс был завершён с другого устройства', kind: 'error' });
});
