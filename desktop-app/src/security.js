'use strict';
// Разрешения сайта, демонстрация экрана и правила навигации.
// Всё, что не относится к адресу SpaceUp, запрещено или открывается в обычном браузере.

const { desktopCapturer, screen, shell, systemPreferences } = require('electron');

// Что сайту SpaceUp можно: камера и микрофон (звонки, голосовые), уведомления,
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

  // Демонстрация экрана (getDisplayMedia). Своего окна выбора источника у нас нет,
  // поэтому отдаём основной монитор: это самый частый сценарий, и он работает
  // одинаково на всех системах. Окна — запасной вариант, если экранов нет в списке
  // (на Wayland система сама показывает окно выбора и возвращает один источник).
  ses.setDisplayMediaRequestHandler((request, callback) => {
    const origin = originOf(request.securityOrigin) ?? originOf(request.frame?.url);
    if (origin !== appOrigin || !request.videoRequested) return callback(null);

    desktopCapturer
      .getSources({ types: ['screen', 'window'], thumbnailSize: { width: 0, height: 0 } })
      .then((sources) => {
        const primaryId = String(screen.getPrimaryDisplay().id);
        const source =
          sources.find((s) => s.display_id === primaryId) ??
          sources.find((s) => s.id.startsWith('screen:')) ??
          sources[0];
        if (!source) return callback(null);
        const streams = { video: source };
        // Звук системы Electron умеет захватывать только в Windows.
        if (request.audioRequested && process.platform === 'win32') streams.audio = 'loopback';
        callback(streams);
      })
      .catch(() => callback(null));
  });
}

// Ссылки внутри SpaceUp остаются в приложении, всё остальное — в браузере по умолчанию.
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
