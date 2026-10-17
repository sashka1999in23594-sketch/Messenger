/**
 * Аутентификация: регистрация, вход (с 2FA: приложение или код из письма),
 * подтверждение и смена почты, восстановление пароля, управление 2FA,
 * удаление аккаунта. Защита от перебора: лимиты по IP (в роутере) +
 * экспоненциальная блокировка аккаунта + одинаковое время ответа.
 */
import { ErrorCode, type RegisterInput, type TwoFactorMethod } from '@omni/shared';
import type { Db } from '../../db/index.js';
import { bool } from '../../db/index.js';
import { AppError, badRequest, conflict } from '../../lib/errors.js';
import { getDummyHash, hashPassword, randomToken, SecretBox, sha256, verifyPassword } from '../../lib/crypto.js';
import { newId } from '../../lib/ids.js';
import { generateTotpSecret, otpauthUrl, verifyTotp } from '../../lib/totp.js';
import type { RequestMeta } from '../../http/types.js';
import type { NotificationService } from '../notifications/notifications.service.js';
import type { RealtimeHub } from '../realtime/hub.js';
import { emailPrefsOf, type UserRow, type UsersRepo } from '../users/users.repo.js';
import { maskEmail, type MailService } from '../mail/mail.service.js';
import { templates, type DeviceInfo } from '../mail/templates.js';
import type { EmailCodes } from './email-codes.js';
import type { UsersService } from '../users/users.service.js';
import type { SecurityLog } from './security-log.js';
import type { SessionService } from './sessions.js';
import { APP_NAME, checkPasswordPolicy } from '@omni/shared';

const LOCK_THRESHOLD = 5;
const LOCK_MAX_MINUTES = 60;
const CHALLENGE_TTL_MS = 5 * 60_000;
const CHALLENGE_MAX_ATTEMPTS = 5;
const RECOVERY_CODES = 10;

export interface TwoFactorChallenge {
  challengeId: string;
  methods: TwoFactorMethod[];
  emailHint: string | null;
  emailSent: boolean;
}

