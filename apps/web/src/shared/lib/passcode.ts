/**
 * Код-пароль приложения (как в Telegram): локальная блокировка интерфейса.
 * Хранится только PBKDF2-хэш (600 000 итераций, SHA-256) — сам код не сохраняется.
 * Защищает от случайного взгляда на разблокированном устройстве; данные сеанса
 * при этом остаются на сервере под защитой httpOnly-cookie.
 */
import { create } from 'zustand';

const ITERATIONS = 600_000;
const enc = new TextEncoder();
const b64 = (buf: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(buf as ArrayBuffer)));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function derive(code: string, salt: Uint8Array): Promise<string> {
  const key = await crypto.subtle.importKey('raw', enc.encode(code), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations: ITERATIONS }, key, 256);
  return b64(bits);
}

export async function hashPasscode(code: string): Promise<{ hash: string; salt: string }> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return { hash: await derive(code, salt), salt: b64(salt) };
}

export async function checkPasscode(code: string, stored: { hash: string; salt: string }): Promise<boolean> {
  const h = await derive(code, unb64(stored.salt));
  // Сравнение постоянного времени не критично локально, но не помешает
  let diff = h.length ^ stored.hash.length;
  for (let i = 0; i < Math.min(h.length, stored.hash.length); i++) diff |= h.charCodeAt(i) ^ stored.hash.charCodeAt(i);
  return diff === 0;
}

export const useLock = create<{ locked: boolean; lock: () => void; unlock: () => void }>((set) => ({
  locked: false,
  lock: () => set({ locked: true }),
  unlock: () => set({ locked: false }),
}));
