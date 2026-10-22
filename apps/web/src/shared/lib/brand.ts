/**
 * День и ночь бренда. В установленном приложении (Sunnet для компьютера или
 * сайт, поставленный как приложение) после заката по местному времени Sunnet
 * становится Lynnet: другое имя, луна вместо солнца в знаке, значок вкладки
 * и окна. В обычной вкладке браузера всегда Sunnet.
 *
 * Закат и рассвет считаются по дате и часовому поясу: для известных поясов —
 * по координатам их города, для остальных — по долготе пояса и широте 50°.
 */
import { create } from 'zustand';

export const DAY_NAME = 'Sunnet';
export const NIGHT_NAME = 'Lynnet';

/** Координаты по часовому поясу (широта, долгота) — для расчёта заката. */
const ZONES: Record<string, [number, number]> = {
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

const rad = (d: number) => (d * Math.PI) / 180;

/** Рассвет и закат по местному времени (часы от полуночи) для даты и координат. */
export function sunTimes(date: Date, lat: number, lon: number, tzHours: number): { rise: number; set: number } | 'day' | 'night' {
  const start = new Date(date.getFullYear(), 0, 0);
  const n = Math.floor((date.getTime() - start.getTime()) / 86_400_000);
  // Склонение Солнца и уравнение времени (минуты) — упрощённые формулы NOAA
  const g = ((2 * Math.PI) / 365) * (n - 1);
  const decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g);
  const eot = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const cosH = (Math.sin(rad(-0.833)) - Math.sin(rad(lat)) * Math.sin(decl)) / (Math.cos(rad(lat)) * Math.cos(decl));
  if (cosH > 1) return 'night'; // полярная ночь
  if (cosH < -1) return 'day'; // полярный день
  const h = (Math.acos(cosH) * 180) / Math.PI / 15;
  const noon = 12 - lon / 15 + tzHours - eot / 60;
  return { rise: noon - h, set: noon + h };
}

/** Ночь ли сейчас у пользователя: солнце ниже горизонта по его часовому поясу. */
export function isNight(now = new Date()): boolean {
  const tzHours = -now.getTimezoneOffset() / 60;
  let zone = '';
  try {
    zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    // Без Intl — по долготе пояса
  }
  const [lat, lon] = ZONES[zone] ?? [50, tzHours * 15];
  const t = sunTimes(now, lat, lon, tzHours);
  if (t === 'day') return false;
  if (t === 'night') return true;
  const hours = now.getHours() + now.getMinutes() / 60;
  return hours < t.rise || hours > t.set;
}

/** Открыт ли Sunnet как установленное приложение, а не вкладкой браузера. */
export function isInstalledApp(): boolean {
  if (typeof window === 'undefined') return false;
  if (/(Sunnet|SpaceUp)\//.test(navigator.userAgent)) return true; // приложение для компьютера
  if ((navigator as Navigator & { standalone?: boolean }).standalone) return true; // iOS «На экран Домой»
  return ['standalone', 'window-controls-overlay', 'minimal-ui'].some((m) => matchMedia(`(display-mode: ${m})`).matches);
}

interface BrandState {
  night: boolean;
}

const nightNow = () => isInstalledApp() && isNight();

export const useBrand = create<BrandState>(() => ({ night: nightNow() }));

/** Имя приложения сейчас: Sunnet днём, Lynnet ночью в установленном приложении. */
export const brandName = () => (useBrand.getState().night ? NIGHT_NAME : DAY_NAME);

/** Значки вкладки и окна — под время суток. */
function applyIcons(night: boolean) {
  for (const link of document.querySelectorAll<HTMLLinkElement>('link[rel~="icon"], link[rel="apple-touch-icon"]')) {
    // Дневной значок запоминаем, ночью ставим луну того же назначения
    link.dataset.day ??= link.getAttribute('href') ?? '';
    link.dataset.dayType ??= link.type;
    if (!night) {
      link.href = link.dataset.day;
      link.type = link.dataset.dayType;
    } else if (link.rel === 'apple-touch-icon') {
      link.href = '/icons/night/apple-touch-icon.png';
    } else {
      link.href = '/icons/night/favicon-32.png';
      link.type = 'image/png';
    }
  }
  // Имя в заголовке окна меняется вместе со знаком
  document.title = document.title.replace(night ? DAY_NAME : NIGHT_NAME, night ? NIGHT_NAME : DAY_NAME);
}

let started = false;
/** Следит за временем суток: проверка раз в минуту и при возвращении в приложение. */
export function startBrandClock(): void {
  if (started || typeof window === 'undefined') return;
  started = true;
  const tick = () => {
    const night = nightNow();
    if (night !== useBrand.getState().night) useBrand.setState({ night });
    applyIcons(night);
  };
  tick();
  setInterval(tick, 60_000);
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && tick());
}
