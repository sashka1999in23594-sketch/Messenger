/**
 * Открытие возможностей — лента функций, которая подстраивается под человека.
 *
 * Источники: все разделы и подразделы Sunnet (реестр навигации), сервисы
 * «Орбиты» и инструменты Sunnet. Каждое действие (открыл раздел, установил
 * сервис, создал проект) добавляет вес категории интересов; вес со временем
 * затухает, поэтому лента следует за тем, чем человек занят сейчас.
 *
 * Ранжирование: интерес к категории + популярность + новизна (ещё не открывал)
 * − «надоело» (уже много раз показывали и не открыли). Каждый 5-й пункт —
 * «открытие» из незнакомой категории, чтобы лента не замыкалась на одном.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { flatNodes } from '../../app/navigation';
import { CATALOG, type CatId } from './catalog';

export interface Feature {
  id: string;
  title: string;
  sub: string;
  cat: CatId;
  /** Куда ведёт: адрес раздела Sunnet или id сервиса Орбиты */
  to: { path: string } | { app: string };
  pop: number;
  kind: 'section' | 'service' | 'tool';
}

/** Раздел Sunnet → категория интересов */
const SECTION_CAT: Record<string, CatId> = {
  home: 'social', messenger: 'chat', channels: 'news', reels: 'video', video: 'video', companies: 'work', communities: 'chat',
  search: 'tools', notifications: 'tools', stats: 'work', profile: 'social', settings: 'tools', calls: 'chat', live: 'video', stories: 'social',
};

// Инструменты Sunnet: название | категория | адрес
const TOOLS = `
Создать проект в Студии|dev|/studio
Уроки: первое приложение за 10 минут|dev|/studio?learn=1
Справочник API Sunnet|dev|/studio?docs=1
Создать свой сервер|chat|/servers/new
Подключить компьютер как сервер|dev|/connect
Браузер с загрузками в облако|tools|/browser
Каталог сервисов Орбиты|tools|/orbit
Подписки и платежи|finance|/orbit?tab=subs
Центр безопасности|tools|/security
Журнал разрешений|tools|/security?tab=perms
Корзина облака|docs|/security?tab=trash
Резервная копия облака|docs|/security?tab=backup
Подключить Telegram к общим чатам|chat|/orbit?app=telegram
Подключить Gmail к уведомлениям|work|/orbit?app=gmail
Опубликовать приложение|dev|/studio?publish=1
Шаблон сервера «Канал автора»|chat|/servers/new?tpl=channel
Шаблон сервера «Команда»|work|/servers/new?tpl=team
Шаблон сервера «Сообщество»|chat|/servers/new?tpl=community
`;

const tools: Feature[] = TOOLS.trim()
  .split('\n')
  .map((l, i) => {
    const [title, cat, path] = l.split('|');
    return { id: `tool.${i}`, title: title!, sub: 'Инструмент Sunnet', cat: cat as CatId, to: { path: path! }, pop: 70, kind: 'tool' as const };
  });

const sectionsF: Feature[] = flatNodes
  .filter((f) => f.node.path && !f.node.adminOnly && !f.node.children?.length)
  .map((f) => ({
    id: `nav.${f.node.id}`,
    title: f.node.label,
    sub: f.section.label,
    cat: SECTION_CAT[f.section.id] ?? 'tools',
    to: { path: f.node.path! },
    pop: 60,
    kind: 'section' as const,
  }));

const services: Feature[] = CATALOG.map((a) => ({ id: `app.${a.id}`, title: a.name, sub: a.blurb, cat: a.cat, to: { app: a.id }, pop: a.pop, kind: 'service' as const }));

export const ALL_FEATURES: Feature[] = [...tools, ...sectionsF, ...services];

interface Taste {
  /** Вес интереса к категории */
  w: Partial<Record<CatId, number>>;
  /** Сколько раз открывали пункт */
  opened: Record<string, number>;
  /** Сколько раз показывали пункт */
  shown: Record<string, number>;
  at: number;
  track: (cat: CatId, amount?: number) => void;
  open: (f: Feature) => void;
  seen: (ids: string[]) => void;
}

const HALF_LIFE = 7 * 24 * 3600e3;

export const useTaste = create<Taste>()(
  persist(
    (set, get) => ({
      w: {},
      opened: {},
      shown: {},
      at: Date.now(),
      track: (cat, amount = 1) => {
        // Затухание: старые интересы постепенно уступают новым
        const now = Date.now();
        const k = Math.pow(0.5, (now - get().at) / HALF_LIFE);
        const w: Taste['w'] = {};
        for (const [c, v] of Object.entries(get().w)) w[c as CatId] = (v ?? 0) * k;
        w[cat] = (w[cat] ?? 0) + amount;
        set({ w, at: now });
      },
      open: (f) => {
        get().track(f.cat, 2);
        set({ opened: { ...get().opened, [f.id]: (get().opened[f.id] ?? 0) + 1 } });
      },
      seen: (ids) => {
        const shown = { ...get().shown };
        for (const id of ids) shown[id] = (shown[id] ?? 0) + 1;
        set({ shown });
      },
    }),
    { name: 'sunnet.taste', partialize: (s) => ({ w: s.w, opened: s.opened, shown: s.shown, at: s.at }) },
  ),
);

/** Детерминированный «шум» на день — порядок меняется ежедневно, но не скачет при перерисовке. */
function jitter(id: string): number {
  const day = Math.floor(Date.now() / 86400e3);
  let h = day;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return ((h >>> 0) % 1000) / 1000;
}

export function rankFeatures(taste: Pick<Taste, 'w' | 'opened' | 'shown'>, query = ''): Feature[] {
  const q = query.trim().toLowerCase();
  const pool = q ? ALL_FEATURES.filter((f) => `${f.title} ${f.sub}`.toLowerCase().includes(q)) : ALL_FEATURES;
  const total = Object.values(taste.w).reduce((a, b) => a + (b ?? 0), 0) || 1;
  const score = (f: Feature) => {
    const interest = (taste.w[f.cat] ?? 0) / total; // 0..1
    const fresh = taste.opened[f.id] ? 0 : 0.25;
    const tired = Math.min(0.4, (taste.shown[f.id] ?? 0) * 0.02) * (taste.opened[f.id] ? 0 : 1);
    return interest * 2 + f.pop / 100 + fresh - tired + jitter(f.id) * 0.35;
  };
  const sorted = [...pool].sort((a, b) => score(b) - score(a));
  if (q) return sorted;
  // Каждый 5-й — открытие из категории, к которой интереса пока нет
  const cold = sorted.filter((f) => !(taste.w[f.cat] ?? 0));
  const out: Feature[] = [];
  const used = new Set<string>();
  let ci = 0;
  for (const f of sorted) {
    if (out.length % 5 === 4 && ci < cold.length) {
      const c = cold[ci++]!;
      if (!used.has(c.id)) {
        out.push(c);
        used.add(c.id);
      }
    }
    if (!used.has(f.id)) {
      out.push(f);
      used.add(f.id);
    }
  }
  return out;
}

/** Человек открыл окно раздела — интерес к его категории немного растёт. */
export function trackSection(sectionId: string): void {
  const cat = SECTION_CAT[sectionId];
  if (cat) useTaste.getState().track(cat, 0.5);
}
