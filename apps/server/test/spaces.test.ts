import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SPACE_PERMS } from '@omni/shared';
import { createTestApp, registerUser } from './helpers.js';

let app: FastifyInstance;
beforeAll(async () => {
  app = await createTestApp();
});
afterAll(async () => {
  await app.close();
});

let n = 0;
const cid = () => `space-${Date.now().toString(36)}-${n++}`.padEnd(12, 'x');

describe('компании', () => {
  it('только по приглашению: приглашение в уведомлениях, роли с правами, закрытые чаты', async () => {
    const boss = await registerUser(app);
    const dev = await registerUser(app);
    const stranger = await registerUser(app);
    const created = await boss.client.post('/spaces', { kind: 'company', name: 'Орбита', description: 'Тестовая компания', isPublic: true });
    expect(created.status).toBe(201);
    const co = created.body;
    expect(co.isPublic).toBe(false);
    expect(co.rooms.length).toBeGreaterThanOrEqual(2);
    // Чаты компании не попадают в общий список чатов
    expect((await boss.client.get('/chats')).body.items.some((c: { spaceId: string }) => c.spaceId === co.id)).toBe(false);

    // Посторонний не видит компанию и не может вступить сам
    expect((await stranger.client.get(`/spaces/${co.id}`)).status).toBe(404);
    expect((await stranger.client.post(`/spaces/${co.id}/join`)).status).toBe(403);
    const general = co.rooms.find((r: { chat: { type: string } }) => r.chat.type === 'group').chat.id;
    expect((await stranger.client.get(`/chats/${general}/messages`)).status).toBe(404);

    // Приглашение приходит уведомлением, принимается — и человек сразу в чатах
    const inv = await boss.client.post(`/spaces/${co.id}/invites`, { userId: dev.user.id });
    expect(inv.status).toBe(201);
    const notifs = await dev.client.get('/notifications');
    expect(notifs.body.items[0]).toMatchObject({ type: 'space_invite', entityId: inv.body.id });
    expect((await dev.client.get('/space-invites')).body.items).toHaveLength(1);
    const accepted = await dev.client.post(`/space-invites/${inv.body.id}/respond`, { accept: true });
    expect(accepted.body.space.joined).toBe(true);
    expect((await dev.client.post(`/chats/${general}/messages`, { clientId: cid(), text: 'Всем привет' })).status).toBe(201);
    // В канал-объявления пишет только тот, у кого есть право
    const news = co.rooms.find((r: { chat: { type: string } }) => r.chat.type === 'channel').chat.id;
    expect((await dev.client.post(`/chats/${news}/messages`, { clientId: cid(), text: 'не положено' })).status).toBe(403);

    // Обычный сотрудник не управляет ролями и не приглашает
    expect((await dev.client.post(`/spaces/${co.id}/roles`, { name: 'Я главный', permissions: SPACE_PERMS.admin })).status).toBe(403);
    expect((await dev.client.post(`/spaces/${co.id}/invites`, { userId: stranger.user.id })).status).toBe(403);

    // Начальник создаёт роль «Бэкенд» и закрытый чат для неё
    const role = await boss.client.post(`/spaces/${co.id}/roles`, { name: 'Бэкенд', color: '#57f287', permissions: SPACE_PERMS.announce });
    expect(role.status).toBe(201);
    const room = await boss.client.post(`/spaces/${co.id}/rooms`, { title: 'бэкенд', roleIds: [role.body.id] });
    expect(room.status).toBe(201);
    expect((await dev.client.get(`/chats/${room.body.chat.id}/messages`)).status).toBe(404);
    await boss.client.put(`/spaces/${co.id}/members/${dev.user.id}/roles`, { roleIds: [role.body.id] });
    expect((await dev.client.get(`/chats/${room.body.chat.id}/messages`)).status).toBe(200);
    // Роль с правом объявлений — теперь можно писать в канал
    expect((await dev.client.post(`/chats/${news}/messages`, { clientId: cid(), text: 'релиз в пятницу' })).status).toBe(201);
    const details = await dev.client.get(`/spaces/${co.id}`);
    expect(details.body.permissions & SPACE_PERMS.announce).toBeTruthy();

    // Исключённый теряет доступ ко всем чатам
    expect((await boss.client.del(`/spaces/${co.id}/members/${dev.user.id}`)).status).toBe(200);
    expect((await dev.client.get(`/chats/${general}/messages`)).status).toBe(404);
    expect((await dev.client.get(`/spaces/${co.id}`)).status).toBe(404);
  });

  it('нельзя выдать права, которых нет у себя', async () => {
    const boss = await registerUser(app);
    const lead = await registerUser(app);
    const co = (await boss.client.post('/spaces', { kind: 'company', name: 'Компания' })).body;
    const inv = await boss.client.post(`/spaces/${co.id}/invites`, { userId: lead.user.id });
    await lead.client.post(`/space-invites/${inv.body.id}/respond`, { accept: true });
    const hr = await boss.client.post(`/spaces/${co.id}/roles`, { name: 'HR', permissions: SPACE_PERMS.manageRoles | SPACE_PERMS.invite });
    await boss.client.put(`/spaces/${co.id}/members/${lead.user.id}/roles`, { roleIds: [hr.body.id] });
    expect((await lead.client.post(`/spaces/${co.id}/roles`, { name: 'Супер', permissions: SPACE_PERMS.admin })).status).toBe(403);
    expect((await lead.client.post(`/spaces/${co.id}/roles`, { name: 'Рекрутер', permissions: SPACE_PERMS.invite })).status).toBe(201);
    expect((await lead.client.put(`/spaces/${co.id}/members/${lead.user.id}/roles`, { roleIds: [] })).status).toBe(403);
  });

  it('отклонённое приглашение не даёт доступа', async () => {
    const boss = await registerUser(app);
    const guest = await registerUser(app);
    const co = (await boss.client.post('/spaces', { kind: 'company', name: 'Закрытая' })).body;
    const inv = await boss.client.post(`/spaces/${co.id}/invites`, { userId: guest.user.id });
    expect((await guest.client.post(`/space-invites/${inv.body.id}/respond`, { accept: false })).body.space).toBeNull();
    expect((await guest.client.get(`/spaces/${co.id}`)).status).toBe(404);
    expect((await guest.client.post(`/space-invites/${inv.body.id}/respond`, { accept: true })).status).toBe(404);
  });
});

