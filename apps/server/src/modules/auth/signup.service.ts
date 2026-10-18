/**
 * Пошаговая регистрация: почта → код из письма (подтверждение обязательно) →
 * телефон, имя, @имя, дата рождения и пол, пароль с подсказкой. Аккаунт
 * создаётся одним запросом в конце, когда все данные проверены.
 */
import { ErrorCode, type SignupCompleteInput, type SignupState } from '@omni/shared';
import type { Db } from '../../db/index.js';
import type { RequestMeta } from '../../http/types.js';
import { AppError, badRequest, conflict } from '../../lib/errors.js';
import { hashPassword } from '../../lib/crypto.js';
import { newId } from '../../lib/ids.js';
import { maskEmail, type MailService } from '../mail/mail.service.js';
import { templates } from '../mail/templates.js';
import type { SystemService } from '../system/system.service.js';
import type { UsersService } from '../users/users.service.js';
import type { UsersRepo } from '../users/users.repo.js';
import type { AuthService, IssuedSession } from './auth.service.js';
import { FlowStore, waitText, type FlowRow } from './flow-store.js';
import type { SecurityLog } from './security-log.js';

const SEND_WINDOW_MS = 30 * 60_000;
const SENDS_PER_WINDOW = 2;

export class SignupService {
  constructor(
    private readonly db: Db,
    private readonly store: FlowStore,
    private readonly users: UsersRepo,
    private readonly usersService: UsersService,
    private readonly auth: AuthService,
    private readonly system: SystemService,
    private readonly mail: MailService,
    private readonly log: SecurityLog,
    private readonly origin: string,
  ) {}

  private emailTaken(email: string): boolean {
    return !!this.db.get('SELECT 1 FROM users WHERE email = :e AND email_verified_at IS NOT NULL AND deleted_at IS NULL', { e: email });
  }

  async start(email: string, meta: RequestMeta): Promise<SignupState> {
    if (this.emailTaken(email)) {
      throw conflict('Эта почта уже привязана к аккаунту — войдите в него', { email: 'Почта уже привязана к аккаунту' });
    }
    this.mail.assertEnabled();
    const { token, row } = this.store.create('signup', { email, step: 'email_code' }, meta);
    await this.sendCode(row);
    return this.state(token, row.id);
  }

  private async sendCode(row: FlowRow): Promise<void> {
    const email = row.email!;
    const { count, freeIn } = this.store.sends(`email:${email}`, 'signup', SEND_WINDOW_MS);
    if (count >= SENDS_PER_WINDOW) {
      throw new AppError(429, ErrorCode.RateLimited, `Код на этот адрес уже отправлялся дважды. Попробуйте через ${waitText(freeIn)}`, undefined, freeIn);
    }
    const { code } = this.store.issue(row);
    await this.mail.send(templates.signupCode(email, code));
    this.store.recordSend(`email:${email}`, 'signup');
  }

  /** «Отправить снова» — один раз и не раньше чем через 30 секунд. */
  async resend(token: string): Promise<SignupState> {
    const row = this.store.get(token, 'signup');
    if (row.step !== 'email_code') throw badRequest('Почта уже подтверждена');
    if (row.resent >= 1) throw new AppError(429, ErrorCode.RateLimited, 'Код уже отправлялся повторно');
    const wait = row.sent_at ? Math.ceil((row.sent_at + 30_000 - Date.now()) / 1000) : 0;
    if (wait > 0) throw new AppError(429, ErrorCode.RateLimited, `Отправить снова можно через ${wait} с`, undefined, wait);
    await this.sendCode(row);
    this.store.markResent(row);
    return this.state(token, row.id);
  }

  verify(token: string, code: string): SignupState {
    const row = this.store.get(token, 'signup');
    if (row.step !== 'email_code') throw badRequest('Почта уже подтверждена');
    const result = this.store.check(row, 'code', code);
    if (result !== 'ok') {
      const left = result === 'wrong' ? this.store.failAttempt(row) : 0;
      const message = left > 0 ? `Неверный код. Осталось попыток: ${left}` : 'Код больше не действует — отправьте новый';
      throw new AppError(400, ErrorCode.EmailCodeInvalid, message, { code: message });
    }
    return this.state(token, this.store.setStep(row, 'details').id);
  }

  /** Свободны ли @имя и номер — чтобы подсказать прямо на шаге, а не в конце. */
  availability(input: { username?: string; phone?: string }): { username?: boolean; phone?: boolean } {
    const out: { username?: boolean; phone?: boolean } = {};
    if (input.username) {
      try {
        this.usersService.assertUsernameFree(input.username);
        out.username = true;
      } catch {
        out.username = false;
      }
    }
    if (input.phone) out.phone = !this.users.byPhone(input.phone);
    return out;
  }

  async complete(input: SignupCompleteInput, meta: RequestMeta): Promise<IssuedSession> {
    const row = this.store.get(input.flow, 'signup');
    if (row.step !== 'details') throw badRequest('Сначала подтвердите почту');
    const email = row.email!;
    if (this.emailTaken(email)) throw conflict('Эта почта уже привязана к аккаунту — войдите в него', { email: 'Почта уже привязана к аккаунту' });
    this.usersService.assertUsernameFree(input.username);
    if (this.users.byPhone(input.phone)) throw conflict('Этот номер уже привязан к другому аккаунту', { phone: 'Номер уже используется' });

    const hash = await hashPassword(input.password);
    const now = Date.now();
    const id = newId(now);
    try {
      this.db.run(
        `INSERT INTO users (id, username, display_name, email, email_verified_at, phone, password_hash, password_hint, birth_date, gender,
                            onboarded_at, created_at, updated_at, last_seen_at)
         VALUES (:id, :username, :name, :email, :now, :phone, :hash, :hint, :birth, :gender, :now, :now, :now, :now)`,
        {
          id,
          username: input.username,
          name: input.displayName,
          email,
          phone: input.phone,
          hash,
          hint: input.passwordHint,
          birth: input.birthDate,
          gender: input.gender === 'unspecified' ? null : input.gender,
          now,
        },
      );
    } catch (err) {
      if (String(err).includes('phone')) throw conflict('Этот номер уже привязан к другому аккаунту', { phone: 'Номер уже используется' });
      if (String(err).includes('UNIQUE')) throw conflict('Это имя уже занято', { username: 'Это имя уже занято' });
      throw err;
    }
    this.store.remove(row);
    this.log.record(id, 'register', meta);
    // Служебный чат появляется сразу — туда будут приходить коды входа
    this.system.chatId(id);
    this.mail.queue(templates.welcome(email, input.displayName, this.origin));
    return this.auth.issueSession(id, meta);
  }

  private state(token: string, rowId: string): SignupState {
    const row = this.store.reload(rowId);
    const { count, freeIn } = this.store.sends(`email:${row.email}`, 'signup', SEND_WINDOW_MS);
    const limited = count >= SENDS_PER_WINDOW;
    return {
      flow: token,
      step: row.step as SignupState['step'],
      emailHint: maskEmail(row.email!),
      resendIn: row.step === 'email_code' ? this.store.resendIn(row) : null,
      limited,
      limitResetIn: limited ? freeIn : null,
    };
  }
}
