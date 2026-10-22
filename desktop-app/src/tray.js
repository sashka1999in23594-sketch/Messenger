'use strict';
// Значок у часов (Windows и Linux): Sunnet работает в фоне, присылает
// уведомления и обновляется сам. Здесь же — автозапуск вместе с системой.

const fs = require('node:fs');
const path = require('node:path');
const { app, Menu, nativeImage, Tray } = require('electron');

const settingsPath = () => path.join(app.getPath('userData'), 'desktop-settings.json');

function readSettings() {
  try {
    return JSON.parse(fs.readFileSync(settingsPath(), 'utf8'));
  } catch {
    return {};
  }
}

function writeSettings(patch) {
  try {
    fs.writeFileSync(settingsPath(), JSON.stringify({ ...readSettings(), ...patch }));
  } catch {
    // не сохранили — не страшно
  }
}

const autostartSupported = () => app.isPackaged && (process.platform === 'win32' || process.platform === 'darwin');

function setAutostart(on) {
  if (!autostartSupported()) return;
  // При входе в систему — свёрнутым: окно не мешает, а сообщения и обновления приходят
  app.setLoginItemSettings({ openAtLogin: on, openAsHidden: on, args: on ? ['--hidden'] : [] });
  writeSettings({ autostart: on });
}

/** Первый запуск: автозапуск включён по умолчанию (выключается в меню значка). */
function ensureAutostart() {
  if (!autostartSupported()) return;
  const s = readSettings();
  if (s.autostart === undefined) setAutostart(true);
}

const autostartOn = () => autostartSupported() && app.getLoginItemSettings({ args: ['--hidden'] }).openAtLogin;

/**
 * @param {{ onOpen: () => void, onQuit: () => void, night: boolean }} opts
 */
function createTray({ onOpen, onQuit, night }) {
  if (process.platform === 'darwin') return null;
  const image = (isNight) => nativeImage.createFromPath(path.join(__dirname, 'assets', isNight ? 'icon-night.png' : 'icon-day.png')).resize({ width: 32, height: 32, quality: 'best' });
  const tray = new Tray(image(night));
  let name = night ? 'Lynnet' : 'Sunnet';
  const build = () =>
    Menu.buildFromTemplate([
      { label: `Открыть ${name}`, click: onOpen },
      { type: 'separator' },
      ...(autostartSupported()
        ? [{ label: 'Запускать вместе с системой', type: 'checkbox', checked: autostartOn(), click: (item) => setAutostart(item.checked) }, { type: 'separator' }]
        : []),
      { label: 'Выйти', click: onQuit },
    ]);
  tray.setToolTip(name);
  tray.setContextMenu(build());
  tray.on('click', onOpen);
  tray.on('double-click', onOpen);
  return {
    tray,
    /** День сменился ночью — другой значок и имя */
    setNight(isNight) {
      name = isNight ? 'Lynnet' : 'Sunnet';
      tray.setImage(image(isNight));
      tray.setToolTip(name);
      tray.setContextMenu(build());
    },
    /** Один раз подсказать, что приложение продолжает работать в фоне */
    hint() {
      if (process.platform !== 'win32' || readSettings().trayHinted) return;
      writeSettings({ trayHinted: true });
      tray.displayBalloon({ title: name, content: 'Продолжает работать в фоне: сообщения и звонки придут. Открыть — щёлкните по значку.', iconType: 'none' });
    },
  };
}

module.exports = { createTray, ensureAutostart };
