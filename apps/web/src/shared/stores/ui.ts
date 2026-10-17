import { useEffect } from 'react';
import { create } from 'zustand';

export interface Toast {
  id: number;
  text: string;
  kind?: 'info' | 'success' | 'error';
  action?: { label: string; onClick: () => void };
}

interface UiState {
  drawerOpen: boolean;
  navOpen: boolean;
  paletteOpen: boolean;
  immersive: boolean;
  /** Страница занимает всю ширину, дерево разделов выезжает по кнопке (мессенджер) */
  bare: boolean;
  /** Название текущей страницы для хлебных крошек (чат, публикация, профиль…) */
  crumb: string | null;
  toasts: Toast[];
  setDrawer: (v: boolean) => void;
  setNavOpen: (v: boolean) => void;
  setPalette: (v: boolean) => void;
  setImmersive: (v: boolean) => void;
  setBare: (v: boolean) => void;
  setCrumb: (v: string | null) => void;
  toast: (t: Omit<Toast, 'id'> | string) => void;
  dismiss: (id: number) => void;
}

let toastId = 0;

export const useUi = create<UiState>((set, get) => ({
  drawerOpen: false,
  navOpen: false,
  paletteOpen: false,
  immersive: false,
  bare: false,
  crumb: null,
  toasts: [],
  setDrawer: (v) => set({ drawerOpen: v }),
  setNavOpen: (v) => set({ navOpen: v }),
  setPalette: (v) => set({ paletteOpen: v }),
  setImmersive: (v) => set({ immersive: v }),
  setBare: (v) => set({ bare: v }),
  setCrumb: (v) => set({ crumb: v }),
  toast: (t) => {
    const toast: Toast = typeof t === 'string' ? { id: ++toastId, text: t } : { ...t, id: ++toastId };
    set({ toasts: [...get().toasts.slice(-2), toast] });
    setTimeout(() => get().dismiss(toast.id), toast.kind === 'error' ? 5000 : 3200);
  },
  dismiss: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
}));

export const toast = (t: Omit<Toast, 'id'> | string) => useUi.getState().toast(t);

/** Задаёт подпись текущей страницы в хлебных крошках. */
export function useCrumb(title: string | null | undefined) {
  const setCrumb = useUi((s) => s.setCrumb);
  useEffect(() => {
    setCrumb(title ?? null);
    if (title) document.title = `${title} · SpaceUp`;
    return () => setCrumb(null);
  }, [title, setCrumb]);
}
