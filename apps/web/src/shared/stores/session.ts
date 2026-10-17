import { create } from 'zustand';
import type { Counters, Me } from '@omni/shared';

interface SessionState {
  status: 'loading' | 'guest' | 'authenticated';
  me: Me | null;
  setMe: (me: Me | null) => void;
  patchMe: (patch: Partial<Me>) => void;
  setCounters: (counters: Counters) => void;
}

export const useSession = create<SessionState>((set) => ({
  status: 'loading',
  me: null,
  setMe: (me) => set({ me, status: me ? 'authenticated' : 'guest' }),
  patchMe: (patch) => set((s) => (s.me ? { me: { ...s.me, ...patch } } : s)),
  setCounters: (counters) => set((s) => (s.me ? { me: { ...s.me, counters } } : s)),
}));

/** Текущий пользователь (внутри защищённых маршрутов всегда есть). */
export function useMe(): Me {
  const me = useSession((s) => s.me);
  if (!me) throw new Error('useMe() вызван вне авторизованной зоны');
  return me;
}
