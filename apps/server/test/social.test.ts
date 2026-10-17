import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, PNG_1x1, registerUser } from './helpers.js';

let app: FastifyInstance;
beforeAll(async () => {
  app = await createTestApp();
});
afterAll(async () => {
  await app.close();
});

async function follow(a: Awaited<ReturnType<typeof registerUser>>, b: Awaited<ReturnType<typeof registerUser>>) {
  expect((await a.client.post(`/users/${b.user.id}/follow`)).status).toBe(200);
}

async function story(u: Awaited<ReturnType<typeof registerUser>>, body: Record<string, unknown> = {}) {
  const m = await u.client.upload(PNG_1x1, 's.png');
  const res = await u.client.post('/stories', { mediaId: m.body.id, ...body });
  expect(res.status).toBe(201);
  return res.body as { id: string; audience: string };
}

describe('истории', () => {
  it('«Близкие друзья» видят историю, остальные подписчики — нет', async () => {
    const author = await registerUser(app);
    const friend = await registerUser(app);
    const other = await registerUser(app);
    await follow(friend, author);
    await follow(other, author);
    await author.client.post('/me/close-friends', { userIds: [friend.user.id] });
    const s = await story(author, { audience: 'close' });
    expect(s.audience).toBe('close');

    const feedFriend = (await friend.client.get('/stories')).body.items as { author: { id: string } }[];
    expect(feedFriend.some((g) => g.author.id === author.user.id)).toBe(true);
    const feedOther = (await other.client.get('/stories')).body.items as { author: { id: string } }[];
    expect(feedOther.some((g) => g.author.id === author.user.id)).toBe(false);
    expect((await other.client.get(`/stories/${s.id}`)).status).toBe(404);
    expect((await other.client.post(`/stories/${s.id}/view`)).status).toBe(404);
    // Профиль: кольцо историй только у близкого друга
    expect((await friend.client.get(`/users/${author.user.id}`)).body.storyRing).toBe('unseen');
    expect((await other.client.get(`/users/${author.user.id}`)).body.storyRing).toBeNull();
  });

  it('реакция видна автору в списке просмотревших и приходит уведомлением', async () => {
    const author = await registerUser(app);
    const fan = await registerUser(app);
    await follow(fan, author);
    const s = await story(author);
    expect((await author.client.post(`/stories/${s.id}/react`, { emoji: '🔥' })).status).toBe(400);
    expect((await fan.client.post(`/stories/${s.id}/react`, { emoji: 'abc' })).status).toBe(400);
    const r = await fan.client.post(`/stories/${s.id}/react`, { emoji: '🔥' });
    expect(r.body.myReaction).toBe('🔥');
    const viewers = (await author.client.get(`/stories/${s.id}/viewers`)).body.items;
    expect(viewers[0]).toMatchObject({ user: { id: fan.user.id }, reaction: '🔥' });
    expect((await fan.client.get(`/stories/${s.id}/viewers`)).status).toBe(403);
    const notes = (await author.client.get('/notifications?filter=likes')).body.items as { type: string }[];
    expect(notes.some((n) => n.type === 'story_reaction')).toBe(true);
    expect((await author.client.get('/stories')).body.items[0].stories[0].reactionCount).toBe(1);
  });

  it('архив и «Актуальное»: истёкшая история видна из подборки, но не из ленты', async () => {
    const author = await registerUser(app);
    const viewer = await registerUser(app);
    await follow(viewer, author);
    const s1 = await story(author);
    const s2 = await story(author);
    const other = await registerUser(app);
    const foreign = await story(other);
    expect((await author.client.post('/highlights', { title: 'Лето', storyIds: [s1.id, foreign.id] })).status).toBe(400);
    const h = await author.client.post('/highlights', { title: 'Лето', storyIds: [s1.id, s2.id], coverStoryId: s2.id });
    expect(h.status).toBe(201);
    expect(h.body.count).toBe(2);

    // Состарим первую историю
    app.ctx.db.run('UPDATE stories SET expires_at = :t WHERE id = :id', { t: Date.now() - 1000, id: s1.id });
    expect((await viewer.client.get(`/users/${author.user.id}/stories`)).body.items).toHaveLength(1);
    const hs = await viewer.client.get(`/highlights/${h.body.id}`);
    expect(hs.body.stories.map((x: { id: string }) => x.id)).toEqual([s1.id, s2.id]);
    expect(hs.body.stories[0].expired).toBe(true);
    expect((await viewer.client.get(`/stories/${s1.id}`)).status).toBe(200);

    const archive = (await author.client.get('/me/stories/archive')).body.items as { id: string }[];
    expect(archive.map((x) => x.id)).toEqual([s2.id, s1.id]);
    expect((await viewer.client.get(`/users/${author.user.id}/highlights`)).body.items).toHaveLength(1);
    // Чужую подборку менять нельзя
    expect((await viewer.client.del(`/highlights/${h.body.id}`)).status).toBe(404);
    // Без подборки истёкшая история недоступна
    await author.client.put(`/highlights/${h.body.id}`, { title: 'Лето', storyIds: [s2.id] });
    expect((await viewer.client.get(`/stories/${s1.id}`)).status).toBe(404);
  });
});