describe('сообщества', () => {
  it('открытое: вступает кто хочет, группы внутри — по желанию', async () => {
    const owner = await registerUser(app);
    const fan = await registerUser(app);
    const c = (await owner.client.post('/spaces', { kind: 'community', name: 'Астрономия', isPublic: true })).body;
    expect((await fan.client.get('/spaces/discover?q=Астро')).body.items.map((s: { id: string }) => s.id)).toContain(c.id);
    expect((await fan.client.get(`/spaces/${c.id}`)).body.joined).toBe(false);
    const group = c.rooms[0].chat.id;
    // До вступления в сообщество — в группы нельзя
    expect((await fan.client.post(`/chats/${group}/join`)).status).toBe(403);
    expect((await fan.client.post(`/spaces/${c.id}/join`)).status).toBe(200);
    expect((await fan.client.get(`/spaces/${c.id}`)).body.rooms[0].joined).toBe(false);
    expect((await fan.client.post(`/chats/${group}/join`)).status).toBe(200);
    expect((await fan.client.post(`/chats/${group}/messages`, { clientId: cid(), text: 'Сатурн сегодня виден!' })).status).toBe(201);
    // Закрытая группа внутри — только по приглашению
    const closed = await owner.client.post(`/spaces/${c.id}/rooms`, { title: 'Организаторы', isPublic: false });
    expect((await fan.client.post(`/chats/${closed.body.chat.id}/join`)).status).toBe(403);
    // Вышел из сообщества — вышел и из групп
    await fan.client.post(`/spaces/${c.id}/leave`);
    expect((await fan.client.post(`/chats/${group}/messages`, { clientId: cid(), text: 'ещё тут?' })).status).toBe(404);
  });

  it('закрытое: только по приглашению или ссылке', async () => {
    const owner = await registerUser(app);
    const friend = await registerUser(app);
    const c = (await owner.client.post('/spaces', { kind: 'community', name: 'Клуб', isPublic: false })).body;
    expect((await friend.client.get(`/spaces/${c.id}`)).status).toBe(404);
    expect((await friend.client.post(`/spaces/${c.id}/join`)).status).toBe(403);
    const link = await owner.client.post(`/spaces/${c.id}/link`);
    const token = link.body.inviteLink.split('/s/')[1];
    expect((await friend.client.post(`/spaces/link/${token}`)).body.joined).toBe(true);
    // Новая ссылка отменяет старую
    await owner.client.post(`/spaces/${c.id}/link`);
    const late = await registerUser(app);
    expect((await late.client.post(`/spaces/link/${token}`)).status).toBe(404);
  });
});
