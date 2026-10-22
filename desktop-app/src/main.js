'use strict';
// Sunnet для компьютера: одно окно, в котором открыт сайт Sunnet.
// Вся логика мессенджера живёт на сайте; здесь — окно, разрешения, ссылки,
// экран загрузки, пока сервер просыпается, обновления и ярлыки Sunnet/Lynnet.

const path = require('node:path');
const { app, BrowserWindow, Menu, net, session } = require('electron');
const { resolveSiteUrl } = require('./config');
const windowState = require('./window-state');
const { originOf, setupNavigation, setupPermissions } = require('./security');
const { attachContextMenu, buildAppMenu } = require('./menu');
const { isNight, watchDayNight } = require('./daynight');
const { syncShortcuts } = require('./shortcuts');
const { startUpdater } = require('./updater');

const SITE_URL = resolveSiteUrl();
const APP_ORIGIN = new URL(SITE_URL).origin;
const BACKGROUND = '#0b0b14'; // фон окна, пока сайт загружается
const isMac = process.platform === 'darwin';

let mainWindow = null;
let quitting = false;
let lastCrashAt = 0;
let dayNight = null;

app.enableSandbox(); // песочница для всех страниц, без исключений
if (process.platform === 'win32') app.setAppUserModelId('app.spaceup.desktop'); // нужно для уведомлений Windows

// Второй запуск не открывает вторую копию, а показывает уже открытое окно.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', showMainWindow);
  app.whenReady().then(start);
}

function start() {
  Menu.setApplicationMenu(buildAppMenu({ isDev: !app.isPackaged }));
  app.setAboutPanelOptions({ applicationName: 'Sunnet', copyright: '© Sunnet' });

  const ses = session.defaultSession;
  // На macOS проверка орфографии системная и язык выбирает сама.
  if (!isMac) {
    try {
      ses.setSpellCheckerLanguages(['ru', 'en-US']);
    } catch {
      // словари недоступны — работаем без проверки орфографии
    }
  }
  setupPermissions(ses, APP_ORIGIN);

  createWindow();
  // Ночью значок и ярлыки — луна и «Lynnet», днём — закат и «Sunnet»
  dayNight = watchDayNight(() => mainWindow, syncShortcuts);
  // Вышла новая версия — окно с загрузкой и перезапуск
  startUpdater({ getMainWindow: () => mainWindow, isNight });
  app.on('activate', showMainWindow); // клик по значку в Dock
}

function createWindow() {
  const state = windowState.load();
  mainWindow = new BrowserWindow({
    title: 'Sunnet',
    ...state.bounds,
    minWidth: windowState.MIN_SIZE.width,
    minHeight: windowState.MIN_SIZE.height,
    backgroundColor: BACKGROUND,
    show: false,
    autoHideMenuBar: !isMac, // Windows/Linux: меню появляется по Alt
    // В Linux значок окна берётся отсюда (в Windows и macOS — из самого приложения).
    ...(process.platform === 'linux'
      ? { icon: path.join(__dirname, '..', 'build', 'icons', '256x256.png') }
      : {}),
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      webSecurity: true,
      spellcheck: true,
      // Не замедлять таймеры в свёрнутом окне: звонки и уведомления должны работать в фоне.
      backgroundThrottling: false,
    },
  });

  windowState.track(mainWindow);
  dayNight?.refresh();
  if (state.isMaximized) mainWindow.maximize();
  // Окно показываем сразу — с экраном загрузки: бесплатный сервер может
  // просыпаться до минуты, и без окна казалось бы, что приложение не запустилось.
  mainWindow.show();

  const contents = mainWindow.webContents;
  setupNavigation(contents, APP_ORIGIN);
  attachContextMenu(mainWindow);

  contents.on('did-fail-load', (_event, code, description, url, isMainFrame) => {
    // -3 (ERR_ABORTED) — загрузку прервала другая навигация, это не обрыв связи.
    if (!isMainFrame || code === -3 || originOf(url) !== APP_ORIGIN) return;
    wake('reconnect');
  });

  // Сервер недоступен или ещё просыпается — вместо «Bad Gateway» экран загрузки.
  contents.on('did-navigate', (_event, url, httpCode) => {
    const serverDown = httpCode >= 502 && httpCode <= 504;
    if (serverDown && originOf(url) === APP_ORIGIN) wake('reconnect');
  });

  // Страница упала — перезагружаем сайт, но не чаще раза в 30 секунд, чтобы не уйти в цикл.
  contents.on('render-process-gone', (_event, details) => {
    if (quitting || details.reason === 'clean-exit' || Date.now() - lastCrashAt < 30_000) return;
    lastCrashAt = Date.now();
    wake('reconnect');
  });

  // macOS: красная кнопка прячет окно, а приложение остаётся в Dock и получает сообщения.
  mainWindow.on('close', (event) => {
    if (!isMac || quitting) return;
    event.preventDefault();
    if (mainWindow.isFullScreen()) {
      mainWindow.once('leave-full-screen', () => mainWindow.hide());
      mainWindow.setFullScreen(false);
    } else {
      mainWindow.hide();
    }
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  wake('start');
}

function loadSite() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  // Ошибку загрузки обрабатывает did-fail-load, здесь её только гасим.
  mainWindow.loadURL(SITE_URL).catch(() => {});
}