describe('профиль', () => {
  it('статус, ссылки, закреплённая публикация и общие подписки', async () => {
    const a = await registerUser(app);
    const b = await registerUser(app);
    const c = await registerUser(app);
    expect((await a.client.put('/me/status', { emoji: '🚀', text: 'Работаю' })).body.status).toMatchObject({ emoji: '🚀', text: 'Работаю' });
    expect((await a.client.put('/me/status', { emoji: 'нет', text: '' })).status).toBe(400);
    expect((await a.client.put('/me/links', { links: [{ title: '', url: 'javascript:alert(1)' }] })).status).toBe(400);
    const links = await a.client.put('/me/links', { links: [{ title: '', url: 'https://www.example.com/page' }] });
    expect(links.body.links).toEqual([{ title: 'example.com', url: 'https://www.example.com/page' }]);

    const p1 = await a.client.post('/posts', { kind: 'note', text: 'первый' });
    await a.client.post('/posts', { kind: 'note', text: 'второй' });
    const foreign = await b.client.post('/posts', { kind: 'note', text: 'чужой' });
    expect((await a.client.put('/me/pinned-post', { postId: foreign.body.id })).status).toBe(404);
    expect((await a.client.put('/me/pinned-post', { postId: p1.body.id })).body.pinnedPostId).toBe(p1.body.id);
    const posts = (await b.client.get(`/users/${a.user.id}/posts?tab=posts`)).body.items as { id: string; pinned?: boolean }[];
    expect(posts[0]).toMatchObject({ id: p1.body.id, pinned: true });
    expect(posts.filter((p) => p.id === p1.body.id)).toHaveLength(1);

    // c подписан на b, b подписан на a → для c у a есть общий подписчик b
    await follow(c, b);
    await follow(b, a);
    const prof = (await c.client.get(`/users/${a.user.id}`)).body;
    expect(prof.mutualFollowers.count).toBe(1);
    expect(prof.mutualFollowers.sample[0].id).toBe(b.user.id);
    expect(prof.status.emoji).toBe('🚀');
  });

  it('«колокольчик»: уведомление о новой публикации; отписка снимает его', async () => {
    const author = await registerUser(app);
    const fan = await registerUser(app);
    expect((await fan.client.post(`/users/${fan.user.id}/subscribe`)).status).toBe(400);
    await fan.client.post(`/users/${author.user.id}/subscribe`);
    expect((await fan.client.get(`/users/${author.user.id}`)).body.subscribed).toBe(true);
    await author.client.post('/posts', { kind: 'note', text: 'Новое видео скоро!' });
    const notes = (await fan.client.get('/notifications?filter=posts')).body.items as { type: string }[];
    expect(notes.map((n) => n.type)).toContain('new_post');
    await fan.client.post(`/users/${author.user.id}/follow`);
    await fan.client.del(`/users/${author.user.id}/follow`);
    expect((await fan.client.get(`/users/${author.user.id}`)).body.subscribed).toBe(false);
  });
});

