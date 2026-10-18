/**
 * Минимальный клиент S3-совместимого хранилища (Backblaze B2, Cloudflare R2,
 * Yandex Object Storage, AWS S3, MinIO): PUT, GET и HEAD объектов с подписью
 * AWS Signature V4. Без SDK — только node:crypto и node:http(s); файлы
 * передаются потоком, поэтому большие видео не занимают память.
 */
import { createHash, createHmac } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { rename, rm, stat } from 'node:fs/promises';
import http from 'node:http';
import https from 'node:https';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export interface S3Options {
  /** https://s3.eu-central-003.backblazeb2.com, https://<account>.r2.cloudflarestorage.com … */
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Папка внутри бакета: в одном бакете могут жить несколько копий приложения */
  prefix: string;
}

export class S3Error extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const sha256hex = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');
const hmac = (key: Buffer | string, data: string) => createHmac('sha256', key).update(data).digest();

/** Кодирование по RFC 3986, как требует подпись V4 («/» в ключе объекта сохраняется). */
export function encodeKey(key: string): string {
  return key
    .split('/')
    .map((s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`))
    .join('/');
}

/** Регион по адресу хранилища: у B2 и AWS он в имени хоста, у R2 — всегда «auto». */
export function regionFromEndpoint(endpoint: string): string {
  const host = endpoint.replace(/^https?:\/\//, '');
  if (host.includes('r2.cloudflarestorage.com')) return 'auto';
  if (host.includes('storage.yandexcloud.net')) return 'ru-central1';
  const m = /^s3[.-]([a-z0-9-]+)\.(?:backblazeb2|amazonaws)\.com/.exec(host);
  return m?.[1] ?? 'us-east-1';
}

/**
 * Подпись запроса AWS Signature V4. Возвращает заголовки, которые нужно добавить
 * к запросу (x-amz-date, x-amz-content-sha256, authorization).
 */
export function signV4(input: {
  method: string;
  url: URL;
  headers: Record<string, string>;
  payloadHash: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  date?: Date;
}): Record<string, string> {
  const amzDate = (input.date ?? new Date()).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const day = amzDate.slice(0, 8);
  const headers: Record<string, string> = {
    ...Object.fromEntries(Object.entries(input.headers).map(([k, v]) => [k.toLowerCase(), v.trim().replace(/\s+/g, ' ')])),
    host: input.url.host,
    'x-amz-content-sha256': input.payloadHash,
    'x-amz-date': amzDate,
  };
  const names = Object.keys(headers).sort();
  const query = [...input.url.searchParams]
    .map(([k, v]) => [encodeKey(k).replaceAll('/', '%2F'), encodeKey(v).replaceAll('/', '%2F')] as const)
    .sort(([a, x], [b, y]) => (a === b ? (x < y ? -1 : 1) : a < b ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');
  const canonical = [
    input.method,
    input.url.pathname,
    query,
    names.map((n) => `${n}:${headers[n]}\n`).join(''),
    names.join(';'),
    input.payloadHash,
  ].join('\n');
  const scope = `${day}/${input.region}/s3/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256hex(canonical)].join('\n');
  const key = hmac(hmac(hmac(hmac(`AWS4${input.secretAccessKey}`, day), input.region), 's3'), 'aws4_request');
  const signature = createHmac('sha256', key).update(toSign).digest('hex');
  return {
    'x-amz-date': amzDate,
    'x-amz-content-sha256': input.payloadHash,
    authorization: `AWS4-HMAC-SHA256 Credential=${input.accessKeyId}/${scope}, SignedHeaders=${names.join(';')}, Signature=${signature}`,
  };
}

const EMPTY_HASH = sha256hex('');
const ATTEMPTS = 3;
const IDLE_TIMEOUT_MS = 60_000;

type Body = { buffer: Buffer } | { file: string; size: number };

export class S3Storage {
  readonly label: string;

  constructor(private readonly opts: S3Options) {
    this.label = `${new URL(opts.endpoint).host}/${opts.bucket}${opts.prefix ? `/${opts.prefix}` : ''}`;
  }

  private full(key: string): string {
    return this.opts.prefix ? `${this.opts.prefix}/${key}` : key;
  }

  /** Адрес в стиле path-style: так работают и B2, и R2, и MinIO. Ключ — уже с папкой. */
  private url(fullKey: string | null, query: Record<string, string> = {}): URL {
    const url = new URL(`${this.opts.endpoint}/${encodeKey(this.opts.bucket)}${fullKey === null ? '' : `/${encodeKey(fullKey)}`}`);
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
    return url;
  }

  /** Один запрос без повторов: ответ отдаётся как есть, тело читает вызывающий. */
  private send(method: string, url: URL, body: Body | null, payloadHash: string, contentType?: string): Promise<http.IncomingMessage> {
    const size = !body ? 0 : 'buffer' in body ? body.buffer.length : body.size;
    const base: Record<string, string> = contentType ? { 'content-type': contentType } : {};
    const headers = {
      ...base,
      ...signV4({ method, url, headers: base, payloadHash, region: this.opts.region, accessKeyId: this.opts.accessKeyId, secretAccessKey: this.opts.secretAccessKey }),
      ...(method === 'PUT' ? { 'content-length': String(size) } : {}),
    };
    const lib = url.protocol === 'http:' ? http : https;
    return new Promise((resolve, reject) => {
      const req = lib.request(url, { method, headers }, resolve);
      req.setTimeout(IDLE_TIMEOUT_MS, () => req.destroy(new Error(`S3: нет ответа ${IDLE_TIMEOUT_MS / 1000} с`)));
      req.on('error', reject);
      if (!body) return req.end();
      if ('buffer' in body) return req.end(body.buffer);
      const src = createReadStream(body.file);
      src.on('error', (e) => req.destroy(e));
      src.pipe(req);
    });
  }

  /** Повторяем при сетевых сбоях, 429 и 5xx — с паузой 0,5 с, затем 2 с. */
  private async request(method: string, url: URL, body: Body | null, payloadHash: string, contentType?: string): Promise<http.IncomingMessage> {
    for (let attempt = 1; ; attempt++) {
      try {
        const res = await this.send(method, url, body, payloadHash, contentType);
        const status = res.statusCode ?? 0;
        if ((status === 429 || status === 500 || status === 502 || status === 503 || status === 504) && attempt < ATTEMPTS) {
          res.resume();
          await new Promise((r) => setTimeout(r, attempt === 1 ? 500 : 2000));
          continue;
        }
        return res;
      } catch (err) {
        if (attempt >= ATTEMPTS) throw err;
        await new Promise((r) => setTimeout(r, attempt === 1 ? 500 : 2000));
      }
    }
  }

  private async fail(res: http.IncomingMessage, what: string): Promise<never> {
    let text = '';
    for await (const chunk of res as Readable) {
      if (text.length < 4096) text += String(chunk);
    }
    const code = /<Code>([^<]+)<\/Code>/.exec(text)?.[1] ?? `HTTP ${res.statusCode}`;
    const message = /<Message>([^<]+)<\/Message>/.exec(text)?.[1] ?? '';
    throw new S3Error(res.statusCode ?? 0, code, `S3 ${what}: ${code}${message ? ` — ${message}` : ''}`);
  }

  /** Загружает буфер или файл. Для файла можно передать заранее посчитанный SHA-256. */
  async put(key: string, data: Buffer | { file: string; sha256?: string }, contentType = 'application/octet-stream'): Promise<void> {
    let body: Body;
    let hash: string;
    if (Buffer.isBuffer(data)) {
      body = { buffer: data };
      hash = sha256hex(data);
    } else {
      body = { file: data.file, size: (await stat(data.file)).size };
      hash = data.sha256 ?? (await fileSha256(data.file));
    }
    const res = await this.request('PUT', this.url(this.full(key)), body, hash, contentType);
    if (res.statusCode !== 200) return this.fail(res, `PUT ${key}`);
    res.resume();
  }

  /** Скачивает объект в файл (атомарно, через временное имя). false — объекта нет. */
  async download(key: string, dest: string): Promise<boolean> {
    const res = await this.request('GET', this.url(this.full(key)), null, EMPTY_HASH);
    if (res.statusCode === 404) {
      let text = '';
      for await (const chunk of res as Readable) text += String(chunk);
      // «Нет файла» — нормально, а «нет бакета» — ошибка настройки, а не пустое хранилище
      if (text.includes('<Code>NoSuchBucket</Code>')) throw new S3Error(404, 'NoSuchBucket', `S3 GET ${key}: NoSuchBucket — бакета «${this.opts.bucket}» нет, проверьте S3_BUCKET`);
      return false;
    }
    if (res.statusCode !== 200) return this.fail(res, `GET ${key}`);
    const tmp = `${dest}.${process.pid}.part`;
    try {
      await pipeline(res, createWriteStream(tmp, { mode: 0o600 }));
      await rename(tmp, dest);
    } catch (err) {
      await rm(tmp, { force: true });
      throw err;
    }
    return true;
  }

  async exists(key: string): Promise<boolean> {
    const res = await this.request('HEAD', this.url(this.full(key)), null, EMPTY_HASH);
    res.resume();
    if (res.statusCode === 404) return false;
    if (res.statusCode !== 200) throw new S3Error(res.statusCode ?? 0, `HTTP ${res.statusCode}`, `S3 HEAD ${key}: HTTP ${res.statusCode}`);
    return true;
  }

  /**
   * Удаляет прежние версии объектов в папке. Хранилища с версионированием
   * (Backblaze B2 — всегда) берегут каждую перезапись, и частые копии базы
   * быстро съели бы бесплатный объём. Возвращает число удалённых версий.
   */
  async deleteOldVersions(prefix: string): Promise<number> {
    const res = await this.request('GET', this.url(null, { versions: '', prefix: this.full(prefix) }), null, EMPTY_HASH);
    if (res.statusCode !== 200) return this.fail(res, `LIST versions ${prefix}`);
    let xml = '';
    for await (const chunk of res as Readable) xml += String(chunk);
    const tag = (block: string, name: string) => new RegExp(`<${name}>([^<]*)</${name}>`).exec(block)?.[1];
    const old = [...xml.matchAll(/<(Version|DeleteMarker)>([\s\S]*?)<\/\1>/g)]
      .map((m) => ({ key: tag(m[2]!, 'Key'), versionId: tag(m[2]!, 'VersionId'), latest: tag(m[2]!, 'IsLatest') === 'true' }))
      .filter((v): v is { key: string; versionId: string; latest: false } => !v.latest && !!v.key && !!v.versionId && v.versionId !== 'null');
    let deleted = 0;
    for (const v of old) {
      const key = unescapeXml(v.key);
      const del = await this.request('DELETE', this.url(key, { versionId: unescapeXml(v.versionId) }), null, EMPTY_HASH);
      del.resume();
      if (del.statusCode === 204 || del.statusCode === 200) deleted++;
    }
    return deleted;
  }
}

function unescapeXml(s: string): string {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
}

async function fileSha256(file: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}
