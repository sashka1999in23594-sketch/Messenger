/**
 * Все загрузки файлов в одном месте: любой вызов uploadFile попадает сюда,
 * а оверлей UploadFx показывает анимацию «файл → дуга → облако» с процентами.
 */
import { create } from 'zustand';

export interface UploadJob {
  id: number;
  name: string;
  /** 0…1 */
  progress: number;
  state: 'up' | 'done' | 'error';
}

interface UploadsState {
  jobs: UploadJob[];
  start: (name: string) => number;
  progress: (id: number, p: number) => void;
  finish: (id: number, ok: boolean) => void;
}

let seq = 0;

export const useUploads = create<UploadsState>((set) => ({
  jobs: [],
  start: (name) => {
    const id = ++seq;
    set((s) => ({ jobs: [...s.jobs, { id, name, progress: 0, state: 'up' }] }));
    return id;
  },
  progress: (id, p) => set((s) => ({ jobs: s.jobs.map((j) => (j.id === id ? { ...j, progress: Math.max(j.progress, Math.min(1, p)) } : j)) })),
  finish: (id, ok) => {
    set((s) => ({ jobs: s.jobs.map((j) => (j.id === id ? { ...j, progress: ok ? 1 : j.progress, state: ok ? 'done' : 'error' } : j)) }));
    // Готовая карточка ещё немного видна — чтобы успела «упасть» в облако
    setTimeout(() => set((s) => ({ jobs: s.jobs.filter((j) => j.id !== id) })), ok ? 1600 : 3200);
  },
}));
