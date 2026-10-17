import { create } from 'zustand';

/** Состояние интерфейса мессенджера (панель информации о чате). */
export const useChatUi = create<{ infoOpen: boolean; toggleInfo: () => void; setInfo: (v: boolean) => void }>((set) => ({
  infoOpen: false,
  toggleInfo: () => set((s) => ({ infoOpen: !s.infoOpen })),
  setInfo: (v) => set({ infoOpen: v }),
}));
