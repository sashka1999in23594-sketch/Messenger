// Генерирует компактный набор эмодзи с русскими названиями и ключевыми словами
// для выбора эмодзи в клиенте: apps/web/src/shared/emoji/emoji-ru.json
// Источник — emojibase-data (MIT). Запуск: node scripts/generate-emoji.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const data = require('emojibase-data/ru/data.json');
// Эмодзи до Unicode 14 поддерживаются практически везде; группа 2 — модификаторы тона кожи
const MAX_VERSION = 14;
const list = data
  .filter((e) => e.group !== undefined && e.group !== 2 && e.version <= MAX_VERSION)
  .sort((a, b) => a.order - b.order)
  .map((e) => [e.emoji, e.group, [e.label, ...(e.tags ?? [])].join(' ').toLowerCase()]);
const out = new URL('../apps/web/src/shared/emoji/emoji-ru.json', import.meta.url);
mkdirSync(new URL('.', out), { recursive: true });
writeFileSync(out, JSON.stringify(list));
console.log(`эмодзи: ${list.length}, ${(readFileSync(out).length / 1024).toFixed(0)} КБ`);
