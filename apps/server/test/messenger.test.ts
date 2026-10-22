import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, createTestApp, PNG_1x1, registerUser } from './helpers.js';

let app: FastifyInstance;
beforeAll(async () => {
  app = await createTestApp();
});
afterAll(async () => {
  await app.close();
});

let n = 0;
const cid = () => `test-${Date.now().toString(36)}-${n++}`.padEnd(10, 'x');

async function group(owner: Client, memberIds: string[], title = 'Группа') {
  const res = await owner.post('/chats/group', { title, memberIds });
  expect(res.status).toBe(200);
  return res.body.id as string;
}

/** Минимальный файл с сигнатурой WebM (EBML) — сервер определяет тип по содержимому. */
const WEBM = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(64, 1)]);

describe('опросы', () => {
  it('результаты скрыты до голоса, один вариант, закрыть может автор', async () => {
    const a = await registerUser(app);
    const b = await registerUser(app);
    const chatId = await group(a.client, [b.user.id]);
    const sent = await a.client.post(`/chats/${chatId}/messages`, {
      clientId: cid(),
      poll: { question: 'Куда едем?', options: ['Горы', 'Море', 'Город'], anonymous: false },
    });
    expect(sent.status).toBe(201);
    expect(sent.body.kind).toBe('poll');
    const poll = sent.body.poll;
    expect(poll.options).toHaveLength(3);

    const twoOptions = await b.client.post(`/chats/${chatId}/messages/${sent.body.id}/vote`, { optionIds: [poll.options[0].id, poll.options[1].id] });
    expect(twoOptions.status).toBe(400);
    const voted = await b.client.post(`/chats/${chatId}/messages/${sent.body.id}/vote`, { optionIds: [poll.options[1].id] });
    expect(voted.status).toBe(200);
    expect(voted.body.poll.voted).toBe(true);
    expect(voted.body.poll.options[1].votes).toBe(1);
    expect(voted.body.poll.recentVoters[0].id).toBe(b.user.id);

    // Автор ещё не голосовал — видит нули
    const list = await a.client.get(`/chats/${chatId}/messages`);
    const forAuthor = list.body.items.find((m: { id: string }) => m.id === sent.body.id);
    expect(forAuthor.poll.options.every((o: { votes: number }) => o.votes === 0)).toBe(true);
    expect(forAuthor.poll.totalVoters).toBe(1);

    expect((await b.client.post(`/chats/${chatId}/messages/${sent.body.id}/close-poll`)).status).toBe(403);
    const closed = await a.client.post(`/chats/${chatId}/messages/${sent.body.id}/close-poll`);
    expect(closed.body.poll.closed).toBe(true);
    expect((await b.client.post(`/chats/${chatId}/messages/${sent.body.id}/vote`, { optionIds: [poll.options[0].id] })).status).toBe(403);
  });

  it('викторина: ответ нельзя изменить, верный вариант виден после ответа', async () => {
    const a = await registerUser(app);
    const b = await registerUser(app);
    const chatId = await group(a.client, [b.user.id]);
    const sent = await a.client.post(`/chats/${chatId}/messages`, {
      clientId: cid(),
      poll: { question: '2 + 2?', options: ['3', '4'], correctOption: 1 },
    });
    expect(sent.body.poll.quiz).toBe(true);
    expect(sent.body.poll.correctOptionId).toBeNull();
    const ans = await b.client.post(`/chats/${chatId}/messages/${sent.body.id}/vote`, { optionIds: [sent.body.poll.options[0].id] });
    expect(ans.body.poll.correctOptionId).toBe(sent.body.poll.options[1].id);
    expect((await b.client.post(`/chats/${chatId}/messages/${sent.body.id}/vote`, { optionIds: [sent.body.poll.options[1].id] })).status).toBe(403);
  });

  it('в личном чате опрос создать нельзя', async () => {
    const a = await registerUser(app);
    const b = await registerUser(app);
    const dm = await a.client.post('/chats/direct', { userId: b.user.id });
    const res = await a.client.post(`/chats/${dm.body.id}/messages`, { clientId: cid(), poll: { question: '?', options: ['а', 'б'] } });
    expect(res.status).toBe(400);
  });
});

