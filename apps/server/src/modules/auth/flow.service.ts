/**
 * Пошаговый вход: почта или телефон → 6-значный код (в чат Sunnet на вошедших
 * устройствах и на почту) → пароль (можно посмотреть подсказку) → при включённой
 * защите — код из приложения-аутентификатора.
 *
 * «Забыли пароль?» — два разных кода: из письма и из чата Sunnet (если других
 * устройств со входом нет — хватает письма) → новый пароль, повтор, подсказка.
 * Вход по QR-коду: вошедшее устройство подтверждает новое, дальше — пароль.
 *
 * Лимиты: «Отправить снова» — один раз и не раньше чем через 30 секунд; не больше
 * 2 кодов за 30 минут на аккаунт (дальше — «только в аккаунт», до 5 за 30 минут);
 * сброс пароля — 4 раза в час.
 */
import {
  ErrorCode,
  looksLikePhone,
  normalizePhone,
  USERNAME_RE,
  type AuthFlowState,
  type AuthFlowStep,
  type QrLoginInfo,
  type QrLoginPoll,
  type QrLoginStart,
} from '@omni/shared';
import type { Db } from '../../db/index.js';
import { bool, iso } from '../../db/index.js';
import { describeDevice, parseUserAgent } from '../../http/request.js';
import type { RequestMeta } from '../../http/types.js';
import { AppError, badRequest, notFound } from '../../lib/errors.js';
import { randomToken, sha256 } from '../../lib/crypto.js';
import { maskEmail, type MailService } from '../mail/mail.service.js';
import { templates } from '../mail/templates.js';
import type { SystemService } from '../system/system.service.js';
import type { UserRow, UsersRepo } from '../users/users.repo.js';
import type { AuthService, IssuedSession } from './auth.service.js';
import { FlowStore, waitText, type FlowRow } from './flow-store.js';
import type { SecurityLog } from './security-log.js';
import { maskIp, type SessionService } from './sessions.js';

const SEND_WINDOW_MS = 30 * 60_000;
const SENDS_PER_WINDOW = 2;
const ACCOUNT_SENDS_PER_WINDOW = 5;
const RESET_WINDOW_MS = 60 * 60_000;
const RESETS_PER_WINDOW = 4;
const QR_TTL_MS = 2 * 60_000;

interface Delivery {
  emailSent: boolean;
  accountSent: boolean;
}
const NOTHING: Delivery = { emailSent: false, accountSent: false };

interface QrRow {
  id: string;
  poll_hash: string;
  status: 'pending' | 'approved' | 'rejected' | 'used';
  user_id: string | null;
  device_name: string;
  user_agent: string;
  ip: string;
  expires_at: number;
  created_at: number;
}

const fmtTime = (d: Date) =>
  d.toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Moscow' }) + ' (МСК)';

/** Откуда пытаются войти — для сообщения в чате Sunnet. */
function whereText(meta: Pick<RequestMeta, 'userAgent' | 'ip' | 'deviceName'>): string {
  const { os, browser } = parseUserAgent(meta.userAgent);
  // Имя устройства показываем, только если клиент назвал его сам (иначе оно повторяет браузер и систему)
  const custom = meta.deviceName !== describeDevice(meta.userAgent) ? [`• Устройство: ${meta.deviceName}`] : [];
  return [`• Система: ${os}`, `• Браузер: ${browser}`, ...custom, `• IP-адрес: ${meta.ip}`, `• Время: ${fmtTime(new Date())}`].join('\n');
}

export class AuthFlowService {
  constructor(
    private readonly db: Db,
    private readonly store: FlowStore,
    private readonly users: UsersRepo,
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
    private readonly system: SystemService,
    private readonly mail: MailService,
    private readonly log: SecurityLog,
  ) {}

  // ─── Шаг 1: почта или телефон ─────────────────────────────────────────────

  /** Аккаунт по почте, номеру телефона или имени пользователя. */
  private findUser(login: string): UserRow | undefined {
    const value = login.trim().toLowerCase();
    if (value.includes('@')) {
      return (
        this.db.get<UserRow>('SELECT * FROM users WHERE email = :e AND email_verified_at IS NOT NULL AND deleted_at IS NULL', { e: value }) ??
        this.db.get<UserRow>('SELECT * FROM users WHERE email = :e AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 1', { e: value })
      );
    }
    if (looksLikePhone(value)) {
      const phone = normalizePhone(value);
      return phone ? this.users.byPhone(phone) : undefined;
    }
    return USERNAME_RE.test(value) ? this.users.byUsername(value) : undefined;
  }

