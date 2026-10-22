'use strict';
// Sunnet днём, Lynnet ночью: после заката по местному времени значок окна,
// панели задач и Dock меняется на луну, после рассвета — обратно на солнце.
// Имя в заголовке окна меняет сам сайт (он видит, что открыт в приложении).
// Расчёт заката — тот же, что на сайте (apps/web/src/shared/lib/brand.ts).

const path = require('node:path');
const { app, nativeImage } = require('electron');

/** Координаты по часовому поясу (широта, долгота) — для расчёта заката. */
const ZONES = {
  'Europe/Kaliningrad': [54.7, 20.5],
  'Europe/Moscow': [55.75, 37.62],
  'Europe/Simferopol': [44.95, 34.1],
  'Europe/Kirov': [58.6, 49.66],
  'Europe/Volgograd': [48.7, 44.5],
  'Europe/Astrakhan': [46.35, 48.04],
  'Europe/Saratov': [51.53, 46.03],
  'Europe/Ulyanovsk': [54.32, 48.4],
  'Europe/Samara': [53.2, 50.15],
  'Asia/Yekaterinburg': [56.84, 60.6],
  'Asia/Omsk': [54.99, 73.37],
  'Asia/Novosibirsk': [55.03, 82.92],
  'Asia/Barnaul': [53.35, 83.77],
  'Asia/Tomsk': [56.5, 84.97],
  'Asia/Novokuznetsk': [53.76, 87.12],
  'Asia/Krasnoyarsk': [56.01, 92.87],
  'Asia/Irkutsk': [52.29, 104.3],
  'Asia/Chita': [52.03, 113.5],
  'Asia/Yakutsk': [62.03, 129.73],
  'Asia/Khandyga': [62.66, 135.55],
  'Asia/Vladivostok': [43.12, 131.89],
  'Asia/Ust-Nera': [64.57, 143.2],
  'Asia/Magadan': [59.56, 150.8],
  'Asia/Sakhalin': [46.96, 142.73],
  'Asia/Srednekolymsk': [67.45, 153.7],
  'Asia/Kamchatka': [53.02, 158.65],
  'Asia/Anadyr': [64.73, 177.5],
  'Europe/Minsk': [53.9, 27.56],
  'Europe/Kyiv': [50.45, 30.52],
  'Europe/Kiev': [50.45, 30.52],
  'Europe/Chisinau': [47.01, 28.86],
  'Europe/Riga': [56.95, 24.1],
  'Europe/Vilnius': [54.69, 25.28],
  'Europe/Tallinn': [59.44, 24.75],
  'Asia/Tbilisi': [41.72, 44.79],
  'Asia/Yerevan': [40.18, 44.51],
  'Asia/Baku': [40.41, 49.87],
  'Asia/Almaty': [43.24, 76.89],
  'Asia/Tashkent': [41.3, 69.24],
  'Asia/Bishkek': [42.87, 74.59],
  'Asia/Dushanbe': [38.56, 68.78],
  'Asia/Ashgabat': [37.95, 58.38],
  'Europe/Istanbul': [41.01, 28.98],
  'Europe/London': [51.51, -0.13],
  'Europe/Berlin': [52.52, 13.4],
  'Europe/Paris': [48.86, 2.35],
  'Europe/Madrid': [40.42, -3.7],
  'Europe/Rome': [41.9, 12.5],
  'Europe/Warsaw': [52.23, 21.01],
  'Asia/Dubai': [25.2, 55.27],
  'America/New_York': [40.71, -74.01],
  'America/Chicago': [41.88, -87.63],
  'America/Denver': [39.74, -104.99],
  'America/Los_Angeles': [34.05, -118.24],
};

const rad = (d) => (d * Math.PI) / 180;

function sunTimes(date, lat, lon, tzHours) {
  const start = new Date(date.getFullYear(), 0, 0);
  const n = Math.floor((date.getTime() - start.getTime()) / 86400000);
  const g = ((2 * Math.PI) / 365) * (n - 1);
  const decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g);
  const eot = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const cosH = (Math.sin(rad(-0.833)) - Math.sin(rad(lat)) * Math.sin(decl)) / (Math.cos(rad(lat)) * Math.cos(decl));
  if (cosH > 1) return 'night';
  if (cosH < -1) return 'day';
  const h = (Math.acos(cosH) * 180) / Math.PI / 15;
  const noon = 12 - lon / 15 + tzHours - eot / 60;
  return { rise: noon - h, set: noon + h };
}

function isNight(now = new Date()) {
  const tzHours = -now.getTimezoneOffset() / 60;
  let zone = '';
  try {
    zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    // без Intl — по долготе пояса
  }
  const [lat, lon] = ZONES[zone] || [50, tzHours * 15];
  const t = sunTimes(now, lat, lon, tzHours);
  if (t === 'day') return false;
  if (t === 'night') return true;
  const hours = now.getHours() + now.getMinutes() / 60;
  return hours < t.rise || hours > t.set;
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
  const timer = setInterval(apply, 60000);
  return {
    /** Новое окно получает текущий значок сразу */
    refresh() {
      current = null;
      apply();
    },
    stop: () => clearInterval(timer),
  };
}

module.exports = { isNight, sunTimes, watchDayNight };
