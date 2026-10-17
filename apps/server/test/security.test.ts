import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { base32Decode, totpAt, currentStep } from '../src/lib/totp.js';
import { hashPassword, SecretBox, verifyPassword } from '../src/lib/crypto.js';
import { Client, createTestApp, PNG_1x1, registerUser } from './helpers.js';

let app: FastifyInstance;
beforeAll(async () => {
  app = await createTestApp();
});
afterAll(async () => {
  await app.close();
});

describe('crypto primitives', () => {
  it('hashes and verifies passwords with scrypt', async () => {
    const h = await hashPassword('пароль-с-юникодом');
    expect(h.startsWith('scrypt$')).toBe(true);
    expect((await verifyPassword('пароль-с-юникодом', h)).ok).toBe(true);
    expect((await verifyPassword('другой', h)).ok).toBe(false);
  });

  it('SecretBox detects tampering', () => {
    const box = new SecretBox('x'.repeat(40), 'test');
    const sealed = box.seal('secret');
    expect(box.open(sealed)).toBe('secret');
    const parts = sealed.split('.');
    parts[3] = Buffer.from('tampered').toString('base64url');
    expect(() => box.open(parts.join('.'))).toThrow();
  });
});

describe('auth & sessions', () => {
  it('registers, returns session and hides password hash', async () => {
    const { client, user } = await registerUser(app);
    const me = await client.get('/me');
    expect(me.status).toBe(200);
    expect(me.body.id).toBe(user.id);
    expect(JSON.stringify(me.body)).not.toContain('scrypt');
    expect(client.cookies.get('omni_sid')).toBeTruthy();
  });

  it('rejects weak passwords and duplicate usernames', async () => {
    const c = new Client(app);
    const weak = await c.post('/auth/register', { username: 'weakling', displayName: 'W', email: 'weak@example.com', password: 'password123' });
    expect(weak.status).toBe(400);
    expect(weak.body.error.fields.password).toBeTruthy();
    const { user } = await registerUser(app);
    const dup = await c.post('/auth/register', { username: user.username.toUpperCase(), displayName: 'X', email: 'dup@example.com', password: 'correct-horse-battery-staple' });
    expect(dup.status).toBe(409);
  });

  it('requires CSRF token and trusted origin for mutations', async () => {
    const { client } = await registerUser(app);
    client.sendCsrf = false;
    expect((await client.post('/posts', { kind: 'note', text: 'hi' })).status).toBe(403);
    client.sendCsrf = true;
    client.origin = 'https://evil.example';
    expect((await client.post('/posts', { kind: 'note', text: 'hi' })).status).toBe(403);
    client.origin = 'http://localhost:5173';
    expect((await client.post('/posts', { kind: 'note', text: 'hi' })).status).toBe(201);
  });

  it('CSRF token is bound to the session', async () => {
    const a = await registerUser(app);
    const b = await registerUser(app);
    // Подставляем токен из чужого сеанса
    a.client.cookies.set('omni_csrf', b.client.cookies.get('omni_csrf')!);
    expect((await a.client.post('/posts', { kind: 'note', text: 'x' })).status).toBe(403);
  });

  it('locks the account after repeated failures, without user enumeration', async () => {
    const { user } = await registerUser(app);
    const c = new Client(app);
    const unknown = await c.post('/auth/login', { username: 'no_such_user_xyz', password: 'whatever-123' });
    const wrong = await c.post('/auth/login', { username: user.username, password: 'wrong-password-1' });
    expect(unknown.status).toBe(401);
    expect(wrong.status).toBe(401);
    expect(unknown.body.error.code).toBe(wrong.body.error.code);
    for (let i = 0; i < 4; i++) await c.post('/auth/login', { username: user.username, password: 'wrong-password-1' });
    const locked = await c.post('/auth/login', { username: user.username, password: 'correct-horse-battery-staple' });
    expect(locked.status).toBe(429);
    expect(locked.body.error.code).toBe('ACCOUNT_LOCKED');
  });

  it('full 2FA flow: setup, login with TOTP, replay protection, recovery code', async () => {
    const { client, user, password } = await registerUser(app);
    const setup = await client.post('/security/2fa/setup', { password });
    expect(setup.status).toBe(200);
    const secret: string = setup.body.secret;
    expect(base32Decode(secret).length).toBe(20);
    const code = totpAt(secret, currentStep());
    const enable = await client.post('/security/2fa/enable', { code });
    expect(enable.status).toBe(200);
    const recovery: string[] = enable.body.recoveryCodes;
    expect(recovery).toHaveLength(10);

    const c2 = new Client(app);
    const step1 = await c2.post('/auth/login', { username: user.username, password });
    expect(step1.body.status).toBe('two_factor_required');
    // Тот же код повторно (replay) — отклоняется
    const replay = await c2.post('/auth/login/2fa', { challengeId: step1.body.challengeId, code });
    expect(replay.status).toBe(401);
    const ok = await c2.post('/auth/login/2fa', { challengeId: step1.body.challengeId, code: recovery[0] });
    expect(ok.status).toBe(200);
    expect(ok.body.me.twoFactorEnabled).toBe(true);

    const c3 = new Client(app);
    const s = await c3.post('/auth/login', { username: user.username, password });
    const reuse = await c3.post('/auth/login/2fa', { challengeId: s.body.challengeId, code: recovery[0] });
    expect(reuse.status).toBe(401);
  });

  it('password change revokes other sessions', async () => {
    const { client, user, password } = await registerUser(app);
    const other = new Client(app);
    await other.post('/auth/login', { username: user.username, password });
    expect((await other.get('/me')).status).toBe(200);
    const res = await client.post('/security/password', { currentPassword: password, newPassword: 'another-long-passphrase-42' });
    expect(res.status).toBe(200);
    expect((await other.get('/me')).status).toBe(401);
    expect((await client.get('/me')).status).toBe(200);
  });

  it('lists and revokes sessions', async () => {
    const { client, user, password } = await registerUser(app);
    const other = new Client(app);
    await other.post('/auth/login', { username: user.username, password });
    const list = await client.get('/security/sessions');
    expect(list.body.items).toHaveLength(2);
    const foreign = list.body.items.find((s: { current: boolean }) => !s.current);
    expect((await client.del(`/security/sessions/${foreign.id}`)).status).toBe(200);
    expect((await other.get('/me')).status).toBe(401);
  });
});

