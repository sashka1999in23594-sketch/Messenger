/**
 * Отправка писем. Способ доставки выбирается настройками окружения:
 *   BREVO_API_KEY / RESEND_API_KEY — HTTPS-API (работает там, где закрыты SMTP-порты);
 *   SMTP_URL — любой SMTP-сервер;
 *   в разработке и тестах — тестовый ящик в памяти (письма видно в интерфейсе входа);
 *   в production без настроек — письма не отправляются (функции почты недоступны).
 * Содержимое писем (коды!) никогда не пишется в логи.
 */
import { randomUUID } from 'node:crypto';
import type { Config, MailProvider } from '../../config.js';
import { AppError } from '../../lib/errors.js';
import { ErrorCode } from '@omni/shared';

export interface Mail {
  to: string;
  subject: string;
  text: string;
  html: string;
  /** Тип письма — для логов (без содержимого) */
  tag: string;
}

export interface StoredMail {
  id: string;
  to: string;
  subject: string;
  text: string;
  createdAt: number;
}

type Logger = Pick<Console, 'info' | 'warn' | 'error'>;

const OUTBOX_MAX = 100;
const SEND_TIMEOUT_MS = 15_000;

export class MailService {
  readonly provider: MailProvider;
  /** Тестовый ящик (только режим разработки) */
  readonly outbox: StoredMail[] = [];
  logger: Logger = console;
  private smtp: Promise<{ sendMail: (m: object) => Promise<unknown> }> | null = null;

  constructor(private readonly config: Config) {
    this.provider = config.mail.provider;
  }

  /** Письма реально уходят адресату (или в тестовый ящик в разработке). */
  get enabled(): boolean {
    return this.provider !== 'disabled';
  }

  get dev(): boolean {
    return this.provider === 'dev';
  }

  assertEnabled(): void {
    if (!this.enabled) throw new AppError(503, ErrorCode.MailUnavailable);
  }

  /** Отправить и дождаться результата (коды подтверждения — пользователь ждёт письмо). */
  async send(mail: Mail): Promise<void> {
    this.assertEnabled();
    try {
      await this.deliver(mail);
      this.logger.info({ mail: mail.tag, provider: this.provider }, 'Письмо отправлено');
    } catch (err) {
      this.logger.error({ mail: mail.tag, provider: this.provider, err: String(err) }, 'Не удалось отправить письмо');
      throw new AppError(502, ErrorCode.MailUnavailable, 'Не удалось отправить письмо. Попробуйте ещё раз чуть позже');
    }
  }

  /** Отправить в фоне (уведомления о входе и безопасности не должны задерживать ответ). */
  queue(mail: Mail): void {
    if (!this.enabled) return;
    void this.deliver(mail).then(
      () => this.logger.info({ mail: mail.tag, provider: this.provider }, 'Письмо отправлено'),
      (err: unknown) => this.logger.error({ mail: mail.tag, provider: this.provider, err: String(err) }, 'Не удалось отправить письмо'),
    );
  }

  private async deliver(mail: Mail): Promise<void> {
    const { fromName, fromEmail } = this.config.mail;
    switch (this.provider) {
      case 'dev': {
        this.outbox.unshift({ id: randomUUID(), to: mail.to, subject: mail.subject, text: mail.text, createdAt: Date.now() });
        this.outbox.length = Math.min(this.outbox.length, OUTBOX_MAX);
        return;
      }
      case 'brevo':
        return this.post('https://api.brevo.com/v3/smtp/email', { 'api-key': this.config.mail.brevoApiKey! }, {
          sender: { name: fromName, email: fromEmail },
          to: [{ email: mail.to }],
          subject: mail.subject,
          htmlContent: mail.html,
          textContent: mail.text,
        });
      case 'resend':
        return this.post('https://api.resend.com/emails', { authorization: `Bearer ${this.config.mail.resendApiKey!}` }, {
          from: `${fromName} <${fromEmail}>`,
          to: [mail.to],
          subject: mail.subject,
          html: mail.html,
          text: mail.text,
        });
      case 'smtp': {
        this.smtp ??= import('nodemailer').then((m) => m.default.createTransport(this.config.mail.smtpUrl!));
        const transport = await this.smtp;
        await transport.sendMail({ from: { name: fromName, address: fromEmail }, to: mail.to, subject: mail.subject, text: mail.text, html: mail.html });
        return;
      }
      case 'disabled':
        return;
    }
  }

  private async post(url: string, headers: Record<string, string>, body: unknown): Promise<void> {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
    if (!res.ok) {
      // Текст ответа провайдера помогает понять причину (неверный ключ, неподтверждённый отправитель)
      const detail = (await res.text().catch(() => '')).slice(0, 300);
      throw new Error(`HTTP ${res.status}: ${detail}`);
    }
  }
}

/** s***a@gmail.com — чтобы показать, куда ушёл код, не раскрывая адрес целиком. */
export function maskEmail(email: string): string {
  const [local = '', domain = ''] = email.split('@');
  const visible = local.length <= 2 ? local[0] ?? '' : `${local[0]}${'*'.repeat(Math.min(5, local.length - 2))}${local.at(-1)}`;
  return `${visible}@${domain}`;
}
