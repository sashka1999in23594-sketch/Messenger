/**
 * Аутентификация: регистрация, вход (с 2FA), смена пароля, управление 2FA,
 * удаление аккаунта. Защита от перебора: лимиты по IP (в роутере) +
 * экспоненциальная блокировка аккаунта + одинаковое время ответа.
 */
import { ErrorCode, type RegisterInput } from '@omni/shared';
import type { Db } from '../../db/index.js';
import { bool } from '../../db/index.js';
import { AppError, badRequest, conflict } from '../../lib/errors.js';
import { getDummyHash, hashPassword, randomToken, SecretBox, sha256, verifyPassword } from '../../lib/crypto.js';
import { newId } from '../../lib/ids.js';
import { generateTotpSecret, otpauthUrl, verifyTotp } from '../../lib/totp.js';
import type { RequestMeta } from '../../http/types.js';
import type { NotificationService } from '../notifications/notifications.service.js';
import type { RealtimeHub } from '../realtime/hub.js';
import type { UserRow, UsersRepo } from '../users/users.repo.js';
import type { UsersService } from '../users/users.service.js';
import type { SecurityLog } from './security-log.js';
import type { SessionService } from './sessions.js';
import { APP_NAME, checkPasswordPolicy } from '@omni/shared';

const LOCK_THRESHOLD = 5;
const LOCK_MAX_MINUTES = 60;
const CHALLENGE_TTL_MS = 5 * 60_000;
const CHALLENGE_MAX_ATTEMPTS = 5;
const RECOVERY_CODES = 10;

export interface IssuedSession {
  token: string;
  sessionId: string;
  expiresAt: number;
  userId: string;
}

export class AuthService {
  private readonly totpBox: SecretBox;

  constructor(
    private readonly db: Db,
    appSecret: string,
    private readonly users: UsersRepo,
    private readonly usersService: UsersService,
    private readonly sessions: SessionService,
    private readonly log: SecurityLog,
    private readonly notifications: NotificationService,
    private readonly hub: RealtimeHub,
  ) {
    this.totpBox = new SecretBox(appSecret, 'totp-secret');
  }

  async register(input: RegisterInput, meta: RequestMeta): Promise<IssuedSession> {
    this.usersService.assertUsernameFree(input.username);
    const hash = await hashPassword(input.password);
    const now = Date.now();
    const id = newId(now);
    try {
      this.db.run(
        `INSERT INTO users (id, username, display_name, password_hash, created_at, updated_at, last_seen_at)
         VALUES (:id, :username, :name, :hash, :now, :now, :now)`,
        { id, username: input.username, name: input.displayName, hash, now },
      );
    } catch (err) {
      if (String(err).includes('UNIQUE')) throw conflict('Это имя уже занято', { username: 'Это имя уже занято' });
      throw err;
    }
    this.log.record(id, 'register', meta);
    return this.issue(id, meta);
  }

  async login(
    username: string,
    password: string,
    meta: RequestMeta,
  ): Promise<{ session: IssuedSession } | { challengeId: string }> {
    const user = this.users.byUsername(username);
    if (!user) {
      await verifyPassword(password, await getDummyHash());
      throw new AppError(401, ErrorCode.InvalidCredentials);
    }
    const now = Date.now();
    if (user.locked_until && user.locked_until > now) {
      throw new AppError(429, ErrorCode.AccountLocked, undefined, undefined, Math.ceil((user.locked_until - now) / 1000));
    }
    const { ok, needsRehash } = await verifyPassword(password, user.password_hash);
    if (!ok) {
      this.registerFailure(user, meta, 'login_failed');
      throw new AppError(401, ErrorCode.InvalidCredentials);
    }
    if (needsRehash) {
      this.db.run('UPDATE users SET password_hash = :h WHERE id = :id', { h: await hashPassword(password), id: user.id });
    }
    if (bool(user.totp_enabled)) {
      const challenge = randomToken(32);
      this.db.run(
        `INSERT INTO login_challenges (id, user_id, device_name, ip, user_agent, expires_at, created_at)
         VALUES (:id, :u, :d, :ip, :ua, :exp, :now)`,
        { id: sha256(challenge), u: user.id, d: meta.deviceName, ip: meta.ip, ua: meta.userAgent, exp: now + CHALLENGE_TTL_MS, now },
      );
      return { challengeId: challenge };
    }
    return { session: this.completeLogin(user, meta) };
  }

