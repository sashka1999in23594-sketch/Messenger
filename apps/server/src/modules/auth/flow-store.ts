/**
 * Хранилище пошаговых попыток входа и регистрации. Клиент получает случайный
 * токен, в базе — только его SHA-256; коды хранятся как HMAC, привязанный к
 * попытке и назначению. Здесь же — журнал отправленных кодов для лимитов.
 */
import { randomInt } from 'node:crypto';
import { ErrorCode } from '@omni/shared';
import type { Db } from '../../db/index.js';
import type { RequestMeta } from '../../http/types.js';
import { AppError } from '../../lib/errors.js';
import { deriveKey, hmac, randomToken, safeEqual, sha256 } from '../../lib/crypto.js';
import { newId } from '../../lib/ids.js';

/** Попытка живёт 30 минут: за это время нужно пройти все шаги */
const FLOW_TTL_MS = 30 * 60_000;
/** Код действует 10 минут и допускает 5 ошибок */
export const CODE_TTL_MS = 10 * 60_000;
const CODE_ATTEMPTS = 5;
/** Повторная отправка — не раньше чем через 30 секунд */
export const RESEND_AFTER_MS = 30_000;

export interface FlowRow {
  id: string;
  kind: 'login' | 'signup';
  user_id: string | null;
  email: string | null;
  step: string;
  device_name: string;
  user_agent: string;
  ip: string;
  code_hash: string | null;
  code_expires_at: number | null;
  code_attempts: number;
  account_code_hash: string | null;
  sent_at: number | null;
  resent: number;
  expires_at: number;
  created_at: number;
}

export type CodeCheck = 'ok' | 'wrong' | 'expired';

export class FlowStore {
  private readonly key: Buffer;

  constructor(
    private readonly db: Db,
    appSecret: string,
  ) {
    this.key = deriveKey(appSecret, 'auth-flow-codes');
  }

  create(kind: FlowRow['kind'], data: { userId?: string; email?: string; step: string }, meta: RequestMeta): { token: string; row: FlowRow } {
    const token = randomToken(32);
    const now = Date.now();
    this.db.run(
      `INSERT INTO auth_flows (id, kind, user_id, email, step, device_name, user_agent, ip, expires_at, created_at)
       VALUES (:id, :kind, :u, :email, :step, :device, :ua, :ip, :exp, :now)`,
      {
        id: sha256(token),
        kind,
        u: data.userId ?? null,
        email: data.email ?? null,
        step: data.step,
        device: meta.deviceName,
        ua: meta.userAgent,
        ip: meta.ip,
        exp: now + FLOW_TTL_MS,
        now,
      },
    );
    return { token, row: this.reload(sha256(token)) };
  }

  /** Попытка по токену; устаревшая или чужого вида — «начните заново». */
  get(token: string, kind: FlowRow['kind']): FlowRow {
    const row = this.db.get<FlowRow>('SELECT * FROM auth_flows WHERE id = :id', { id: sha256(token) });
    if (!row || row.kind !== kind || row.expires_at < Date.now()) throw new AppError(410, ErrorCode.FlowExpired);
    return row;
  }

  reload(id: string): FlowRow {
    return this.db.get<FlowRow>('SELECT * FROM auth_flows WHERE id = :id', { id })!;
  }

  setStep(row: FlowRow, step: string): FlowRow {
    this.db.run(
      `UPDATE auth_flows SET step = :step, code_hash = NULL, account_code_hash = NULL, code_attempts = 0, resent = 0, sent_at = NULL
       WHERE id = :id`,
      { step, id: row.id },
    );
    return this.reload(row.id);
  }

  remove(row: FlowRow): void {
    this.db.run('DELETE FROM auth_flows WHERE id = :id', { id: row.id });
  }

  private hash(row: FlowRow, which: 'code' | 'account', code: string): string {
    return hmac(this.key, `${row.id}:${which}:${code}`);
  }

  private static newCode(): string {
    return String(randomInt(0, 1_000_000)).padStart(6, '0');
  }