  async start(login: string, meta: RequestMeta): Promise<AuthFlowState> {
    const user = this.findUser(login);
    if (!user || bool(user.is_system)) throw new AppError(404, ErrorCode.NotFound, 'Аккаунт не найден', { login: 'Аккаунт не найден' });
    if (user.locked_until && user.locked_until > Date.now()) {
      throw new AppError(429, ErrorCode.AccountLocked, undefined, undefined, Math.ceil((user.locked_until - Date.now()) / 1000));
    }
    const { token, row } = this.store.create('login', { userId: user.id, step: 'code' }, meta);
    this.log.record(user.id, 'login_started', meta);
    const delivery = await this.sendLoginCode(row, user, meta, 'all');
    return this.state(token, row.id, user, delivery);
  }

  /**
   * Код входа: в чат Sunnet и на почту ('all') или только в чат ('account',
   * когда лимит писем исчерпан). NOTHING — лимит не дал отправить.
   */
  private async sendLoginCode(row: FlowRow, user: UserRow, meta: RequestMeta, to: 'all' | 'account'): Promise<Delivery> {
    if (to === 'all') {
      if (this.store.sends(user.id, 'login', SEND_WINDOW_MS).count >= SENDS_PER_WINDOW) return NOTHING;
    } else {
      const { count, freeIn } = this.store.sends(user.id, 'login_account', SEND_WINDOW_MS);
      if (count >= ACCOUNT_SENDS_PER_WINDOW) {
        throw new AppError(429, ErrorCode.RateLimited, `Слишком много кодов. Попробуйте через ${waitText(freeIn)}`, undefined, freeIn);
      }
    }
    const { code } = this.store.issue(row);
    this.system.post(
      user.id,
      `Код для входа в Sunnet: ${code}\n\nНикому не сообщайте этот код — даже сотрудникам Sunnet. Код действует 10 минут.\n\nПопытка входа:\n${whereText(meta)}\n\nЕсли это были не вы — просто не вводите код и смените пароль в настройках безопасности.`,
    );
    let emailSent = false;
    if (to === 'all' && user.email && this.mail.enabled) {
      emailSent = await this.mail.send(templates.loginCode(user.email, user.display_name, code, { device: meta.deviceName, ip: meta.ip, time: new Date() })).then(
        () => true,
        () => false,
      );
    }
    this.store.recordSend(user.id, to === 'all' ? 'login' : 'login_account');
    return { emailSent, accountSent: this.system.hasActiveSessions(user.id) };
  }

  /** «Отправить снова» (один раз, через 30 секунд) или «Отправить только в аккаунт». */
  async resend(token: string, to: 'all' | 'account', meta: RequestMeta): Promise<AuthFlowState> {
    const row = this.store.get(token, 'login');
    const user = this.flowUser(row);
    const wait = row.sent_at ? Math.ceil((row.sent_at + 30_000 - Date.now()) / 1000) : 0;
    if (wait > 0) throw new AppError(429, ErrorCode.RateLimited, `Отправить снова можно через ${wait} с`, undefined, wait);

    if (row.step === 'code') {
      if (to === 'account') return this.state(token, row.id, user, await this.sendLoginCode(row, user, meta, 'account'));
      if (row.resent >= 1) throw new AppError(429, ErrorCode.RateLimited, 'Код уже отправлялся повторно');
      const delivery = await this.sendLoginCode(row, user, meta, 'all');
      if (delivery !== NOTHING) this.store.markResent(row);
      return this.state(token, row.id, user, delivery);
    }
    if (row.step === 'reset_codes') {
      if (to === 'account') throw badRequest('Для сброса пароля нужны оба кода');
      if (row.resent >= 1) throw new AppError(429, ErrorCode.RateLimited, 'Коды уже отправлялись повторно');
      const delivery = await this.sendResetCodes(row, user, meta);
      this.store.markResent(row);
      return this.state(token, row.id, user, delivery);
    }
    throw badRequest('Сейчас отправлять код не нужно');
  }

