import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createTestApp, registerUser } from './helpers.js';

describe('привязка нескольких аккаунтов к устройству', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(async () => {
    await app.close();
  });

  it('позволяет переключаться между аккаунтами одного устройства без пароля', async () => {
    // Аккаунт A зарегистрирован на этом устройстве (клиент хранит cookie omni_did)
    const a = await registerUser(app);
    // Второй аккаунт B существует
    const b = await registerUser(app);
    // На устройстве A входим в B — теперь на устройстве два привязанных аккаунта
    const login = await a.client.post('/auth/login', { username: b.user.username, password: b.password });
    expect(login.status).toBe(200);
    expect(login.body.me.id).toBe(b.user.id);

    // Оба аккаунта в списке привязанных
    const list = await a.client.get('/auth/accounts');
    expect(list.status).toBe(200);
    const ids = (list.body.accounts as { id: string }[]).map((x) => x.id).sort();
    expect(ids).toEqual([a.user.id, b.user.id].sort());

    // Переключаемся обратно на A без ввода пароля
    const sw = await a.client.post('/auth/accounts/switch', { userId: a.user.id });
    expect(sw.status).toBe(200);
    expect(sw.body.me.id).toBe(a.user.id);

    // Текущий сеанс теперь — A
    const session = await a.client.get('/auth/session');
    expect(session.body.me.id).toBe(a.user.id);
  });

  it('не даёт переключиться на аккаунт, не привязанный к этому устройству', async () => {
    const a = await registerUser(app); // устройство 1, аккаунт A
    const c = await registerUser(app); // устройство 2, аккаунт C
    // C со своего устройства пытается переключиться на чужой аккаунт A
    const sw = await c.client.post('/auth/accounts/switch', { userId: a.user.id });
    expect(sw.status).toBe(403);
    // И по-прежнему остаётся собой
    const session = await c.client.get('/auth/session');
    expect(session.body.me.id).toBe(c.user.id);
  });

  it('для гостя список привязанных аккаунтов пуст', async () => {
    const guest = await registerUser(app);
    await guest.client.post('/auth/logout');
    const list = await guest.client.get('/auth/accounts');
    expect(list.status).toBe(200);
    // После выхода активных сеансов на устройстве нет
    expect(list.body.accounts).toEqual([]);
  });
});