  /**
   * Новый код (и, при сбросе пароля, второй — для чата SpaceUp). Прежние коды
   * этой попытки перестают действовать, счётчик ошибок обнуляется.
   */
  issue(row: FlowRow, withAccountCode = false): { code: string; accountCode: string | null } {
    const code = FlowStore.newCode();
    let accountCode = withAccountCode ? FlowStore.newCode() : null;
    // Два одинаковых кода подряд выглядели бы как ошибка — перевыпускаем
    while (accountCode && accountCode === code) accountCode = FlowStore.newCode();
    const now = Date.now();
    this.db.run(
      `UPDATE auth_flows SET code_hash = :h, account_code_hash = :ah, code_expires_at = :exp, code_attempts = 0, sent_at = :now
       WHERE id = :id`,
      {
        h: this.hash(row, 'code', code),
        ah: accountCode ? this.hash(row, 'account', accountCode) : null,
        exp: now + CODE_TTL_MS,
        now,
        id: row.id,
      },
    );
    return { code, accountCode };
  }

  markResent(row: FlowRow): void {
    this.db.run('UPDATE auth_flows SET resent = resent + 1 WHERE id = :id', { id: row.id });
  }

  /** Сравнение без побочных эффектов (ошибку засчитывает failAttempt). */
  check(row: FlowRow, which: 'code' | 'account', code: string): CodeCheck {
    const stored = which === 'code' ? row.code_hash : row.account_code_hash;
    if (!stored || !row.code_expires_at || row.code_expires_at < Date.now() || row.code_attempts >= CODE_ATTEMPTS) return 'expired';
    return safeEqual(stored, this.hash(row, which, code)) ? 'ok' : 'wrong';
  }

  /** Засчитывает неверный ввод; возвращает, сколько попыток осталось. */
  failAttempt(row: FlowRow): number {
    this.db.run('UPDATE auth_flows SET code_attempts = code_attempts + 1 WHERE id = :id', { id: row.id });
    return Math.max(0, CODE_ATTEMPTS - row.code_attempts - 1);
  }

  /** Через сколько секунд можно отправить код снова (null — повтор уже использован). */
  resendIn(row: FlowRow): number | null {
    if (row.resent >= 1) return null;
    if (!row.sent_at) return 0;
    return Math.max(0, Math.ceil((row.sent_at + RESEND_AFTER_MS - Date.now()) / 1000));
  }

  // ─── Лимиты отправки ──────────────────────────────────────────────────────

  /** Сколько кодов этого вида ушло за окно и когда освободится место. */
  sends(subject: string, kind: string, windowMs: number): { count: number; freeIn: number } {
    const since = Date.now() - windowMs;
    const rows = this.db.all<{ created_at: number }>(
      'SELECT created_at FROM code_sends WHERE subject = :s AND kind = :k AND created_at > :since ORDER BY created_at',
      { s: subject, k: kind, since },
    );
    const oldest = rows[0]?.created_at;
    return { count: rows.length, freeIn: oldest ? Math.max(1, Math.ceil((oldest + windowMs - Date.now()) / 1000)) : 0 };
  }

  recordSend(subject: string, kind: string): void {
    this.db.run('INSERT INTO code_sends (id, subject, kind, created_at) VALUES (:id, :s, :k, :now)', {
      id: newId(),
      s: subject,
      k: kind,
      now: Date.now(),
    });
  }

  /** Фоновая очистка: устаревшие попытки, журнал отправок старше суток, QR-коды. */
  cleanup(): number {
    const now = Date.now();
    return (
      this.db.run('DELETE FROM auth_flows WHERE expires_at < :now', { now }).changes +
      this.db.run('DELETE FROM code_sends WHERE created_at < :t', { t: now - 86400_000 }).changes +
      this.db.run('DELETE FROM qr_logins WHERE expires_at < :t', { t: now - 600_000 }).changes
    );
  }
}

/** «через 12 мин» / «через 40 с» — для сообщений о лимитах. */
export function waitText(seconds: number): string {
  return seconds >= 60 ? `${Math.ceil(seconds / 60)} мин` : `${seconds} с`;
}
