import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';

export const ORIGIN = 'http://localhost:5173';

export async function createTestApp(): Promise<FastifyInstance> {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'omni-test-'));
  const config = loadConfig({
    NODE_ENV: 'test',
    DATA_DIR: dataDir,
    APP_SECRET: 'test-secret-test-secret-test-secret-0123456789',
    PUBLIC_ORIGIN: ORIGIN,
  });
  const app = await buildApp(config);
  await app.ready();
  return app;
}

interface Res<T = any> {
  status: number;
  body: T;
  headers: Record<string, unknown>;
}

/** HTTP-клиент для тестов: хранит cookies, сам подставляет Origin и CSRF-токен. */
export class Client {
  cookies = new Map<string, string>();
  origin = ORIGIN;
  sendCsrf = true;
  /** У каждого клиента свой IP — как у реальных пользователей (лимиты считаются по IP) */
  ip = `10.${(Math.random() * 255) | 0}.${(Math.random() * 255) | 0}.${(Math.random() * 254 + 1) | 0}`;

  constructor(private readonly app: FastifyInstance) {}

  async request<T = any>(method: string, url: string, body?: unknown, extraHeaders: Record<string, string> = {}): Promise<Res<T>> {
    if (method !== 'GET' && this.sendCsrf && !this.cookies.has('omni_csrf')) await this.request('GET', '/api/v1/auth/session');
    const headers: Record<string, string> = { origin: this.origin, 'user-agent': 'vitest Chrome/120 Windows', ...extraHeaders };
    if (this.cookies.size) headers.cookie = [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
    if (this.sendCsrf && this.cookies.has('omni_csrf')) headers['x-csrf-token'] = this.cookies.get('omni_csrf')!;
    const isBuffer = Buffer.isBuffer(body);
    const res = await this.app.inject({
      method: method as 'GET',
      url,
      remoteAddress: this.ip,
      headers: body !== undefined && !isBuffer ? { ...headers, 'content-type': 'application/json' } : headers,
      payload: body === undefined ? undefined : isBuffer ? body : JSON.stringify(body),
    });
    const setCookie = res.headers['set-cookie'];
    for (const c of Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : []) {
      const [pair] = c.split(';');
      const [k, ...v] = pair!.split('=');
      const value = v.join('=');
      if (!value || /Expires=Thu, 01 Jan 1970/i.test(c)) this.cookies.delete(k!);
      else this.cookies.set(k!, value);
    }
    let parsed: unknown = res.body;
    try {
      parsed = JSON.parse(res.body);
    } catch {
      /* not json */
    }
    return { status: res.statusCode, body: parsed as T, headers: res.headers };
  }

  get = <T = any>(url: string) => this.request<T>('GET', `/api/v1${url}`);
  post = <T = any>(url: string, body: unknown = {}) => this.request<T>('POST', `/api/v1${url}`, body);
  patch = <T = any>(url: string, body: unknown = {}) => this.request<T>('PATCH', `/api/v1${url}`, body);
  put = <T = any>(url: string, body: unknown = {}) => this.request<T>('PUT', `/api/v1${url}`, body);
  del = <T = any>(url: string) => this.request<T>('DELETE', `/api/v1${url}`);

  async upload(file: Buffer, filename: string, query = '') {
    const boundary = '----omni' + Math.random().toString(16).slice(2);
    const payload = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`),
      file,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    return this.request('POST', `/api/v1/media${query}`, payload, { 'content-type': `multipart/form-data; boundary=${boundary}` });
  }
}

let counter = 0;
let phones = 0;
/** Уникальный номер для тестов: +7 999 xxx-xx-xx */
export const testPhone = () => `+7999${String(Date.now() % 1000).padStart(3, '0')}${String(phones++).padStart(4, '0')}`;
export async function registerUser(app: FastifyInstance, name?: string) {
  const client = new Client(app);
  const username = name ?? `user_${Date.now().toString(36)}_${counter++}`;
  const res = await client.post('/auth/register', { username, displayName: `Тест ${username}`, email: `${username}@example.com`, phone: testPhone(), password: 'correct-horse-battery-staple' });
  if (res.status !== 201) throw new Error(`register failed: ${JSON.stringify(res.body)}`);
  return { client, user: res.body.me as { id: string; username: string }, password: 'correct-horse-battery-staple' };
}

/** Минимальный валидный PNG 1×1. */
export const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);
