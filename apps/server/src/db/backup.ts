/**
 * Копия базы во внешнем хранилище — для хостингов с временным диском
 * (бесплатный Render стирает файлы при каждом засыпании и деплое).
 *
 * При старте, если локальной базы нет, она скачивается из последней копии.
 * Дальше раз в BACKUP_INTERVAL_SEC проверяем, менялось ли что-нибудь
 * (SELECT total_changes()), и если да — снимаем согласованный снимок
 * (VACUUM INTO не блокирует запись надолго), сжимаем и отправляем.
 * Последний снимок уходит при остановке сервиса. Дополнительно хранятся
 * 7 дневных копий (по дню недели) — на случай, если нужно откатиться.
 * Раз в час удаляются прежние версии копий: B2 хранит каждую перезапись.
 */
import { createReadStream, createWriteStream, existsSync } from 'node:fs';
import { mkdir, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { pipeline } from 'node:stream/promises';
import { createGzip, createGunzip } from 'node:zlib';
import type { S3Storage } from '../lib/s3.js';
import type { Db } from './index.js';

export const DB_KEY = 'db/latest.db.gz';
const dailyKey = (d: Date) => `db/day-${d.getUTCDay()}.db.gz`;
const PRUNE_EVERY_MS = 3600_000;

type Logger = Pick<Console, 'info' | 'warn' | 'error'>;
export type RestoreResult = { from: 'local' } | { from: 'empty' } | { from: 'backup'; bytes: number; ms: number };

/**
 * Восстанавливает базу из хранилища, если локального файла нет.
 * Любая ошибка, кроме «копии ещё нет», останавливает запуск: иначе сервис
 * стартовал бы с пустой базой и следующей копией затёр бы настоящие данные.
 */
export async function restoreDb(s3: S3Storage, dbFile: string): Promise<RestoreResult> {
  if (existsSync(dbFile)) return { from: 'local' };
  const started = Date.now();
  await mkdir(path.dirname(dbFile), { recursive: true });
  const gz = `${dbFile}.restore.gz`;
  const tmp = `${dbFile}.restore`;
  try {
    if (!(await s3.download(DB_KEY, gz))) return { from: 'empty' };
    await pipeline(createReadStream(gz), createGunzip(), createWriteStream(tmp, { mode: 0o600 }));
    const check = new DatabaseSync(tmp);
    const ok = (check.prepare('PRAGMA quick_check').get() as { quick_check: string }).quick_check;
    check.close();
    if (ok !== 'ok') throw new Error(`копия базы повреждена (${ok}) — восстановите дневную копию db/day-N.db.gz под именем ${DB_KEY}`);
    const bytes = (await stat(tmp)).size;
    await rename(tmp, dbFile);
    return { from: 'backup', bytes, ms: Date.now() - started };
  } finally {
    await rm(gz, { force: true });
    await rm(tmp, { force: true });
    await rm(`${tmp}-wal`, { force: true });
    await rm(`${tmp}-shm`, { force: true });
  }
}

export class DbBackup {
  /** Счётчик изменений на момент последней отправленной копии (-1 — копии ещё нет) */
  private sent: number;
  private running: Promise<void> | null = null;
  private timer: NodeJS.Timeout | null = null;
  private lastDaily = '';
  /** null — хранилище не поддерживает версии (R2 и др.), чистить нечего */
  private prunedAt: number | null = 0;
  lastAt: number | null = null;

  constructor(
    private readonly db: Db,
    private readonly s3: S3Storage,
    private readonly workDir: string,
    private readonly log: Logger,
    /** true — в хранилище уже лежит ровно эта база (только что восстановили) */
    inSync: boolean,
  ) {
    this.sent = inSync ? this.changes() : -1;
  }

  private changes(): number {
    return Number(this.db.value('SELECT total_changes()'));
  }

  start(intervalMs: number): void {
    this.timer = setInterval(() => void this.run().catch(() => undefined), intervalMs);
    this.timer.unref();
    void this.run().catch(() => undefined);
  }

  /** Отправляет копию, если с прошлого раза база менялась. true — копия отправлена. */
  async run(): Promise<boolean> {
    while (this.running) await this.running.catch(() => undefined);
    const n = this.changes();
    if (n === this.sent) return false;
    this.running = this.snapshot(n)
      .catch((err: unknown) => {
        this.log.error({ err: String(err) }, 'Не удалось сохранить копию базы — повторим позже');
        throw err;
      })
      .finally(() => {
        this.running = null;
      });
    await this.running;
    return true;
  }

  private async snapshot(n: number): Promise<void> {
    await mkdir(this.workDir, { recursive: true });
    const raw = path.join(this.workDir, 'snapshot.db');
    const gz = `${raw}.gz`;
    await rm(raw, { force: true });
    // Согласованный снимок с учётом WAL; между подсчётом изменений и снимком
    // код синхронный, поэтому снимок содержит ровно n изменений
    this.db.run('VACUUM INTO :file', { file: raw });
    try {
      await pipeline(createReadStream(raw), createGzip({ level: 6 }), createWriteStream(gz));
      await this.s3.put(DB_KEY, { file: gz }, 'application/gzip');
      const now = new Date();
      const day = now.toISOString().slice(0, 10);
      if (day !== this.lastDaily) {
        await this.s3.put(dailyKey(now), { file: gz }, 'application/gzip');
        this.lastDaily = day;
      }
      if (this.lastAt === null) this.log.info({ bytes: (await stat(gz)).size }, 'Копия базы сохранена в хранилище');
      this.sent = n;
      this.lastAt = Date.now();
      if (this.prunedAt !== null && this.lastAt - this.prunedAt > PRUNE_EVERY_MS) {
        this.prunedAt = this.lastAt;
        await this.s3.deleteOldVersions('db/').catch((err: unknown) => {
          this.prunedAt = null;
          this.log.info({ err: String(err) }, 'Хранилище без версий файлов — чистка старых копий не нужна');
        });
      }
    } finally {
      await rm(raw, { force: true });
      await rm(gz, { force: true });
    }
  }

  /** Остановка: последняя копия, если есть несохранённые изменения. */
  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.run().catch(() => undefined);
  }
}
