/**
 * Приложения рабочего стола: разделы Sunnet из реестра навигации и две
 * отдельные страницы — «Помощь» и «Скачать приложение». Каждому окну
 * соответствует приложение по адресу, который в нём открыт.
 */
import { Download, LifeBuoy, RadioTower, Sun, type LucideIcon } from 'lucide-react';
import { findByPath, sectionFor, sections, type NavSection } from '../../app/navigation';

export interface DeskApp {
  id: string;
  label: string;
  short: string;
  icon: LucideIcon;
  path: string;
  badge?: NavSection['badge'];
  description?: string;
}

/** Порядок значков в доке. */
export const DOCK_APPS = ['home', 'messenger', 'channels', 'reels', 'video', 'companies', 'communities', 'search', 'notifications', 'stats', 'profile', 'settings'] as const;

const EXTRA: DeskApp[] = [
  { id: 'create', label: 'Новая публикация', short: 'Создать', icon: Sun, path: '/create', description: 'Фото, видео, Reels или заметка — одним окном' },
  { id: 'studio', label: 'Студия эфира', short: 'Студия', icon: RadioTower, path: '/live/studio', description: 'Сцена, микшер и чат — как в OBS' },
  { id: 'help', label: 'Помощь', short: 'Помощь', icon: LifeBuoy, path: '/help', description: 'Ответы на вопросы и связь с командой' },
  { id: 'download', label: 'Скачать приложение', short: 'Скачать', icon: Download, path: '/download', description: 'Sunnet для телефона и компьютера' },
];

const cache = new Map<string, DeskApp>();
function fromSection(s: NavSection): DeskApp {
  let app = cache.get(s.id);
  if (!app) {
    app = { id: s.id, label: s.label, short: s.short, icon: s.icon, path: s.path, badge: s.badge, description: s.description };
    cache.set(s.id, app);
  }
  return app;
}

export const pathnameOf = (path: string) => path.split(/[?#]/)[0] || '/';

/** Приложение, которому принадлежит адрес. */
export function appFor(path: string): DeskApp {
  const pathname = pathnameOf(path);
  const extra = EXTRA.find((a) => pathname === a.path || pathname.startsWith(`${a.path}/`));
  return extra ?? fromSection(sectionFor(pathname));
}

/** Заголовок окна: раздел и, если есть, подраздел («Настройки — Приватность»). */
export function titleFor(path: string): { app: DeskApp; sub: string | null; text: string } {
  const app = appFor(path);
  const node = findByPath(pathnameOf(path));
  const sub = node && node.section.id === app.id && node.node.label !== app.label ? node.node.label : null;
  return { app, sub, text: sub ? `${app.label} — ${sub}` : app.label };
}

export function appById(id: string): DeskApp | undefined {
  const s = sections.find((x) => x.id === id);
  return s ? fromSection(s) : EXTRA.find((a) => a.id === id);
}

export const dockApps: DeskApp[] = DOCK_APPS.map((id) => appById(id)).filter((a): a is DeskApp => !!a);

/** Адреса, которые относятся к самому приложению (а не к файлам и API). */
export function isAppPath(path: string): boolean {
  const pathname = pathnameOf(path);
  if (!pathname.startsWith('/') || pathname.startsWith('//')) return false;
  if (/^\/(api|uploads|media|assets|static)\//.test(pathname)) return false;
  // Файл с расширением (картинка, видео, документ) — не раздел приложения
  return !/\.[a-z0-9]{2,5}$/i.test(pathname);
}

/**
 * Куда ведёт «Назад», если в истории окна некуда возвращаться:
 * ближайший пункт выше по дереву навигации, иначе — начало раздела.
 */
export function parentPath(path: string): string | null {
  const pathname = pathnameOf(path);
  const app = appFor(pathname);
  if (pathname === app.path) return null;
  const found = findByPath(pathname);
  if (found && found.section.id === app.id) {
    const chain = found.node.path === pathname ? found.trail : [...found.trail, found.node];
    for (let i = chain.length - 1; i >= 0; i--) {
      const p = chain[i]!.path;
      if (p && p !== pathname) return p;
    }
  }
  return app.path;
}

/** Разделы со своим списком слева — боковая панель по умолчанию скрыта. */
const OWN_LIST = ['messenger', 'channels', 'reels', 'search', 'help', 'download', 'create', 'studio'];
export const SIDE_W = 264;
export function defaultSide(appId: string, width: number): boolean {
  return !OWN_LIST.includes(appId) && width >= 940;
}
/** Есть ли у раздела дерево подразделов */
export function hasTree(appId: string): boolean {
  const s = sections.find((x) => x.id === appId);
  return !!s && (s.children.length > 1 || (s.children[0]?.children?.length ?? 0) > 0);
}

/** Компьютер Apple: кнопки окон слева, сочетания с ⌘. */
export const isMac = (() => {
  if (typeof navigator === 'undefined') return false;
  const p = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ?? navigator.platform ?? '';
  return /mac|iphone|ipad/i.test(p);
})();

/** Подпись клавиши-модификатора в подсказках. */
export const MOD = isMac ? '⌘' : 'Ctrl+';