describe('упоминания, «без звука», медленный режим, автоудаление', () => {
  it('@упоминание участника группы — уведомление и счётчик упоминаний', async () => {
    const a = await registerUser(app);
    const b = await registerUser(app);
    const chatId = await group(a.client, [b.user.id]);
    const sent = await a.client.post(`/chats/${chatId}/messages`, { clientId: cid(), text: `@${b.user.username} глянь, пожалуйста`, silent: true });
    expect(sent.body.silent).toBe(true);
    const chat = await b.client.get(`/chats/${chatId}`);
    expect(chat.body.unreadMentions).toBe(1);
    const notes = await b.client.get('/notifications');
    expect(notes.body.items.some((x: { type: string; link: string }) => x.type === 'mention' && x.link.includes(chatId))).toBe(true);
    await b.client.post(`/chats/${chatId}/read`, { seq: sent.body.seq });
    expect((await b.client.get(`/chats/${chatId}`)).body.unreadMentions).toBe(0);
  });

  it('медленный режим: участник ждёт, администратор — нет', async () => {
    const a = await registerUser(app);
    const b = await registerUser(app);
    const chatId = await group(a.client, [b.user.id]);
    expect((await b.client.patch(`/chats/${chatId}`, { slowModeSec: 30 })).status).toBe(403);
    expect((await a.client.patch(`/chats/${chatId}`, { slowModeSec: 30 })).body.slowModeSec).toBe(30);
    expect((await b.client.post(`/chats/${chatId}/messages`, { clientId: cid(), text: 'раз' })).status).toBe(201);
    const second = await b.client.post(`/chats/${chatId}/messages`, { clientId: cid(), text: 'два' });
    expect(second.status).toBe(429);
    expect(second.body.error.retryAfter).toBeGreaterThan(0);
    expect((await a.client.post(`/chats/${chatId}/messages`, { clientId: cid(), text: 'админ' })).status).toBe(201);
    expect((await a.client.post(`/chats/${chatId}/messages`, { clientId: cid(), text: 'админ 2' })).status).toBe(201);
  });

  it('автоудаление в группе включает только администратор; новые сообщения получают срок', async () => {
    const a = await registerUser(app);
    const b = await registerUser(app);
    const chatId = await group(a.client, [b.user.id]);
    expect((await b.client.patch(`/chats/${chatId}`, { ttlSeconds: 86400 })).status).toBe(403);
    expect((await a.client.patch(`/chats/${chatId}`, { ttlSeconds: 86400 })).body.ttlSeconds).toBe(86400);
    const m = await b.client.post(`/chats/${chatId}/messages`, { clientId: cid(), text: 'исчезну' });
    expect(m.body.expiresAt).toBeTruthy();
  });
});

describe('кто прочитал, голосовые, поиск', () => {
  it('«кто прочитал» уважает выключенные отчёты о прочтении', async () => {
    const a = await registerUser(app);
    const b = await registerUser(app);
    const c = await registerUser(app);
    const chatId = await group(a.client, [b.user.id, c.user.id]);
    const m = await a.client.post(`/chats/${chatId}/messages`, { clientId: cid(), text: 'прочитайте' });
    await c.client.patch('/me/privacy', { readReceipts: false });
    await b.client.post(`/chats/${chatId}/read`, { seq: m.body.seq });
    await c.client.post(`/chats/${chatId}/read`, { seq: m.body.seq });
    const readers = await a.client.get(`/chats/${chatId}/messages/${m.body.id}/readers`);
    expect(readers.body.items.map((u: { id: string }) => u.id)).toEqual([b.user.id]);
  });

  it('голосовое: аудио-WebM с волной; картинку голосовым не отправить', async () => {
    const a = await registerUser(app);
    const b = await registerUser(app);
    const dm = await a.client.post('/chats/direct', { userId: b.user.id });
    const wave = Buffer.from(Array.from({ length: 40 }, (_, i) => (i * 7) % 255)).toString('base64url');
    const voice = await a.client.upload(WEBM, 'voice.webm', `?as=audio&duration=3&waveform=${wave}`);
    expect(voice.status).toBe(201);
    expect(voice.body.kind).toBe('audio');
    expect(voice.body.waveform).toHaveLength(40);
    const sent = await a.client.post(`/chats/${dm.body.id}/messages`, { clientId: cid(), kind: 'voice', mediaIds: [voice.body.id] });
    expect(sent.status).toBe(201);
    expect(sent.body.kind).toBe('voice');

    const img = await a.client.upload(PNG_1x1, 'x.png');
    const bad = await a.client.post(`/chats/${dm.body.id}/messages`, { clientId: cid(), kind: 'voice', mediaIds: [img.body.id] });
    expect(bad.status).toBe(400);
  });

  it('глобальный поиск находит только свои переписки', async () => {
    const a = await registerUser(app);
    const b = await registerUser(app);
    const outsider = await registerUser(app);
    const chatId = await group(a.client, [b.user.id]);
    await a.client.post(`/chats/${chatId}/messages`, { clientId: cid(), text: 'Секретный рецепт квантового пирога' });
    const found = await b.client.get(`/messages/search?q=${encodeURIComponent('квантового')}`);
    expect(found.body.items).toHaveLength(1);
    expect(found.body.items[0].chat.id).toBe(chatId);
    const none = await outsider.client.get(`/messages/search?q=${encodeURIComponent('квантового')}`);
    expect(none.body.items).toHaveLength(0);
  });
});

