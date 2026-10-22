import { create } from 'zustand';

/** Состояние интерфейса мессенджера: панель информации о чате и поиск по переписке. */
export const useChatUi = create<{
  infoOpen: boolean;
  searchOpen: boolean;
  toggleInfo: () => void;
  setInfo: (v: boolean) => void;
  setSearch: (v: boolean) => void;
}>((set) => ({
  infoOpen: false,
  searchOpen: false,
  toggleInfo: () => set((s) => ({ infoOpen: !s.infoOpen })),
  setInfo: (v) => set({ infoOpen: v }),
  setSearch: (v) => set({ searchOpen: v }),
}));
