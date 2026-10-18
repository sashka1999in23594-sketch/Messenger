/**
 * Отправка писем. Способ доставки выбирается настройками окружения:
 *   BREVO_API_KEY / RESEND_API_KEY — HTTPS-API (работает там, где закрыты SMTP-порты);
 *   MAIL_SCRIPT_URL — свой Gmail через Google Apps Script (docs/gmail-mailer.gs), тоже HTTPS;
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

/**
 * Состояние почты для /health: off — не настроена; ok — ключ принят и отправитель
 * подтверждён; bad_key — провайдер не принял ключ; sender_not_verified — адрес из
 * MAIL_FROM не подтверждён у провайдера; ip_blocked — Brevo пускает только с разрешённых
 * IP (у хостинга адрес меняется); script_access — скрипт Gmail не открыт для всех;
 * on — настроена, но проверить нельзя (SMTP).
 */
export type MailHealth = 'off' | 'dev' | 'checking' | 'ok' | 'on' | 'bad_key' | 'ip_blocked' | 'sender_not_verified' | 'script_access' | 'unreachable';

const OUTBOX_MAX = 100;
const SEND_TIMEOUT_MS = 15_000;
/** Скрипт Google при первом обращении «просыпается» несколько секунд */
const SCRIPT_TIMEOUT_MS = 30_000;

/** Ответ скрипта Gmail не JSON — значит, Google показал страницу входа: доступ не «Anyone». */
class ScriptAccessError extends Error {}

export class MailService {
  readonly provider: MailProvider;
  /** Тестовый ящик (только режим разработки) */
  readonly outbox: StoredMail[] = [];
  logger: Logger = console;
  private smtp: Promise<{ sendMail: (m: object) => Promise<unknown> }> | null = null;

  health: MailHealth;

  constructor(private readonly config: Config) {
    this.provider = config.mail.provider;
    this.health =
      this.provider === 'disabled' ? 'off' : this.provider === 'dev' ? 'dev' : this.provider === 'brevo' || this.provider === 'gmail' ? 'checking' : 'on';
  }

  /**
   * Проверка при запуске (только Brevo): принят ли ключ и подтверждён ли отправитель.
   * Без подтверждённого отправителя Brevo письма не отправит — об этом лучше узнать сразу.
   */
  async verify(): Promise<MailHealth> {
    if (this.provider === 'gmail') return this.verifyScript();
    if (this.provider !== 'brevo') return this.health;
    const get = (path: string) =>
      fetch(`https://api.brevo.com/v3/${path}`, {
        headers: { accept: 'application/json', 'api-key': this.config.mail.brevoApiKey! },
        signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
      });
    try {
      const account = await get('account');
      if (account.status === 401 || account.status === 403) {
        // У новых аккаунтов Brevo бывает включена защита «только с разрешённых IP»
        const text = await account.text().catch(() => '');
        this.health = /\bIP\b|unrecogni[sz]ed/i.test(text) ? 'ip_blocked' : 'bad_key';
      } else {
        const res = await get('senders');
        const { senders = [] } = res.ok ? ((await res.json()) as { senders?: { email: string; active: boolean }[] }) : {};
        const from = this.config.mail.fromEmail.toLowerCase();
        this.health = senders.some((x) => x.active && x.email.toLowerCase() === from) ? 'ok' : 'sender_not_verified';
      }
    } catch {
      this.health = 'unreachable';
    }
    const hints: Record<string, string> = {
      ok: `Brevo: ключ принят, отправитель ${this.config.mail.fromEmail} подтверждён`,
      bad_key: 'Brevo не принял BREVO_API_KEY — создайте новый ключ в SMTP & API → API Keys',
      ip_blocked: 'Brevo блокирует запросы с IP хостинга — отключите защиту: Security → Authorized IPs → Deactivate blocking',
      sender_not_verified: `Brevo: адрес ${this.config.mail.fromEmail} из MAIL_FROM не подтверждён — добавьте его в Senders и подтвердите кодом из письма`,
      unreachable: 'Brevo не отвечает — проверим при отправке письма',
    };
    (this.health === 'ok' ? this.logger.info : this.logger.warn).call(this.logger, hints[this.health]);
    return this.health;
  }

  /** Gmail через Apps Script: скрипт отвечает, секрет совпадает, сколько писем осталось на сегодня. */
  private async verifyScript(): Promise<MailHealth> {
    let hint: string;
    try {
      const r = await this.script({ ping: true });
      this.health = r.ok ? 'ok' : 'bad_key';
      hint = r.ok
        ? `Gmail: скрипт отвечает, на сегодня осталось писем: ${r.quota ?? '?'}`
        : 'Gmail: MAIL_SCRIPT_SECRET не совпадает с SECRET в скрипте';
    } catch (err) {
      this.health = err instanceof ScriptAccessError ? 'script_access' : 'unreachable';
      hint =
        this.health === 'script_access'
          ? 'Gmail: скрипт недоступен — в Apps Script: Deploy → Manage deployments → Who has access: Anyone'
          : 'Gmail: скрипт не отвечает — проверим при отправке письма';
    }
    (this.health === 'ok' ? this.logger.info : this.logger.warn).call(this.logger, hint);
    return this.health;
  }

  private async script(body: Record<string, unknown>): Promise<{ ok: boolean; error?: string; quota?: number }> {
    const { url, secret } = this.config.mail.script!;
    // POST → 302 → GET с результатом: fetch проходит перенаправление сам
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ secret, ...body }),
      redirect: 'follow',
      signal: AbortSignal.timeout(SCRIPT_TIMEOUT_MS),
    });
    const text = await res.text();
    try {
      return JSON.parse(text) as { ok: boolean; error?: string; quota?: number };
    } catch {
      throw new ScriptAccessError(`HTTP ${res.status}: скрипт ответил не JSON — откройте доступ «Anyone»`);
    }
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
      case 'gmail': {
        const r = await this.script({ to: mail.to, subject: mail.subject, html: mail.html, text: mail.text, name: fromName });
        if (!r.ok) throw new Error(`Gmail-скрипт: ${r.error ?? 'ошибка'}`);
        return;
      }
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
