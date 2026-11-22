'use strict';
// Мост панели встроенного браузера: только навигация и получение состояния.
// Сам сайт этот мост не видит — он загружается в отдельном представлении без preload.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('inapp', {
  nav: (action, arg) => ipcRenderer.send('inapp:nav', String(action), typeof arg === 'string' ? arg : undefined),
  onState: (cb) => ipcRenderer.on('inapp:state', (_e, s) => cb(s)),
});
