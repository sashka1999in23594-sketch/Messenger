/**
 * Каталог приложений — кнопка «+» в доке. Поиск, категории, подборки.
 * Честно про способ подключения: у большинства сервисов нет API для встраивания
 * чужого аккаунта, поэтому они открываются официальной веб-версией в отдельном окне
 * браузера. Объединение чатов Telegram/WhatsApp — отдельная серверная интеграция
 * (Telegram — TDLib на сервере, WhatsApp — только Business Cloud API), она в работе.
 */
import { useMemo, useState, type CSSProperties } from 'react';
import { useSearchParams } from 'react-router';
import { BookOpen, Briefcase, Code2, ExternalLink, Film, Gamepad2, Link2, MessageCircle, MonitorDown, Music, Search, Sparkles, Users, Wrench } from 'lucide-react';
import { openPath } from '../desktop/fx';
import { installHistory, openInstaller } from './Installer';
import { toast } from '../../shared/stores/ui';
import { CATALOG, CATEGORIES, type CatalogApp } from './catalog';
import './apps.css';

const KEY = 'sunnet-apps-opened';

/** Значок категории вместо буквы: свои логотипы сервисов мы не копируем. */
const CAT_ICON: Record<string, React.ReactNode> = {
  chat: <MessageCircle size={22} />,
  social: <Users size={22} />,
  music: <Music size={22} />,
  video: <Film size={22} />,
  work: <Briefcase size={22} />,
  dev: <Code2 size={22} />,
  learn: <BookOpen size={22} />,
  games: <Gamepad2 size={22} />,
  tools: <Wrench size={22} />,
};

function readOpened(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, number>;
  } catch {
    return {};
  }
}

function remember(id: string) {
  try {
    const o = readOpened();
    o[id] = (o[id] ?? 0) + 1;
    localStorage.setItem(KEY, JSON.stringify(o));
  } catch {
    /* хранилище недоступно — подбор просто не учтёт это открытие */
  }
}

/** Подбор «для вас»: категории, которыми человек уже пользуется, весят больше. */
function recommend(opened: Record<string, number>): CatalogApp[] {
  const weight = new Map<string, number>();
  for (const a of CATALOG) if (opened[a.id]) weight.set(a.cat, (weight.get(a.cat) ?? 0) + opened[a.id]!);
  return [...CATALOG]
    .filter((a) => !opened[a.id])
    .sort((x, y) => (weight.get(y.cat) ?? 0) + y.pop / 100 - ((weight.get(x.cat) ?? 0) + x.pop / 100))
    .slice(0, 6);
}

function AppRow({ a, i }: { a: CatalogApp; i: number }) {
  const open = () => {
    remember(a.id);
    window.open(a.url, '_blank', 'noopener,noreferrer');
  };
  return (
    <li className="apps-row" style={{ '--i': i } as CSSProperties}>
      <span className="apps-row__icon" style={{ '--c1': a.color[0], '--c2': a.color[1] } as CSSProperties} aria-hidden>
        {CAT_ICON[a.cat] ?? a.name.slice(0, 1)}
      </span>
      <span className="apps-row__text">
        <span className="apps-row__name">{a.name}</span>
        <span className="apps-row__desc">{a.desc}</span>
        <span className={`apps-row__how apps-row__how--${a.how}`}>{a.how === 'web' ? 'Официальная веб-версия' : a.how === 'api' ? 'Чаты — в общем списке Sunnet' : 'Приложение Sunnet'}</span>
      </span>
      <button
        type="button"
        className="apps-row__add"
        onClick={async () => {
          remember(a.id);
          if (await openInstaller({ name: a.name, url: a.url, publisher: new URL(a.url).hostname, verified: true, kind: 'web' })) toast({ text: `${a.name} — на рабочем столе`, kind: 'success' });
        }}
        aria-label={`Добавить ${a.name} на рабочий стол`}
        title="На рабочий стол"
      >
        <MonitorDown size={16} />
      </button>
      {a.how === 'api' && (
        <button type="button" className="apps-row__open" onClick={() => void openPath('/chats/connect')} aria-label={`Подключить ${a.name} к чатам Sunnet`}>
          <Link2 size={14} /> К чатам
        </button>
      )}
      <button type="button" className="apps-row__open" onClick={open} aria-label={`Открыть ${a.name}`}>
        Открыть <ExternalLink size={14} />
      </button>
    </li>
  );
}

