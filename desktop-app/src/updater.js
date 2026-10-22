'use strict';
// Обновления без участия пользователя, как у игровых лаунчеров.
// При запуске окно запуска спрашивает GitHub Releases, есть ли версия новее,
// скачивает её с прогрессом, ставит тихо и перезапускает приложение.
// В фоне (приложение запущено вместе с системой и свёрнуто в трей) обновление
// скачивается само и ставится, пока окном никто не пользуется.
// Работает в Windows (установщик NSIS) и Linux (AppImage). На macOS без
// платной подписи Apple обновление не установить — там сайт предложит скачать.

const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');

const RECHECK_MS = 4 * 60 * 60 * 1000;
/** Метка «после обновления запуститься свёрнутым в трей» */
const markerPath = () => path.join(app.getPath('userData'), 'start-hidden');

let updater;
function get() {
  if (updater !== undefined) return updater;
  updater = null;
  const supported = app.isPackaged && (process.platform === 'win32' || (process.platform === 'linux' && !!process.env.APPIMAGE));
  if (!supported) return null;
  try {
    ({ autoUpdater: updater } = require('electron-updater'));
    updater.autoDownload = false;
    updater.autoInstallOnAppQuit = true;
    updater.logger = null;
    // Ошибки сети не должны валить приложение — их обрабатывают вызовы ниже
    updater.on('error', () => {});
  } catch {
    updater = null;
  }
  return updater;
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const withTimeout = (promise, ms) => Promise.race([promise, delay(ms).then(() => Promise.reject(new Error('timeout')))]);

/** Новая версия (сведения о ней) или null: нет обновления, нет связи, не дождались. */
async function findUpdate(timeoutMs = 8000) {
  const u = get();
  if (!u) return null;
  try {
    const result = await withTimeout(u.checkForUpdates(), timeoutMs);
    if (!result?.updateInfo) return null;
    const available = result.isUpdateAvailable ?? result.updateInfo.version !== app.getVersion();
    return available ? result.updateInfo : null;
  } catch {
    return null;
  }
}

/** Скачать найденное обновление; onProgress получает проценты, байты и скорость. */
async function download(onProgress = () => {}) {
  const u = get();
  if (!u) throw new Error('Обновления недоступны');
  u.on('download-progress', onProgress);
  try {
    await u.downloadUpdate();
  } finally {
    u.off('download-progress', onProgress);
  }
}

/** Тихо поставить скачанное и перезапуститься (свёрнутым в трей, если hidden). */
function install({ hidden = false } = {}) {
  const u = get();
  if (!u) return;
  if (hidden) {
    try {
      fs.writeFileSync(markerPath(), String(Date.now()));
    } catch {
      // не записали — после обновления просто откроется окно запуска
    }
  }
  setImmediate(() => u.quitAndInstall(true, true));
}

/** Запуск после фонового обновления: снова свернуться в трей (метка живёт 15 минут). */
function consumeHiddenMarker() {
  try {
    const at = Number(fs.readFileSync(markerPath(), 'utf8'));
    fs.rmSync(markerPath(), { force: true });
    return Date.now() - at < 15 * 60 * 1000;
  } catch {
    return false;
  }
}

/**
 * Фоновые обновления: проверка сейчас и каждые 4 часа. Скачанное ставится,
 * как только окно скрыто (никто не пользуется), иначе — при выходе.
 * @param {{ idle: () => boolean, onIdle: (cb: () => void) => void }} opts
 */
function updateInBackground({ idle, onIdle }) {
  if (!get()) return;
  let busy = false;
  let ready = false;
  const tryInstall = () => {
    if (ready && idle()) install({ hidden: true });
  };
  onIdle(tryInstall);
  const run = async () => {
    if (busy || ready) return;
    busy = true;
    try {
      const info = await findUpdate(20_000);
      if (info) {
        await download();
        ready = true;
        tryInstall();
      }
    } catch {
      // попробуем при следующей проверке
    } finally {
      busy = false;
    }
  };
  void run();
  setInterval(run, RECHECK_MS).unref?.();
}

module.exports = { findUpdate, download, install, consumeHiddenMarker, updateInBackground, withTimeout, delay };
