'use strict';
// Обновления как у игровых лаунчеров: при запуске приложение спрашивает GitHub
// Releases, есть ли версия новее. Если есть — главное окно прячется, появляется
// небольшое окно с прогрессом загрузки, затем установка и перезапуск.
// Работает в Windows (установщик NSIS) и в Linux (AppImage). На macOS без
// платной подписи Apple обновление не установить — там сайт предложит скачать.

const path = require('node:path');
const { app, BrowserWindow } = require('electron');

const CHECK_TIMEOUT_MS = 15_000;
const RECHECK_MS = 6 * 60 * 60 * 1000;

function supported() {
  if (!app.isPackaged) return false;
  if (process.platform === 'win32') return true;
  return process.platform === 'linux' && !!process.env.APPIMAGE;
}

/**
 * @param {{ getMainWindow: () => BrowserWindow | null, isNight: () => boolean, log?: (msg: string) => void }} opts
 */
function startUpdater({ getMainWindow, isNight, log = () => {} }) {
  if (!supported()) return;
  let autoUpdater;
  try {
    ({ autoUpdater } = require('electron-updater'));
  } catch (err) {
    log(`updater unavailable: ${err}`);
    return;
  }
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = null;

  let win = null;
  let phase = 'idle';
  let version = '';

  const send = (state) => {
    if (!win || win.isDestroyed()) return;
    win.webContents.executeJavaScript(`window.updateState && window.updateState(${JSON.stringify(state)})`).catch(() => {});
  };

  function openWindow(version) {
    if (win && !win.isDestroyed()) return;
    win = new BrowserWindow({
      width: 420,
      height: 380,
      resizable: false,
      maximizable: false,
      minimizable: true,
      fullscreenable: false,
      frame: false,
      show: false,
      center: true,
      title: 'Обновление Sunnet',
      backgroundColor: '#14161d',
      skipTaskbar: false,
      webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false },
    });
    win.loadFile(path.join(__dirname, 'update.html'), { query: { night: isNight() ? '1' : '0' } }).catch(() => {});
    win.once('ready-to-show', () => {
      win.show();
      send({ phase: 'found', version });
    });
    win.on('closed', () => {
      win = null;
      // Окно закрыли посреди загрузки — обновление доустановится при выходе
      if (phase !== 'installing') showMain();
    });
  }

  function showMain() {
    const main = getMainWindow();
    if (main && !main.isDestroyed() && !main.isVisible()) main.show();
  }

  function fail(err) {
    log(`update failed: ${err}`);
    if (phase === 'idle' || phase === 'checking') {
      phase = 'idle';
      return;
    }
    phase = 'idle';
    send({ phase: 'error' });
    setTimeout(() => {
      if (win && !win.isDestroyed()) win.close();
      showMain();
    }, 2200);
  }

  autoUpdater.on('update-available', (info) => {
    if (phase !== 'checking') return;
    phase = 'downloading';
    version = info.version;
    // Как в лаунчерах: сначала обновление, потом приложение
    const main = getMainWindow();
    if (main && !main.isDestroyed()) main.hide();
    openWindow(info.version);
    autoUpdater.downloadUpdate().catch(fail);
  });
  autoUpdater.on('update-not-available', () => {
    phase = 'idle';
  });
  autoUpdater.on('download-progress', (p) => {
    send({ phase: 'downloading', version, percent: p.percent, transferred: p.transferred, total: p.total, speed: p.bytesPerSecond });
  });
  autoUpdater.on('update-downloaded', () => {
    phase = 'installing';
    send({ phase: 'installing' });
    // Тихая установка и перезапуск новой версии
    setTimeout(() => autoUpdater.quitAndInstall(true, true), 1200);
  });
  autoUpdater.on('error', fail);

  const check = () => {
    if (phase !== 'idle') return;
    phase = 'checking';
    const timer = setTimeout(() => phase === 'checking' && (phase = 'idle'), CHECK_TIMEOUT_MS);
    autoUpdater
      .checkForUpdates()
      .catch(fail)
      .finally(() => clearTimeout(timer));
  };
  check();
  // Приложение открыто сутками — проверяем изредка; найденное предложим так же
  setInterval(check, RECHECK_MS).unref?.();
}

module.exports = { startUpdater };
