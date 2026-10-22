/**
 * Lynnet — секрет установленного приложения: с 03:00 до 03:25 по местному
 * времени Sunnet становится Lynnet. Меняется всё: имя, знак (луна), значки,
 * тема (тёмная), вход и регистрация, обои рабочего стола — лунная сцена с
 * ракетами. В обычной вкладке браузера всегда Sunnet.
 */
import { create } from 'zustand';
import { applyPrefs, usePrefs } from '../stores/prefs';

export const DAY_NAME = 'Sunnet';
export const NIGHT_NAME = 'Lynnet';

/** Окно Lynnet: минуты от полуночи [начало, конец) */
const WINDOW: [number, number] = [3 * 60, 3 * 60 + 25];

/** Время Lynnet по часам пользователя. */
export function isNight(now = new Date()): boolean {
  const m = now.getHours() * 60 + now.getMinutes();
  return m >= WINDOW[0] && m < WINDOW[1];
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

/** Имя приложения сейчас: Lynnet в его часы в установленном приложении, иначе Sunnet. */
export const brandName = () => (useBrand.getState().night ? NIGHT_NAME : DAY_NAME);
/** То же для интерфейса — перерисуется, когда Sunnet станет Lynnet и обратно. */
export const useBrandName = () => useBrand((s) => (s.night ? NIGHT_NAME : DAY_NAME));

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
  // Тема — тёмная, пока Lynnet
  const root = document.documentElement;
  if (night !== (root.dataset.lynnet === '1')) {
    if (night) root.dataset.lynnet = '1';
    else delete root.dataset.lynnet;
    applyPrefs(usePrefs.getState());
  }
}

let started = false;
/** Следит за временем: проверка каждые 20 секунд и при возвращении в приложение. */
export function startBrandClock(): void {
  if (started || typeof window === 'undefined') return;
  started = true;
  const tick = () => {
    const night = nightNow();
    if (night !== useBrand.getState().night) useBrand.setState({ night });
    applyIcons(night);
  };
  tick();
  setInterval(tick, 20_000);
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && tick());
}
