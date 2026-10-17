import { randomBytes } from 'node:crypto';

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // Crockford base32

/**
 * ULID-подобный идентификатор: 48 бит времени + 80 бит случайности.
 * Сортируется по времени создания (удобно для курсорной пагинации)
 * и не угадывается перебором.
 */
export function newId(now = Date.now()): string {
  let time = '';
  let t = now;
  for (let i = 0; i < 10; i++) {
    time = ALPHABET[t % 32] + time;
    t = Math.floor(t / 32);
  }
  const bytes = randomBytes(10);
  let rand = '';
  // 80 бит → 16 символов base32
  let acc = 0n;
  for (const b of bytes) acc = (acc << 8n) | BigInt(b);
  for (let i = 0; i < 16; i++) {
    rand = ALPHABET[Number(acc & 31n)] + rand;
    acc >>= 5n;
  }
  return time + rand;
}

/** Время создания из идентификатора (мс). */
export function idTime(id: string): number {
  let t = 0;
  for (const ch of id.slice(0, 10)) t = t * 32 + ALPHABET.indexOf(ch);
  return t;
}
