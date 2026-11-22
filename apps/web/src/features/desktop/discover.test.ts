import { beforeEach, describe, expect, it } from 'vitest';
import { pickFeature } from './discover';

describe('подбор возможностей', () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    };
  });

  it('предлагает то, что рядом с интересами, и не повторяет увиденное', () => {
    const u = { score: { messenger: 10 }, seen: ['/chats'], muted: {}, shownAt: 0, updatedAt: Date.now() };
    const p = pickFeature(u);
    expect(p).not.toBeNull();
    expect(p!.node.path).not.toBe('/chats');
    // Мессенджер или связанные с ним разделы
    expect(['Мессенджер', 'Звонки', 'Каналы', 'Сообщества', 'Серверы', 'Чаты']).toContain(p!.section);
  });

  it('«Не интересно» приглушает раздел', () => {
    const u = { score: { messenger: 10 }, seen: [], muted: { messenger: Date.now() + 1e9 }, shownAt: 0, updatedAt: Date.now() };
    for (let i = 0; i < 10; i++) expect(pickFeature(u)?.section).not.toBe('Мессенджер');
  });
});
