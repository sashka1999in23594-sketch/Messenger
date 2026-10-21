import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { regionFromEndpoint, type S3Options } from './lib/s3.js';
import { storageKey } from './lib/sealed.js';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  HOST: z.string().default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  APP_SECRET: z.string().optional(),
  PUBLIC_ORIGIN: z.string().optional(),
  /** Дополнительные разрешённые Origin через запятую (например, мобильная сборка) */
  EXTRA_ORIGINS: z.string().default(''),
  DATA_DIR: z.string().default('./data'),
  MAX_IMAGE_MB: z.coerce.number().positive().default(15),
  MAX_VIDEO_MB: z.coerce.number().positive().default(300),
  MAX_FILE_MB: z.coerce.number().positive().default(50),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  /** Количество доверенных прокси перед приложением (для корректного IP клиента) */
  TRUST_PROXY: z.coerce.number().int().min(0).default(0),
  /** Каталог собранного веб-клиента — если задан, сервер отдаёт его сам */
  WEB_DIST: z.string().optional(),
  SESSION_DAYS: z.coerce.number().int().min(1).max(365).default(30),
  /** Загрузить демо-данные при первом запуске (публичное демо, например на Render) */
  DEMO_SEED: z.enum(['true', 'false', '1', '0', '']).default('false'),
  /** Адрес сервиса, который Render подставляет сам — используется, если PUBLIC_ORIGIN не задан */
  RENDER_EXTERNAL_URL: z.string().optional(),
  /** Отправитель писем: «Имя <адрес>» */
  MAIL_FROM: z.string().default('Sunnet <no-reply@sunnet.local>'),
  /** Почта через HTTPS-API (работает и там, где SMTP-порты закрыты, например на бесплатном Render) */
  BREVO_API_KEY: z.string().optional(),
  RESEND_API_KEY: z.string().optional(),
  /**
   * Или через свой Gmail без сторонних сервисов: Google Apps Script (docs/gmail-mailer.gs),
   * развёрнутый как веб-приложение. Адрес /exec и общий секрет из скрипта.
   */
  MAIL_SCRIPT_URL: z.string().default(''),
  MAIL_SCRIPT_SECRET: z.string().default(''),
  /** Или через SMTP: smtps://логин:пароль@smtp.example.com:465 */
  SMTP_URL: z.string().optional(),
  /** Звонки: STUN-серверы (через запятую) и TURN для сложных сетей (мобильный интернет, корпоративный NAT) */
  STUN_URLS: z.string().default('stun:stun.l.google.com:19302,stun:stun.cloudflare.com:3478'),
  TURN_URLS: z.string().default(''),
  TURN_USERNAME: z.string().default(''),
  TURN_CREDENTIAL: z.string().default(''),
  /** TURN от Cloudflare (бесплатно): временные логин и пароль выдаются по ключу на каждый звонок */
  CF_TURN_KEY_ID: z.string().default(''),
  CF_TURN_API_TOKEN: z.string().default(''),
  /** TURN от Metered: полная ссылка вида https://<app>.metered.live/api/v1/turn/credentials?apiKey=… */
  METERED_TURN_URL: z.string().default(''),
  /**
   * Внешнее S3-совместимое хранилище (Backblaze B2, Cloudflare R2, Yandex Object Storage…):
   * копия базы и загруженные файлы переживают перезапуск на хостинге с временным диском.
   */
  S3_ENDPOINT: z.string().default(''),
  S3_BUCKET: z.string().default(''),
  S3_ACCESS_KEY_ID: z.string().default(''),
  S3_SECRET_ACCESS_KEY: z.string().default(''),
  /** Регион; если не задан — определяется по адресу хранилища */
  S3_REGION: z.string().default(''),
  /** Папка внутри бакета */
  S3_PREFIX: z.string().default('spaceup'),
  /** Шифрование копий базы и файлов в хранилище ключом из APP_SECRET (on — по умолчанию) */
  S3_ENCRYPTION: z.enum(['on', 'off']).default('on'),
  /** Как часто проверять изменения базы и отправлять копию (секунды) */
  BACKUP_INTERVAL_SEC: z.coerce.number().int().min(5).max(3600).default(60),
});

