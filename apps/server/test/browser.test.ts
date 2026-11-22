import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { isPrivateAddress, safeGet } from '../src/modules/browser/browser.routes.js';
import { Client, createTestApp, registerUser } from './helpers.js';

let app: FastifyInstance;
beforeAll(async () => {
  app = await createTestApp();
});
afterAll(async () => {
  await app.close();
});

describe('браузер: защита загрузок от SSRF', () => {
  it('распознаёт внутренние адреса', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '192.168.0.10', '172.20.1.1', '169.254.169.254', '100.64.0.1', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1', '0.0.0.0']) expect(isPrivateAddress(ip)).toBe(true);
    for (const ip of ['8.8.8.8', '93.184.216.34', '2a00:1450:4010::64']) expect(isPrivateAddress(ip)).toBe(false);
  });

  it('проверяет адрес в момент соединения (защита от DNS rebinding)', async () => {
    await expect(safeGet(new URL('https://localhost/secret'))).rejects.toThrow('PRIVATE_ADDRESS');
  });

  it('не скачивает по http, во внутреннюю сеть, с паролем в ссылке и на чужой порт', async () => {
    const { client } = await registerUser(app);
    for (const url of ['http://example.com/a.pdf', 'https://127.0.0.1/a.pdf', 'https://169.254.169.254/latest/meta-data', 'https://[::1]/x', 'https://user:pw@example.com/a.pdf', 'https://example.com:8443/a.pdf', 'file:///etc/passwd', 'https://localhost/a.pdf']) {
      const r = await client.post('/browser/download', { url });
      expect(r.status, url).toBe(400);
    }
  });

  it('поиск работает только после входа и отдаёт результаты Sunnet', async () => {
    expect((await new Client(app).get('/browser/search?q=sunnet')).status).toBe(401);
    const { client } = await registerUser(app);
    const r = await client.get('/browser/search?q=тест');
    expect(r.status).toBe(200);
    expect(r.body.sunnet).toHaveProperty('users');
  });
});
