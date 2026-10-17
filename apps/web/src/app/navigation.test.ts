import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { findByPath, flatNodes, sectionFor, sections } from './navigation';

/** Маршруты из routes.tsx (разбираем текст, чтобы не тянуть в тест весь React-рендеринг). */
const routesSource = readFileSync(new URL('./routes.tsx', import.meta.url), 'utf8');
const routePatterns = [...routesSource.matchAll(/path="([^"]+)"/g)]
  .map((m) => m[1]!)
  .filter((p) => p !== '*')
  .map((p) => {
    // Вложенные маршруты чатов объявлены относительно /chats
    const full = /^(folder|saved|discover|new|:chatId)/.test(p) ? `/chats/${p}` : `/${p}`;
    return new RegExp(`^${full.replace(/:[a-zA-Z]+/g, '[^/]+')}$`);
  });

describe('реестр навигации', () => {
  it('у всех узлов уникальные id', () => {
    const ids = flatNodes.map((f) => f.node.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('каждый лист ведёт куда-то: у него есть путь', () => {
    for (const { node } of flatNodes) {
      if (!node.children?.length) expect(node.path, node.id).toBeTruthy();
    }
  });

  it('в лабиринте нет тупиков: путь либо реализован, либо помечен как «скоро» с описанием', () => {
    const dead: string[] = [];
    for (const { node } of flatNodes) {
      if (!node.path) continue;
      const routed = routePatterns.some((r) => r.test(node.path!));
      if (!routed && !node.planned?.length) dead.push(`${node.id} → ${node.path}`);
    }
    expect(dead).toEqual([]);
  });

  it('у каждого раздела есть иконка, путь и подразделы', () => {
    for (const s of sections) {
      expect(s.icon).toBeTruthy();
      expect(s.path.startsWith('/')).toBe(true);
      expect(s.children.length).toBeGreaterThan(0);
    }
  });

  it('лабиринт действительно большой: десятки разделов и 3+ уровня вложенности', () => {
    expect(flatNodes.length).toBeGreaterThan(120);
    expect(Math.max(...flatNodes.map((f) => f.trail.length))).toBeGreaterThanOrEqual(2);
  });

  it('находит раздел и ближайший узел для любого адреса', () => {
    expect(sectionFor('/chats/01ABC').id).toBe('messenger');
    expect(sectionFor('/watch/123').id).toBe('video');
    expect(sectionFor('/u/alice').id).toBe('profile');
    expect(findByPath('/settings/security/2fa')?.node.id).toBe('settings.security.2fa');
    expect(findByPath('/chats/folder/groups')?.node.id).toBe('messenger.folders.groups');
  });
});
