'use strict';
// Встроенный браузер Sunnet: любой сайт и сторонние приложения (Telegram, WhatsApp,
// Instagram, Twitch…) открываются внутри Sunnet, а не в системном браузере.
//
// Окно = две части: сверху панель Sunnet (адрес, назад/вперёд, загрузки), ниже — сам
// сайт. Безопасность:
//  • сайт работает в песочнице, без preload и без доступа к Node и к Sunnet;
//  • у каждого приложения свой изолированный профиль (persist:app-<id>): куки Telegram
//    не видны Instagram и наоборот; обычные сайты — в общем профиле persist:web;
//  • сессия Sunnet (куки входа) в эти профили не попадает;
//  • панель общается с приложением только тремя командами через проверенный IPC;
//  • скачанное сохраняется во временную папку, загружается в облако Sunnet и удаляется
//    с диска — на компьютер пользователя ничего не попадает и не запускается.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { BaseWindow, WebContentsView, ipcMain, net, session } = require('electron');

const TOOLBAR_H = 52;
const windows = new Map(); // ключ профиля → окно (одно окно на приложение)
let ctx = null; // { appOrigin, siteSession, icon }

const safeUrl = (raw) => {
  try {
    const u = new URL(raw);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null;
  } catch {
    return null;
  }
};

/** Профиль: 'web' для сайтов, 'app-telegram' и т. п. для приложений. */
const partitionKey = (name) => (/^app-[a-z0-9-]{1,32}$/.test(name || '') ? name : 'web');

const sessionsReady = new Set();
function prepareSession(key) {
  const ses = session.fromPartition(`persist:${key}`);
  if (sessionsReady.has(key)) return ses;
  sessionsReady.add(key);
  const isApp = key !== 'web';
  // Сайты получают только безобидные разрешения; камера и микрофон — только приложениям
  // (звонки в WhatsApp и Telegram); остальное — запрет.
  ses.setPermissionRequestHandler((_wc, permission, cb) => {
    const ok = ['notifications', 'fullscreen', 'clipboard-sanitized-write'].includes(permission) || (isApp && permission === 'media');
    cb(ok);
  });
  ses.setPermissionCheckHandler((_wc, permission) => ['notifications', 'fullscreen'].includes(permission) || (isApp && permission === 'media'));
  ses.on('will-download', (_e, item, wc) => handleDownload(item, wc));
  return ses;
}

// ─── Загрузки: в облако Sunnet, не на диск ───────────────────────────────────

function sendToolbar(wc, msg) {
  for (const w of windows.values()) {
    if (w.site.webContents === wc && !w.bar.webContents.isDestroyed()) w.bar.webContents.send('inapp:state', msg);
  }
}

/** Имя файла: из Content-Disposition (в том числе filename*=UTF-8''…), иначе от Chromium, иначе из адреса. */
function fileNameOf(item) {
  const cd = item.getContentDisposition?.() || '';
  const star = /filename\*\s*=\s*(?:UTF-8|utf-8)''([^;]+)/.exec(cd);
  if (star) {
    try {
      return decodeURIComponent(star[1].trim().replace(/^"|"$/g, ''));
    } catch {
      /* битое имя — ниже другие варианты */
    }
  }
  const plain = /filename\s*=\s*"?([^";]+)"?/.exec(cd)?.[1];
  const chromium = item.getFilename();
  if (chromium && chromium !== 'download') return chromium;
  if (plain) return plain;
  try {
    const last = decodeURIComponent(new URL(item.getURL()).pathname.split('/').pop() || '');
    if (last) return last;
  } catch {
    /* адрес без имени */
  }
  return 'файл';
}

