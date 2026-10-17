import { create } from 'zustand';

interface TypingEntry {
  userId: string;
  name: string;
  until: number;
}

interface RealtimeState {
  status: 'connecting' | 'online' | 'offline';
  typing: Record<string, TypingEntry[]>;
  presence: Record<string, { online: boolean; lastSeenAt: string | null }>;
  setStatus: (s: RealtimeState['status']) => void;
  addTyping: (chatId: string, userId: string, name: string) => void;
  clearTyping: (chatId: string, userId: string) => void;
  setPresence: (userId: string, online: boolean, lastSeenAt: string | null) => void;
}

export const useRealtime = create<RealtimeState>((set) => ({
  status: 'connecting',
  typing: {},
  presence: {},
  setStatus: (status) => set({ status }),
  addTyping: (chatId, userId, name) =>
    set((s) => ({
      typing: {
        ...s.typing,
        [chatId]: [...(s.typing[chatId] ?? []).filter((t) => t.userId !== userId), { userId, name, until: Date.now() + 5000 }],
      },
    })),
  clearTyping: (chatId, userId) =>
    set((s) => ({ typing: { ...s.typing, [chatId]: (s.typing[chatId] ?? []).filter((t) => t.userId !== userId) } })),
  setPresence: (userId, online, lastSeenAt) => set((s) => ({ presence: { ...s.presence, [userId]: { online, lastSeenAt } } })),
}));

// Истёкшие индикаторы «печатает…» убираем раз в секунду
setInterval(() => {
  const { typing } = useRealtime.getState();
  const now = Date.now();
  let changed = false;
  const next: typeof typing = {};
  for (const [chatId, list] of Object.entries(typing)) {
    const alive = list.filter((t) => t.until > now);
    if (alive.length !== list.length) changed = true;
    next[chatId] = alive;
  }
  if (changed) useRealtime.setState({ typing: next });
}, 1000);
