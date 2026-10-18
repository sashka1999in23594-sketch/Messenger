/**
 * Хранилище медиафайлов. Файлы лежат на диске под случайными именами,
 * тип определяется по содержимому, ссылки подписаны HMAC и истекают —
 * это позволяет позже вынести раздачу на CDN/S3 без изменения клиента.
 *
 * Если подключено внешнее хранилище (S3_*), каждый файл после загрузки
 * копируется туда, а после перезапуска на чистом диске скачивается обратно
 * при первом обращении — диск сервера работает как кэш.
 */
import { createHash } from 'node:crypto';
import { createWriteStream, existsSync } from 'node:fs';
import { mkdir, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import { ErrorCode, type MediaItem, type MediaKind } from '@omni/shared';
import type { Config } from '../../config.js';
import type { Db } from '../../db/index.js';
import { AppError, badRequest, forbidden } from '../../lib/errors.js';
import { deriveKey, hmac, safeEqual } from '../../lib/crypto.js';
import { newId } from '../../lib/ids.js';
import type { S3Storage } from '../../lib/s3.js';
import { imageSize, sniff, type Sniffed } from './sniff.js';

export interface MediaRow {
  id: string;
  owner_id: string;
  kind: MediaKind;
  mime: string;
  size: number;
  width: number | null;
  height: number | null;
  duration_sec: number | null;
  poster_media_id: string | null;
  storage_key: string;
  original_name: string | null;
  sha256: string;
  created_at: number;
  deleted_at: number | null;
  waveform: string | null;
  remote_at: number | null;
}

type Logger = Pick<Console, 'info' | 'warn' | 'error'>;

/** Волна голосового: base64url из байтов 0–255 (до 100 значений). */
function decodeWaveform(v: string | null): number[] | null {
  if (!v) return null;
  try {
    return [...Buffer.from(v, 'base64url')].slice(0, 100);
  } catch {
    return null;
  }
}

/** Ссылки живут 24–30 часов и стабильны в пределах 6-часового окна (кэшируются браузером). */
const URL_BUCKET_SEC = 6 * 3600;
const URL_TTL_SEC = 24 * 3600;
const HEAD_BYTES = 256 * 1024;

export class MediaService {
  private readonly signKey: Buffer;
  logger: Logger = console;
  /** Файлы, которые прямо сейчас отправляются в хранилище или скачиваются из него */
  private readonly uploading = new Map<string, Promise<unknown>>();
  private readonly downloading = new Map<string, Promise<boolean>>();

  constructor(
    private readonly db: Db,
    private readonly config: Config,
    private readonly remote: S3Storage | null = null,
  ) {
    this.signKey = deriveKey(config.secret, 'media-url');
  }

  url(id: string | null | undefined): string | null {
    if (!id) return null;
    const now = Math.floor(Date.now() / 1000);
    const exp = Math.ceil((now + URL_TTL_SEC) / URL_BUCKET_SEC) * URL_BUCKET_SEC;
    return `/api/v1/media/${id}?e=${exp}&s=${this.sign(id, exp)}`;
  }

  private sign(id: string, exp: number): string {
    return hmac(this.signKey, `${id}.${exp}`).slice(0, 32);
  }

  verify(id: string, exp: string | undefined, sig: string | undefined): boolean {
    const e = Number(exp);
    if (!sig || !Number.isInteger(e) || e < Date.now() / 1000) return false;
    return safeEqual(this.sign(id, e), sig);
  }

  get(id: string): MediaRow | undefined {
    return this.db.get<MediaRow>('SELECT * FROM media WHERE id = :id AND deleted_at IS NULL', { id });
  }

  filePath(row: MediaRow): string {
    return path.join(this.config.uploadsDir, row.storage_key);
  }

  /**
   * Гарантирует, что файл есть на диске: после перезапуска на чистом диске
   * скачивает его из хранилища (один раз, даже при параллельных запросах).
   */
  async ensureLocal(row: MediaRow): Promise<boolean> {
    const file = this.filePath(row);
    if (existsSync(file)) return true;
    if (!this.remote) return false;
    let job = this.downloading.get(row.id);
    if (!job) {
      job = mkdir(path.dirname(file), { recursive: true })
        .then(() => this.remote!.download(`media/${row.storage_key}`, file))
        .finally(() => this.downloading.delete(row.id));
      this.downloading.set(row.id, job);
    }
    return job;
  }

  /** Отправляет файл в хранилище в фоне; при сбое его подберёт syncPending(). */
  private mirror(row: MediaRow): void {
    if (!this.remote || this.uploading.has(row.id)) return;
    const job = this.remote
      .put(`media/${row.storage_key}`, { file: this.filePath(row), sha256: row.sha256 }, row.mime)
      .then(() => this.db.run('UPDATE media SET remote_at = :now WHERE id = :id', { id: row.id, now: Date.now() }))
      .catch((err: unknown) => this.logger.warn({ media: row.id, err: String(err) }, 'Файл не отправлен в хранилище — повторим позже'))
      .finally(() => this.uploading.delete(row.id));
    this.uploading.set(row.id, job);
  }

  /** Остановка сервиса: дожидаемся файлов, которые отправляются прямо сейчас. */
  async flush(): Promise<void> {
    await Promise.allSettled([...this.uploading.values()]);
  }

  /**
   * Фоновая задача: досылает файлы, которые не удалось отправить сразу
   * (или все старые файлы — при первом подключении хранилища).
   */
  async syncPending(limit = 20): Promise<number> {
    if (!this.remote) return 0;
    const rows = this.db.all<MediaRow>('SELECT * FROM media WHERE remote_at IS NULL ORDER BY created_at LIMIT :limit', { limit });
    let done = 0;
    for (const row of rows) {
      if (this.uploading.has(row.id)) continue;
      if (existsSync(this.filePath(row))) {
        const job = this.remote.put(`media/${row.storage_key}`, { file: this.filePath(row), sha256: row.sha256 }, row.mime);
        this.uploading.set(row.id, job);
        try {
          await job;
        } finally {
          this.uploading.delete(row.id);
        }
        this.db.run('UPDATE media SET remote_at = :now WHERE id = :id', { id: row.id, now: Date.now() });
      } else {
        // Файла нет на диске: обычно он уже в хранилище, а отметка не попала в копию базы
        const there = await this.remote.exists(`media/${row.storage_key}`);
        this.db.run('UPDATE media SET remote_at = :at WHERE id = :id', { id: row.id, at: there ? Date.now() : 0 });
      }
      done++;
    }
    return done;
  }

  toItem(row: MediaRow): MediaItem {
    return {
      id: row.id,
      kind: row.kind,
      url: this.url(row.id)!,
      mime: row.mime,
      size: row.size,
      width: row.width,
      height: row.height,
      durationSec: row.duration_sec,
      posterUrl: this.url(row.poster_media_id),
      name: row.original_name,
      waveform: decodeWaveform(row.waveform),
    };
  }

  items(ids: readonly string[]): Map<string, MediaItem> {
    const out = new Map<string, MediaItem>();
    if (ids.length === 0) return out;
    const unique = [...new Set(ids)];
    const placeholders = unique.map((_, i) => `:m${i}`).join(',');
    const params = Object.fromEntries(unique.map((v, i) => [`m${i}`, v]));
    for (const row of this.db.all<MediaRow>(
      `SELECT * FROM media WHERE id IN (${placeholders}) AND deleted_at IS NULL`,
      params,
    )) {
      out.set(row.id, this.toItem(row));
    }
    return out;
  }

  /** Проверяет, что все файлы принадлежат пользователю (нельзя прикрепить чужой файл). */
  assertOwned(userId: string, ids: readonly string[], kinds?: readonly MediaKind[]): MediaRow[] {
    const rows: MediaRow[] = [];
    for (const id of ids) {
      const row = this.get(id);
      if (!row || row.owner_id !== userId) throw forbidden('Файл не найден или принадлежит другому пользователю');
      if (kinds && !kinds.includes(row.kind)) throw badRequest('Неподходящий тип файла');
      rows.push(row);
    }
    return rows;
  }

  /** Сохраняет загрузку: потоково, с подсчётом SHA-256 и лимитом размера по типу. */
  async store(
    ownerId: string,
    stream: Readable,
    opts: { originalName?: string; width?: number; height?: number; durationSec?: number; posterId?: string; asAudio?: boolean; waveform?: string },
  ): Promise<MediaItem> {
    const id = newId();
    const tmpDir = path.join(this.config.uploadsDir, 'tmp');
    await mkdir(tmpDir, { recursive: true });
    const tmpPath = path.join(tmpDir, id);

    const hash = createHash('sha256');
    const headChunks: Buffer[] = [];
    let headLen = 0;
    let size = 0;
    let sniffed: Sniffed | null = null;
    const limits = this.config.limits;
    const maxFor = (k: MediaKind) =>
      k === 'image' ? limits.imageBytes : k === 'video' || k === 'audio' ? limits.videoBytes : limits.fileBytes;

    const guard = new Transform({
      transform(chunk: Buffer, _enc, cb) {
        size += chunk.length;
        hash.update(chunk);
        if (headLen < HEAD_BYTES) {
          headChunks.push(chunk);
          headLen += chunk.length;
        }
        if (!sniffed && headLen >= 16) {
          sniffed = sniff(Buffer.concat(headChunks));
          if (!sniffed) return cb(new AppError(415, ErrorCode.UnsupportedMedia));
        }
        if (sniffed && size > maxFor(sniffed.kind)) return cb(new AppError(413, ErrorCode.PayloadTooLarge));
        cb(null, chunk);
      },
    });

    try {
      await pipeline(stream, guard, createWriteStream(tmpPath, { mode: 0o600 }));
    } catch (err) {
      await rm(tmpPath, { force: true });
      throw err;
    }
    if ((stream as Readable & { truncated?: boolean }).truncated) {
      await rm(tmpPath, { force: true });
      throw new AppError(413, ErrorCode.PayloadTooLarge);
    }
    const head = Buffer.concat(headChunks);
    sniffed ??= sniff(head);
    if (!sniffed || size === 0) {
      await rm(tmpPath, { force: true });
      throw new AppError(415, ErrorCode.UnsupportedMedia);
    }
    let detected: Sniffed = sniffed;
    // Голосовые из браузера пишутся в контейнер WebM/MP4 без видео — по подсказке клиента считаем их аудио
    if (opts.asAudio && detected.mime === 'video/webm') detected = { mime: 'audio/webm', kind: 'audio', ext: 'webm' };
    if (opts.asAudio && detected.mime === 'video/mp4') detected = { mime: 'audio/mp4', kind: 'audio', ext: 'm4a' };
    const waveform = detected.kind === 'audio' && opts.waveform && /^[A-Za-z0-9_-]{1,140}$/.test(opts.waveform) ? opts.waveform : null;

    const dims = detected.kind === 'image' ? imageSize(head, detected.mime) : null;
    const now = new Date();
    const storageKey = path.posix.join(
      String(now.getUTCFullYear()),
      String(now.getUTCMonth() + 1).padStart(2, '0'),
      `${id}.${detected.ext}`,
    );
    const finalPath = path.join(this.config.uploadsDir, storageKey);
    await mkdir(path.dirname(finalPath), { recursive: true });
    await rename(tmpPath, finalPath);

    let posterId: string | null = null;
    if (opts.posterId) {
      const poster = this.get(opts.posterId);
      if (poster && poster.owner_id === ownerId && poster.kind === 'image') posterId = poster.id;
    }
    const clampDim = (v: number | undefined) => (v && v > 0 && v < 20000 ? Math.round(v) : null);
    const name = opts.originalName?.replace(/[\\/\u0000-\u001f]/g, '_').slice(0, 200) || null;

    this.db.run(
      `INSERT INTO media (id, owner_id, kind, mime, size, width, height, duration_sec, poster_media_id, storage_key, original_name, sha256, waveform, created_at)
       VALUES (:id, :owner, :kind, :mime, :size, :w, :h, :dur, :poster, :key, :name, :sha, :wave, :now)`,
      {
        id,
        owner: ownerId,
        kind: detected.kind,
        mime: detected.mime,
        size,
        w: dims?.width ?? clampDim(opts.width),
        h: dims?.height ?? clampDim(opts.height),
        dur: opts.durationSec && opts.durationSec > 0 && opts.durationSec < 86400 ? opts.durationSec : null,
        poster: posterId,
        key: storageKey,
        name: detected.kind === 'file' || (detected.kind === 'audio' && !opts.asAudio) ? name : null,
        sha: hash.digest('hex'),
        wave: waveform,
        now: now.getTime(),
      },
    );
    const row = this.get(id)!;
    this.mirror(row);
    return this.toItem(row);
  }
}
