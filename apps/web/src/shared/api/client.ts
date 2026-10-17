/**
 * HTTP-клиент API. Cookie сеанса — httpOnly (JS её не видит), CSRF-токен берётся
 * из отдельной cookie и отправляется заголовком. Ошибки приводятся к ApiError
 * с машиночитаемым кодом.
 */
import { API_PREFIX, ERROR_MESSAGES, type ApiErrorBody, type ErrorCode, type MediaItem } from '@omni/shared';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode | 'NETWORK_ERROR',
    message: string,
    readonly fields?: Record<string, string>,
    readonly retryAfter?: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

const CSRF_COOKIE = 'omni_csrf';

function readCookie(name: string): string | undefined {
  return document.cookie
    .split('; ')
    .find((c) => c.startsWith(`${name}=`))
    ?.slice(name.length + 1);
}

type UnauthorizedListener = () => void;
const unauthorizedListeners = new Set<UnauthorizedListener>();
export function onUnauthorized(fn: UnauthorizedListener): () => void {
  unauthorizedListeners.add(fn);
  return () => unauthorizedListeners.delete(fn);
}

async function refreshCsrf(): Promise<void> {
  await fetch(`${API_PREFIX}/auth/session`, { credentials: 'same-origin' });
}

async function toError(res: Response): Promise<ApiError> {
  let body: ApiErrorBody | null = null;
  try {
    body = (await res.json()) as ApiErrorBody;
  } catch {
    /* не JSON */
  }
  const code = body?.error?.code ?? 'INTERNAL_ERROR';
  return new ApiError(res.status, code, body?.error?.message ?? ERROR_MESSAGES[code as ErrorCode] ?? 'Ошибка', body?.error?.fields, body?.error?.retryAfter);
}

export async function request<T>(method: string, path: string, body?: unknown, retried = false): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (method !== 'GET') {
    if (!readCookie(CSRF_COOKIE)) await refreshCsrf();
    const token = readCookie(CSRF_COOKIE);
    if (token) headers['X-CSRF-Token'] = token;
  }
  let res: Response;
  try {
    res = await fetch(`${API_PREFIX}${path}`, {
      method,
      headers,
      credentials: 'same-origin',
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', 'Нет соединения с сервером');
  }
  if (!res.ok) {
    const err = await toError(res);
    // Токен CSRF устарел (например, после входа в другой вкладке) — обновляем и повторяем один раз
    if (err.code === 'CSRF_FAILED' && !retried) {
      await refreshCsrf();
      return request<T>(method, path, body, true);
    }
    if (err.status === 401 && !path.startsWith('/auth/')) unauthorizedListeners.forEach((fn) => fn());
    throw err;
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body: unknown = {}) => request<T>('POST', path, body),
  patch: <T>(path: string, body: unknown = {}) => request<T>('PATCH', path, body),
  put: <T>(path: string, body: unknown = {}) => request<T>('PUT', path, body),
  del: <T>(path: string) => request<T>('DELETE', path),
};

export interface UploadOptions {
  width?: number;
  height?: number;
  duration?: number;
  posterId?: string;
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
}

/** Загрузка файла с прогрессом (XMLHttpRequest — fetch пока не умеет прогресс отправки). */
export function uploadFile(file: Blob, filename: string, opts: UploadOptions = {}): Promise<MediaItem> {
  return new Promise((resolve, reject) => {
    const run = async () => {
      if (!readCookie(CSRF_COOKIE)) await refreshCsrf();
      const params = new URLSearchParams();
      if (opts.width) params.set('width', String(Math.round(opts.width)));
      if (opts.height) params.set('height', String(Math.round(opts.height)));
      if (opts.duration) params.set('duration', String(opts.duration));
      if (opts.posterId) params.set('posterId', opts.posterId);
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${API_PREFIX}/media?${params.toString()}`);
      xhr.withCredentials = true;
      xhr.setRequestHeader('X-CSRF-Token', readCookie(CSRF_COOKIE) ?? '');
      xhr.setRequestHeader('Accept', 'application/json');
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) opts.onProgress?.(e.loaded / e.total);
      };
      xhr.onload = () => {
        let body: unknown = null;
        try {
          body = JSON.parse(xhr.responseText);
        } catch {
          /* ignore */
        }
        if (xhr.status >= 200 && xhr.status < 300) resolve(body as MediaItem);
        else {
          const e = (body as ApiErrorBody | null)?.error;
          reject(new ApiError(xhr.status, e?.code ?? 'INTERNAL_ERROR', e?.message ?? 'Не удалось загрузить файл'));
        }
      };
      xhr.onerror = () => reject(new ApiError(0, 'NETWORK_ERROR', 'Нет соединения с сервером'));
      opts.signal?.addEventListener('abort', () => xhr.abort());
      const form = new FormData();
      form.append('file', file, filename);
      xhr.send(form);
    };
    run().catch(reject);
  });
}

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.retryAfter && (err.code === 'ACCOUNT_LOCKED' || err.code === 'RATE_LIMITED') && !err.message.includes('через')) {
      const min = Math.ceil(err.retryAfter / 60);
      return `${err.message}. Повторите через ${min} мин.`;
    }
    return err.message;
  }
  return 'Что-то пошло не так';
}
