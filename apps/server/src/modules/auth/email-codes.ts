/**
 * Одноразовые коды из писем (подтверждение почты, вход, сброс пароля,
 * подтверждение действий). В базе хранится только HMAC кода, привязанный
 * к пользователю и назначению; у кода ограничены срок жизни и число попыток,
 * а у отправки — частота (не чаще раза в минуту и 5 раз в час).
 */
import { randomInt } from 'node:crypto';
import { ErrorCode } from '@omni/shared';
import type { Db } from '../../db/index.js';
import { AppError } from '../../lib/errors.js';
import { deriveKey, hmac, safeEqual } from '../../lib/crypto.js';
import { newId } from '../../lib/ids.js';

export type EmailCodePurpose = 'verify_email' | 'login' | 'reset_password' | 'email_2fa_enable' | 'email_2fa_disable';

const TTL_MS: Record<EmailCodePurpose, number> = {
  verify_email: 15 * 60_000,
  login: 10 * 60_000,
  reset_password: 30 * 60_000,
  email_2fa_enable: 15 * 60_000,
  email_2fa_disable: 15 * 60_000,
};
const MAX_ATTEMPTS = 5;
const RESEND_AFTER_MS = 60_000;
const MAX_PER_HOUR = 5;

interface CodeRow {
  id: string;
  user_id: string;
  email: string;
  code_hash: string;
  ref: string | null;
  attempts: number;
  expires_at: number;
  created_at: number;
}

export class EmailCodes {
  private readonly key: Buffer;

  constructor(
    private readonly db: Db,
    appSecret: string,
  ) {
    this.key = deriveKey(appSecret, 'email-codes');
  }

  private hash(userId: string, purpose: EmailCodePurpose, code: string): string {
    return hmac(this.key, `${userId}:${purpose}:${code}`);
  }

  /** Проверка частоты без выпуска кода (чтобы не отправлять письмо, если лимит исчерпан). */
  assertCanSend(userId: string, purpose: EmailCodePurpose): void {
    const now = Date.now();
    const recent = this.db.all<{ created_at: number }>(
      'SELECT created_at FROM email_codes WHERE user_id = :u AND purpose = :p AND created_at > :since ORDER BY created_at DESC',
      { u: userId, p: purpose, since: now - 3600_000 },
    );
    const last = recent[0]?.created_at;
    if (last && now - last < RESEND_AFTER_MS) {
      const wait = Math.ceil((RESEND_AFTER_MS - (now - last)) / 1000);
      throw new AppError(429, ErrorCode.RateLimited, `Новый код можно запросить через ${wait} с`, undefined, wait);
    }
    if (recent.length >= MAX_PER_HOUR) {
      throw new AppError(429, ErrorCode.RateLimited, 'Слишком много писем за час. Попробуйте позже', undefined, 3600);
    }
  }

  /** Выпускает новый код (предыдущие коды того же назначения перестают действовать). */
  issue(userId: string, purpose: EmailCodePurpose, email: string, ref: string | null = null): string {
    this.assertCanSend(userId, purpose);
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const now = Date.now();
    this.db.tx(() => {
      this.db.run('UPDATE email_codes SET consumed_at = :now WHERE user_id = :u AND purpose = :p AND consumed_at IS NULL', { now, u: userId, p: purpose });
      this.db.run(
        `INSERT INTO email_codes (id, user_id, purpose, email, code_hash, ref, expires_at, created_at)
         VALUES (:id, :u, :p, :email, :h, :ref, :exp, :now)`,
        { id: newId(now), u: userId, p: purpose, email, h: this.hash(userId, purpose, code), ref, exp: now + TTL_MS[purpose], now },
      );
    });
    return code;
  }

  /**
   * Проверяет код. При успехе код погашается и возвращается адрес, на который он был отправлен.
   * Неверный код увеличивает счётчик попыток; после 5 ошибок код перестаёт действовать.
   */
  consume(userId: string, purpose: EmailCodePurpose, code: string, ref: string | null = null): string {
    const row = this.db.get<CodeRow>(
      `SELECT * FROM email_codes WHERE user_id = :u AND purpose = :p AND consumed_at IS NULL
       ORDER BY created_at DESC LIMIT 1`,
      { u: userId, p: purpose },
    );
    const valid = !!row && row.expires_at > Date.now() && row.attempts < MAX_ATTEMPTS && (ref === null || row.ref === ref);
    const matches = valid && safeEqual(row.code_hash, this.hash(userId, purpose, code));
    if (!matches) {
      if (row) this.db.run('UPDATE email_codes SET attempts = attempts + 1 WHERE id = :id', { id: row.id });
      throw new AppError(400, ErrorCode.EmailCodeInvalid, undefined, { code: 'Неверный или устаревший код' });
    }
    this.db.run('UPDATE email_codes SET consumed_at = :now WHERE id = :id', { now: Date.now(), id: row.id });
    return row.email;
  }

  /** Фоновая очистка старых кодов. */
  cleanup(): void {
    this.db.run('DELETE FROM email_codes WHERE created_at < :t', { t: Date.now() - 7 * 86400_000 });
  }
}
