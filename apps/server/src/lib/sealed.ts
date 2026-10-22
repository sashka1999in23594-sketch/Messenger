/**
 * Шифрование объектов во внешнем хранилище (копии базы и файлы пользователей).
 *
 * Хранилище (B2, R2, S3) видит только шифротекст: даже если утекут ключи от
 * бакета, переписку и файлы не прочитать. Ключ выводится из APP_SECRET через
 * HKDF и есть только у сервера. AES-256-GCM с новым случайным IV на каждый
 * объект; ключ объекта (его имя в бакете) входит в AAD, поэтому подменить один
 * файл другим нельзя — проверка подлинности не сойдётся.
 *
 * Формат: «SNE1» (4 байта) | IV (12) | шифротекст | тег GCM (16).
 * Объекты без заголовка — старые незашифрованные — читаются как есть.
 */
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { open, rm, stat } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';

const MAGIC = Buffer.from('SNE1');
const IV_LEN = 12;
const TAG_LEN = 16;
const HEADER_LEN = MAGIC.length + IV_LEN;

/** Ключ шифрования хранилища из секрета приложения (32 байта). */
export function storageKey(appSecret: string): Buffer {
  return Buffer.from(hkdfSync('sha256', appSecret, 'sunnet-storage', 'objects-v1', 32));
}

/** Зашифровать буфер целиком. */
export function sealBuffer(key: Buffer, aad: string, data: Buffer): Buffer {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv('aes-256-gcm', key, iv).setAAD(Buffer.from(aad));
  return Buffer.concat([MAGIC, iv, cipher.update(data), cipher.final(), cipher.getAuthTag()]);
}

/** Зашифровать файл потоком в новый файл (большие видео не занимают память). */
export async function sealFile(key: Buffer, aad: string, src: string, dest: string): Promise<void> {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv('aes-256-gcm', key, iv).setAAD(Buffer.from(aad));
  const out = createWriteStream(dest, { mode: 0o600 });
  out.write(Buffer.concat([MAGIC, iv]));
  try {
    await pipeline(createReadStream(src), cipher, out, { end: false });
    await new Promise<void>((resolve, reject) => out.end(cipher.getAuthTag(), (err?: Error | null) => (err ? reject(err) : resolve())));
  } catch (err) {
    out.destroy();
    await rm(dest, { force: true });
    throw err;
  }
}

/** Начинается ли файл с заголовка зашифрованного объекта. */
export async function isSealedFile(file: string): Promise<boolean> {
  const fh = await open(file, 'r');
  try {
    const head = Buffer.alloc(MAGIC.length);
    const { bytesRead } = await fh.read(head, 0, MAGIC.length, 0);
    return bytesRead === MAGIC.length && head.equals(MAGIC);
  } finally {
    await fh.close();
  }
}

/**
 * Расшифровать файл потоком. Неверный ключ, чужой объект или повреждённые
 * данные — ошибка (тег GCM не сходится), частично записанный результат удаляется.
 */
export async function openFile(key: Buffer, aad: string, src: string, dest: string): Promise<void> {
  const size = (await stat(src)).size;
  if (size < HEADER_LEN + TAG_LEN) throw new Error('зашифрованный объект повреждён: слишком короткий');
  const fh = await open(src, 'r');
  const iv = Buffer.alloc(IV_LEN);
  const tag = Buffer.alloc(TAG_LEN);
  try {
    await fh.read(iv, 0, IV_LEN, MAGIC.length);
    await fh.read(tag, 0, TAG_LEN, size - TAG_LEN);
  } finally {
    await fh.close();
  }
  const decipher = createDecipheriv('aes-256-gcm', key, iv).setAAD(Buffer.from(aad)).setAuthTag(tag);
  try {
    // Пустой диапазон (пустой файл) createReadStream не любит — шифротекст длиной 0 тоже бывает
    const body = size - HEADER_LEN - TAG_LEN > 0 ? createReadStream(src, { start: HEADER_LEN, end: size - TAG_LEN - 1 }) : (async function* () {})();
    await pipeline(body, decipher, createWriteStream(dest, { mode: 0o600 }));
  } catch (err) {
    await rm(dest, { force: true });
    throw new Error(`не удалось расшифровать объект «${aad}»: неверный ключ (сменился APP_SECRET?) или данные повреждены — ${String(err)}`);
  }
}
