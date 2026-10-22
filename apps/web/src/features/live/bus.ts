/** События эфиров из WebSocket: ведущему и зрителям, чатам эфиров и премьер. */
import type { LiveChatMessage, LiveStream, ServerEvent } from '@omni/shared';
import { queryClient } from '../../shared/api/query';

type LiveEvent = Extract<
  ServerEvent,
  { t: 'live.viewer' | 'live.signal' | 'live.updated' | 'live.chat' }
>;

const target = new EventTarget();

export function onLive(fn: (e: LiveEvent) => void): () => void {
  const h = (e: Event) => fn((e as CustomEvent<LiveEvent>).detail);
  target.addEventListener('live', h);
  return () => target.removeEventListener('live', h);
}

export const liveKey = (id: string) => ['live', id] as const;
export const roomKey = (room: string) => ['live-chat', room] as const;

/** Вызывается из общего обработчика реального времени. */
export function handleLiveEvent(e: LiveEvent): void {
  if (e.t === 'live.updated') {
    queryClient.setQueryData<{ stream: LiveStream; chat: LiveChatMessage[] }>(
      liveKey(e.stream.id),
      (old) => (old ? { ...old, stream: e.stream } : old),
    );
    void queryClient.invalidateQueries({ queryKey: ['live-list'] });
  }
  if (e.t === 'live.chat') {
    queryClient.setQueryData<LiveChatMessage[]>(roomKey(e.room), (old) =>
      old && !old.some((m) => m.id === e.message.id) ? [...old, e.message].slice(-300) : old,
    );
  }
  target.dispatchEvent(new CustomEvent('live', { detail: e }));
}
