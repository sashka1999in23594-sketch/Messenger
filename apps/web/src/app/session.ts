import type { Me } from '@omni/shared';
import { api, onUnauthorized } from '../shared/api/client';
import { queryClient } from '../shared/api/query';
import { registerDevice } from '../shared/crypto/e2e';
import { useSession } from '../shared/stores/session';
import { toast } from '../shared/stores/ui';
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

export async function bootstrapSession(): Promise<void> {
  try {
    const { me } = await api.get<{ me: Me | null }>('/auth/session');
    if (me) enterSession(me);
    else useSession.getState().setMe(null);
  } catch {
    // Сервер недоступен — показываем вход (там будет сообщение об ошибке)
    useSession.getState().setMe(null);
  }
}

export async function logout(): Promise<void> {
  try {
    await api.post('/auth/logout');
  } finally {
    leaveSession();
  }
}

onUnauthorized(() => {
  if (useSession.getState().status === 'authenticated') {
    leaveSession();
    toast({ text: 'Сеанс завершён. Войдите снова', kind: 'error' });
  }
});

sessionEvents.addEventListener('revoked', () => {
  leaveSession();
  toast({ text: 'Этот сеанс был завершён с другого устройства', kind: 'error' });
});
