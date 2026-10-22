'use strict';
// Разрешения сайта, демонстрация экрана и правила навигации.
// Всё, что не относится к адресу Sunnet, запрещено или открывается в обычном браузере.

const path = require('node:path');
const { BrowserWindow, desktopCapturer, shell, systemPreferences, webContents } = require('electron');

// Что сайту Sunnet можно: камера и микрофон (звонки, голосовые), уведомления,
// запись в буфер обмена, полноэкранное видео. display-capture — демонстрация экрана:
// сам источник выбирает setDisplayMediaRequestHandler ниже.
const ALLOWED_PERMISSIONS = new Set([
  'media',
  'notifications',
  'clipboard-sanitized-write',
  'fullscreen',
  'display-capture',
]);

// Схемы, которые можно отдать системе: сайты — в браузер, mailto: — в почтовую программу.
const EXTERNAL_PROTOCOLS = new Set(['https:', 'http:', 'mailto:']);

function originOf(url) {
  try {
    const { origin } = new URL(url);
    return origin === 'null' ? null : origin;
  } catch {
    return null;
  }
}

function openExternal(url) {
  let protocol;
  try {
    protocol = new URL(url).protocol;
  } catch {
    return;
  }
  if (EXTERNAL_PROTOCOLS.has(protocol)) shell.openExternal(url).catch(() => {});
}

// macOS спрашивает доступ к камере и микрофону у самого приложения (а не у сайта),
// поэтому запрашиваем его в тот момент, когда сайт просит медиа.
async function askMacMediaAccess(mediaTypes = []) {
  if (process.platform !== 'darwin') return true;
  const kinds = [];
  if (mediaTypes.includes('audio')) kinds.push('microphone');
  if (mediaTypes.includes('video')) kinds.push('camera');
  for (const kind of kinds) {
    if (!(await systemPreferences.askForMediaAccess(kind))) return false;
  }
  return true;
}

function setupPermissions(ses, appOrigin) {
  ses.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const origin = originOf(details.requestingUrl) ?? originOf(webContents.getURL());
    if (origin !== appOrigin) return callback(false);

    // Переход по ссылке mailto: Chromium оформляет как запрос «открыть внешнее приложение».
    if (permission === 'openExternal') {
      return callback(String(details.externalURL ?? '').startsWith('mailto:'));
    }
    if (!ALLOWED_PERMISSIONS.has(permission)) return callback(false);
    if (permission === 'media') {
      askMacMediaAccess(details.mediaTypes).then(callback, () => callback(false));
      return;
    }
    callback(true);
  });

  // Проверки без запроса (Notification.permission, подписи устройств и т. п.).
  ses.setPermissionCheckHandler((_webContents, permission, requestingOrigin) => {
    return ALLOWED_PERMISSIONS.has(permission) && originOf(requestingOrigin) === appOrigin;
  });

  // Демонстрация экрана (getDisplayMedia): своё окно выбора — весь экран или
  // отдельное окно, с миниатюрами. Звук системы Electron захватывает только в Windows.
  ses.setDisplayMediaRequestHandler((request, callback) => {
    const origin = originOf(request.securityOrigin) ?? originOf(request.frame?.url);
    if (origin !== appOrigin || !request.videoRequested) return callback(null);

    desktopCapturer
      .getSources({ types: ['screen', 'window'], thumbnailSize: { width: 320, height: 180 }, fetchWindowIcons: true })
      .then(async (sources) => {
        // Своё окно Sunnet в списке не нужно — его показ бесконечно отражался бы сам в себе
        const own = new Set(BrowserWindow.getAllWindows().map((w) => w.getMediaSourceId()));
        const list = sources.filter((s) => !own.has(s.id));
        if (!list.length) return callback(null);
        const wc = request.frame ? webContents.fromFrame(request.frame) : null;
        const parent = wc ? BrowserWindow.fromWebContents(wc) : null;
        const source = await pickSource(list, parent);
        if (process.env.SUNNET_DEBUG) console.error('display media: sources', list.length, 'own', [...own], 'picked', source?.id ?? null);
        if (!source) return callback(null);
        const streams = { video: source };
        if (request.audioRequested && process.platform === 'win32') streams.audio = 'loopback';
        callback(streams);
      })
      .catch((err) => {
        if (process.env.SUNNET_DEBUG) console.error('display media:', err);
        callback(null);
      });
  });
}

/** Окно выбора источника: экраны и окна с миниатюрами. Возвращает источник или null. */
function pickSource(sources, parent) {
  return new Promise((resolve) => {
    const win = new BrowserWindow({
      width: 760,
      height: 560,
      parent: parent ?? undefined,
      modal: !!parent,
      resizable: true,
      minimizable: false,
      maximizable: false,
      title: 'Что показать участникам',
      backgroundColor: '#12151c',
      autoHideMenuBar: true,
      show: false,
      webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false },
    });
    let done = false;
    const finish = (value, why) => {
      if (process.env.SUNNET_DEBUG) console.error('picker finish:', why);
      if (done) return;
      done = true;
      resolve(value);
      if (!win.isDestroyed()) win.close();
    };
    const screens = sources.filter((s) => s.id.startsWith('screen:'));
    const data = sources.map((s) => ({
      id: s.id,
      // Экраны система называет по-английски («Entire screen») — подписываем сами
      name: s.id.startsWith('screen:') ? (screens.length > 1 ? `Экран ${screens.indexOf(s) + 1}` : 'Весь экран') : s.name,
      kind: s.id.startsWith('screen:') ? 'screen' : 'window',
      thumb: s.thumbnail.toDataURL(),
      icon: s.appIcon && !s.appIcon.isEmpty() ? s.appIcon.toDataURL() : null,
    }));
    win.webContents.on('did-navigate-in-page', (_e, url) => {
      const hash = new URL(url).hash.slice(1);
      if (hash === 'cancel') return finish(null, 'cancel');
      if (hash.startsWith('pick:')) finish(sources.find((s) => s.id === hash.slice(5)) ?? null, 'pick');
    });
    win.on('closed', () => finish(null, 'closed'));
    win.once('ready-to-show', () => win.show());
    win
      .loadFile(path.join(__dirname, 'picker.html'))
      .then(() => win.webContents.executeJavaScript(`window.setSources(${JSON.stringify(data)})`))
      .catch((err) => {
        if (process.env.SUNNET_DEBUG) console.error('picker:', err);
        finish(null);
      });
  });
}

// Ссылки внутри Sunnet остаются в приложении, всё остальное — в браузере по умолчанию.
function setupNavigation(webContents, appOrigin) {
  webContents.setWindowOpenHandler(({ url }) => {
    if (originOf(url) === appOrigin) webContents.loadURL(url).catch(() => {});
    else openExternal(url);
    return { action: 'deny' }; // новых окон Electron не создаём
  });

  webContents.on('will-navigate', (event, legacyUrl) => {
    const url = event.url ?? legacyUrl;
    if (originOf(url) === appOrigin) return;
    event.preventDefault();
    openExternal(url);
  });

  // Встроенные <webview> сайту не нужны.
  webContents.on('will-attach-webview', (event) => event.preventDefault());
}

module.exports = { originOf, setupPermissions, setupNavigation };