  // ─── Шаг 2: код ───────────────────────────────────────────────────────────

  verifyCode(token: string, code: string, meta: RequestMeta): AuthFlowState {
    const row = this.store.get(token, 'login');
    if (row.step !== 'code') throw badRequest('Код уже подтверждён');
    const user = this.flowUser(row);
    const result = this.store.check(row, 'code', code);
    if (result !== 'ok') {
      const left = result === 'wrong' ? this.store.failAttempt(row) : 0;
      this.log.record(user.id, 'login_code_failed', meta);
      const message = left > 0 ? `Неверный код. Осталось попыток: ${left}` : 'Код больше не действует — отправьте новый';
      throw new AppError(400, ErrorCode.EmailCodeInvalid, message, { code: message });
    }
    return this.state(token, this.store.setStep(row, 'password').id, user, NOTHING);
  }

  // ─── Шаг 3: пароль ────────────────────────────────────────────────────────

  /** Подсказка к паролю — только после проверки кода. */
  hint(token: string): { hint: string | null } {
    const row = this.store.get(token, 'login');
    if (row.step !== 'password') throw badRequest('Подсказка доступна на шаге пароля');
    return { hint: this.flowUser(row).password_hint };
  }

  async password(token: string, password: string, meta: RequestMeta): Promise<AuthFlowState | IssuedSession> {
    const row = this.store.get(token, 'login');
    if (row.step !== 'password') throw badRequest('Сначала введите код');
    const user = this.flowUser(row);
    await this.auth.checkLoginPassword(user, password, meta);
    if (bool(user.totp_enabled)) return this.state(token, this.store.setStep(row, 'totp').id, user, NOTHING);
    return this.finish(row, user, meta);
  }

  totp(token: string, code: string, meta: RequestMeta): IssuedSession {
    const row = this.store.get(token, 'login');
    if (row.step !== 'totp') throw badRequest('Сначала введите пароль');
    const user = this.flowUser(row);
    if (!this.auth.checkTotp(user, code, meta)) {
      this.auth.registerFailure(user, meta, 'login_2fa_failed');
      throw new AppError(401, ErrorCode.TwoFactorInvalid, undefined, { code: 'Неверный код' });
    }
    return this.finish(row, user, meta);
  }

  private finish(row: FlowRow, user: UserRow, meta: RequestMeta): IssuedSession {
    this.store.remove(row);
    const known = this.sessions.isKnownDevice(user.id, meta.userAgent);
    const session = this.auth.completeLogin(user, meta);
    if (!known) {
      this.system.post(
        user.id,
        `Выполнен вход в ваш аккаунт.\n\n${whereText(meta)}\n\nЕсли это были не вы — завершите этот сеанс в «Настройки → Безопасность → Устройства» и смените пароль.`,
      );
    }
    return session;
  }

  /** «Назад» со сброса пароля или кода из приложения — снова к паролю (код уже подтверждён). */
  back(token: string): AuthFlowState {
    const row = this.store.get(token, 'login');
    if (!['reset_codes', 'reset_password', 'totp'].includes(row.step)) throw badRequest('Отсюда вернуться нельзя');
    return this.state(token, this.store.setStep(row, 'password').id, this.flowUser(row), NOTHING);
  }

  // ─── Сброс пароля ─────────────────────────────────────────────────────────

  async forgot(token: string, meta: RequestMeta): Promise<AuthFlowState> {
    const row = this.store.get(token, 'login');
    if (row.step !== 'password') throw badRequest('Сброс пароля доступен на шаге пароля');
    const user = this.flowUser(row);
    if (!user.email) {
      throw badRequest('К аккаунту не привязана почта, поэтому сбросить пароль не получится. Напишите в поддержку: spaceup.support@gmail.com');
    }
    const delivery = await this.sendResetCodes(row, user, meta);
    return this.state(token, row.id, user, delivery);
  }

