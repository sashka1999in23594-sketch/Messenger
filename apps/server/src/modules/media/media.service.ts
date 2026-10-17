/**
 * Хранилище медиафайлов. Файлы лежат на диске под случайными именами,
 * тип определяется по содержимому, ссылки подписаны HMAC и истекают —
 * это позволяет позже вынести раздачу на CDN/S3 без изменения клиента.
 */
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
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
}

/** Ссылки живут 24–30 часов и стабильны в пределах 6-часового окна (кэшируются браузером). */
const URL_BUCKET_SEC = 6 * 3600;
const URL_TTL_SEC = 24 * 3600;
const HEAD_BYTES = 256 * 1024;

export class MediaService {
  private readonly signKey: Buffer;

  constructor(
    private readonly db: Db,
    private readonly config: Config,
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
    opts: { originalName?: string; width?: number; height?: number; durationSec?: number; posterId?: string },
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
    const detected: Sniffed = sniffed;

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
      `INSERT INTO media (id, owner_id, kind, mime, size, width, height, duration_sec, poster_media_id, storage_key, original_name, sha256, created_at)
       VALUES (:id, :owner, :kind, :mime, :size, :w, :h, :dur, :poster, :key, :name, :sha, :now)`,
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
        name: detected.kind === 'file' || detected.kind === 'audio' ? name : null,
        sha: hash.digest('hex'),
        now: now.getTime(),
      },
    );
    return this.toItem(this.get(id)!);
  }
}
