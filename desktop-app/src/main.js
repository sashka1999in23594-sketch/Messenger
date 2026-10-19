'use strict';
// Sunnet для компьютера: одно окно, в котором открыт сайт Sunnet.
// Вся логика мессенджера живёт на сайте; здесь — окно, разрешения, ссылки и экран «нет сети».

const path = require('node:path');
const { app, BrowserWindow, Menu, session } = require('electron');
const { resolveSiteUrl } = require('./config');
const windowState = require('./window-state');
const { originOf, setupNavigation, setupPermissions } = require('./security');
const { attachContextMenu, buildAppMenu } = require('./menu');

const SITE_URL = resolveSiteUrl();
const APP_ORIGIN = new URL(SITE_URL).origin;
const BACKGROUND = '#0b0b14'; // фон окна, пока сайт загружается
const isMac = process.platform === 'darwin';

let mainWindow = null;
let quitting = false;
let lastCrashAt = 0;

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
  if (state.isMaximized) mainWindow.maximize();
  // Показываем окно сразу (тёмный фон), не дожидаясь сайта: бесплатный сервер
  // может просыпаться до минуты, и без окна казалось бы, что приложение не запустилось.
  mainWindow.show();

  const contents = mainWindow.webContents;
  setupNavigation(contents, APP_ORIGIN);
  attachContextMenu(mainWindow);

  contents.on('did-fail-load', (_event, code, description, url, isMainFrame) => {
    // -3 (ERR_ABORTED) — загрузку прервала другая навигация, это не обрыв связи.
    if (!isMainFrame || code === -3 || originOf(url) !== APP_ORIGIN) return;
    showOffline(description || `Ошибка ${code}`);
  });

  // Сервер недоступен или ещё просыпается — вместо «Bad Gateway» показываем свой экран.
  contents.on('did-navigate', (_event, url, httpCode) => {
    const serverDown = httpCode >= 502 && httpCode <= 504;
    if (serverDown && originOf(url) === APP_ORIGIN) showOffline(`HTTP ${httpCode}`);
  });

  // Страница упала — перезагружаем сайт, но не чаще раза в 30 секунд, чтобы не уйти в цикл.
  contents.on('render-process-gone', (_event, details) => {
    if (quitting || details.reason === 'clean-exit' || Date.now() - lastCrashAt < 30_000) return;
    lastCrashAt = Date.now();
    loadSite();
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

  loadSite();
}

function loadSite() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  // Ошибку загрузки обрабатывает did-fail-load, здесь её только гасим.
  mainWindow.loadURL(SITE_URL).catch(() => {});
}

// Локальная страница «Нет соединения»: сама проверяет сеть каждые 10 секунд
// и возвращает на сайт, как только он отвечает.
function showOffline(reason) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow
    .loadFile(path.join(__dirname, 'offline.html'), { query: { url: SITE_URL, reason } })
    .catch(() => {});
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
