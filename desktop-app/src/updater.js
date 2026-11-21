'use strict';
// Обновления без участия пользователя, как у игровых лаунчеров.
// При запуске и каждые несколько минут приложение спрашивает GitHub Releases,
// есть ли версия новее, скачивает её с прогрессом, ставит тихо и перезапускается.
// Когда и как показывать окно обновления, решает main.js.
// Работает в Windows (установщик NSIS) и Linux (AppImage). На macOS без
// платной подписи Apple обновление не установить — там сайт предложит скачать.

const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');

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
    // Раньше журнал был выключен (logger = null), и сбои обновления невозможно было
    // разобрать. Теперь всё пишется в <userData>/updater.log (последние ~200 КБ).
    updater.logger = fileLogger();
    // Ошибки сети не должны валить приложение — их обрабатывают вызовы ниже
    updater.on('error', (e) => updater.logger.error(`error: ${e?.stack || e}`));
  } catch {
    updater = null;
  }
  return updater;
}

function fileLogger() {
  const file = path.join(app.getPath('userData'), 'updater.log');
  const write = (level) => (msg) => {
    try {
      const st = fs.statSync(file, { throwIfNoEntry: false });
      if (st && st.size > 200_000) fs.renameSync(file, `${file}.old`);
      fs.appendFileSync(file, `${new Date().toISOString()} ${level} ${typeof msg === 'string' ? msg : JSON.stringify(msg)}\n`);
    } catch {
      // журнал не важнее обновления
    }
  };
  return { info: write('INFO'), warn: write('WARN'), error: write('ERROR'), debug: () => {} };
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const withTimeout = (promise, ms) => Promise.race([promise, delay(ms).then(() => Promise.reject(new Error('timeout')))]);

/**
 * Новая версия (сведения о ней) или null: нет обновления, нет связи, не дождались.
 * Две попытки: первая проверка после запуска иногда упирается в медленный ответ GitHub.
 */
async function findUpdate(timeoutMs = 8000) {
  const u = get();
  if (!u) return null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const result = await withTimeout(u.checkForUpdates(), timeoutMs);
      if (!result?.updateInfo) return null;
      const available = result.isUpdateAvailable ?? isNewer(result.updateInfo.version, app.getVersion());
      u.logger.info(`check: current ${app.getVersion()}, latest ${result.updateInfo.version}, update ${available}`);
      return available ? result.updateInfo : null;
    } catch (e) {
      u.logger.warn(`check failed (attempt ${attempt + 1}): ${e?.message || e}`);
      if (attempt === 0) await delay(2000);
    }
  }
  return null;
}

/** 1.10.0 > 1.9.3 — сравнение по числам, а не строкой. */
function isNewer(a, b) {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  return false;
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

module.exports = { findUpdate, download, install, consumeHiddenMarker, withTimeout, delay };