describe('папки, приглашения, отложенные сообщения', () => {
  it('своя папка показывает только подходящие чаты и недоступна другим', async () => {
    const a = await registerUser(app);
    const b = await registerUser(app);
    await a.client.post('/chats/direct', { userId: b.user.id }).then((r) => a.client.post(`/chats/${r.body.id}/messages`, { clientId: cid(), text: 'привет' }));
    const g = await group(a.client, [b.user.id], 'Только группа');
    const folder = await a.client.post('/chat-folders', { name: 'Работа', emoji: '💼', includeTypes: ['groups'] });
    expect(folder.status).toBe(201);
    const list = await a.client.get(`/chats?folder=${folder.body.id}`);
    expect(list.body.items.map((c: { id: string }) => c.id)).toEqual([g]);
    expect((await b.client.get(`/chats?folder=${folder.body.id}`)).status).toBe(404);
    // Чужой чат в папку не добавить
    const other = await registerUser(app);
    const foreign = await group(other.client, []);
    expect((await a.client.post('/chat-folders', { name: 'Чужое', includeChatIds: [foreign] })).status).toBe(400);
  });

  it('ссылка-приглашение в закрытую группу: лимит, отзыв, права', async () => {
    const owner = await registerUser(app);
    const member = await registerUser(app);
    const guest1 = await registerUser(app);
    const guest2 = await registerUser(app);
    const chatId = await group(owner.client, [member.user.id], 'Закрытый клуб');
    expect((await member.client.post(`/chats/${chatId}/invites`, {})).status).toBe(403);
    const inv = await owner.client.post(`/chats/${chatId}/invites`, { usageLimit: 1 });
    expect(inv.status).toBe(201);
    expect(inv.body.url).toContain(`/join/${inv.body.token}`);

    const preview = await guest1.client.get(`/invites/${inv.body.token}`);
    expect(preview.body.chat.title).toBe('Закрытый клуб');
    expect(preview.body.isMember).toBe(false);
    const joined = await guest1.client.post(`/invites/${inv.body.token}/join`);
    expect(joined.body.role).toBe('member');
    // Лимит в одно использование исчерпан
    expect((await guest2.client.post(`/invites/${inv.body.token}/join`)).status).toBe(404);

    const inv2 = await owner.client.post(`/chats/${chatId}/invites`, {});
    await owner.client.del(`/chats/${chatId}/invites/${inv2.body.token}`);
    expect((await guest2.client.get(`/invites/${inv2.body.token}`)).status).toBe(404);
    expect((await guest2.client.get('/invites/not-a-real-token')).status).toBe(404);
  });

  it('отложенное сообщение отправляется в назначенное время', async () => {
    const a = await registerUser(app);
    const b = await registerUser(app);
    const dm = await a.client.post('/chats/direct', { userId: b.user.id });
    const past = await a.client.post(`/chats/${dm.body.id}/scheduled`, { text: 'вчера', sendAt: new Date(Date.now() - 60_000).toISOString() });
    expect(past.status).toBe(400);
    const s = await a.client.post(`/chats/${dm.body.id}/scheduled`, { text: 'С днём рождения! 🎂', sendAt: new Date(Date.now() + 3600_000).toISOString() });
    expect(s.status).toBe(201);
    expect((await a.client.get(`/chats/${dm.body.id}/scheduled`)).body.items).toHaveLength(1);
    expect((await b.client.get(`/chats/${dm.body.id}/scheduled`)).body.items).toHaveLength(0);

    // «Перематываем время»: делаем сообщение просроченным и запускаем фоновую задачу
    app.ctx.db.run('UPDATE scheduled_messages SET send_at = 0 WHERE id = :id', { id: s.body.id });
    expect(app.ctx.services.scheduled.sendDue(() => undefined)).toBe(1);
    const msgs = await b.client.get(`/chats/${dm.body.id}/messages`);
    expect(msgs.body.items.at(-1).text).toBe('С днём рождения! 🎂');
    expect((await a.client.get(`/chats/${dm.body.id}/scheduled`)).body.items).toHaveLength(0);
  });
});

