'use strict';
// Ярлыки Windows (рабочий стол и меню «Пуск») меняются вместе с временем суток:
// днём — «Sunnet» с закатом, ночью — «Lynnet» с луной. Заодно убираем старый
// ярлык «SpaceUp», который остался от прошлых версий.
//
// Анимацию при наведении на значок рабочего стола Windows не поддерживает:
// значок ярлыка — статичная картинка из .ico, поэтому меняем имя и картинку.

const fs = require('node:fs');
const path = require('node:path');
const { app, shell } = require('electron');

const APP_ID = 'app.spaceup.desktop';
const NAMES = ['Sunnet', 'Lynnet', 'SpaceUp'];

/** Значки ярлыков должны лежать вне asar — копируем их в папку данных приложения. */
function iconPath(night) {
  const name = night ? 'icon-night.ico' : 'icon-day.ico';
  const dir = path.join(app.getPath('userData'), 'icons');
  const file = path.join(dir, name);
  try {
    fs.mkdirSync(dir, { recursive: true });
    const src = path.join(__dirname, 'assets', name);
    const srcSize = fs.statSync(src).size;
    if (!fs.existsSync(file) || fs.statSync(file).size !== srcSize) fs.copyFileSync(src, file);
    return file;
  } catch {
    return process.execPath;
  }
}

const same = (a, b) => !!a && !!b && path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();

/** Наш ли это ярлык: ведёт на это приложение или на старую установку SpaceUp. */
function isOurs(file, exe) {
  let target = '';
  try {
    target = shell.readShortcutLink(file).target;
  } catch {
    return false;
  }
  if (same(target, exe)) return true;
  const base = path.basename(file, '.lnk');
  return base === 'SpaceUp' && (/spaceup/i.test(target) || !fs.existsSync(target));
}

function syncShortcuts(night) {
  if (process.platform !== 'win32' || !app.isPackaged) return;
  const exe = process.execPath;
  const name = night ? 'Lynnet' : 'Sunnet';
  const dirs = [app.getPath('desktop'), path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs')];
  for (const dir of dirs) {
    try {
      // Ярлык создаём, только если он уже был: удалённый пользователем не возвращаем
      let had = false;
      for (const old of NAMES) {
        const file = path.join(dir, `${old}.lnk`);
        if (!fs.existsSync(file) || !isOurs(file, exe)) continue;
        had = true;
        if (old !== name) fs.rmSync(file, { force: true });
      }
      if (!had) continue;
      const file = path.join(dir, `${name}.lnk`);
      const link = { target: exe, cwd: path.dirname(exe), description: name, icon: iconPath(night), iconIndex: 0, appUserModelId: APP_ID };
      shell.writeShortcutLink(file, fs.existsSync(file) ? 'replace' : 'create', link);
    } catch {
      // нет доступа к папке — пропускаем
    }
  }
}

module.exports = { syncShortcuts };