  /** Два разных кода: на почту и в чат Sunnet (если есть устройства со входом). */
  private async sendResetCodes(row: FlowRow, user: UserRow, meta: RequestMeta): Promise<Delivery> {
    const { count, freeIn } = this.store.sends(user.id, 'reset', RESET_WINDOW_MS);
    if (count >= RESETS_PER_WINDOW) {
      throw new AppError(429, ErrorCode.RateLimited, `Сбросить пароль можно 4 раза в час. Попробуйте через ${waitText(freeIn)}`, undefined, freeIn);
    }
    this.mail.assertEnabled();
    const withAccount = this.system.hasActiveSessions(user.id);
    if (row.step !== 'reset_codes') row = this.store.setStep(row, 'reset_codes');
    const { code, accountCode } = this.store.issue(row, withAccount);
    await this.mail.send(templates.resetPassword(user.email!, user.display_name, code, { device: meta.deviceName, ip: meta.ip, time: new Date() }));
    if (accountCode) {
      this.system.post(
        user.id,
        `Код для сброса пароля: ${accountCode}\n\nВторой код отправлен на почту — для сброса нужны оба. Никому их не сообщайте.\n\nЗапрос со следующего устройства:\n${whereText(meta)}\n\nЕсли это были не вы — ничего не делайте: без обоих кодов пароль не изменится.`,
      );
    }
    this.store.recordSend(user.id, 'reset');
    this.log.record(user.id, 'password_reset_requested', meta);
    return { emailSent: true, accountSent: !!accountCode };
  }

  resetCodes(token: string, emailCode: string, accountCode: string | undefined, meta: RequestMeta): AuthFlowState {
    const row = this.store.get(token, 'login');
    if (row.step !== 'reset_codes') throw badRequest('Сначала запросите сброс пароля');
    const user = this.flowUser(row);
    const email = this.store.check(row, 'code', emailCode);
    const account = row.account_code_hash ? this.store.check(row, 'account', accountCode ?? '') : 'ok';
    if (email !== 'ok' || account !== 'ok') {
      const expired = email === 'expired' || account === 'expired';
      const left = expired ? 0 : this.store.failAttempt(row);
      this.log.record(user.id, 'password_reset_code_failed', meta);
      const fields: Record<string, string> = {};
      if (expired || left === 0) {
        fields.emailCode = 'Коды больше не действуют — отправьте новые';
      } else {
        if (email !== 'ok') fields.emailCode = 'Неверный код из письма';
        if (account !== 'ok') fields.accountCode = 'Неверный код из чата Sunnet';
      }
      const message = Object.values(fields).join('. ') + (left > 0 ? `. Осталось попыток: ${left}` : '');
      throw new AppError(400, ErrorCode.EmailCodeInvalid, message, fields);
    }
    return this.state(token, this.store.setStep(row, 'reset_password').id, user, NOTHING);
  }

  async resetPassword(token: string, password: string, hint: string, meta: RequestMeta): Promise<AuthFlowState | IssuedSession> {
    const row = this.store.get(token, 'login');
    if (row.step !== 'reset_password') throw badRequest('Сначала введите коды');
    const user = this.flowUser(row);
    await this.auth.setNewPassword(user, password, hint, meta);
    this.system.post(
      user.id,
      `Пароль от аккаунта изменён. Все остальные устройства вышли из аккаунта.\n\n${whereText(meta)}\n\nЕсли это были не вы — срочно напишите в поддержку: spaceup.support@gmail.com`,
    );
    const fresh = this.users.byId(user.id)!;
    // Сброс пароля не отменяет второй фактор: код из приложения спрашиваем и здесь
    if (bool(fresh.totp_enabled)) return this.state(token, this.store.setStep(row, 'totp').id, fresh, NOTHING);
    return this.finish(row, fresh, meta);
  }

  // ─── Вход по QR-коду ──────────────────────────────────────────────────────

  qrStart(meta: RequestMeta): QrLoginStart {
    const token = randomToken(24);
    const secret = randomToken(24);
    const now = Date.now();
    this.db.run(
      `INSERT INTO qr_logins (id, poll_hash, device_name, user_agent, ip, expires_at, created_at)
       VALUES (:id, :poll, :device, :ua, :ip, :exp, :now)`,
      { id: sha256(token), poll: sha256(secret), device: meta.deviceName, ua: meta.userAgent, ip: meta.ip, exp: now + QR_TTL_MS, now },
    );
    return { token, secret, expiresAt: iso(now + QR_TTL_MS) };
  }