  loginWithSecondFactor(challengeId: string, code: string, meta: RequestMeta): IssuedSession {
    const row = this.db.get<{ id: string; user_id: string; attempts: number; expires_at: number }>(
      'SELECT * FROM login_challenges WHERE id = :id',
      { id: sha256(challengeId) },
    );
    if (!row || row.expires_at < Date.now() || row.attempts >= CHALLENGE_MAX_ATTEMPTS) {
      throw new AppError(401, ErrorCode.TwoFactorInvalid, 'Сессия входа истекла. Войдите заново');
    }
    const user = this.users.byId(row.user_id);
    if (!user) throw new AppError(401, ErrorCode.InvalidCredentials);
    if (!this.checkSecondFactor(user, code, meta)) {
      this.db.run('UPDATE login_challenges SET attempts = attempts + 1 WHERE id = :id', { id: row.id });
      this.registerFailure(user, meta, 'login_2fa_failed');
      throw new AppError(401, ErrorCode.TwoFactorInvalid);
    }
    this.db.run('DELETE FROM login_challenges WHERE id = :id', { id: row.id });
    return this.completeLogin(user, meta);
  }

  /** TOTP или одноразовый резервный код. */
  private checkSecondFactor(user: UserRow, code: string, meta: RequestMeta): boolean {
    if (/^\d{6}$/.test(code)) {
      if (!user.totp_secret_enc) return false;
      const step = verifyTotp(this.totpBox.open(user.totp_secret_enc), code, user.totp_last_step);
      if (step === null) return false;
      this.db.run('UPDATE users SET totp_last_step = :s WHERE id = :id', { s: step, id: user.id });
      return true;
    }
    const hash = sha256(code.toLowerCase());
    const r = this.db.run(
      'UPDATE recovery_codes SET used_at = :now WHERE user_id = :u AND code_hash = :h AND used_at IS NULL',
      { now: Date.now(), u: user.id, h: hash },
    );
    if (r.changes > 0) {
      this.log.record(user.id, 'recovery_code_used', meta);
      return true;
    }
    return false;
  }

  private registerFailure(user: UserRow, meta: RequestMeta, type: string): void {
    const failures = user.failed_logins + 1;
    let lockedUntil: number | null = null;
    if (failures >= LOCK_THRESHOLD) {
      const minutes = Math.min(LOCK_MAX_MINUTES, 2 ** (failures - LOCK_THRESHOLD));
      lockedUntil = Date.now() + minutes * 60_000;
      this.log.record(user.id, 'login_locked', meta, { minutes });
    }
    this.db.run('UPDATE users SET failed_logins = :f, locked_until = :l WHERE id = :id', { f: failures, l: lockedUntil, id: user.id });
    this.log.record(user.id, type, meta);
  }

  private completeLogin(user: UserRow, meta: RequestMeta): IssuedSession {
    const known = this.sessions.isKnownDevice(user.id, meta.userAgent);
    this.db.run('UPDATE users SET failed_logins = 0, locked_until = NULL WHERE id = :id', { id: user.id });
    this.log.record(user.id, 'login_success', meta, { device: meta.deviceName });
    if (!known) {
      this.notifications.notify({
        userId: user.id,
        type: 'security',
        entityType: 'session',
        link: '/settings/security/sessions',
        preview: `Новый вход: ${meta.deviceName}. Если это были не вы — завершите сеанс и смените пароль.`,
      });
    }
    return this.issue(user.id, meta);
  }

  private issue(userId: string, meta: RequestMeta): IssuedSession {
    const s = this.sessions.create(userId, meta);
    return { ...s, userId };
  }

