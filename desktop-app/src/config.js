'use strict';
// Адрес сайта SpaceUp, который открывает приложение.
// Порядок: переменная окружения SPACEUP_URL (удобно при разработке) →
// src/config.json, который записывается при сборке (scripts/write-config.js) →
// адрес по умолчанию. Модуль не зависит от Electron, поэтому его использует и скрипт сборки.

const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_URL = 'https://omni-w0fb.onrender.com';

// Пропускаем только https (и http для локальной разработки), иначе null.
function normalizeUrl(value) {
  if (typeof value !== 'string' || value.trim() === '') return null;
  try {
    const url = new URL(value.trim());
    const isLocal = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
    if (url.protocol === 'https:' || (url.protocol === 'http:' && isLocal)) return url.href;
  } catch {
    // некорректный адрес — ниже вернём null
  }
  return null;
}

function readBakedUrl() {
  try {
    const raw = fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8');
    return JSON.parse(raw).url;
  } catch {
    return undefined; // файла нет (например, при `npm start`) — это нормально
  }
}

function resolveSiteUrl() {
  return normalizeUrl(process.env.SPACEUP_URL) ?? normalizeUrl(readBakedUrl()) ?? DEFAULT_URL;
}

module.exports = { DEFAULT_URL, normalizeUrl, resolveSiteUrl };
