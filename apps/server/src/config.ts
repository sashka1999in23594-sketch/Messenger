import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

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
});

export type Config = ReturnType<typeof loadConfig>;

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
  };
}
