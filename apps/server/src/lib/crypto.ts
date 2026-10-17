/**
 * Криптографические примитивы сервера. Только встроенный node:crypto —
 * никаких самописных алгоритмов, только стандартные конструкции.
 */
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  hkdfSync,
  randomBytes,
  scrypt as scryptCb,
  timingSafeEqual,
  type ScryptOptions,
} from 'node:crypto';

function scrypt(password: string, salt: Buffer, keylen: number, opts: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scryptCb(password, salt, keylen, opts, (err, key) => (err ? reject(err) : resolve(key))),
  );
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

export function hmac(key: string | Buffer, value: string): string {
  return createHmac('sha256', key).update(value).digest('base64url');
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) {
    timingSafeEqual(ab, ab); // выравниваем время выполнения
    return false;
  }
  return timingSafeEqual(ab, bb);
}

// ─── Пароли: scrypt (memory-hard KDF) ───────────────────────────────────────

/** Параметры по рекомендациям OWASP (N=2^17 рекомендовано, 2^15 — компромисс для прототипа). */
const SCRYPT = { N: 2 ** 15, r: 8, p: 1, keylen: 64 } as const;
const SCRYPT_MAXMEM = 128 * SCRYPT.N * SCRYPT.r * 2;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password.normalize('NFKC'), salt, SCRYPT.keylen, {
    N: SCRYPT.N,
    r: SCRYPT.r,
    p: SCRYPT.p,
    maxmem: SCRYPT_MAXMEM,
  });
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64'), key.toString('base64')].join('$');
}

export async function verifyPassword(
  password: string,
  stored: string,
): Promise<{ ok: boolean; needsRehash: boolean }> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return { ok: false, needsRehash: false };
  const [, nStr, rStr, pStr, saltB64, keyB64] = parts as [string, string, string, string, string, string];
  const N = Number(nStr);
  const r = Number(rStr);
  const p = Number(pStr);
  const expected = Buffer.from(keyB64, 'base64');
  const key = await scrypt(password.normalize('NFKC'), Buffer.from(saltB64, 'base64'), expected.length, {
    N,
    r,
    p,
    maxmem: 128 * N * r * 2,
  });
  const ok = key.length === expected.length && timingSafeEqual(key, expected);
  return { ok, needsRehash: ok && (N < SCRYPT.N || r !== SCRYPT.r || p !== SCRYPT.p) };
}

/** Хэш-заглушка: проверяется, когда пользователь не найден, чтобы время ответа не выдавало существование аккаунта. */
let dummyHash: Promise<string> | null = null;
export function getDummyHash(): Promise<string> {
  dummyHash ??= hashPassword(randomToken(16));
  return dummyHash;
}

// ─── Шифрование данных «в покое» (AES-256-GCM) ──────────────────────────────

export class SecretBox {
  private readonly key: Buffer;

  constructor(appSecret: string, purpose: string) {
    this.key = Buffer.from(hkdfSync('sha256', appSecret, 'omni-secretbox', purpose, 32));
  }

  seal(plaintext: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return ['v1', iv.toString('base64url'), tag.toString('base64url'), ct.toString('base64url')].join('.');
  }

  open(sealed: string): string {
    const [v, ivB, tagB, ctB] = sealed.split('.');
    if (v !== 'v1' || !ivB || !tagB || ctB === undefined) throw new Error('Unsupported sealed format');
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(ivB, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagB, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(ctB, 'base64url')), decipher.final()]).toString('utf8');
  }
}

/** Ключ для подписей (CSRF, ссылки на медиа) — выводится из APP_SECRET, отдельный для каждой цели. */
export function deriveKey(appSecret: string, purpose: string): Buffer {
  return Buffer.from(hkdfSync('sha256', appSecret, 'omni-signing', purpose, 32));
}
