/**
 * «Орбита» — каталог приложений и сервисов Sunnet (кнопка «+» в доке).
 * Рекомендации, категории, популярное, новое, подборки, создание своих
 * приложений и управление подписками.
 */
import { useMemo, useState, type CSSProperties } from 'react';
import { useSearchParams } from 'react-router';
import { ArrowLeft, BadgeCheck, Check, CreditCard, Flame, Hammer, Search, ShieldAlert, Sparkles, Star, Wand2, Clock } from 'lucide-react';
import { cn } from '../../shared/lib/format';
import { openPath } from '../desktop/fx';
import { CATALOG, CATEGORIES, catalogById, PERM_LABEL, VIA_LABEL, type CatalogApp, type CatId } from './catalog';
import { useCloud } from './cloud';
import { rankFeatures, useTaste } from './discover';
import { AppGlyph } from './AppGlyph';
import { askInstall } from './PermissionPrompt';
import { Subscriptions } from './Subscriptions';
import './hub.css';

type Tab = 'foryou' | 'top' | 'new' | 'cats' | 'create' | 'subs';
const TABS: { id: Tab; label: string; icon: typeof Star }[] = [
  { id: 'foryou', label: 'Для вас', icon: Sparkles },
  { id: 'top', label: 'Популярное', icon: Flame },
  { id: 'new', label: 'Новое', icon: Clock },
  { id: 'cats', label: 'Категории', icon: Star },
  { id: 'create', label: 'Создать', icon: Hammer },
  { id: 'subs', label: 'Подписки', icon: CreditCard },
];

const COLLECTIONS: { title: string; sub: string; ids: string[]; grad: string }[] = [
  { title: 'Все мессенджеры — в одном списке', sub: 'Подключите и общайтесь из Sunnet', ids: ['telegram', 'whatsapp', 'discord', 'slack', 'вконтакте', 'snapchat'], grad: 'linear-gradient(135deg,#ffd36b,#ff8a3d)' },
  { title: 'Кино на вечер', sub: 'Онлайн-кинотеатры с вашими подписками', ids: ['кинопоиск', 'wink', 'okko', 'иви', 'netflix', 'start'], grad: 'linear-gradient(135deg,#8ec5ff,#3d7bff)' },
  { title: 'Музыка без границ', sub: 'Слушайте, не выходя из Sunnet', ids: ['яндекс-музыка', 'spotify', 'vk-музыка', 'soundcloud', 'звук', 'youtube-music'], grad: 'linear-gradient(135deg,#ffb3d1,#ff5f8f)' },
  { title: 'Для разработчиков', sub: 'Код, хостинг и свой сервер', ids: ['студия-sunnet', 'github', 'sunnet-connect', 'render', 'figma', 'stackblitz'], grad: 'linear-gradient(135deg,#b6f0c8,#2fbf71)' },
];

function useInstalled() {
  const items = useCloud((s) => s.items);
  return useMemo(() => new Set(items.filter((i) => i.appId).map((i) => i.appId!)), [items]);
}

function GetButton({ app }: { app: CatalogApp }) {
  const installed = useInstalled();
  const has = installed.has(app.id);
  return (
    <button
      type="button"
      className={cn('orbit-get', has && 'orbit-get--has')}
      onClick={(e) => {
        e.stopPropagation();
        if (has) {
          const item = useCloud.getState().items.find((i) => i.appId === app.id);
          if (app.via === 'sunnet') openPath(app.url);
          else if (item) window.open(app.url, '_blank', 'noopener');
        } else void askInstall(app.id);
      }}
    >
      {has ? (
        <>
          <Check size={14} /> Открыть
        </>
      ) : (
        'Добавить'
      )}
    </button>
  );
}

function AppRow({ app, i, onOpen }: { app: CatalogApp; i: number; onOpen: (id: string) => void }) {
  return (
    <div className="orbit-row" style={{ '--i': i } as CSSProperties} onClick={() => onOpen(app.id)} role="button" tabIndex={0}>
      <AppGlyph app={app} size={46} />
      <div className="orbit-row__text">
        <div className="orbit-row__name">
          {app.name} {app.verified ? <BadgeCheck size={14} className="orbit-ok" /> : <ShieldAlert size={14} className="orbit-warn" />}
        </div>
        <div className="orbit-row__sub ellipsis">{app.blurb}</div>
      </div>
      <GetButton app={app} />
    </div>
  );
}

function Detail({ app, onBack }: { app: CatalogApp; onBack: () => void }) {
  const similar = CATALOG.filter((a) => a.cat === app.cat && a.id !== app.id).slice(0, 6);
  return (
    <div className="orbit-detail">
      <button type="button" className="btn btn--ghost btn--sm" onClick={onBack}>
        <ArrowLeft size={16} /> Орбита
      </button>
      <div className="orbit-detail__head">
        <AppGlyph app={app} size={96} />
        <div>
          <h1 className="orbit-detail__name">{app.name}</h1>
          <div className="orbit-detail__pub">
            {app.publisher} · {app.verified ? <span className="orbit-ok"><BadgeCheck size={14} /> проверен</span> : <span className="orbit-warn"><ShieldAlert size={14} /> не проверен</span>}
          </div>
          <div className="orbit-detail__via">{VIA_LABEL[app.via]}</div>
          <GetButton app={app} />
        </div>
      </div>
      <p className="orbit-detail__blurb">{app.blurb}</p>
      <div className="orbit-cards">
        <div className="orbit-card">
          <div className="orbit-card__t">Как работает в Sunnet</div>
          {app.via === 'api' && 'Подключение через официальный API: вы входите на странице сервиса, Sunnet получает только разрешённые данные.'}
          {app.via === 'web' && 'Официальная веб-версия сервиса. Вход — на сайте сервиса, Sunnet не видит ваш пароль.'}
          {app.via === 'link' && 'Ярлык на сайт: у сервиса нет открытого API для сторонних приложений.'}
          {app.via === 'sunnet' && 'Встроенное приложение Sunnet: работает с облаком и синхронизируется между устройствами.'}
        </div>
        <div className="orbit-card">
          <div className="orbit-card__t">Разрешения</div>
          {app.perms.length ? app.perms.map((p) => <div key={p}>• {PERM_LABEL[p]}</div>) : 'Не требуются'}
        </div>
      </div>
      <h3 className="orbit-h">Похожие</h3>
      <div className="orbit-grid">
        {similar.map((a, i) => (
          <AppRow key={a.id} app={a} i={i} onOpen={() => undefined} />
        ))}
      </div>
    </div>
  );
}