// Экран загрузки: закат с лучами, которые следуют за мышью, и прогресс внизу.
// Главный процесс тем временем стучится в сервер и, как только тот ответил,
// открывает Sunnet. Так спящий сервер выглядит как загрузка, а не как ошибка.
let waking = 0;
/** Сколько ждём ответа проверки, прежде чем всё равно открыть сайт */
const OPEN_ANYWAY_MS = 30_000;
/** Одна попытка проверки — не дольше этого: зависший запрос не должен останавливать загрузку */
const PROBE_TIMEOUT_MS = 8_000;

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function withTimeout(promise, ms) {
  return Promise.race([promise, delay(ms).then(() => Promise.reject(new Error('timeout')))]);
}

/** Сервер ответил хоть чем-то, кроме «шлюз недоступен» (502–504, пока Render будит сервер). */
async function serverAnswers(url) {
  const check = async (doFetch) => {
    const res = await doFetch(url, { cache: 'no-store' });
    if (res.status >= 502 && res.status <= 504) throw new Error(`HTTP ${res.status}`);
    return true;
  };
  try {
    // Два сетевых стека параллельно: Chromium (net) и Node — какой ответит первым
    return await Promise.any([withTimeout(check(net.fetch), PROBE_TIMEOUT_MS), withTimeout(check(fetch), PROBE_TIMEOUT_MS)]);
  } catch {
    return false;
  }
}

function wake(mode) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const run = ++waking;
  const startedAt = Date.now();
  mainWindow
    .loadFile(path.join(__dirname, 'loading.html'), { query: { mode, night: isNight() ? '1' : '0' } })
    .catch(() => {});
  const health = new URL('/api/v1/health', SITE_URL).href;
  const alive = () => run === waking && mainWindow && !mainWindow.isDestroyed();
  let opened = false;
  const open = async () => {
    if (opened || !alive()) return;
    opened = true;
    // Экран загрузки показываем хотя бы секунду, чтобы он не мигал
    await delay(Math.max(0, 1000 - (Date.now() - startedAt)));
    if (!alive()) return;
    await withTimeout(mainWindow.webContents.executeJavaScript('window.sunnetReady && window.sunnetReady()'), 2000).catch(() => {});
    await delay(650);
    if (alive()) loadSite();
  };
  // Проверка молчит слишком долго — открываем сайт: загрузка страницы сама дождётся сервера,
  // а экран загрузки остаётся на месте, пока сайт не откроется
  setTimeout(() => void open(), OPEN_ANYWAY_MS);
  const poll = async () => {
    if (!alive() || opened) return;
    if (await serverAnswers(health)) return void open();
    setTimeout(poll, 1500);
  };
  void poll();
}

function showMainWindow() {
  if (!app.isReady()) return;
  if (!mainWindow) {
    createWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

app.on('before-quit', () => {
  quitting = true;
});

app.on('window-all-closed', () => {
  if (!isMac) app.quit();
});