describe('privacy & authorization', () => {
  it('private profile: content hidden until follow request is accepted', async () => {
    const alice = await registerUser(app);
    const bob = await registerUser(app);
    await alice.client.patch('/me/privacy', { isPrivate: true });
    const post = await alice.client.post('/posts', { kind: 'note', text: 'секретная мысль' });
    expect((await bob.client.get(`/posts/${post.body.id}`)).status).toBe(404);
    const follow = await bob.client.post(`/users/${alice.user.id}/follow`);
    expect(follow.body.status).toBe('pending');
    expect((await bob.client.get(`/posts/${post.body.id}`)).status).toBe(404);
    await alice.client.post(`/me/follow-requests/${bob.user.id}/accept`);
    expect((await bob.client.get(`/posts/${post.body.id}`)).status).toBe(200);
  });

  it('whoCanMessage=nobody blocks new chats, blocking stops messages', async () => {
    const alice = await registerUser(app);
    const bob = await registerUser(app);
    await alice.client.patch('/me/privacy', { whoCanMessage: 'nobody' });
    const denied = await bob.client.post('/chats/direct', { userId: alice.user.id });
    expect(denied.status).toBe(403);
    expect(denied.body.error.code).toBe('PRIVACY_RESTRICTED');

    await alice.client.patch('/me/privacy', { whoCanMessage: 'everyone' });
    const chat = await bob.client.post('/chats/direct', { userId: alice.user.id });
    expect(chat.status).toBe(200);
    await alice.client.post(`/users/${bob.user.id}/block`);
    const send = await bob.client.post(`/chats/${chat.body.id}/messages`, { clientId: 'client-msg-0001', text: 'привет' });
    expect(send.status).toBe(403);
  });

  it('non-members cannot read private chats', async () => {
    const alice = await registerUser(app);
    const bob = await registerUser(app);
    const eve = await registerUser(app);
    const chat = await alice.client.post('/chats/direct', { userId: bob.user.id });
    await alice.client.post(`/chats/${chat.body.id}/messages`, { clientId: 'client-msg-0002', text: 'только для Боба' });
    expect((await eve.client.get(`/chats/${chat.body.id}/messages`)).status).toBe(404);
    expect((await eve.client.get(`/chats/${chat.body.id}`)).status).toBe(404);
  });
});