  logout(userId: string, sessionId: string, meta: RequestMeta): void {
    this.sessions.revoke(userId, sessionId);
    this.log.record(userId, 'logout', meta);
    this.hub.kickSession(userId, sessionId);
  }

  revokeSession(userId: string, sessionId: string, meta: RequestMeta): boolean {
    const ok = this.sessions.revoke(userId, sessionId);
    if (ok) {
      this.log.record(userId, 'session_revoked', meta, { sessionId });
      this.hub.kickSession(userId, sessionId);
    }
    return ok;
  }

  revokeOtherSessions(userId: string, keepSessionId: string, meta: RequestMeta): number {
    const ids = this.sessions.revokeAllExcept(userId, keepSessionId);
    for (const id of ids) this.hub.kickSession(userId, id);
    this.log.record(userId, 'sessions_revoked_all', meta, { count: ids.length });
    return ids.length;
  }

  async assertPassword(userId: string, password: string): Promise<UserRow> {
    const user = this.users.byId(userId);
    if (!user) throw new AppError(401, ErrorCode.Unauthorized);
    const { ok } = await verifyPassword(password, user.password_hash);
    if (!ok) throw badRequest('Неверный пароль', { password: 'Неверный пароль' });
    return user;
  }

  async changePassword(userId: string, sessionId: string, current: string, next: string, meta: RequestMeta): Promise<void> {
    const user = await this.assertPassword(userId, current).catch(() => {
      throw badRequest('Неверный текущий пароль', { currentPassword: 'Неверный текущий пароль' });
    });
    const problem = checkPasswordPolicy(next, [user.username, user.display_name]);
    if (problem) throw new AppError(400, ErrorCode.WeakPassword, problem, { newPassword: problem });
    if (current === next) throw badRequest('Новый пароль совпадает со старым', { newPassword: 'Пароль не изменился' });
    this.db.run('UPDATE users SET password_hash = :h, updated_at = :now WHERE id = :id', {
      h: await hashPassword(next),
      now: Date.now(),
      id: userId,
    });
    this.log.record(userId, 'password_changed', meta);
    // Смена пароля завершает все остальные сеансы
    this.revokeOtherSessions(userId, sessionId, meta);
  }

  async changeUsername(userId: string, username: string, password: string, meta: RequestMeta): Promise<void> {
    const user = await this.assertPassword(userId, password);
    if (user.username === username) return;
    this.usersService.assertUsernameFree(username, userId);
    this.db.run('UPDATE users SET username = :u, updated_at = :now WHERE id = :id', { u: username, now: Date.now(), id: userId });
    this.log.record(userId, 'username_changed', meta, { from: user.username, to: username });
  }

  // ─── 2FA ──────────────────────────────────────────────────────────────────

  async beginTotpSetup(userId: string, password: string): Promise<{ secret: string; otpauthUrl: string }> {
    const user = await this.assertPassword(userId, password);
    if (bool(user.totp_enabled)) throw conflict('Двухфакторная защита уже включена');
    const secret = generateTotpSecret();
    this.db.run('UPDATE users SET totp_secret_enc = :s, totp_last_step = NULL WHERE id = :id', {
      s: this.totpBox.seal(secret),
      id: userId,
    });
    return { secret, otpauthUrl: otpauthUrl(secret, user.username, APP_NAME) };
  }

  confirmTotpSetup(userId: string, code: string, meta: RequestMeta): string[] {
    const user = this.users.byId(userId);
    if (!user?.totp_secret_enc) throw badRequest('Сначала начните настройку');
    if (bool(user.totp_enabled)) throw conflict('Двухфакторная защита уже включена');
    const step = verifyTotp(this.totpBox.open(user.totp_secret_enc), code, null);
    if (step === null) throw new AppError(400, ErrorCode.TwoFactorInvalid, undefined, { code: 'Неверный код' });
    const codes = this.db.tx(() => {
      this.db.run('UPDATE users SET totp_enabled = 1, totp_last_step = :s WHERE id = :id', { s: step, id: userId });
      return this.replaceRecoveryCodes(userId);
    });
    this.log.record(userId, 'twofa_enabled', meta);
    return codes;
  }

