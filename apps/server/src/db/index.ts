/**
 * Тонкая обёртка над встроенным node:sqlite. Весь SQL — параметризованный
 * (никакой конкатенации пользовательских данных → нет SQL-инъекций).
 * Слой изолирован: переход на PostgreSQL затронет только этот файл и SQL в репозиториях.
 */
import { DatabaseSync, type StatementSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

export type SqlValue = string | number | bigint | null | Uint8Array;
export type SqlParams = Record<string, unknown> | unknown[];
export type Row = Record<string, unknown>;

function normalize(value: unknown): SqlValue {
  if (value === undefined || value === null) return null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'object' && !(value instanceof Uint8Array)) return JSON.stringify(value);
  return value as SqlValue;
}

const PARAM_RE = /[:@$]([A-Za-z_][A-Za-z0-9_]*)/g;

/** Передаём в SQLite только параметры, которые реально есть в запросе (лишние ключи — норма для DTO-объектов). */
function bind(params: SqlParams | undefined, names: Set<string>): SqlValue[] | [Record<string, SqlValue>] {
  if (params === undefined) return [];
  if (Array.isArray(params)) return params.map(normalize);
  const out: Record<string, SqlValue> = {};
  for (const name of names) {
    if (!(name in params)) throw new Error(`Missing SQL parameter :${name}`);
    out[name] = normalize((params as Record<string, unknown>)[name]);
  }
  return [out];
}

export class Db {
  readonly raw: DatabaseSync;
  private readonly cache = new Map<string, { stmt: StatementSync; names: Set<string> }>();
  private depth = 0;

  constructor(file: string) {
    if (file !== ':memory:') mkdirSync(path.dirname(file), { recursive: true });
    this.raw = new DatabaseSync(file);
    this.raw.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      PRAGMA foreign_keys = ON;
      PRAGMA busy_timeout = 5000;
      PRAGMA temp_store = MEMORY;
      PRAGMA secure_delete = ON;
    `);
  }

  private prepare(sql: string, params?: SqlParams): [StatementSync, SqlValue[]] {
    let entry = this.cache.get(sql);
    if (!entry) {
      // Имена параметров извлекаем без строковых литералов ('...'), чтобы не спутать с текстом
      const names = new Set([...sql.replace(/'(?:[^']|'')*'/g, "''").matchAll(PARAM_RE)].map((m) => m[1]!));
      entry = { stmt: this.raw.prepare(sql), names };
      this.cache.set(sql, entry);
    }
    return [entry.stmt, bind(params, entry.names) as SqlValue[]];
  }

  get<T = Row>(sql: string, params?: SqlParams): T | undefined {
    const [stmt, args] = this.prepare(sql, params);
    return stmt.get(...args) as T | undefined;
  }

  all<T = Row>(sql: string, params?: SqlParams): T[] {
    const [stmt, args] = this.prepare(sql, params);
    return stmt.all(...args) as T[];
  }

  run(sql: string, params?: SqlParams): { changes: number; lastInsertRowid: number } {
    const [stmt, args] = this.prepare(sql, params);
    const r = stmt.run(...args);
    return { changes: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid) };
  }

  /** Скаляр: первая колонка первой строки. */
  value<T = unknown>(sql: string, params?: SqlParams): T | undefined {
    const row = this.get<Row>(sql, params);
    return row ? (Object.values(row)[0] as T) : undefined;
  }

  exec(sql: string): void {
    this.raw.exec(sql);
  }

  /** Транзакция; вложенные вызовы используют SAVEPOINT. Функция обязана быть синхронной. */
  tx<T>(fn: () => T): T {
    const sp = `sp_${this.depth}`;
    this.raw.exec(this.depth === 0 ? 'BEGIN IMMEDIATE' : `SAVEPOINT ${sp}`);
    this.depth++;
    try {
      const result = fn();
      if (result instanceof Promise) throw new Error('db.tx() callback must be synchronous');
      this.depth--;
      this.raw.exec(this.depth === 0 ? 'COMMIT' : `RELEASE ${sp}`);
      return result;
    } catch (err) {
      this.depth--;
      this.raw.exec(this.depth === 0 ? 'ROLLBACK' : `ROLLBACK TO ${sp}; RELEASE ${sp}`);
      throw err;
    }
  }

  /** Плейсхолдеры для IN (...): возвращает строку ":p0, :p1" и объект параметров. */
  static inList(values: readonly unknown[], prefix = 'p'): { sql: string; params: Record<string, unknown> } {
    const params: Record<string, unknown> = {};
    const names = values.map((v, i) => {
      params[`${prefix}${i}`] = v;
      return `:${prefix}${i}`;
    });
    return { sql: names.length ? names.join(', ') : 'NULL', params };
  }

  close(): void {
    this.cache.clear();
    this.raw.close();
  }
}

export const bool = (v: unknown): boolean => v === 1 || v === true;
export const iso = (ms: unknown): string => new Date(Number(ms)).toISOString();
export const isoOrNull = (ms: unknown): string | null => (ms === null || ms === undefined ? null : iso(ms));
export function json<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string' || !value) return fallback;
  try {
    return { ...fallback, ...(JSON.parse(value) as object) } as T;
  } catch {
    return fallback;
  }
}