describe('chats', () => {
  it('sends messages idempotently and tracks unread/read', async () => {
    const alice = await registerUser(app);
    const bob = await registerUser(app);
    const chat = await alice.client.post('/chats/direct', { userId: bob.user.id });
    const body = { clientId: 'idem-key-000001', text: 'Привет, #мир' };
    const m1 = await alice.client.post(`/chats/${chat.body.id}/messages`, body);
    const m2 = await alice.client.post(`/chats/${chat.body.id}/messages`, body);
    expect(m1.status).toBe(201);
    expect(m2.body.id).toBe(m1.body.id);
    const bobChats = await bob.client.get('/chats');
    expect(bobChats.body.items[0].unreadCount).toBe(1);
    await bob.client.post(`/chats/${chat.body.id}/read`, { seq: m1.body.seq });
    expect((await bob.client.get('/chats')).body.items[0].unreadCount).toBe(0);
    const react = await bob.client.post(`/chats/${chat.body.id}/messages/${m1.body.id}/reactions`, { emoji: '🔥' });
    expect(react.body.reactions[0]).toMatchObject({ emoji: '🔥', count: 1, mine: true });
  });

  it('channels: only admins can post', async () => {
    const owner = await registerUser(app);
    const reader = await registerUser(app);
    const ch = await owner.client.post('/chats/channel', { title: 'Новости', isPublic: true });
    await reader.client.post(`/chats/${ch.body.id}/join`);
    expect((await reader.client.post(`/chats/${ch.body.id}/messages`, { clientId: 'reader-attempt-1', text: 'x' })).status).toBe(403);
    expect((await owner.client.post(`/chats/${ch.body.id}/messages`, { clientId: 'owner-post-0001', text: 'Выпуск 1' })).status).toBe(201);
  });

  it('secret chats accept only ciphertext from the bound device', async () => {
    const alice = await registerUser(app);
    const bob = await registerUser(app);
    const key = Buffer.alloc(91, 7).toString('base64');
    await alice.client.put('/keys/devices', { deviceId: 'alice-device-0000001', publicKey: key, algorithm: 'ECDH-P256' });
    await bob.client.put('/keys/devices', { deviceId: 'bob-device-00000001', publicKey: key, algorithm: 'ECDH-P256' });
    const chat = await alice.client.post('/chats/secret', { userId: bob.user.id, myDeviceId: 'alice-device-0000001' });
    expect(chat.status).toBe(200);
    expect(chat.body.secret.devices[bob.user.id]).toBe('bob-device-00000001');
    const plain = await alice.client.post(`/chats/${chat.body.id}/messages`, { clientId: 'secret-plain-001', text: 'plaintext' });
    expect(plain.status).toBe(400);
    const enc = { ciphertext: Buffer.from('opaque').toString('base64'), iv: Buffer.alloc(12).toString('base64'), senderDeviceId: 'alice-device-0000001' };
    const ok = await alice.client.post(`/chats/${chat.body.id}/messages`, { clientId: 'secret-enc-0001', encrypted: enc });
    expect(ok.status).toBe(201);
    expect(ok.body.text).toBeNull();
    const spoof = await alice.client.post(`/chats/${chat.body.id}/messages`, {
      clientId: 'secret-enc-0002',
      encrypted: { ...enc, senderDeviceId: 'bob-device-00000001' },
    });
    expect(spoof.status).toBe(403);
    // Подмена ключа уже зарегистрированного устройства запрещена
    const hijack = await alice.client.put('/keys/devices', { deviceId: 'bob-device-00000001', publicKey: key, algorithm: 'ECDH-P256' });
    expect(hijack.status).toBe(409);
  });
});