  private qrRow(token: string): QrRow | undefined {
    return this.db.get<QrRow>('SELECT * FROM qr_logins WHERE id = :id', { id: sha256(token) });
  }

  /** Новое устройство спрашивает, подтвердили ли вход. После подтверждения — шаг пароля. */
  qrPoll(token: string, secret: string, meta: RequestMeta): QrLoginPoll {
    const row = this.qrRow(token);
    if (!row || row.poll_hash !== sha256(secret) || row.status === 'used') return { status: 'expired' };
    if (row.status === 'rejected') return { status: 'rejected' };
    if (row.status === 'pending') return { status: row.expires_at < Date.now() ? 'expired' : 'pending' };
    // Подтверждено: одноразово выдаём попытку входа сразу на шаге пароля
    const user = row.user_id ? this.users.byId(row.user_id) : undefined;
    this.db.run("UPDATE qr_logins SET status = 'used' WHERE id = :id", { id: row.id });
    if (!user || row.expires_at + QR_TTL_MS < Date.now()) return { status: 'expired' };
    const { token: flow, row: flowRow } = this.store.create('login', { userId: user.id, step: 'password' }, meta);
    return { status: 'approved', state: this.state(flow, flowRow.id, user, NOTHING) };
  }

  /** Что показать на вошедшем устройстве перед подтверждением. */
  qrInfo(token: string): QrLoginInfo {
    const row = this.qrRow(token);
    if (!row || row.status !== 'pending' || row.expires_at < Date.now()) throw notFound('QR-код устарел — попросите показать новый');
    const { os, browser } = parseUserAgent(row.user_agent);
    return { device: row.device_name, os, browser, ip: maskIp(row.ip), createdAt: iso(row.created_at) };
  }

  qrDecide(token: string, approverId: string, approve: boolean, meta: RequestMeta): void {
    const row = this.qrRow(token);
    if (!row || row.status !== 'pending' || row.expires_at < Date.now()) throw notFound('QR-код устарел — попросите показать новый');
    this.db.run('UPDATE qr_logins SET status = :s, user_id = :u WHERE id = :id', { s: approve ? 'approved' : 'rejected', u: approverId, id: row.id });
    this.log.record(approverId, approve ? 'qr_login_approved' : 'qr_login_rejected', meta);
    if (approve) {
      this.system.post(
        approverId,
        `Вы разрешили вход по QR-коду. На новом устройстве осталось ввести пароль.\n\n${whereText({ userAgent: row.user_agent, ip: row.ip, deviceName: row.device_name })}\n\nЕсли это были не вы — завершите сеанс в «Настройки → Безопасность → Устройства».`,
      );
    }
  }

  // ─── Общее ────────────────────────────────────────────────────────────────

  private flowUser(row: FlowRow): UserRow {
    const user = row.user_id ? this.users.byId(row.user_id) : undefined;
    if (!user) throw new AppError(410, ErrorCode.FlowExpired);
    return user;
  }

  private state(token: string, rowId: string, user: UserRow, delivery: Delivery): AuthFlowState {
    const row = this.store.reload(rowId);
    const step = row.step as AuthFlowStep;
    const resetStep = step === 'reset_codes' || step === 'reset_password';
    const limit = resetStep
      ? this.store.sends(user.id, 'reset', RESET_WINDOW_MS)
      : this.store.sends(user.id, 'login', SEND_WINDOW_MS);
    const limited = resetStep ? limit.count >= RESETS_PER_WINDOW : limit.count >= SENDS_PER_WINDOW;
    const identified = step !== 'code';
    return {
      status: 'step',
      flow: token,
      step,
      emailHint: user.email ? maskEmail(user.email) : null,
      emailSent: delivery.emailSent,
      accountSent: delivery.accountSent,
      resendIn: step === 'code' || step === 'reset_codes' ? this.store.resendIn(row) : null,
      limited,
      limitResetIn: limited ? limit.freeIn : null,
      needsAccountCode: step === 'reset_codes' && !!row.account_code_hash,
      user: identified ? this.users.toSummary(user) : null,
      hasHint: identified && !!user.password_hint,
    };
  }
}