describe('лента', () => {
  it('скрытые слова и #теги убирают публикации из ленты (регистр не важен)', async () => {
    const a = await registerUser(app);
    const b = await registerUser(app);
    await follow(a, b);
    const spoiler = await b.client.post('/posts', { kind: 'note', text: 'СПОЙЛЕРЫ к финалу сезона' });
    const tagged = await b.client.post('/posts', { kind: 'note', text: 'Матч сегодня #футбол' });
    const ok = await b.client.post('/posts', { kind: 'note', text: 'Обычный пост' });
    await a.client.post('/me/muted-words', { word: 'Спойлер' });
    await a.client.post('/me/muted-words', { word: '#футбол' });
    expect((await a.client.get('/me/muted-words')).body.items).toHaveLength(2);
    const ids = ((await a.client.get('/feed/following')).body.items as { id: string }[]).map((p) => p.id);
    expect(ids).toContain(ok.body.id);
    expect(ids).not.toContain(spoiler.body.id);
    expect(ids).not.toContain(tagged.body.id);
    // Чужие ленты не затронуты
    const idsB = ((await b.client.get('/feed/following')).body.items as { id: string }[]).map((p) => p.id);
    expect(idsB).toContain(spoiler.body.id);
  });

  it('черновики, отложенная публикация и ошибки расписания', async () => {
    const a = await registerUser(app);
    const d = await a.client.post('/me/drafts', { kind: 'note', text: '' });
    expect(d.status).toBe(201);
    expect((await a.client.post(`/me/drafts/${d.body.id}/publish`)).status).toBe(400);
    expect((await a.client.post('/me/drafts', { kind: 'note', text: 'x', publishAt: new Date(Date.now() - 1000).toISOString() })).status).toBe(400);
    const sch = await a.client.post('/me/drafts', { kind: 'note', text: 'По расписанию', publishAt: new Date(Date.now() + 3600_000).toISOString() });
    expect(sch.status).toBe(201);
    expect((await a.client.get('/me/drafts?filter=scheduled')).body.items).toHaveLength(1);
    expect((await a.client.get('/me/drafts')).body.items).toHaveLength(1);
    const b = await registerUser(app);
    expect((await b.client.post(`/me/drafts/${sch.body.id}/publish`)).status).toBe(404);

    // Время пришло — фоновая задача публикует
    app.ctx.db.run('UPDATE post_drafts SET publish_at = :t WHERE id = :id', { t: Date.now() - 1, id: sch.body.id });
    expect(app.ctx.services.drafts.publishDue(() => undefined)).toBe(1);
    const posts = (await a.client.get(`/users/${a.user.id}/posts?tab=posts`)).body.items as { text: string }[];
    expect(posts[0]!.text).toBe('По расписанию');
    expect((await a.client.get('/me/drafts?filter=scheduled')).body.items).toHaveLength(0);
  });

  it('списки: лента участников, приватность, чужой список не изменить', async () => {
    const a = await registerUser(app);
    const b = await registerUser(app);
    const c = await registerUser(app);
    const list = await a.client.post('/lists', { name: 'Друзья', isPrivate: true });
    await a.client.post(`/lists/${list.body.id}/members`, { userIds: [b.user.id] });
    const pb = await b.client.post('/posts', { kind: 'note', text: 'от b' });
    await c.client.post('/posts', { kind: 'note', text: 'от c' });
    const feed = (await a.client.get(`/lists/${list.body.id}/feed`)).body.items as { id: string }[];
    expect(feed.map((p) => p.id)).toEqual([pb.body.id]);
    expect((await c.client.get(`/lists/${list.body.id}`)).status).toBe(404);
    expect((await c.client.post(`/lists/${list.body.id}/members`, { userIds: [c.user.id] })).status).toBe(404);
    const mine = (await a.client.get(`/me/lists?memberOf=${b.user.id}`)).body.items;
    expect(mine[0]).toMatchObject({ memberCount: 1, hasMember: true });
    await a.client.put(`/lists/${list.body.id}`, { name: 'Друзья', isPrivate: false });
    expect((await c.client.get(`/lists/${list.body.id}/feed`)).status).toBe(200);
  });

  it('коллекции: добавление ставит закладку, снятие закладки убирает из коллекций; «кто оценил»', async () => {
    const a = await registerUser(app);
    const b = await registerUser(app);
    const post = await b.client.post('/posts', { kind: 'note', text: 'полезное' });
    const col = await a.client.post('/me/collections', { name: 'Полезное', emoji: '💡' });
    const added = await a.client.post(`/me/collections/${col.body.id}/items`, { postId: post.body.id });
    expect(added.body.count).toBe(1);
    expect((await a.client.get(`/posts/${post.body.id}`)).body.viewer.bookmarked).toBe(true);
    expect((await a.client.get(`/me/collections?postId=${post.body.id}`)).body.items[0].hasPost).toBe(true);
    expect((await b.client.get(`/me/collections/${col.body.id}/posts`)).status).toBe(404);
    await a.client.del(`/posts/${post.body.id}/bookmark`);
    expect((await a.client.get(`/me/collections/${col.body.id}`)).body.count).toBe(0);

    await a.client.post(`/posts/${post.body.id}/like`);
    const likers = (await b.client.get(`/posts/${post.body.id}/likers`)).body.items as { id: string }[];
    expect(likers.map((u) => u.id)).toEqual([a.user.id]);
  });
});