describe('звонки', () => {
  it('вызов → ответ → завершение; сообщение о звонке и история', async () => {
    const a = await registerUser(app);
    const b = await registerUser(app);
    const dm = await a.client.post('/chats/direct', { userId: b.user.id });
    const call = await a.client.post('/calls', { chatId: dm.body.id, video: true });
    expect(call.status).toBe(201);
    expect(call.body.status).toBe('ringing');
    expect((await a.client.post('/calls/' + call.body.id + '/accept')).status).toBe(403);

    // Третий звонит занятому собеседнику
    const c = await registerUser(app);
    const dm2 = await c.client.post('/chats/direct', { userId: b.user.id });
    expect((await c.client.post('/calls', { chatId: dm2.body.id })).body.status).toBe('busy');

    const accepted = await b.client.post(`/calls/${call.body.id}/accept`);
    expect(accepted.body.status).toBe('active');
    // Сигналы принимаются только с устройства-участника
    expect(() =>
      app.ctx.services.calls.signal(b.user.id, 'other-session', call.body.id, { type: 'answer', sdp: 'v=0' }),
    ).toThrow();
    const ended = await a.client.post(`/calls/${call.body.id}/hangup`);
    expect(ended.body.status).toBe('ended');

    const msgs = await b.client.get(`/chats/${dm.body.id}/messages`);
    const callMsg = msgs.body.items.find((m: { kind: string }) => m.kind === 'call');
    expect(callMsg.call.id).toBe(call.body.id);
    expect(callMsg.text).toContain('Видеозвонок');
    const history = (await b.client.get('/calls')).body.items as { id: string; status: string }[];
    expect(history.find((h) => h.id === call.body.id)?.status).toBe('ended');
    expect(history.some((h) => h.status === 'busy')).toBe(true);
  });

  it('групповой звонок: создание по id и имени, вход, приглашение, выход, история', async () => {
    const a = await registerUser(app);
    const b = await registerUser(app);
    const c = await registerUser(app);
    const d = await registerUser(app);
    const room = await a.client.post('/calls/rooms', { userIds: [b.user.id], usernames: ['@' + c.user.username], video: true, title: 'Планёрка' });
    expect(room.status).toBe(201);
    expect(room.body.status).toBe('active');
    expect(room.body.members.map((m: { state: string }) => m.state)).toEqual(['joined', 'invited', 'invited']);
    // Посторонний звонок не видит и войти не может
    expect((await d.client.get(`/calls/rooms/${room.body.id}`)).status).toBe(404);
    expect((await d.client.post(`/calls/rooms/${room.body.id}/join`)).status).toBe(404);
    // Приглашённый видит текущий звонок и входит
    expect((await b.client.get('/calls/rooms/current')).body.room.id).toBe(room.body.id);
    const joined = await b.client.post(`/calls/rooms/${room.body.id}/join`);
    expect(joined.body.members.find((m: { user: { id: string } }) => m.user.id === b.user.id).state).toBe('joined');
    // Приглашать может участник; приглашённый, но не вошедший — нет
    expect((await c.client.post(`/calls/rooms/${room.body.id}/invite`, { userIds: [d.user.id] })).status).toBe(403);
    const invited = await b.client.post(`/calls/rooms/${room.body.id}/invite`, { userIds: [d.user.id] });
    expect(invited.body.members).toHaveLength(4);
    // Отказ приглашённого
    expect((await c.client.post(`/calls/rooms/${room.body.id}/leave`)).body.members.find((m: { user: { id: string } }) => m.user.id === c.user.id).state).toBe('declined');
    // Чат звонка — только для участников
    expect((await d.client.post(`/calls/rooms/${room.body.id}/chat`, { text: 'Привет' })).status).toBe(403);
    expect((await a.client.post(`/calls/rooms/${room.body.id}/chat`, { text: 'Привет всем' })).body.text).toBe('Привет всем');
    // Сигналы — только с устройства, с которого человек в звонке
    expect(() => app.ctx.services.rooms.signal(b.user.id, 'other-session', room.body.id, a.user.id, { type: 'answer', sdp: 'v=0' })).toThrow();
    // Вышли все — звонок завершён
    await a.client.post(`/calls/rooms/${room.body.id}/leave`);
    const last = await b.client.post(`/calls/rooms/${room.body.id}/leave`);
    expect(last.body.status).toBe('ended');
    expect((await d.client.post(`/calls/rooms/${room.body.id}/join`)).status).toBe(400);
    const history = (await b.client.get('/calls/rooms')).body.items as { id: string; title: string }[];
    expect(history[0]).toMatchObject({ id: room.body.id, title: 'Планёрка' });
  });

  it('групповой звонок: права организатора, рука, правила и итог в чате', async () => {
    const a = await registerUser(app);
    const b = await registerUser(app);
    const c = await registerUser(app);
    const dm = await a.client.post('/chats/direct', { userId: b.user.id });
    const room = await a.client.post('/calls/rooms', { userIds: [b.user.id, c.user.id], video: true, chatId: dm.body.id });
    expect(room.body.settings).toMatchObject({ allowMic: true, locked: false, spotlight: null });
    await b.client.post(`/calls/rooms/${room.body.id}/join`);
    await c.client.post(`/calls/rooms/${room.body.id}/join`);
    const id = room.body.id as string;
    const mod = (who: typeof a, body: object) => who.client.post(`/calls/rooms/${id}/moderate`, body);
    // Участник не может управлять
    expect((await mod(b, { action: 'muteAll' })).status).toBe(403);
    // Рука: поднять, организатор даёт слово — рука опускается, право говорить есть
    const up = await b.client.post(`/calls/rooms/${id}/hand`, { up: true });
    expect(up.body.members.find((m: { user: { id: string } }) => m.user.id === b.user.id).hand).toBeTruthy();
    const speak = await mod(a, { action: 'allowSpeak', userId: b.user.id });
    const bm = speak.body.members.find((m: { user: { id: string } }) => m.user.id === b.user.id);
    expect(bm.hand).toBeNull();
    expect(bm.canSpeak).toBe(true);
    // Правила: микрофоны и чат выключены, вход закрыт
    const st = await mod(a, { action: 'settings', settings: { allowMic: false, allowChat: false, locked: true } });
    expect(st.body.settings).toMatchObject({ allowMic: false, allowChat: false, locked: true });
    expect((await c.client.post(`/calls/rooms/${id}/chat`, { text: 'можно?' })).status).toBe(403);
    expect((await a.client.post(`/calls/rooms/${id}/chat`, { text: 'Тишина' })).status).toBe(200);
    expect((await c.client.post(`/calls/rooms/${id}/invite`, { userIds: [a.user.id] })).status).toBe(403);
    // Закрепить для всех, соорганизатор
    expect((await mod(a, { action: 'spotlight', spotlight: `screen:${b.user.id}` })).body.settings.spotlight).toBe(`screen:${b.user.id}`);
    const co = await mod(a, { action: 'cohost', userId: c.user.id, on: true });
    expect(co.body.members.find((m: { user: { id: string } }) => m.user.id === c.user.id).role).toBe('cohost');
    // Соорганизатор не управляет организатором
    expect((await mod(c, { action: 'remove', userId: a.user.id })).status).toBe(403);
    // Удалённый не вернётся сам
    const rm = await mod(a, { action: 'remove', userId: b.user.id });
    expect(rm.body.members.find((m: { user: { id: string } }) => m.user.id === b.user.id).state).toBe('removed');
    expect((await b.client.post(`/calls/rooms/${id}/join`)).status).toBe(403);
    // Завершить для всех — итог в личном чате
    const end = await mod(a, { action: 'end' });
    expect(end.body.status).toBe('ended');
    const msgs = await a.client.get(`/chats/${dm.body.id}/messages`);
    expect(msgs.body.items.at(-1).text).toContain('позвонил(а)');
  });

  it('групповой звонок: единственный приглашённый отклонил — звонок завершён', async () => {
    const a = await registerUser(app);
    const b = await registerUser(app);
    const room = await a.client.post('/calls/rooms', { userIds: [b.user.id], video: false });
    const declined = await b.client.post(`/calls/rooms/${room.body.id}/leave`);
    expect(declined.status).toBe(200);
    expect((await a.client.get(`/calls/rooms/${room.body.id}`)).body.status).toBe('ended');
  });

  it('групповой звонок: не больше 50 человек, заблокировавшего не позвать', async () => {
    const a = await registerUser(app);
    const b = await registerUser(app);
    await b.client.post(`/users/${a.user.id}/block`);
    expect((await a.client.post('/calls/rooms', { userIds: [b.user.id] })).status).toBe(400);
    expect((await a.client.post('/calls/rooms', { usernames: ['nobody_here_xyz'] })).status).toBe(400);
    const many = Array.from({ length: 50 }, (_, i) => `user_${i}`);
    expect((await a.client.post('/calls/rooms', { usernames: many })).status).toBe(400);
  });

  it('в группу и заблокировавшему не позвонить; отклонённый звонок', async () => {
    const a = await registerUser(app);
    const b = await registerUser(app);
    const g = await group(a.client, [b.user.id]);
    expect((await a.client.post('/calls', { chatId: g })).status).toBe(400);
    const dm = await a.client.post('/chats/direct', { userId: b.user.id });
    const call = await a.client.post('/calls', { chatId: dm.body.id });
    expect((await b.client.post(`/calls/${call.body.id}/hangup`)).body.status).toBe('declined');
    await b.client.post(`/users/${a.user.id}/block`);
    expect((await a.client.post('/calls', { chatId: dm.body.id })).status).toBe(403);
  });

  it('пропущенные: только входящие без ответа', async () => {
    const a = await registerUser(app);
    const b = await registerUser(app);
    const dm = await a.client.post('/chats/direct', { userId: b.user.id });
    const call = await a.client.post('/calls', { chatId: dm.body.id });
    // Звонящий передумал — у собеседника это пропущенный
    expect((await a.client.post(`/calls/${call.body.id}/hangup`)).body.status).toBe('cancelled');
    const missedB = (await b.client.get('/calls?filter=missed')).body.items as { id: string }[];
    expect(missedB.map((c) => c.id)).toEqual([call.body.id]);
    expect((await a.client.get('/calls?filter=missed')).body.items).toEqual([]);
    expect((await a.client.get('/calls')).body.items).toHaveLength(1);
  });
});