export type Config = ReturnType<typeof loadConfig>;

/**
 * Способ доставки писем: HTTPS-API (Brevo/Resend), SMTP, тестовый ящик в разработке
 * или «выключено» (production без настроек — письма не отправляются).
 */
export type MailProvider = 'brevo' | 'resend' | 'gmail' | 'smtp' | 'dev' | 'disabled';

function loadDotEnv(file: string) {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!m || line.trimStart().startsWith('#')) continue;
    const [, key, raw] = m;
    if (key && process.env[key] === undefined) {
      process.env[key] = (raw ?? '').replace(/^(['"])(.*)\1$/, '$2');
    }
  }
}

export function loadConfig(overrides: Partial<Record<keyof z.infer<typeof envSchema>, string>> = {}) {
  loadDotEnv(path.resolve(process.cwd(), '.env'));
  const env = envSchema.parse({ ...process.env, ...overrides });
  const dataDir = path.resolve(env.DATA_DIR);
  mkdirSync(path.join(dataDir, 'uploads'), { recursive: true });

  let secret = env.APP_SECRET;
  if (!secret || secret.startsWith('change-me')) {
    if (env.NODE_ENV === 'production') {
      throw new Error('APP_SECRET обязателен в production (минимум 32 символа, например `openssl rand -base64 48`)');
    }
    // В разработке генерируем и сохраняем секрет, чтобы сессии переживали перезапуск.
    const file = path.join(dataDir, '.dev-secret');
    if (!existsSync(file)) writeFileSync(file, randomBytes(48).toString('base64'), { mode: 0o600 });
    secret = readFileSync(file, 'utf8').trim();
  }
  if (secret.length < 32) throw new Error('APP_SECRET должен быть не короче 32 символов');

  const publicOrigin = (env.PUBLIC_ORIGIN || env.RENDER_EXTERNAL_URL || 'http://localhost:5173').replace(/\/$/, '');
  const origins = [publicOrigin, ...env.EXTRA_ORIGINS.split(',')]
    .map((o) => o.trim().replace(/\/$/, ''))
    .filter(Boolean);
  const isProd = env.NODE_ENV === 'production';
  const s3Vars = [env.S3_ENDPOINT, env.S3_BUCKET, env.S3_ACCESS_KEY_ID, env.S3_SECRET_ACCESS_KEY];
  // Наполовину заполненные настройки — почти наверняка опечатка: молча работать без копии нельзя
  if (s3Vars.some(Boolean) && !s3Vars.every(Boolean)) {
    throw new Error('Хранилище: задайте все четыре переменные — S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY');
  }
  const endpoint = env.S3_ENDPOINT.trim().replace(/\/+$/, '');
  const storage: S3Options | null = s3Vars.every(Boolean)
    ? {
        endpoint: /^https?:\/\//.test(endpoint) ? endpoint : `https://${endpoint}`,
        region: env.S3_REGION || regionFromEndpoint(endpoint),
        bucket: env.S3_BUCKET.trim(),
        accessKeyId: env.S3_ACCESS_KEY_ID.trim(),
        secretAccessKey: env.S3_SECRET_ACCESS_KEY.trim(),
        prefix: env.S3_PREFIX.trim().replace(/^\/+|\/+$/g, ''),
        // Ключ есть только у сервера: даже с доступом к бакету данные не прочитать
        encryptionKey: env.S3_ENCRYPTION === 'on' ? storageKey(secret) : undefined,
      }
    : null;
  // Частые ошибки настройки — понятным текстом, а не «Malformed Access Key Id» от хранилища
  if (storage && !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(storage.bucket)) {
    throw new Error(`S3_BUCKET «${storage.bucket}»: по S3 имя бакета — только строчные латинские буквы, цифры, точки и дефисы (3–63 символа). Создайте бакет с таким именем`);
  }
  if (storage?.endpoint.includes('backblazeb2.com') && (/^[0-9a-f]{12}$/.test(storage.accessKeyId) || /^[0-9a-f]{40,}$/.test(storage.secretAccessKey))) {
    throw new Error('S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY: это главный ключ Backblaze (Master Application Key), по S3 он не работает. Создайте ключ: Application Keys → Add a New Application Key (keyID — около 25 символов, applicationKey начинается с K00)');
  }
  const scriptUrl = env.MAIL_SCRIPT_URL.trim();
  if (scriptUrl && !/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(scriptUrl)) {
    throw new Error('MAIL_SCRIPT_URL: нужен адрес веб-приложения Google Apps Script вида https://script.google.com/macros/s/…/exec');
  }
  if (scriptUrl && env.MAIL_SCRIPT_SECRET.trim().length < 16) {
    throw new Error('MAIL_SCRIPT_SECRET: задайте тот же секрет, что в скрипте (не короче 16 символов)');
  }
  const from = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(env.MAIL_FROM);
  const mail = {
    fromName: from?.[1] || 'Sunnet',
    fromEmail: (from?.[2] ?? env.MAIL_FROM).trim(),
    provider: (env.BREVO_API_KEY
      ? 'brevo'
      : env.RESEND_API_KEY
        ? 'resend'
        : scriptUrl
          ? 'gmail'
          : env.SMTP_URL
            ? 'smtp'
            : isProd
              ? 'disabled'
              : 'dev') as MailProvider,
    brevoApiKey: env.BREVO_API_KEY ?? null,
    resendApiKey: env.RESEND_API_KEY ?? null,
    smtpUrl: env.SMTP_URL ?? null,
    script: scriptUrl ? { url: scriptUrl, secret: env.MAIL_SCRIPT_SECRET.trim() } : null,
  };

  return {
    env: env.NODE_ENV,
    isProd,
    isTest: env.NODE_ENV === 'test',
    host: env.HOST,
    port: env.PORT,
    secret,
    publicOrigin,
    allowedOrigins: new Set(origins),
    dataDir,
    dbFile: env.NODE_ENV === 'test' ? ':memory:' : path.join(dataDir, 'omni.db'),
    uploadsDir: path.join(dataDir, 'uploads'),
    limits: {
      imageBytes: env.MAX_IMAGE_MB * 1024 * 1024,
      videoBytes: env.MAX_VIDEO_MB * 1024 * 1024,
      fileBytes: env.MAX_FILE_MB * 1024 * 1024,
    },
    logLevel: env.LOG_LEVEL,
    trustProxy: env.TRUST_PROXY,
    // В production по умолчанию раздаём собранный клиент из apps/web/dist (один origin)
    webDist: env.WEB_DIST ? path.resolve(env.WEB_DIST) : isProd && existsSync(path.resolve('../web/dist')) ? path.resolve('../web/dist') : null,
    sessionTtlMs: env.SESSION_DAYS * 24 * 3600 * 1000,
    /** Cookies с флагом Secure — в production всегда (нужен HTTPS) */
    secureCookies: isProd,
    demoSeed: env.DEMO_SEED === 'true' || env.DEMO_SEED === '1',
    mail,
    iceServers: [
      { urls: env.STUN_URLS.split(',').map((u) => u.trim()).filter(Boolean) },
      ...(env.TURN_URLS
        ? [{ urls: env.TURN_URLS.split(',').map((u) => u.trim()).filter(Boolean), username: env.TURN_USERNAME, credential: env.TURN_CREDENTIAL }]
        : []),
    ] as { urls: string[]; username?: string; credential?: string }[],
    turn: {
      cloudflare: env.CF_TURN_KEY_ID && env.CF_TURN_API_TOKEN ? { keyId: env.CF_TURN_KEY_ID, token: env.CF_TURN_API_TOKEN } : null,
      meteredUrl: env.METERED_TURN_URL || null,
    },
    storage,
    backupIntervalMs: env.BACKUP_INTERVAL_SEC * 1000,
  };
}