function handleDownload(item, wc) {
  const name = fileNameOf(item).replace(/[\\/:*?"<>|]+/g, '_').slice(0, 120);
  const tmp = path.join(os.tmpdir(), `sunnet-dl-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  item.setSavePath(tmp);
  item.on('updated', () => {
    const total = item.getTotalBytes();
    sendToolbar(wc, { download: { name, phase: 'down', percent: total ? Math.round((item.getReceivedBytes() / total) * 50) : 10 } });
  });
  item.once('done', async (_e, state) => {
    if (state !== 'completed') {
      fs.rm(tmp, { force: true }, () => {});
      sendToolbar(wc, { download: { name, phase: 'error', text: 'Скачивание прервано' } });
      return;
    }
    try {
      sendToolbar(wc, { download: { name, phase: 'up', percent: 60 } });
      await uploadToCloud(tmp, name);
      sendToolbar(wc, { download: { name, phase: 'done', percent: 100 } });
    } catch (err) {
      sendToolbar(wc, { download: { name, phase: 'error', text: err?.message || 'Не удалось сохранить в облако' } });
    } finally {
      fs.rm(tmp, { force: true }, () => {});
    }
  });
}

/** Запрос к API Sunnet от имени вошедшего пользователя (куки основной сессии). */
async function apiFetch(pathname, init = {}) {
  const ses = ctx.siteSession;
  const csrf = (await ses.cookies.get({ url: ctx.appOrigin })).find((c) => /csrf/i.test(c.name));
  const res = await net.fetch(new URL(`/api/v1${pathname}`, ctx.appOrigin).href, {
    ...init,
    session: ses,
    credentials: 'include',
    headers: { Accept: 'application/json', Origin: ctx.appOrigin, ...(csrf ? { 'X-CSRF-Token': csrf.value } : {}), ...(init.headers || {}) },
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error?.message || `Сервер ответил ${res.status}`);
  return body;
}

async function uploadToCloud(file, name) {
  const stat = await fs.promises.stat(file);
  if (stat.size > 50 * 1024 * 1024) throw new Error('Файл больше 50 МБ — в облако не помещается');
  const form = new FormData();
  form.append('file', new Blob([await fs.promises.readFile(file)]), name);
  const media = await apiFetch('/media?as=file', { method: 'POST', body: form });
  await apiFetch('/desk/items', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind: 'file', name, mediaId: media.id }),
  });
}

// ─── Окно ────────────────────────────────────────────────────────────────────

function layout(w) {
  const [width, height] = w.win.getContentSize();
  w.bar.setBounds({ x: 0, y: 0, width, height: TOOLBAR_H });
  w.site.setBounds({ x: 0, y: TOOLBAR_H, width, height: Math.max(0, height - TOOLBAR_H) });
}

function pushState(w) {
  const wc = w.site.webContents;
  if (w.bar.webContents.isDestroyed() || wc.isDestroyed()) return;
  w.bar.webContents.send('inapp:state', {
    url: wc.getURL(),
    title: wc.getTitle(),
    loading: wc.isLoading(),
    back: wc.navigationHistory.canGoBack(),
    forward: wc.navigationHistory.canGoForward(),
    app: w.title,
  });
}

/**
 * Открыть сайт во встроенном браузере. `profile` — 'web' или 'app-<id>' для
 * сторонних приложений (у каждого своё окно и свои куки).
 */
function openInApp(rawUrl, profile = 'web', title = '') {
  const url = safeUrl(rawUrl);
  if (!url || !ctx) return false;
  const key = partitionKey(profile);
  const existing = windows.get(key);
  if (existing && !existing.win.isDestroyed()) {
    if (key === 'web' || existing.site.webContents.getURL() === 'about:blank') existing.site.webContents.loadURL(url).catch(() => {});
    if (existing.win.isMinimized()) existing.win.restore();
    existing.win.show();
    existing.win.focus();
    return true;
  }
  const ses = prepareSession(key);
  const win = new BaseWindow({ width: 1200, height: 820, minWidth: 420, minHeight: 360, title: title || 'Sunnet · Браузер', backgroundColor: '#f4f7fc', show: false, ...(ctx.icon ? { icon: ctx.icon } : {}) });
  const bar = new WebContentsView({
    webPreferences: { preload: path.join(__dirname, 'inapp-preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  const site = new WebContentsView({
    webPreferences: { session: ses, contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true, spellcheck: true },
  });
  win.contentView.addChildView(site);
  win.contentView.addChildView(bar);
  const w = { win, bar, site, title: title || '', key };
  windows.set(key, w);
  layout(w);
  win.on('resize', () => layout(w));
  win.on('closed', () => {
    windows.delete(key);
    if (!site.webContents.isDestroyed()) site.webContents.close();
    if (!bar.webContents.isDestroyed()) bar.webContents.close();
  });

  const wc = site.webContents;
  // Новые окна сайта (ссылки target=_blank, вход через Google и т. п.) — в этом же окне
  wc.setWindowOpenHandler(({ url: next }) => {
    const ok = safeUrl(next);
    if (ok) wc.loadURL(ok).catch(() => {});
    return { action: 'deny' };
  });
  wc.on('will-navigate', (event) => {
    if (!safeUrl(event.url)) event.preventDefault(); // file:, javascript: и прочее — нельзя
  });
  wc.on('will-attach-webview', (event) => event.preventDefault());
  for (const ev of ['did-navigate', 'did-navigate-in-page', 'page-title-updated', 'did-start-loading', 'did-stop-loading']) wc.on(ev, () => pushState(w));
  wc.on('page-title-updated', (_e, t) => win.setTitle(title ? `${title} — Sunnet` : `${t} — Sunnet`));

  bar.webContents.loadFile(path.join(__dirname, 'inapp-toolbar.html')).catch(() => {});
  bar.webContents.once('did-finish-load', () => {
    pushState(w);
    win.show();
  });
  wc.loadURL(url).catch(() => {});
  return true;
}

function setupInApp(options) {
  ctx = options;
  // Команды панели: только от наших панелей, с проверкой аргументов
  const owner = (sender) => [...windows.values()].find((w) => w.bar.webContents === sender);
  ipcMain.on('inapp:nav', (event, action, arg) => {
    const w = owner(event.sender);
    if (!w) return;
    const wc = w.site.webContents;
    if (action === 'back' && wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack();
    else if (action === 'forward' && wc.navigationHistory.canGoForward()) wc.navigationHistory.goForward();
    else if (action === 'reload') wc.reload();
    else if (action === 'stop') wc.stop();
    else if (action === 'go' && typeof arg === 'string') {
      const t = arg.trim().slice(0, 2000);
      const direct = safeUrl(t) || (/^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(t) ? safeUrl(`https://${t}`) : null);
      if (direct) wc.loadURL(direct).catch(() => {});
      else if (t) ctx.onSearch?.(t);
    }
  });
}

module.exports = { openInApp, setupInApp, partitionKey };
