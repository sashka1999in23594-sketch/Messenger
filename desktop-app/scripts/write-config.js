'use strict';
// Перед сборкой записывает src/config.json с адресом сайта.
// Адрес берётся из SPACEUP_URL (например, из переменной репозитория в GitHub Actions),
// без неё — адрес по умолчанию из src/config.js.

const fs = require('node:fs');
const path = require('node:path');
const { DEFAULT_URL, normalizeUrl } = require('../src/config');

const raw = process.env.SPACEUP_URL;
const url = raw ? normalizeUrl(raw) : DEFAULT_URL;
if (!url) {
  console.error(`SPACEUP_URL должен быть адресом https://…, получено: ${raw}`);
  process.exit(1);
}

const file = path.join(__dirname, '..', 'src', 'config.json');
fs.writeFileSync(file, `${JSON.stringify({ url }, null, 2)}\n`);
console.log(`Адрес сайта для сборки: ${url} → ${path.relative(process.cwd(), file)}`);