describe('content', () => {
  it('posts, hashtags, likes, threaded comments, notifications', async () => {
    const alice = await registerUser(app);
    const bob = await registerUser(app);
    const post = await alice.client.post('/posts', { kind: 'note', text: `Запускаем #omni вместе с @${bob.user.username}` });
    expect(post.body.hashtags).toContain('omni');
    await bob.client.post(`/posts/${post.body.id}/like`);
    const c1 = await bob.client.post(`/posts/${post.body.id}/comments`, { text: 'Круто!' });
    const reply = await alice.client.post(`/posts/${post.body.id}/comments`, { text: 'Спасибо', parentId: c1.body.id });
    const replyToReply = await bob.client.post(`/posts/${post.body.id}/comments`, { text: 'Ещё', parentId: reply.body.id });
    expect(replyToReply.body.parentId).toBe(c1.body.id);
    const fresh = await alice.client.get(`/posts/${post.body.id}`);
    expect(fresh.body.stats).toMatchObject({ likes: 1, comments: 3 });
    const bobNotifs = await bob.client.get('/notifications');
    expect(bobNotifs.body.items.map((n: { type: string }) => n.type)).toEqual(expect.arrayContaining(['mention', 'reply']));
    const trending = await alice.client.get('/hashtags/trending');
    expect(trending.body.items.some((h: { tag: string }) => h.tag === 'omni')).toBe(true);
    const search = await bob.client.get('/search?q=запускаем');
    expect(search.body.posts.some((p: { id: string }) => p.id === post.body.id)).toBe(true);
  });

  it('comments respect whoCanComment and disabled comments', async () => {
    const alice = await registerUser(app);
    const bob = await registerUser(app);
    await alice.client.patch('/me/privacy', { whoCanComment: 'nobody' });
    const post = await alice.client.post('/posts', { kind: 'note', text: 'без комментариев' });
    expect((await bob.client.post(`/posts/${post.body.id}/comments`, { text: 'а я скажу' })).status).toBe(403);
  });
});

describe('media', () => {
  it('sniffs content type, signs URLs and rejects disguised files', async () => {
    const { client } = await registerUser(app);
    const up = await client.upload(PNG_1x1, 'photo.png');
    expect(up.status).toBe(201);
    expect(up.body).toMatchObject({ kind: 'image', mime: 'image/png', width: 1, height: 1 });
    const file = await client.request('GET', up.body.url);
    expect(file.status).toBe(200);
    expect(file.headers['x-content-type-options']).toBe('nosniff');
    const tampered = await client.request('GET', up.body.url.replace(/s=[^&]+/, 's=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'));
    expect(tampered.status).toBe(404);
    const html = await client.upload(Buffer.from('<html><script>alert(1)</script></html>'.repeat(3)), 'evil.png');
    expect(html.status).toBe(415);
  });

  it('cannot attach media owned by someone else', async () => {
    const alice = await registerUser(app);
    const bob = await registerUser(app);
    const up = await alice.client.upload(PNG_1x1, 'a.png');
    const res = await bob.client.post('/posts', { kind: 'photo', text: '', mediaIds: [up.body.id] });
    expect(res.status).toBe(403);
  });
});
