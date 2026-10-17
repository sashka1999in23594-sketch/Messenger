/**
 * Сквозное шифрование секретных чатов (Web Crypto API, без сторонних библиотек).
 *
 *  1. Каждое устройство генерирует пару ключей ECDH P-256. Приватный ключ
 *     создаётся НЕИЗВЛЕКАЕМЫМ (extractable: false) и хранится в IndexedDB —
 *     его нельзя прочитать даже из JavaScript этой страницы, только использовать.
 *  2. Публичный ключ публикуется на сервере (/keys/devices).
 *  3. Ключ чата = HKDF-SHA256(ECDH(мой приватный, публичный собеседника),
 *     salt = id чата, info = "omni-secret-chat-v1") → AES-256-GCM.
 *  4. Каждое сообщение шифруется со случайным 96-битным IV; id чата передаётся
 *     как AAD — сервер не может «переложить» шифротекст в другой чат.
 *  5. Отпечаток (safety number) — SHA-256 от обоих публичных ключей: совпадение
 *     у собеседников доказывает отсутствие подмены ключей (MITM).
 *
 * Дальнейшие шаги (см. docs/SECURITY.md): Double Ratchet (forward secrecy),
 * мультиустройства, шифрование вложений.
 */
import { api } from '../api/client';
import type { DeviceKey, EncryptedPayload } from '@omni/shared';
import { randomId } from '../lib/format';

const DB_NAME = 'omni-e2e';
const STORE = 'keys';
const IDENTITY = 'identity-v1';

interface Identity {
  deviceId: string;
  publicKey: string; // base64 SPKI
  privateKey: CryptoKey;
}

function idb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet<T>(key: string): Promise<T | undefined> {
  const db = await idb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error);
  });
}

async function idbPut(key: string, value: unknown): Promise<void> {
  const db = await idb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

const b64 = (buf: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(buf as ArrayBuffer)));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const utf8 = new TextEncoder();
const fromUtf8 = new TextDecoder();

export function isE2ESupported(): boolean {
  return typeof crypto !== 'undefined' && !!crypto.subtle && typeof indexedDB !== 'undefined';
}

let identityPromise: Promise<Identity> | null = null;

/** Ключ этого устройства (создаётся при первом вызове). */
export function getIdentity(): Promise<Identity> {
  identityPromise ??= (async () => {
    const existing = await idbGet<Identity>(IDENTITY);
    if (existing) return existing;
    const pair = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits'])) as CryptoKeyPair;
    const spki = await crypto.subtle.exportKey('spki', pair.publicKey);
    const identity: Identity = { deviceId: `web_${randomId(18)}`, publicKey: b64(spki), privateKey: pair.privateKey };
    await idbPut(IDENTITY, identity);
    return identity;
  })();
  return identityPromise;
}

/** Публикует публичный ключ устройства на сервере (идемпотентно). */
export async function registerDevice(): Promise<string | null> {
  if (!isE2ESupported()) return null;
  try {
    const id = await getIdentity();
    await api.put<DeviceKey>('/keys/devices', { deviceId: id.deviceId, publicKey: id.publicKey, algorithm: 'ECDH-P256' });
    return id.deviceId;
  } catch {
    return null;
  }
}

const chatKeys = new Map<string, Promise<CryptoKey>>();
const peerKeyCache = new Map<string, Promise<DeviceKey>>();

export function fetchDeviceKey(deviceId: string): Promise<DeviceKey> {
  let p = peerKeyCache.get(deviceId);
  if (!p) {
    p = api.get<DeviceKey>(`/keys/devices/${encodeURIComponent(deviceId)}`);
    peerKeyCache.set(deviceId, p);
    p.catch(() => peerKeyCache.delete(deviceId));
  }
  return p;
}

/** Ключ AES-GCM для секретного чата (выводится локально, не покидает устройство). */
export function chatKey(chatId: string, peerPublicKey: string): Promise<CryptoKey> {
  const cacheKey = `${chatId}:${peerPublicKey}`;
  let p = chatKeys.get(cacheKey);
  if (!p) {
    p = (async () => {
      const me = await getIdentity();
      const peer = await crypto.subtle.importKey('spki', unb64(peerPublicKey), { name: 'ECDH', namedCurve: 'P-256' }, false, []);
      const shared = await crypto.subtle.deriveBits({ name: 'ECDH', public: peer }, me.privateKey, 256);
      const hkdfKey = await crypto.subtle.importKey('raw', shared, 'HKDF', false, ['deriveKey']);
      return crypto.subtle.deriveKey(
        { name: 'HKDF', hash: 'SHA-256', salt: utf8.encode(chatId), info: utf8.encode('omni-secret-chat-v1') },
        hkdfKey,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt'],
      );
    })();
    chatKeys.set(cacheKey, p);
  }
  return p;
}

export interface SecretPlaintext {
  v: 1;
  text: string;
}

export async function encryptMessage(chatId: string, key: CryptoKey, text: string): Promise<EncryptedPayload> {
  const me = await getIdentity();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const payload: SecretPlaintext = { v: 1, text };
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: utf8.encode(chatId) }, key, utf8.encode(JSON.stringify(payload)));
  return { ciphertext: b64(ct), iv: b64(iv), senderDeviceId: me.deviceId };
}

export async function decryptMessage(chatId: string, key: CryptoKey, enc: EncryptedPayload): Promise<SecretPlaintext> {
  const pt = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: unb64(enc.iv), additionalData: utf8.encode(chatId) },
    key,
    unb64(enc.ciphertext),
  );
  const parsed = JSON.parse(fromUtf8.decode(pt)) as SecretPlaintext;
  if (parsed.v !== 1 || typeof parsed.text !== 'string') throw new Error('bad payload');
  return parsed;
}

/** Отпечаток пары ключей: 12 групп по 5 цифр + эмодзи для быстрой сверки голосом/при встрече. */
export async function fingerprint(keyA: string, keyB: string): Promise<{ digits: string[]; emoji: string[] }> {
  const [x, y] = [keyA, keyB].sort();
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', utf8.encode(`${x}|${y}`)));
  const digits: string[] = [];
  for (let i = 0; i < 12; i++) {
    const n = ((digest[i * 2]! << 8) | digest[i * 2 + 1]!) % 100000;
    digits.push(String(n).padStart(5, '0'));
  }
  const EMOJI = ['🐶', '🐱', '🦊', '🐼', '🐸', '🦁', '🐙', '🦋', '🌵', '🍀', '🍎', '🍋', '🍉', '🍇', '🚀', '⚡', '🔥', '🌈', '⭐', '🌙', '🎈', '🎸', '🎲', '🔑', '💎', '🧩', '🛸', '🐳', '🦉', '🐢', '🌻', '🍄'];
  const emoji = Array.from(digest.slice(24, 32), (b) => EMOJI[b % EMOJI.length]!);
  return { digits, emoji };
}
