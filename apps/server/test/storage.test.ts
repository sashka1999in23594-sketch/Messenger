import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { checkWrite, DbBackup, DB_KEY, restoreDb } from '../src/db/backup.js';
import { Db } from '../src/db/index.js';
import { regionFromEndpoint, S3Storage, signV4 } from '../src/lib/s3.js';
import { storageKey } from '../src/lib/sealed.js';
import { createTestApp, PNG_1x1, registerUser } from './helpers.js';

/** Поддельное S3-хранилище в памяти: проверяет подпись по форме и хэш содержимого. */
function fakeS3() {
  const objects = new Map<string, Buffer>();
  const state = { failPut: false, deny: false };
  /** Как в B2: у перезаписанного объекта остаются прежние версии */
  const deletedVersions: string[] = [];
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const key = decodeURIComponent(req.url!.slice(1));
      const auth = req.headers.authorization ?? '';
      if (state.deny || !auth.startsWith('AWS4-HMAC-SHA256 Credential=test-key/')) {
        res.writeHead(403).end('<Error><Code>AccessDenied</Code><Message>bad key</Message></Error>');
        return;
      }
      if (req.method === 'GET' && req.url!.includes('?versions')) {
        const prefix = new URL(req.url!, 'http://x').searchParams.get('prefix');
        return void res.writeHead(200).end(
          `<ListVersionsResult><Version><Key>${prefix}latest.db.gz</Key><VersionId>v2</VersionId><IsLatest>true</IsLatest></Version>` +
            `<Version><Key>${prefix}latest.db.gz</Key><VersionId>v1</VersionId><IsLatest>false</IsLatest></Version></ListVersionsResult>`,
        );
      }
      if (req.method === 'DELETE') {
        deletedVersions.push(req.url!);
        return void res.writeHead(204).end();
      }
      if (req.method === 'PUT') {
        const body = Buffer.concat(chunks);
        if (state.failPut) return void res.writeHead(400).end('<Error><Code>BadRequest</Code></Error>');
        if (createHash('sha256').update(body).digest('hex') !== req.headers['x-amz-content-sha256']) {
          return void res.writeHead(400).end('<Error><Code>XAmzContentSHA256Mismatch</Code></Error>');
        }
        objects.set(key, body);
        return void res.writeHead(200).end();
      }
      const obj = objects.get(key);
      if (key.startsWith('missing-bucket/')) return void res.writeHead(404).end('<Error><Code>NoSuchBucket</Code></Error>');
      if (!obj) return void res.writeHead(404).end('<Error><Code>NoSuchKey</Code></Error>');
      res.writeHead(200, { 'content-length': obj.length });
      res.end(req.method === 'HEAD' ? undefined : obj);
    });
  });
  return { server, objects, state, deletedVersions };
}

const s3 = fakeS3();
let endpoint = '';
const storageOpts = () => ({ endpoint, region: 'auto', bucket: 'bucket', accessKeyId: 'test-key', secretAccessKey: 'secret', prefix: 'spaceup' });
const silent = { info: () => undefined, warn: () => undefined, error: () => undefined };
const dirs: string[] = [];
const tempDir = () => {
  const d = mkdtempSync(path.join(tmpdir(), 'omni-storage-'));
  dirs.push(d);
  return d;
};