const deviceOf = (meta: RequestMeta): DeviceInfo => ({ device: meta.deviceName, ip: meta.ip, time: new Date() });

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
    private readonly mail: MailService,
    private readonly codes: EmailCodes,
    private readonly origin: string,
  ) {
    this.totpBox = new SecretBox(appSecret, 'totp-secret');
  }

  async register(input: RegisterInput, meta: RequestMeta, opts: { sendVerification?: boolean } = {}): Promise<IssuedSession & { emailSent: boolean }> {
    this.usersService.assertUsernameFree(input.username);
    const hash = await hashPassword(input.password);
    const now = Date.now();
    const id = newId(now);
    try {
      this.db.run(
        `INSERT INTO users (id, username, display_name, email, password_hash, created_at, updated_at, last_seen_at)
         VALUES (:id, :username, :name, :email, :hash, :now, :now, :now)`,
        { id, username: input.username, name: input.displayName, email: input.email, hash, now },
      );
    } catch (err) {
      if (String(err).includes('UNIQUE')) throw conflict('Это имя уже занято', { username: 'Это имя уже занято' });
      throw err;
    }
    this.log.record(id, 'register', meta);
    // Код подтверждения почты: если письмо не ушло, его можно запросить повторно
    const send = opts.sendVerification ?? true;
    const emailSent = send && this.mail.enabled ? await this.sendEmailVerification(id).then(() => true, () => false) : false;
    return { ...this.issue(id, meta), emailSent };
  }

  async login(username: string, password: string, meta: RequestMeta): Promise<{ session: IssuedSession } | { challenge: TwoFactorChallenge }> {
    const user = this.users.byLogin(username);
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
    const methods = this.twoFactorMethods(user);
    if (methods.length) {
      const challenge = randomToken(32);
      this.db.run(
        `INSERT INTO login_challenges (id, user_id, device_name, ip, user_agent, expires_at, created_at)
         VALUES (:id, :u, :d, :ip, :ua, :exp, :now)`,
        { id: sha256(challenge), u: user.id, d: meta.deviceName, ip: meta.ip, ua: meta.userAgent, exp: now + CHALLENGE_TTL_MS, now },
      );
      // Если приложения-аутентификатора нет — код из письма отправляем сразу
      let emailSent = false;
      if (!methods.includes('totp')) {
        emailSent = await this.sendLoginCode(challenge, meta).then(() => true, () => false);
      }
      return {
        challenge: { challengeId: challenge, methods, emailHint: methods.includes('email') && user.email ? maskEmail(user.email) : null, emailSent },
      };
    }
    return { session: this.completeLogin(user, meta) };
  }

  /** Доступные способы второго фактора. Вход по почте работает только с подтверждённым адресом. */
  private twoFactorMethods(user: UserRow): TwoFactorMethod[] {
    const methods: TwoFactorMethod[] = [];
    if (bool(user.totp_enabled)) methods.push('totp');
    if (bool(user.email_2fa) && user.email && user.email_verified_at) methods.push('email');
    return methods;
  }

  private challengeRow(challengeId: string) {
    const row = this.db.get<{ id: string; user_id: string; attempts: number; expires_at: number }>('SELECT * FROM login_challenges WHERE id = :id', {
      id: sha256(challengeId),
    });
    if (!row || row.expires_at < Date.now() || row.attempts >= CHALLENGE_MAX_ATTEMPTS) {
      throw new AppError(401, ErrorCode.TwoFactorInvalid, 'Сессия входа истекла. Войдите заново');
    }
    return row;
  }

  /** Отправляет код входа на подтверждённую почту (вход с двухфакторной защитой по почте). */
  async sendLoginCode(challengeId: string, meta: RequestMeta): Promise<{ emailHint: string }> {
    const row = this.challengeRow(challengeId);
    const user = this.users.byId(row.user_id);
    if (!user || !this.twoFactorMethods(user).includes('email') || !user.email) {
      throw badRequest('Для этого аккаунта вход по коду из письма не настроен');
    }
    this.mail.assertEnabled();
    const code = this.codes.issue(user.id, 'login', user.email, row.id);
    await this.mail.send(templates.loginCode(user.email, user.display_name, code, deviceOf(meta)));
    this.db.run('UPDATE login_challenges SET email_sent = 1 WHERE id = :id', { id: row.id });
    return { emailHint: maskEmail(user.email) };
  }

  loginWithSecondFactor(challengeId: string, code: string, meta: RequestMeta): IssuedSession {
    const row = this.challengeRow(challengeId);
    const user = this.users.byId(row.user_id);
    if (!user) throw new AppError(401, ErrorCode.InvalidCredentials);
    if (!this.checkSecondFactor(user, code, meta, row.id)) {
      this.db.run('UPDATE login_challenges SET attempts = attempts + 1 WHERE id = :id', { id: row.id });
      this.registerFailure(user, meta, 'login_2fa_failed');
      throw new AppError(401, ErrorCode.TwoFactorInvalid);
    }
    this.db.run('DELETE FROM login_challenges WHERE id = :id', { id: row.id });
    return this.completeLogin(user, meta);
  }

  /** TOTP, код из письма (только при входе — привязан к попытке входа) или одноразовый резервный код. */
  private checkSecondFactor(user: UserRow, code: string, meta: RequestMeta, challengeId: string | null = null): boolean {
    if (/^\d{6}$/.test(code)) {
      if (bool(user.totp_enabled) && user.totp_secret_enc) {
        const step = verifyTotp(this.totpBox.open(user.totp_secret_enc), code, user.totp_last_step);
        if (step !== null) {
          this.db.run('UPDATE users SET totp_last_step = :s WHERE id = :id', { s: step, id: user.id });
          return true;
        }
      }
      if (challengeId && this.twoFactorMethods(user).includes('email')) {
        try {
          this.codes.consume(user.id, 'login', code, challengeId);
          return true;
        } catch {
          return false;
        }
      }
      return false;
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
      if (user.email && user.email_verified_at && emailPrefsOf(user).loginAlerts) {
        this.mail.queue(templates.newLogin(user.email, user.display_name, deviceOf(meta), this.origin));
      }
    }
    return this.issue(user.id, meta);
  }

  /** Письмо о важном изменении в безопасности аккаунта (если почта подтверждена). */
  private securityEmail(userId: string, what: string, meta: RequestMeta): void {
    const user = this.users.byId(userId);
    if (!user?.email || !user.email_verified_at || !emailPrefsOf(user).securityAlerts) return;
    this.mail.queue(templates.securityChange(user.email, user.display_name, what, deviceOf(meta), this.origin));
  }

  // ─── Почта ────────────────────────────────────────────────────────────────

  async sendEmailVerification(userId: string): Promise<{ emailHint: string }> {
    const user = this.users.byId(userId);
    if (!user?.email) throw badRequest('Сначала укажите адрес почты');
    if (user.email_verified_at) throw conflict('Почта уже подтверждена');
    this.mail.assertEnabled();
    const code = this.codes.issue(user.id, 'verify_email', user.email);
    await this.mail.send(templates.verifyEmail(user.email, user.display_name, code));
    return { emailHint: maskEmail(user.email) };
  }

  verifyEmail(userId: string, code: string, meta: RequestMeta): void {
    const user = this.users.byId(userId);
    if (!user?.email) throw badRequest('Сначала укажите адрес почты');
    if (user.email_verified_at) return;
    const email = this.codes.consume(user.id, 'verify_email', code);
    // Адрес сменили после отправки кода — код от старого адреса не подходит
    if (email !== user.email) throw new AppError(400, ErrorCode.EmailCodeInvalid, undefined, { code: 'Код был отправлен на другой адрес' });
    const taken = this.db.get('SELECT 1 FROM users WHERE email = :e AND email_verified_at IS NOT NULL AND id != :id', { e: email, id: userId });
    if (taken) throw conflict('Эта почта уже привязана к другому аккаунту', { code: 'Почта уже используется' });
    this.db.run('UPDATE users SET email_verified_at = :now, updated_at = :now WHERE id = :id', { now: Date.now(), id: userId });
    this.log.record(userId, 'email_verified', meta);
    this.mail.queue(templates.welcome(email, user.display_name, this.origin));
  }

  async changeEmail(userId: string, email: string, password: string, meta: RequestMeta): Promise<{ emailSent: boolean }> {
    const user = await this.assertPassword(userId, password);
    if (bool(user.email_2fa)) throw badRequest('Сначала отключите вход по коду из письма — потом смените адрес');
    if (user.email === email && user.email_verified_at) return { emailSent: false };
    const previous = user.email_verified_at ? user.email : null;
    this.db.run('UPDATE users SET email = :e, email_verified_at = NULL, updated_at = :now WHERE id = :id', { e: email, now: Date.now(), id: userId });
    this.log.record(userId, 'email_changed', meta, { to: maskEmail(email) });
    if (previous && emailPrefsOf(user).securityAlerts) {
      this.mail.queue(templates.securityChange(previous, user.display_name, `Адрес почты изменён на ${maskEmail(email)}`, deviceOf(meta), this.origin));
    }
    const emailSent = this.mail.enabled ? await this.sendEmailVerification(userId).then(() => true, () => false) : false;
    return { emailSent };
  }

  // ─── Восстановление пароля ────────────────────────────────────────────────

  /**
   * Запрос на сброс пароля. Ответ всегда одинаковый — по нему нельзя узнать,
   * существует ли аккаунт и привязана ли к нему почта.
   */
  requestPasswordReset(login: string, meta: RequestMeta): void {
    const user = this.users.byLogin(login);
    if (!user?.email || !user.email_verified_at || !this.mail.enabled) return;
    try {
      const code = this.codes.issue(user.id, 'reset_password', user.email);
      this.mail.queue(templates.resetPassword(user.email, user.display_name, code, deviceOf(meta)));
      this.log.record(user.id, 'password_reset_requested', meta);
    } catch {
      // Лимит частоты: молча, чтобы ответ не отличался
    }
  }

  /**
   * Сброс пароля по коду из письма. Все сеансы завершаются. Если включена 2FA,
   * автоматического входа нет — нужно войти с новым паролем и вторым фактором.
   */
  async resetPassword(login: string, code: string, newPassword: string, meta: RequestMeta): Promise<IssuedSession | null> {
    const user = this.users.byLogin(login);
    if (!user) throw new AppError(400, ErrorCode.EmailCodeInvalid, undefined, { code: 'Неверный или устаревший код' });
    this.codes.consume(user.id, 'reset_password', code);
    const problem = checkPasswordPolicy(newPassword, [user.username, user.display_name]);
    if (problem) throw new AppError(400, ErrorCode.WeakPassword, problem, { newPassword: problem });
    this.db.run('UPDATE users SET password_hash = :h, failed_logins = 0, locked_until = NULL, updated_at = :now WHERE id = :id', {
      h: await hashPassword(newPassword),
      now: Date.now(),
      id: user.id,
    });
    const ids = this.sessions.revokeAllExcept(user.id, null);
    for (const id of ids) this.hub.kickSession(user.id, id);
    this.log.record(user.id, 'password_reset', meta);
    this.securityEmail(user.id, 'Пароль сброшен по коду из письма', meta);
    if (this.twoFactorMethods(user).length) return null;
    return this.completeLogin(user, meta);
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
    this.securityEmail(userId, 'Пароль изменён', meta);
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
    this.securityEmail(userId, 'Включена защита приложением-аутентификатором', meta);
    return codes;
  }

  async disableTotp(userId: string, password: string, code: string, meta: RequestMeta): Promise<void> {
    const user = await this.assertPassword(userId, password);
    if (!bool(user.totp_enabled)) return;
    if (!this.checkSecondFactor(user, code, meta)) throw new AppError(400, ErrorCode.TwoFactorInvalid, undefined, { code: 'Неверный код' });
    this.db.tx(() => {
      this.db.run('UPDATE users SET totp_enabled = 0, totp_secret_enc = NULL, totp_last_step = NULL WHERE id = :id', { id: userId });
      // Резервные коды нужны, пока включён хоть один второй фактор
      if (!bool(user.email_2fa)) this.db.run('DELETE FROM recovery_codes WHERE user_id = :id', { id: userId });
    });
    this.log.record(userId, 'twofa_disabled', meta);
    this.securityEmail(userId, 'Отключена защита приложением-аутентификатором', meta);
  }

  /** Шаг 1 включения/отключения входа по коду из письма: пароль + код на подтверждённую почту. */
  async sendEmailTwoFactorCode(userId: string, action: 'enable' | 'disable', password: string): Promise<{ emailHint: string }> {
    const user = await this.assertPassword(userId, password);
    if (!user.email || !user.email_verified_at) throw badRequest('Сначала подтвердите почту');
    if (action === 'enable' && bool(user.email_2fa)) throw conflict('Вход по коду из письма уже включён');
    if (action === 'disable' && !bool(user.email_2fa)) throw conflict('Вход по коду из письма уже выключен');
    this.mail.assertEnabled();
    const code = this.codes.issue(userId, action === 'enable' ? 'email_2fa_enable' : 'email_2fa_disable', user.email);
    await this.mail.send(
      templates.confirmAction(user.email, user.display_name, code, action === 'enable' ? 'включить вход по коду из письма' : 'отключить вход по коду из письма'),
    );
    return { emailHint: maskEmail(user.email) };
  }

  /** Шаг 2: код из письма. При включении выдаются резервные коды (если их ещё нет). */
  confirmEmailTwoFactor(userId: string, action: 'enable' | 'disable', code: string, meta: RequestMeta): { recoveryCodes: string[] | null } {
    const user = this.users.byId(userId);
    if (!user) throw new AppError(401, ErrorCode.Unauthorized);
    this.codes.consume(userId, action === 'enable' ? 'email_2fa_enable' : 'email_2fa_disable', code);
    if (action === 'enable') {
      const recoveryCodes = this.db.tx(() => {
        this.db.run('UPDATE users SET email_2fa = 1, updated_at = :now WHERE id = :id', { now: Date.now(), id: userId });
        return this.recoveryCodesLeft(userId) === 0 ? this.replaceRecoveryCodes(userId) : null;
      });
      this.log.record(userId, 'email_2fa_enabled', meta);
      this.securityEmail(userId, 'Включён вход по коду из письма', meta);
      return { recoveryCodes };
    }
    this.db.tx(() => {
      this.db.run('UPDATE users SET email_2fa = 0, updated_at = :now WHERE id = :id', { now: Date.now(), id: userId });
      if (!bool(user.totp_enabled)) this.db.run('DELETE FROM recovery_codes WHERE user_id = :id', { id: userId });
    });
    this.log.record(userId, 'email_2fa_disabled', meta);
    this.securityEmail(userId, 'Отключён вход по коду из письма', meta);
    return { recoveryCodes: null };
  }

  async regenerateRecoveryCodes(userId: string, password: string, meta: RequestMeta): Promise<string[]> {
    const user = await this.assertPassword(userId, password);
    if (!bool(user.totp_enabled) && !bool(user.email_2fa)) throw badRequest('Сначала включите двухфакторную защиту');
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
           email = NULL, email_verified_at = NULL, email_2fa = 0,
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