  async disableTotp(userId: string, password: string, code: string, meta: RequestMeta): Promise<void> {
    const user = await this.assertPassword(userId, password);
    if (!bool(user.totp_enabled)) return;
    if (!this.checkSecondFactor(user, code, meta)) throw new AppError(400, ErrorCode.TwoFactorInvalid, undefined, { code: 'Неверный код' });
    this.db.tx(() => {
      this.db.run('UPDATE users SET totp_enabled = 0, totp_secret_enc = NULL, totp_last_step = NULL WHERE id = :id', { id: userId });
      this.db.run('DELETE FROM recovery_codes WHERE user_id = :id', { id: userId });
    });
    this.log.record(userId, 'twofa_disabled', meta);
  }

  async regenerateRecoveryCodes(userId: string, password: string, meta: RequestMeta): Promise<string[]> {
    const user = await this.assertPassword(userId, password);
    if (!bool(user.totp_enabled)) throw badRequest('Сначала включите двухфакторную защиту');
    const codes = this.db.tx(() => this.replaceRecoveryCodes(userId));
    this.log.record(userId, 'recovery_codes_regenerated', meta);
    return codes;
  }

  recoveryCodesLeft(userId: string): number {
    return this.db.value<number>('SELECT COUNT(*) FROM recovery_codes WHERE user_id = :u AND used_at IS NULL', { u: userId }) ?? 0;
  }

  private replaceRecoveryCodes(userId: string): string[] {
    this.db.run('DELETE FROM recovery_codes WHERE user_id = :u', { u: userId });
    const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
    const codes: string[] = [];
    for (let i = 0; i < RECOVERY_CODES; i++) {
      const bytes = Buffer.from(randomToken(16), 'base64url');
      const code = Array.from(bytes.subarray(0, 10), (b) => alphabet[b % alphabet.length]).join('');
      codes.push(code);
      this.db.run('INSERT INTO recovery_codes (id, user_id, code_hash, created_at) VALUES (:id, :u, :h, :now)', {
        id: newId(),
        u: userId,
        h: sha256(code),
        now: Date.now(),
      });
    }
    return codes.map((c) => `${c.slice(0, 5)}-${c.slice(5)}`);
  }

  /** Удаление аккаунта: личные данные стираются, контент скрывается. */
  async deleteAccount(userId: string, password: string, meta: RequestMeta): Promise<void> {
    await this.assertPassword(userId, password);
    const now = Date.now();
    const tombstone = `deleted_${userId.toLowerCase()}`;
    this.db.tx(() => {
      this.db.run(
        `UPDATE users SET username = :t, display_name = 'Удалённый аккаунт', bio = '', website = NULL, location = NULL,
           avatar_media_id = NULL, banner_media_id = NULL, password_hash = '!', totp_secret_enc = NULL, totp_enabled = 0,
           searchable = 0, deleted_at = :now, updated_at = :now WHERE id = :id`,
        { t: tombstone, now, id: userId },
      );
      this.db.run('UPDATE posts SET deleted_at = :now WHERE author_id = :id AND deleted_at IS NULL', { now, id: userId });
      this.db.run('UPDATE comments SET deleted_at = :now WHERE author_id = :id AND deleted_at IS NULL', { now, id: userId });
      this.db.run('UPDATE stories SET deleted_at = :now WHERE author_id = :id', { now, id: userId });
      this.db.run('UPDATE media SET deleted_at = :now WHERE owner_id = :id', { now, id: userId });
      this.db.run('DELETE FROM follows WHERE follower_id = :id OR followee_id = :id', { id: userId });
      this.db.run('UPDATE device_keys SET revoked_at = :now WHERE user_id = :id', { now, id: userId });
      this.db.run('DELETE FROM recovery_codes WHERE user_id = :id', { id: userId });
    });
    const ids = this.sessions.revokeAllExcept(userId, null);
    for (const id of ids) this.hub.kickSession(userId, id);
    this.log.record(userId, 'account_deleted', meta);
  }
}