beforeAll(async () => {
  await new Promise<void>((r) => s3.server.listen(0, '127.0.0.1', r));
  endpoint = `http://127.0.0.1:${(s3.server.address() as AddressInfo).port}`;
});
afterAll(() => {
  s3.server.close();
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

describe('подпись S3', () => {
  it('совпадает с примером из документации AWS (GET Object)', () => {
    const h = signV4({
      method: 'GET',
      url: new URL('https://examplebucket.s3.amazonaws.com/test.txt'),
      headers: { Range: 'bytes=0-9' },
      payloadHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      region: 'us-east-1',
      accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
      secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      date: new Date('2013-05-24T00:00:00Z'),
    });
    expect(h.authorization).toBe(
      'AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41',
    );
  });

  it('регион определяется по адресу хранилища', () => {
    expect(regionFromEndpoint('https://s3.eu-central-003.backblazeb2.com')).toBe('eu-central-003');
    expect(regionFromEndpoint('https://abc.r2.cloudflarestorage.com')).toBe('auto');
    expect(regionFromEndpoint('https://storage.yandexcloud.net')).toBe('ru-central1');
    expect(regionFromEndpoint('https://s3.eu-west-1.amazonaws.com')).toBe('eu-west-1');
  });
});

describe('шифрование хранилища', () => {
  const key = storageKey('test-secret-test-secret-test-secret-42');
  const sealedStorage = () => new S3Storage({ ...storageOpts(), prefix: 'sealed', encryptionKey: key });

  it('в хранилище только шифротекст, а скачивается исходный файл', async () => {
    const storage = sealedStorage();
    const secretText = 'Привет! Это личное сообщение, которое хранилище не должно видеть.';
    await storage.put('notes/a.txt', Buffer.from(secretText), 'text/plain');
    const dir = tempDir();
    const big = path.join(dir, 'video.bin');
    writeFileSync(big, Buffer.alloc(3 * 1024 * 1024 + 17, 7));
    await storage.put('media/video.bin', { file: big }, 'video/mp4');

    const stored = s3.objects.get('bucket/sealed/notes/a.txt')!;
    expect(stored.subarray(0, 4).toString()).toBe('SNE1');
    expect(stored.includes(Buffer.from('личное'))).toBe(false);
    expect(s3.objects.get('bucket/sealed/media/video.bin')!.length).toBe(3 * 1024 * 1024 + 17 + 4 + 12 + 16);

    const out = path.join(dir, 'a.txt');
    expect(await storage.download('notes/a.txt', out)).toBe(true);
    expect(readFileSync(out, 'utf8')).toBe(secretText);
    const outBig = path.join(dir, 'video.out');
    await storage.download('media/video.bin', outBig);
    expect(readFileSync(outBig).equals(readFileSync(big))).toBe(true);
  });

  it('старые незашифрованные объекты читаются, чужой ключ и подмена объекта — ошибка', async () => {
    const storage = sealedStorage();
    const dir = tempDir();
    // Объект, сохранённый до включения шифрования
    s3.objects.set('bucket/sealed/legacy.txt', Buffer.from('старая копия'));
    expect(await storage.download('legacy.txt', path.join(dir, 'legacy.txt'))).toBe(true);
    expect(readFileSync(path.join(dir, 'legacy.txt'), 'utf8')).toBe('старая копия');

    await storage.put('one.txt', Buffer.from('первый'));
    // Другой ключ (сменили APP_SECRET) — не расшифровать, файл не появляется
    const other = new S3Storage({ ...storageOpts(), prefix: 'sealed', encryptionKey: storageKey('another-secret-another-secret-12345') });
    await expect(other.download('one.txt', path.join(dir, 'x.txt'))).rejects.toThrow(/расшифровать/);
    expect(existsSync(path.join(dir, 'x.txt'))).toBe(false);
    // Подмена: шифротекст одного объекта под именем другого не проходит проверку
    s3.objects.set('bucket/sealed/two.txt', s3.objects.get('bucket/sealed/one.txt')!);
    await expect(storage.download('two.txt', path.join(dir, 'two.txt'))).rejects.toThrow(/расшифровать/);
    // Шифрование выключили, а объект зашифрован — понятная ошибка, а не мусор вместо файла
    const plain = new S3Storage({ ...storageOpts(), prefix: 'sealed' });
    await expect(plain.download('one.txt', path.join(dir, 'y.txt'))).rejects.toThrow(/S3_ENCRYPTION/);
  });

  it('копия базы шифруется и восстанавливается', async () => {
    const storage = sealedStorage();
    const dir = tempDir();
    const db = new Db(path.join(dir, 'a.db'));
    db.exec('CREATE TABLE notes (id INTEGER PRIMARY KEY, text TEXT)');
    db.run('INSERT INTO notes (text) VALUES (:t)', { t: 'секретная переписка' });
    await new DbBackup(db, storage, path.join(dir, 'backup'), silent, false).run();
    db.close();
    const stored = s3.objects.get(`bucket/sealed/${DB_KEY}`)!;
    expect(stored.subarray(0, 4).toString()).toBe('SNE1');
    const fresh = path.join(tempDir(), 'b.db');
    expect((await restoreDb(storage, fresh)).from).toBe('backup');
    const copy = new Db(fresh);
    expect(copy.all('SELECT text FROM notes')).toEqual([{ text: 'секретная переписка' }]);
    copy.close();
    s3.deletedVersions.length = 0;
  });
});

describe('копия базы', () => {
  it('отправляется только при изменениях и восстанавливается на чистом диске', async () => {
    const storage = new S3Storage(storageOpts());
    const dir = tempDir();
    const db = new Db(path.join(dir, 'a.db'));
    db.exec('CREATE TABLE notes (id INTEGER PRIMARY KEY, text TEXT)');
    db.run('INSERT INTO notes (text) VALUES (:t)', { t: 'первая' });
    const backup = new DbBackup(db, storage, path.join(dir, 'backup'), silent, false);

    expect(await backup.run()).toBe(true);
    expect(s3.objects.has(`bucket/spaceup/${DB_KEY}`)).toBe(true);
    // Прежняя версия копии удалена, последняя — нет
    expect(s3.deletedVersions).toEqual(['/bucket/spaceup/db/latest.db.gz?versionId=v1']);
    expect([...s3.objects.keys()].some((k) => /db\/day-\d\.db\.gz$/.test(k))).toBe(true);
    expect(await backup.run()).toBe(false);

    db.run('INSERT INTO notes (text) VALUES (:t)', { t: 'вторая' });
    expect(await backup.run()).toBe(true);
    db.close();

    const fresh = path.join(tempDir(), 'b.db');
    const r = await restoreDb(storage, fresh);
    expect(r.from).toBe('backup');
    const copy = new Db(fresh);
    expect(copy.all('SELECT text FROM notes ORDER BY id')).toEqual([{ text: 'первая' }, { text: 'вторая' }]);
    copy.close();

    // Локальная база уже есть — ничего не трогаем
    expect((await restoreDb(storage, fresh)).from).toBe('local');
  });

  it('несуществующий бакет и ключ без права записи — ошибка, а не «пустое хранилище»', async () => {
    const wrong = new S3Storage({ ...storageOpts(), bucket: 'missing-bucket' });
    await expect(restoreDb(wrong, path.join(tempDir(), 'e.db'))).rejects.toThrow(/NoSuchBucket/);
    s3.state.failPut = true;
    try {
      await expect(checkWrite(new S3Storage(storageOpts()))).rejects.toThrow(/S3 PUT/);
    } finally {
      s3.state.failPut = false;
    }
  });

  it('пустое хранилище — новая база; ошибка доступа — запуск останавливается', async () => {
    const empty = new S3Storage({ ...storageOpts(), prefix: 'other' });
    expect((await restoreDb(empty, path.join(tempDir(), 'c.db'))).from).toBe('empty');
    s3.state.deny = true;
    try {
      await expect(restoreDb(empty, path.join(tempDir(), 'd.db'))).rejects.toThrow(/AccessDenied/);
    } finally {
      s3.state.deny = false;
    }
  });
});

describe('файлы во внешнем хранилище', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = await createTestApp({ S3_ENDPOINT: endpoint, S3_BUCKET: 'bucket', S3_ACCESS_KEY_ID: 'test-key', S3_SECRET_ACCESS_KEY: 'secret', S3_PREFIX: 'files' });
  });
  afterAll(async () => {
    await app.close();
  });

  const waitFor = async (fn: () => boolean) => {
    for (let i = 0; i < 100 && !fn(); i++) await new Promise((r) => setTimeout(r, 20));
    return fn();
  };

  it('после загрузки файл копируется, а на чистом диске скачивается обратно', async () => {
    const { client } = await registerUser(app);
    const up = await client.upload(PNG_1x1, 'pixel.png');
    expect(up.status).toBe(201);
    const { media } = app.ctx.services;
    const { db } = app.ctx;
    const row = media.get(up.body.id)!;
    expect(await waitFor(() => s3.objects.has(`bucket/files/media/${row.storage_key}`))).toBe(true);
    expect(await waitFor(() => !!db.value('SELECT remote_at FROM media WHERE id = :id', { id: row.id }))).toBe(true);

    // Диск сервера стёрт (перезапуск на бесплатном хостинге)
    rmSync(media.filePath(row));
    const res = await app.inject({ method: 'GET', url: up.body.url });
    expect(res.statusCode).toBe(200);
    expect(res.rawPayload.equals(PNG_1x1)).toBe(true);
    expect(existsSync(media.filePath(row))).toBe(true);
  });

  it('если хранилище было недоступно, фоновая задача досылает файл', async () => {
    const { client } = await registerUser(app);
    s3.state.failPut = true;
    const up = await client.upload(PNG_1x1, 'later.png');
    const media = app.ctx.services.media;
    await new Promise((r) => setTimeout(r, 100));
    expect(app.ctx.db.value('SELECT remote_at FROM media WHERE id = :id', { id: up.body.id })).toBeNull();
    s3.state.failPut = false;
    expect(await media.syncPending()).toBeGreaterThanOrEqual(1);
    expect(app.ctx.db.value('SELECT remote_at FROM media WHERE id = :id', { id: up.body.id })).toBeGreaterThan(0);
  });

  it('частично заданные настройки хранилища — ошибка, а не тихая работа без копии', async () => {
    await expect(createTestApp({ S3_BUCKET: 'bucket' })).rejects.toThrow(/S3_ENDPOINT/);
    const b2 = { S3_ENDPOINT: 's3.eu-central-003.backblazeb2.com', S3_BUCKET: 'spaceup-data', S3_ACCESS_KEY_ID: '003a456fb99b83e0000000001', S3_SECRET_ACCESS_KEY: 'K003abcdefghijklmnopqrstuvwxyz0' };
    await expect(createTestApp({ ...b2, S3_BUCKET: 'Sunnet' })).rejects.toThrow(/строчные/);
    await expect(createTestApp({ ...b2, S3_ACCESS_KEY_ID: 'a456fb99b83e' })).rejects.toThrow(/главный ключ/);
  });
});
