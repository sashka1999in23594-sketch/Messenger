/**
 * Открытие возможностей — «лента функций», как рекомендации видео, только вместо
 * роликов — инструменты Sunnet. Модель простая и приватная (всё на устройстве):
 *  1. Считаем, какие разделы человек открывает (с затуханием: свежее весит больше).
 *  2. Кандидаты — пункты навигации, которыми он ещё не пользовался.
 *  3. Оценка = интерес к своему разделу + интерес к связанным разделам + новизна;
 *     «Не интересно» на неделю приглушает весь раздел.
 * Карточка появляется не чаще раза в 8 минут активной работы и не поверх полноэкранного окна.
 */
import { useEffect, useState } from 'react';
import { Sparkles, X } from 'lucide-react';
import { sections, type NavNode } from '../../app/navigation';
import { appFor } from './apps';
import { openPath } from './fx';
import { activeWin, useDesktop } from './store';
import './discover.css';

interface Usage {
  /** раздел → накопленный интерес */
  score: Record<string, number>;
  /** открытые адреса */
  seen: string[];
  /** раздел → до какого времени приглушён */
  muted: Record<string, number>;
  shownAt: number;
  updatedAt: number;
}
const KEY = 'sunnet-discover';
const EVERY_MS = 8 * 60_000;
const DECAY_DAYS = 14;

/** Какие разделы «рядом»: интерес к одному поднимает подсказки из другого. */
const RELATED: Record<string, string[]> = {
  messenger: ['calls', 'channels', 'communities', 'servers'],
  channels: ['messenger', 'communities'],
  video: ['reels', 'channels'],
  reels: ['video', 'home'],
  home: ['reels', 'profile', 'stats'],
  studio: ['servers', 'apps', 'cloud'],
  servers: ['studio', 'communities'],
  communities: ['servers', 'messenger'],
  cloud: ['studio', 'browser', 'apps'],
  browser: ['cloud', 'apps'],
  apps: ['studio', 'browser'],
  companies: ['servers', 'messenger', 'calls'],
  stats: ['profile', 'home'],
};

function read(): Usage {
  try {
    const u = JSON.parse(localStorage.getItem(KEY) ?? '') as Usage;
    if (u && u.score) return u;
  } catch {
    /* первый запуск */
  }
  return { score: {}, seen: [], muted: {}, shownAt: Date.now(), updatedAt: Date.now() };
}
function save(u: Usage) {
  try {
    localStorage.setItem(KEY, JSON.stringify(u));
  } catch {
    /* подбор просто не запомнится */
  }
}

/** Учесть открытие раздела (вызывается при смене активного окна). */
export function noteVisit(path: string) {
  const u = read();
  const days = (Date.now() - u.updatedAt) / 86_400_000;
  const k = Math.pow(0.5, days / DECAY_DAYS);
  for (const s of Object.keys(u.score)) u.score[s] = u.score[s]! * k;
  const id = appFor(path).id;
  u.score[id] = (u.score[id] ?? 0) + 1;
  const clean = path.split(/[?#]/)[0]!;
  if (!u.seen.includes(clean)) u.seen = [clean, ...u.seen].slice(0, 400);
  u.updatedAt = Date.now();
  save(u);
}

interface Pick {
  node: NavNode;
  section: string;
  reason: string;
}

export function pickFeature(u = read()): Pick | null {
  const now = Date.now();
  let best: { p: Pick; s: number } | null = null;
  for (const sec of sections) {
    if ((u.muted[sec.id] ?? 0) > now) continue;
    const own = u.score[sec.id] ?? 0;
    const near = (RELATED[sec.id] ?? []).reduce((a, r) => a + (u.score[r] ?? 0), 0);
    const walk = (nodes: NavNode[]) => {
      for (const n of nodes) {
        if (n.children) walk(n.children);
        if (!n.path || n.planned || n.adminOnly || u.seen.includes(n.path) || n.path === sec.path) continue;
        // Небольшой случайный разброс, чтобы подсказки не повторялись одна за другой
        const s = own * 1.0 + near * 0.6 + (n.keywords?.length ? 0.3 : 0) + Math.random() * 0.4;
        if (!best || s > best.s) {
          const reason = own >= near && own > 0 ? `вы часто открываете «${sec.label}»` : near > 0 ? `рядом с тем, чем вы пользуетесь` : 'новое в Sunnet';
          best = { p: { node: n, section: sec.label, reason }, s };
        }
      }
    };
    walk(sec.children);
  }
  return (best as { p: Pick } | null)?.p ?? null;
}

/** Карточка «Новая возможность» над доком. */
export function DiscoverCard() {
  const [pick, setPick] = useState<Pick | null>(null);
  useEffect(() => {
    // Учитываем, что человек открывает
    let last = '';
    const unsub = useDesktop.subscribe((s) => {
      const a = activeWin(s.wins);
      if (a && a.path !== last) {
        last = a.path;
        noteVisit(a.path);
      }
    });
    const tick = () => {
      const u = read();
      const st = useDesktop.getState();
      const a = activeWin(st.wins);
      if (document.hidden || a?.max || Date.now() - u.shownAt < EVERY_MS) return;
      const p = pickFeature(u);
      if (!p) return;
      u.shownAt = Date.now();
      save(u);
      setPick(p);
    };
    const t = setInterval(tick, 30_000);
    // Первая подсказка — через минуту после входа
    const first = setTimeout(() => {
      const u = read();
      if (Date.now() - u.shownAt > 60_000) tick();
    }, 60_000);
    return () => {
      unsub();
      clearInterval(t);
      clearTimeout(first);
    };
  }, []);
  if (!pick) return null;
  const Icon = pick.node.icon ?? Sparkles;
  const dismiss = (mute: boolean) => {
    if (mute) {
      const u = read();
      const sec = sections.find((s) => s.label === pick.section);
      if (sec) u.muted[sec.id] = Date.now() + 7 * 86_400_000;
      save(u);
    }
    setPick(null);
  };
  return (
    <div className="disc" role="status" aria-live="polite">
      <span className="disc__icon" aria-hidden>
        <Icon size={20} />
        <i />
      </span>
      <div className="disc__body">
        <span className="disc__eyebrow">
          <Sparkles size={12} /> Новая возможность · {pick.reason}
        </span>
        <b>
          {pick.section}: {pick.node.label}
        </b>
        {pick.node.description && <span className="disc__text">{pick.node.description}</span>}
        <span className="disc__acts">
          <button
            type="button"
            className="disc__go"
            onClick={() => {
              void openPath(pick.node.path!);
              dismiss(false);
            }}
          >
            Попробовать
          </button>
          <button type="button" className="disc__no" onClick={() => dismiss(true)}>
            Не интересно
          </button>
        </span>
      </div>
      <button type="button" className="disc__x" aria-label="Закрыть" onClick={() => dismiss(false)}>
        <X size={14} />
      </button>
    </div>
  );
}
