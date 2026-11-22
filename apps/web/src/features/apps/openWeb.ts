/**
 * Открыть сайт или стороннее приложение «внутри Sunnet».
 * — В приложении для компьютера: встроенный браузер Sunnet. У каждого приложения
 *   каталога свой изолированный профиль (вход как в оригинале, куки не смешиваются),
 *   скачанное уходит в облако.
 * — В веб-версии браузер не позволяет показать чужой сайт внутри (сайты запрещают
 *   встраивание), поэтому открываем новую вкладку.
 */
import { CATALOG, type CatalogApp } from './catalog';

export const isDesktopApp = () => typeof navigator !== 'undefined' && /\bElectron\//.test(navigator.userAgent);

const hostOf = (u: string) => {
  try {
    return new URL(u).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
};

/** Приложение каталога, которому принадлежит адрес (web.telegram.org → Telegram). */
export function appForUrl(url: string): CatalogApp | undefined {
  const h = hostOf(url);
  return h ? CATALOG.find((a) => hostOf(a.url) === h) : undefined;
}

export function openWeb(url: string, app?: Pick<CatalogApp, 'id' | 'name'>) {
  const owner = app ?? appForUrl(url);
  const target = !isDesktopApp() ? '_blank' : owner ? `sunnet-app-${owner.id}~${encodeURIComponent(owner.name)}` : 'sunnet-web';
  window.open(url, target, 'noopener,noreferrer');
}
