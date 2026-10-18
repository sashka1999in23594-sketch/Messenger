'use strict';
// Запоминает размер, положение и развёрнутость окна между запусками.
// Хранится в небольшом JSON в папке данных приложения (app.getPath('userData')).

const fs = require('node:fs');
const path = require('node:path');
const { app, screen } = require('electron');

const DEFAULT_SIZE = { width: 1280, height: 820 };
const MIN_SIZE = { width: 380, height: 600 };

const stateFile = () => path.join(app.getPath('userData'), 'window-state.json');

// Окно считается видимым, если заметная его часть попадает хотя бы на один монитор
// (монитор могли отключить или поменять разрешение с прошлого запуска).
function isOnScreen(b) {
  return screen.getAllDisplays().some(({ workArea: a }) => {
    const overlapX = Math.min(b.x + b.width, a.x + a.width) - Math.max(b.x, a.x);
    const overlapY = Math.min(b.y + b.height, a.y + a.height) - Math.max(b.y, a.y);
    return overlapX >= 100 && overlapY >= 50;
  });
}

// Вызывать после app.whenReady(): модулю screen нужен готовый Electron.
function load() {
  let saved = {};
  try {
    saved = JSON.parse(fs.readFileSync(stateFile(), 'utf8')) ?? {};
  } catch {
    // первый запуск или повреждённый файл — берём размеры по умолчанию
  }
  const size = (value, min, fallback) =>
    Number.isFinite(value) ? Math.max(min, Math.round(value)) : fallback;
  const bounds = {
    width: size(saved.width, MIN_SIZE.width, DEFAULT_SIZE.width),
    height: size(saved.height, MIN_SIZE.height, DEFAULT_SIZE.height),
  };
  if (Number.isFinite(saved.x) && Number.isFinite(saved.y)) {
    const placed = { ...bounds, x: Math.round(saved.x), y: Math.round(saved.y) };
    if (isOnScreen(placed)) Object.assign(bounds, placed);
  }
  // Без x/y Electron сам поставит окно по центру экрана.
  return { bounds, isMaximized: saved.isMaximized === true };
}

function save(win) {
  if (win.isDestroyed()) return;
  // getNormalBounds — размеры «обычного» окна, даже если сейчас оно развёрнуто или свёрнуто.
  const data = { ...win.getNormalBounds(), isMaximized: win.isMaximized() };
  try {
    const file = stateFile();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(`${file}.tmp`, JSON.stringify(data));
    fs.renameSync(`${file}.tmp`, file); // атомарная замена, чтобы не оставить полфайла
  } catch {
    // не удалось сохранить — не страшно, в следующий раз откроемся с размерами по умолчанию
  }
}

// Сохраняем с задержкой при изменениях (на случай аварийного выхода) и сразу при закрытии.
function track(win) {
  let timer = null;
  const saveSoon = () => {
    clearTimeout(timer);
    timer = setTimeout(() => save(win), 500);
  };
  for (const event of ['resize', 'move', 'maximize', 'unmaximize']) win.on(event, saveSoon);
  win.on('close', () => {
    clearTimeout(timer);
    save(win);
  });
}

module.exports = { load, track, MIN_SIZE };