export function OrbitPage() {
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab) || 'foryou';
  const detail = params.get('app');
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<CatId | null>(null);
  const taste = useTaste();
  const setTab = (t: Tab) => setParams({ tab: t });
  const openApp = (id: string) => setParams({ tab, app: id });

  const list = useMemo(() => {
    if (q.trim()) {
      const s = q.toLowerCase();
      return CATALOG.filter((a) => `${a.name} ${a.blurb}`.toLowerCase().includes(s));
    }
    if (tab === 'top') return [...CATALOG].sort((a, b) => b.pop - a.pop);
    if (tab === 'new') return CATALOG.filter((a) => a.isNew);
    if (tab === 'cats') return CATALOG.filter((a) => !cat || a.cat === cat).sort((a, b) => b.pop - a.pop);
    return rankFeatures(taste)
      .filter((f) => f.kind === 'service')
      .map((f) => catalogById.get((f.to as { app: string }).app)!)
      .filter(Boolean);
  }, [q, tab, cat, taste]);

  const app = detail ? catalogById.get(detail) : undefined;
  if (app) return <div className="orbit"><Detail app={app} onBack={() => setParams({ tab })} /></div>;

  return (
    <div className="orbit">
      <header className="orbit-hero">
        <div className="orbit-hero__sun" aria-hidden />
        <div className="orbit-hero__ring orbit-hero__ring--1" aria-hidden />
        <div className="orbit-hero__ring orbit-hero__ring--2" aria-hidden />
        <h1 className="orbit-hero__title">Орбита</h1>
        <p className="orbit-hero__sub">{CATALOG.length} сервисов и приложений вокруг вашего Sunnet</p>
        <div className="orbit-search">
          <Search size={18} />
          <input placeholder="Найти приложение, сервис или функцию" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </header>
      <nav className="orbit-tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={cn('orbit-tab', tab === t.id && 'orbit-tab--on')} onClick={() => setTab(t.id)}>
            <t.icon size={15} /> {t.label}
          </button>
        ))}
      </nav>

      {tab === 'subs' && !q ? (
        <Subscriptions />
      ) : tab === 'create' && !q ? (
        <div className="orbit-create">
          <div className="orbit-create__card orbit-create__card--studio" onClick={() => openPath(`/studio?project=${useCloud.getState().create('project').id}`)} role="button" tabIndex={0}>
            <Wand2 size={28} />
            <div className="orbit-create__t">Новое приложение</div>
            <div className="orbit-create__s">Студия: холст, Explorer, свойства и скрипты на SunScript (JavaScript + API Sunnet)</div>
          </div>
          <div className="orbit-create__card orbit-create__card--server" onClick={() => openPath('/servers/new')} role="button" tabIndex={0}>
            <Sparkles size={28} />
            <div className="orbit-create__t">Новый сервер</div>
            <div className="orbit-create__s">Пространство для общения: каналы, роли, реакции, приглашения</div>
          </div>
          <div className="orbit-create__card orbit-create__card--learn" onClick={() => openPath('/studio?learn=1')} role="button" tabIndex={0}>
            <Star size={28} />
            <div className="orbit-create__t">Научиться с нуля</div>
            <div className="orbit-create__s">Интерактивные уроки — от первой кнопки до опубликованного приложения</div>
          </div>
        </div>
      ) : (
        <>
          {tab === 'foryou' && !q && (
            <div className="orbit-collections">
              {COLLECTIONS.map((c, i) => (
                <div key={c.title} className="orbit-coll" style={{ background: c.grad, '--i': i } as CSSProperties}>
                  <div className="orbit-coll__t">{c.title}</div>
                  <div className="orbit-coll__s">{c.sub}</div>
                  <div className="orbit-coll__apps">
                    {c.ids.map((id) => catalogById.get(id)).filter(Boolean).map((a) => (
                      <button key={a!.id} type="button" className="orbit-coll__app" onClick={() => openApp(a!.id)} title={a!.name}>
                        <AppGlyph app={a!} size={38} />
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
          {tab === 'cats' && !q && (
            <div className="orbit-cats">
              {CATEGORIES.map((c) => (
                <button key={c.id} type="button" className={cn('orbit-cat', cat === c.id && 'orbit-cat--on')} onClick={() => setCat(cat === c.id ? null : c.id)}>
                  <span className="orbit-cat__e">{c.emoji}</span> {c.label}
                </button>
              ))}
            </div>
          )}
          <h3 className="orbit-h">{q ? `Найдено: ${list.length}` : tab === 'foryou' ? 'Подобрано для вас' : tab === 'top' ? 'Популярное' : tab === 'new' ? 'Недавно добавлены' : 'Все приложения'}</h3>
          <div className="orbit-grid">
            {list.slice(0, 120).map((a, i) => (
              <AppRow key={a.id} app={a} i={i % 24} onOpen={openApp} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