describe('каналы', () => {
  it('комментарии, просмотры, блокировки и настройки доступа', async () => {
    const owner = await registerUser(app);
    const reader = await registerUser(app);
    const troll = await registerUser(app);
    const ch = await owner.client.post('/chats/channel', { title: 'Канал', isPublic: true });
    const id = ch.body.id as string;
    expect(ch.body.commentsEnabled).toBe(true);
    await reader.client.post(`/chats/${id}/join`);
    await troll.client.post(`/chats/${id}/join`);
    const post = await owner.client.post(`/chats/${id}/messages`, { clientId: cid(), text: 'Первый пост' });
    expect(post.body.viewCount).toBe(1);

    // Комментарий не попадает в ленту канала, но увеличивает счётчик
    const c1 = await reader.client.post(`/chats/${id}/messages/${post.body.id}/comments`, { clientId: cid(), text: 'Отлично!' });
    expect(c1.status).toBe(201);
    expect(c1.body.threadRootId).toBe(post.body.id);
    const feed = await reader.client.get(`/chats/${id}/messages`);
    expect(feed.body.items.map((m: { id: string }) => m.id)).not.toContain(c1.body.id);
    const thread = await owner.client.get(`/chats/${id}/messages/${post.body.id}/comments`);
    expect(thread.body.items).toHaveLength(1);
    expect(thread.body.root.commentCount).toBe(1);
    // Подписчик по-прежнему не может публиковать посты
    expect((await reader.client.post(`/chats/${id}/messages`, { clientId: cid(), text: 'спам' })).status).toBe(403);

    // Просмотр считается один раз на человека
    await reader.client.post(`/chats/${id}/views`, { messageIds: [post.body.id] });
    const again = await reader.client.post(`/chats/${id}/views`, { messageIds: [post.body.id] });
    expect(again.body.views[post.body.id]).toBe(1);
    await troll.client.post(`/chats/${id}/views`, { messageIds: [post.body.id] });
    const counted = await owner.client.get(`/chats/${id}/messages`);
    expect(counted.body.items.find((m: { id: string }) => m.id === post.body.id).viewCount).toBe(2);

    // Блокировка: только администраторы; заблокированный не вернётся
    expect((await reader.client.post(`/chats/${id}/bans`, { userId: troll.user.id })).status).toBe(403);
    expect((await owner.client.post(`/chats/${id}/bans`, { userId: troll.user.id, days: 0 })).status).toBe(200);
    expect((await troll.client.post(`/chats/${id}/join`)).status).toBe(403);
    expect((await troll.client.post(`/chats/${id}/messages/${post.body.id}/comments`, { clientId: cid(), text: 'а я вернулся' })).status).toBe(404);
    expect((await owner.client.get(`/chats/${id}/bans`)).body.items[0].user.id).toBe(troll.user.id);
    await owner.client.del(`/chats/${id}/bans/${troll.user.id}`);
    expect((await troll.client.post(`/chats/${id}/join`)).status).toBe(200);

    // Администратор, назначенный владельцем, модерирует комментарии
    await owner.client.patch(`/chats/${id}/members/${reader.user.id}`, { role: 'admin' });
    const c2 = await troll.client.post(`/chats/${id}/messages/${post.body.id}/comments`, { clientId: cid(), text: 'грубость' });
    expect((await reader.client.del(`/chats/${c2.body.chatId}/messages/${c2.body.id}?forEveryone=true`)).status).toBe(200);
    expect((await owner.client.get(`/chats/${id}/messages/${post.body.id}/comments`)).body.root.commentCount).toBe(1);

    // Комментарии выключает администратор; закрытый канал не виден в поиске
    expect((await troll.client.patch(`/chats/${id}`, { commentsEnabled: false })).status).toBe(403);
    expect((await owner.client.patch(`/chats/${id}`, { commentsEnabled: false, isPublic: false })).body).toMatchObject({ commentsEnabled: false, isPublic: false });
    expect((await troll.client.post(`/chats/${id}/messages/${post.body.id}/comments`, { clientId: cid(), text: 'ещё' })).status).toBe(403);
    expect((await troll.client.get('/chats/discover')).body.items.map((c: { id: string }) => c.id)).not.toContain(id);
  });

  it('открытые и закрытые группы', async () => {
    const a = await registerUser(app);
    const b = await registerUser(app);
    const open = await a.client.post('/chats/group', { title: 'Открытая', isPublic: true });
    const closed = await a.client.post('/chats/group', { title: 'Закрытая' });
    expect(open.body.isPublic).toBe(true);
    expect((await b.client.post(`/chats/${open.body.id}/join`)).status).toBe(200);
    expect((await b.client.post(`/chats/${closed.body.id}/join`)).status).toBe(403);
  });
});

describe('звонки: STUN и TURN', () => {
  it('без TURN клиент узнаёт, что резервного маршрута нет', async () => {
    const u = await registerUser(app);
    const r = await u.client.get('/calls/config');
    expect(r.body.relay).toBe(false);
    expect(r.body.turnSource).toBeNull();
    expect(JSON.stringify(r.body.iceServers)).toContain('stun:');
  });

  it('свой TURN из окружения выдаётся вместе с учётными данными', async () => {
    const turnApp = await createTestApp({ TURN_URLS: 'turn:turn.example.com:3478', TURN_USERNAME: 'u', TURN_CREDENTIAL: 'p' });
    try {
      const u = await registerUser(turnApp);
      const r = await u.client.get('/calls/config');
      expect(r.body).toMatchObject({ relay: true, turnSource: 'static' });
      expect(r.body.iceServers.some((s: { urls: string[]; username?: string }) => s.urls.includes('turn:turn.example.com:3478') && s.username === 'u')).toBe(true);
      // Без входа настройки не выдаются
      expect((await new Client(turnApp).get('/calls/config')).status).toBe(401);
    } finally {
      await turnApp.close();
    }
  });
});