export function AppsCatalog() {
  const [params] = useSearchParams();
  const [q, setQ] = useState(() => params.get('q') ?? '');
  const [cat, setCat] = useState<string>('all');
  const opened = useMemo(readOpened, []);
  const forYou = useMemo(() => recommend(opened), [opened]);
  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return CATALOG.filter((a) => (cat === 'all' || a.cat === cat) && (!s || `${a.name} ${a.desc} ${a.tags}`.toLowerCase().includes(s))).sort((x, y) => y.pop - x.pop);
  }, [q, cat]);

  return (
    <div className="scroll">
      <div className="apps">
        <header className="apps-hero">
          <div className="apps-hero__sun" aria-hidden />
          <h1 className="apps-hero__title">Приложения</h1>
          <p className="apps-hero__sub">{CATALOG.length} сервисов для работы, общения, музыки и кино</p>
          <label className="apps-search">
            <Search size={18} aria-hidden />
            <input id="apps-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Найти приложение или сервис" autoComplete="off" />
          </label>
        </header>

        <div className="apps-links">
          <button type="button" className="apps-row__open" onClick={() => void openPath('/apps/subscriptions')}>
            Мои подписки
          </button>
          <button type="button" className="apps-row__open" onClick={() => void openPath('/studio')}>
            Создать своё приложение
          </button>
        </div>
        <nav className="apps-cats" aria-label="Категории">
          {[{ id: 'all', label: 'Все' }, ...CATEGORIES].map((c) => (
            <button key={c.id} type="button" className={`apps-cat ${cat === c.id ? 'is-on' : ''}`} onClick={() => setCat(c.id)}>
              {c.label}
            </button>
          ))}
        </nav>

        {!q && cat === 'all' && (
          <section className="apps-sec">
            <h2 className="apps-sec__title">
              <Sparkles size={18} aria-hidden /> Подобрано для вас
            </h2>
            <ul className="apps-grid">
              {forYou.map((a, i) => (
                <AppRow key={a.id} a={a} i={i} />
              ))}
            </ul>
          </section>
        )}

        <section className="apps-sec">
          <h2 className="apps-sec__title">{q ? `Найдено: ${list.length}` : cat === 'all' ? 'Популярное' : CATEGORIES.find((c) => c.id === cat)?.label}</h2>
          {list.length ? (
            <ul className="apps-grid">
              {list.map((a, i) => (
                <AppRow key={a.id} a={a} i={Math.min(i, 12)} />
              ))}
            </ul>
          ) : (
            <p className="apps-empty">Ничего не нашлось. Попробуйте другое название.</p>
          )}
        </section>
        {installHistory().length > 0 && !q && cat === 'all' && (
          <section className="apps-sec">
            <h2 className="apps-sec__title">История установок</h2>
            <ul className="apps-history">
              {installHistory()
                .slice(0, 10)
                .map((h) => (
                  <li key={h.at}>
                    <b>{h.name}</b> · {h.publisher} · {new Date(h.at).toLocaleString('ru', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                  </li>
                ))}
            </ul>
          </section>
        )}
        <p className="apps-note">
          Сервисы открываются своей официальной веб-версией — Sunnet не получает ваши пароли и не копирует защищённый контент. Объединение чатов Telegram и WhatsApp в общий список Sunnet требует серверной интеграции через их официальные API и появится отдельным обновлением.
        </p>
      </div>
    </div>
  );
}
