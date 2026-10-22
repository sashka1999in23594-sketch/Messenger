'use strict';
// Sunnet и его секрет Lynnet: в часы Lynnet значок окна, панели задач и Dock,
// ярлыки и трей — луна, окно запуска и экран загрузки — лунная сцена.
// Всё остальное меняет сам сайт (он видит, что открыт в приложении);
// правило времени то же, что в apps/web/src/shared/lib/brand.ts.

const path = require('node:path');
const { app, nativeImage } = require('electron');

/**
 * Время Lynnet — секрет приложения: с 03:00 до 03:25 по часам компьютера.
 * SUNNET_LYNNET=1 включает его вне этих минут (для проверки).
 */
function isNight(now = new Date()) {
  if (process.env.SUNNET_LYNNET === '1') return true;
  const m = now.getHours() * 60 + now.getMinutes();
  return m >= 180 && m < 205;
}

const icon = (name) => nativeImage.createFromPath(path.join(__dirname, 'assets', name));

/** Следит за временем суток и меняет значки; проверка раз в минуту. `onChange` — ярлыки и прочее. */
function watchDayNight(getWindow, onChange) {
  let current = null;
  const apply = () => {
    const night = isNight();
    if (night === current) return;
    current = night;
    const win = getWindow();
    if (win && !win.isDestroyed() && process.platform !== 'darwin') win.setIcon(icon(night ? 'icon-night.png' : 'icon-day.png'));
    if (process.platform === 'darwin' && app.dock) app.dock.setIcon(icon(night ? 'icon-night-mac.png' : 'icon-day-mac.png'));
    try {
      onChange?.(night);
    } catch {
      // ярлыки не обязательны
    }
  };
  apply();
  const timer = setInterval(apply, 20000);
  return {
    /** Новое окно получает текущий значок сразу */
    refresh() {
      current = null;
      apply();
    },
    stop: () => clearInterval(timer),
  };
}

module.exports = { isNight, watchDayNight };
