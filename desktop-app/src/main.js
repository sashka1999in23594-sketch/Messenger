'use strict';
// Sunnet для компьютера. Запуск — как у игровых лаунчеров: сначала маленькое
// окно с солнцем (проверка и установка обновлений, подключение к серверу),
// потом главное окно с сайтом Sunnet. Вместе с системой приложение стартует
// свёрнутым в трей: сообщения приходят, обновления ставятся сами.
// Вся логика мессенджера живёт на сайте; здесь — окна, разрешения, ссылки,
// обновления и ярлыки Sunnet/Lynnet.

const path = require('node:path');
const { app, BrowserWindow, Menu, net, session } = require('electron');
const { resolveSiteUrl } = require('./config');
const windowState = require('./window-state');
const { originOf, setupNavigation, setupPermissions } = require('./security');
const { attachContextMenu, buildAppMenu } = require('./menu');
const { isNight, watchDayNight } = require('./daynight');
const { syncShortcuts } = require('./shortcuts');
const updates = require('./updater');
const { createTray, ensureAutostart } = require('./tray');

const SITE_URL = resolveSiteUrl();
const APP_ORIGIN = new URL(SITE_URL).origin;
const HEALTH_URL = new URL('/api/v1/health', SITE_URL).href;
const BACKGROUND = '#0b0b14'; // фон окна, пока сайт загружается
const isMac = process.platform === 'darwin';
const { delay, withTimeout } = updates;

let mainWindow = null;
let launcher = null;
let tray = null;
let quitting = false;
let lastCrashAt = 0;
let dayNight = null;

app.enableSandbox(); // песочница для всех страниц, без исключений
if (process.platform === 'win32') app.setAppUserModelId('app.spaceup.desktop'); // нужно для уведомлений Windows

// Второй запуск не открывает вторую копию, а показывает уже открытое окно.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => (launcher && !launcher.isDestroyed() ? launcher.focus() : showMainWindow()));
  app.whenReady().then(start);
}

async function start() {
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
  ensureAutostart();

  try {
    tray = createTray({ onOpen: showMainWindow, onQuit: quit, night: isNight() });
  } catch {
    tray = null; // в некоторых окружениях Linux трея нет — работаем без него
  }
  // Ночью значки, ярлыки и трей — луна и «Lynnet», днём — закат и «Sunnet»
  dayNight = watchDayNight(
    () => mainWindow,
    (night) => {
      syncShortcuts(night);
      tray?.setNight(night);
    },
  );
  app.on('activate', showMainWindow); // клик по значку в Dock
  keepServerAwake(); // пока приложение живёт (даже свёрнутое в трей) — не даём серверу заснуть

  // Запуск вместе с системой (или после фонового обновления) — без окон
  const hidden = process.argv.includes('--hidden') || app.getLoginItemSettings().wasOpenedAsHidden || updates.consumeHiddenMarker();
  if (hidden && (tray || isMac)) {
    createWindow();
    void waitForServer(() => !!mainWindow).then(() => loadSite());
    void startBackgroundUpdates()();
    return;
  }
  await launch();
}

// ─── Окно запуска ────────────────────────────────────────────────────────────

