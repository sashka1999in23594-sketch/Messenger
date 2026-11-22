import { createHmac } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SecretBox } from '../src/lib/crypto.js';
import { createTestApp, registerUser } from './helpers.js';

let app: FastifyInstance;
beforeAll(async () => {
  process.env.WHATSAPP_APP_SECRET = 'test-app-secret';
  app = await createTestApp();
});
afterAll(async () => {
  await app.close();
});

const hook = (body: unknown, secret = 'test-app-secret') => {
  const raw = JSON.stringify(body);
  return app.inject({
    method: 'POST',
    url: '/api/v1/bridge/whatsapp/webhook',
    headers: { 'content-type': 'application/json', 'x-hub-signature-256': `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}` },
    payload: raw,
  });
};

describe('подключённые мессенджеры', () => {
  it('без ключей Telegram сервер честно отвечает, что подключение не настроено', async () => {
    const { client } = await registerUser(app);
    const st = await client.get('/bridge/status');
    expect(st.body.telegram).toEqual({ available: false, connected: false, account: null });
    const r = await client.post('/bridge/telegram/start', { phone: '+79991234567' });
    expect(r.status).toBe(503);
  });

  it('вебхук WhatsApp без верной подписи отклоняется', async () => {
    expect((await hook({ entry: [] }, 'wrong')).statusCode).toBe(401);
  });

  it('сообщение WhatsApp попадает в общий список только к владельцу номера', async () => {
    const owner = await registerUser(app);
    const other = await registerUser(app);
    const box = new SecretBox(app.ctx.config.secret, 'messenger-bridge');
    app.ctx.db.run("INSERT INTO bridge_links (id, user_id, service, account, secret_enc, ext_id, created_at) VALUES ('l1', :u, 'whatsapp', 'Моя пекарня', :e, '1234567', 0)", {
      u: owner.user.id,
      e: box.seal(JSON.stringify({ token: 'x', phoneNumberId: '1234567' })),
    });
    const res = await hook({
      entry: [{ changes: [{ value: { metadata: { phone_number_id: '1234567' }, contacts: [{ wa_id: '79990001122', profile: { name: 'Мама' } }], messages: [{ from: '79990001122', timestamp: '1700000000', type: 'text', text: { body: 'Купи хлеб' } }] } }] }],
    });
    expect(res.statusCode).toBe(200);
    const notes = (await owner.client.get('/notifications')).body.items;
    expect(notes[0]).toMatchObject({ type: 'app_message', preview: 'WhatsApp · Мама: Купи хлеб' });
    const chats = (await owner.client.get('/bridge/chats')).body.chats;
    expect(chats).toHaveLength(1);
    expect(chats[0]).toMatchObject({ id: 'wa:79990001122', service: 'whatsapp', title: 'Мама', lastText: 'Купи хлеб', unread: 1 });
    const msgs = (await owner.client.get('/bridge/chats/wa:79990001122/messages')).body.messages;
    expect(msgs[0].text).toBe('Купи хлеб');
    expect((await owner.client.get('/bridge/chats')).body.chats[0].unread).toBe(0);
    expect((await other.client.get('/bridge/chats')).body.chats).toHaveLength(0);
    expect((await other.client.get('/bridge/chats/wa:79990001122/messages')).status).toBe(404);
  });
});