function openLauncher() {
  launcher = new BrowserWindow({
    width: 440,
    height: 340,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    frame: false,
    show: false,
    center: true,
    title: 'Sunnet',
    backgroundColor: '#15110f',
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  launcher.loadFile(path.join(__dirname, 'launcher.html'), { query: { night: isNight() ? '1' : '0' } }).catch(() => {});
  launcher.once('ready-to-show', () => launcher?.show());
  // Крестик в окне запуска — как «Отмена» у лаунчеров: приложение закрывается
  launcher.on('closed', () => {
    const cancelled = !!launcher;
    launcher = null;
    if (cancelled && !(mainWindow && mainWindow.isVisible())) quit();
  });
}

function setLauncher(state) {
  if (!launcher || launcher.isDestroyed()) return;
  const js = `window.launcher && window.launcher(${JSON.stringify(state)})`;
  // Страница ещё грузится — отправим, когда загрузится
  if (launcher.webContents.isLoading()) launcher.webContents.once('did-finish-load', () => launcher?.webContents.executeJavaScript(js).catch(() => {}));
  else launcher.webContents.executeJavaScript(js).catch(() => {});
}

function closeLauncher() {
  const win = launcher;
  launcher = null; // закрываем сами — это не отмена
  if (win && !win.isDestroyed()) win.close();
}

/** Как у Roblox: обновление → подключение к серверу → Sunnet. */
async function launch() {
  openLauncher();
  setLauncher({ phase: 'checking' });
  const info = await updates.findUpdate(8000);
  if (info && launcher) {
    try {
      setLauncher({ phase: 'downloading', version: info.version, percent: 0 });
      await updates.download((p) =>
        setLauncher({ phase: 'downloading', version: info.version, percent: p.percent, transferred: p.transferred, total: p.total, speed: p.bytesPerSecond }),
      );
      setLauncher({ phase: 'installing' });
      await delay(900);
      quitting = true;
      updates.install();
      return;
    } catch {
      setLauncher({ phase: 'error', text: 'Не получилось обновиться — запускаем текущую версию' });
      await delay(1800);
    }
  }
  if (!launcher) return;
  setLauncher({ phase: 'connecting' });
  await waitForServer(() => !!launcher);
  if (!launcher) return;
  setLauncher({ phase: 'starting' });
  createWindow();
  loadSite();
  // Главное окно показываем, когда Sunnet уже нарисовался (но не дольше 20 секунд)
  await Promise.race([new Promise((resolve) => mainWindow?.webContents.once('did-finish-load', resolve)), delay(20_000)]);
  await delay(300);
  closeLauncher();
  showMainWindow();
  startBackgroundUpdates();
}

/** Как часто приложение спрашивает, не вышла ли новая версия */
const UPDATE_CHECK_MS = 5 * 60 * 1000;
let updating = false;

/** Идёт ли звонок — посреди разговора не обновляемся. */
async function inCall() {
  if (!mainWindow || mainWindow.isDestroyed()) return false;
  const js = "!!document.querySelector('.room-win, .room-mobile, .room-pill, .call-screen')";
  return withTimeout(mainWindow.webContents.executeJavaScript(js), 2000).catch(() => false);
}

/**
 * Обновления, пока приложение открыто: вышла новая версия — главное окно
 * закрывается, появляется окно обновления с прогрессом, установка и перезапуск.
 * Во время звонка ждём, пока он закончится. Свёрнуто в трей — ставим тихо.
 */
function startBackgroundUpdates() {
  const check = async () => {
    if (updating) return;
    const info = await updates.findUpdate(20_000);
    if (!info || updating) return;
    if (await inCall()) return void setTimeout(check, 60_000);
    updating = true;
    const visible = mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible();
    if (!visible) {
      try {
        await updates.download();
        quitting = true;
        updates.install({ hidden: true });
      } catch {
        updating = false;
      }
      return;
    }
    mainWindow.hide();
    openLauncher();
    setLauncher({ phase: 'downloading', version: info.version, percent: 0 });
    try {
      await updates.download((p) =>
        setLauncher({ phase: 'downloading', version: info.version, percent: p.percent, transferred: p.transferred, total: p.total, speed: p.bytesPerSecond }),
      );
      setLauncher({ phase: 'installing' });
      await delay(900);
      quitting = true;
      updates.install();
    } catch {
      setLauncher({ phase: 'error', text: 'Не получилось обновиться — продолжаем в текущей версии' });
      await delay(1800);
      closeLauncher();
      showMainWindow();
      updating = false;
    }
  };
  setInterval(() => void check(), UPDATE_CHECK_MS);
  return check;
}

// ─── Сервер не спит, пока приложение запущено ────────────────────────────────
// Бесплатный сервер засыпает после простоя. Пока Sunnet работает (в том числе
// свёрнутый в трей или запущенный вместе с системой), раз в несколько минут
// тихо дёргаем /health — тогда при открытии окна всё готово, без ожидания.
function keepServerAwake() {
  const ping = () => void net.fetch(HEALTH_URL, { cache: 'no-store', signal: AbortSignal.timeout(20_000) }).catch(() => {});
  ping();
  // 4 минуты: с запасом под усыпление бесплатного тарифа (~15 минут простоя),
  // чтобы сервер не успевал заснуть, а база (и сеанс) не терялись при его перезапуске.
  setInterval(ping, 4 * 60 * 1000).unref?.();
}

// ─── Сервер ──────────────────────────────────────────────────────────────────

/** Одна попытка проверки — не дольше этого: зависший запрос не должен останавливать загрузку */
const PROBE_TIMEOUT_MS = 8_000;
/** Сколько ждём ответа проверки, прежде чем всё равно открыть сайт */
const OPEN_ANYWAY_MS = 30_000;

/** Сервер ответил хоть чем-то, кроме «шлюз недоступен» (502–504, пока Render будит сервер). */
async function serverAnswers() {
  const check = async (doFetch) => {
    const res = await doFetch(HEALTH_URL, { cache: 'no-store' });
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

/** Ждём, пока сервер проснётся (или крайний срок — тогда загрузка сайта дождётся его сама). */
async function waitForServer(alive) {
  const deadline = Date.now() + OPEN_ANYWAY_MS;
  while (alive() && Date.now() < deadline) {
    if (await serverAnswers()) return true;
    await delay(1500);
  }
  return false;
}

// ─── Главное окно ────────────────────────────────────────────────────────────

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
  if (state.isMaximized) mainWindow.once('show', () => mainWindow?.maximize());

  const contents = mainWindow.webContents;
  setupNavigation(contents, APP_ORIGIN);
  attachContextMenu(mainWindow);

  contents.on('did-fail-load', (_event, code, description, url, isMainFrame) => {
    // -3 (ERR_ABORTED) — загрузку прервала другая навигация, это не обрыв связи.
    if (!isMainFrame || code === -3 || originOf(url) !== APP_ORIGIN) return;
    wake();
  });

  // Сервер недоступен или ещё просыпается — вместо «Bad Gateway» экран загрузки.
  contents.on('did-navigate', (_event, url, httpCode) => {
    const serverDown = httpCode >= 502 && httpCode <= 504;
    if (serverDown && originOf(url) === APP_ORIGIN) wake();
  });

  // Страница упала — перезагружаем сайт, но не чаще раза в 30 секунд, чтобы не уйти в цикл.
  contents.on('render-process-gone', (_event, details) => {
    if (quitting || details.reason === 'clean-exit' || Date.now() - lastCrashAt < 30_000) return;
    lastCrashAt = Date.now();
    wake();
  });

  // Крестик прячет окно, а не закрывает Sunnet: сообщения и звонки продолжают приходить
  // (macOS — в Dock, Windows и Linux — значок у часов). Выход — из меню значка.
  mainWindow.on('close', (event) => {
    if (quitting || (!isMac && !tray)) return;
    event.preventDefault();
    // Закрыли окно во время звонка — завершаем звонок (в фоне остаётся свёрнутое окно, не звонок)
    mainWindow.webContents.executeJavaScript('window.__sunnetEndCall && window.__sunnetEndCall()').catch(() => {});
    if (mainWindow.isFullScreen()) {
      mainWindow.once('leave-full-screen', () => mainWindow.hide());
      mainWindow.setFullScreen(false);
    } else {
      mainWindow.hide();
    }
    tray?.hint();
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function loadSite() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  // Ошибку загрузки обрабатывает did-fail-load, здесь её только гасим.
  mainWindow.loadURL(SITE_URL).catch(() => {});
}

// Связь пропала посреди работы: в окне — экран загрузки с закатом, пока сервер
// снова не ответит, затем Sunnet открывается сам.
let waking = 0;
function wake() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const run = ++waking;
  mainWindow
    .loadFile(path.join(__dirname, 'loading.html'), { query: { mode: 'reconnect', night: isNight() ? '1' : '0' } })
    .catch(() => {});
  const alive = () => run === waking && mainWindow && !mainWindow.isDestroyed();
  void (async () => {
    await delay(1000);
    await waitForServer(alive);
    if (!alive()) return;
    await withTimeout(mainWindow.webContents.executeJavaScript('window.sunnetReady && window.sunnetReady()'), 2000).catch(() => {});
    await delay(650);
    if (alive()) loadSite();
  })();
}

function showMainWindow() {
  if (!app.isReady()) return;
  if (launcher && !launcher.isDestroyed()) {
    launcher.focus();
    return;
  }
  if (!mainWindow) {
    createWindow();
    loadSite();
  }
  // Открыли из трея, а сайт ещё не загрузился (сервер просыпается) — экран загрузки
  if (!mainWindow.webContents.getURL()) wake();
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function quit() {
  quitting = true;
  app.quit();
}

app.on('before-quit', () => {
  quitting = true;
});

app.on('window-all-closed', () => {
  if (!isMac) app.quit();
});
