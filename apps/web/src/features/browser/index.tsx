/**
 * Браузер Sunnet: вкладки, адресная строка, поиск (Википедия и сам Sunnet), закладки,
 * история с поиском и очисткой, приватные вкладки (без истории), загрузки сразу в облако.
 * Сайты открываются внутри, если сами это разрешают; иначе — кнопка «Открыть отдельно».
 */
import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { ArrowLeft, ArrowRight, Bookmark, BookmarkCheck, CloudDownload, ExternalLink, EyeOff, History, Lock, Plus, RotateCw, Search, Trash2, X } from 'lucide-react';
import { api, errorMessage } from '../../shared/api/client';
import { toast } from '../../shared/stores/ui';
import { createItem } from '../desktop/cloud';
import { isDesktopApp, openWeb } from '../apps/openWeb';
import { SunBurst } from '../../shared/ui/SunBurst';
import './browser.css';

interface Tab {
  id: string;
  url: string | null;
  query: string | null;
  back: string[];
  forward: string[];
  private: boolean;
}
interface Visit {
  url: string;
  title: string;
  at: number;
}

const read = <T,>(k: string, d: T): T => {
  try {
    return JSON.parse(localStorage.getItem(k) ?? '') as T;
  } catch {
    return d;
  }
};
const write = (k: string, v: unknown) => {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {
    /* хранилище недоступно */
  }
};
const uid = () => Math.random().toString(36).slice(2, 9);
const newTab = (priv = false): Tab => ({ id: uid(), url: null, query: null, back: [], forward: [], private: priv });

/** Что ввели в адресную строку: адрес сайта или поисковый запрос. */
function resolve(input: string): { url?: string; query?: string } {
  const t = input.trim();
  if (/^https?:\/\//i.test(t)) return { url: t.replace(/^http:/i, 'https:') };
  if (/^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(t) && !t.includes(' ')) return { url: `https://${t}` };
  return { query: t };
}

export function BrowserPage() {
  // /browser?q=… — поиск сразу (например, из адресной строки встроенного браузера)
  const [tabs, setTabs] = useState<Tab[]>(() => {
    const q = new URLSearchParams(window.location.search).get('q')?.trim();
    return [{ ...newTab(), query: q ? q.slice(0, 200) : null }];
  });
  const [activeId, setActiveId] = useState(tabs[0]!.id);
  const [bookmarks, setBookmarks] = useState<Visit[]>(() => read('sunnet-browser-bookmarks', []));
  const [history, setHistory] = useState<Visit[]>(() => read('sunnet-browser-history', []));
  const [panel, setPanel] = useState<'none' | 'history' | 'bookmarks' | 'downloads'>('none');
  const [downloads, setDownloads] = useState<{ name: string; state: 'loading' | 'done' | 'error'; text?: string }[]>([]);
  const tab = tabs.find((t) => t.id === activeId) ?? tabs[0]!;
  const [address, setAddress] = useState('');
  useEffect(() => setAddress(tab.url ?? tab.query ?? ''), [tab.id, tab.url, tab.query]);

  const patch = (id: string, f: (t: Tab) => Tab) => setTabs((ts) => ts.map((t) => (t.id === id ? f(t) : t)));
  const go = (input: string) => {
    const r = resolve(input);
    if (!r.url && !r.query) return;
    // В приложении для компьютера сайт открывается во встроенном браузере Sunnet —
    // там работают все сайты, вход, видео, а скачанное уходит в облако
    if (r.url && isDesktopApp()) {
      openWeb(r.url);
      if (!tab.private) {
        const h = [{ url: r.url, title: new URL(r.url).hostname, at: Date.now() }, ...history.filter((v) => v.url !== r.url)].slice(0, 300);
        setHistory(h);
        write('sunnet-browser-history', h);
      }
      return;
    }
    patch(tab.id, (t) => ({ ...t, back: [...t.back, t.url ?? (t.query ? `?${t.query}` : '')].filter(Boolean), forward: [], url: r.url ?? null, query: r.query ?? null }));
    if (r.url && !tab.private) {
      const h = [{ url: r.url, title: new URL(r.url).hostname, at: Date.now() }, ...history.filter((v) => v.url !== r.url)].slice(0, 300);
      setHistory(h);
      write('sunnet-browser-history', h);
    }
  };
  const step = (dir: 'back' | 'forward') =>
    patch(tab.id, (t) => {
      const list = dir === 'back' ? t.back : t.forward;
      if (!list.length) return t;
      const target = list[list.length - 1]!;
      const cur = t.url ?? (t.query ? `?${t.query}` : '');
      const rest = list.slice(0, -1);
      const isQ = target.startsWith('?');
      return { ...t, url: isQ ? null : target, query: isQ ? target.slice(1) : null, back: dir === 'back' ? rest : [...t.back, cur], forward: dir === 'forward' ? rest : [...t.forward, cur] };
    });
  const marked = !!tab.url && bookmarks.some((b) => b.url === tab.url);
  const toggleMark = () => {
    if (!tab.url) return;
    const next = marked ? bookmarks.filter((b) => b.url !== tab.url) : [{ url: tab.url, title: new URL(tab.url).hostname, at: Date.now() }, ...bookmarks];
    setBookmarks(next);
    write('sunnet-browser-bookmarks', next);
  };
  const download = async (url: string) => {
    const name = decodeURIComponent(url.split('/').pop() || 'файл').slice(0, 80);
    setDownloads((d) => [{ name, state: 'loading' }, ...d]);
    setPanel('downloads');
    try {
      const r = await api.post<{ media: { id: string }; name: string }>('/browser/download', { url });
      await createItem({ kind: 'file', name: r.name, mediaId: r.media.id });
      setDownloads((d) => d.map((x, i) => (i === 0 ? { ...x, state: 'done', text: 'Проверено и сохранено на рабочий стол' } : x)));
      toast({ text: `«${r.name}» — на рабочем столе`, kind: 'success' });
    } catch (e) {
      setDownloads((d) => d.map((x, i) => (i === 0 ? { ...x, state: 'error', text: errorMessage(e) } : x)));
    }
  };

  return (
    <div className="brw">
      <div className="brw__tabs" role="tablist" aria-label="Вкладки">
        {tabs.map((t) => (
          <div key={t.id} className={`brw__tab${t.id === tab.id ? ' is-on' : ''}${t.private ? ' is-private' : ''}`}>
            <button type="button" role="tab" aria-selected={t.id === tab.id} onClick={() => setActiveId(t.id)}>
              {t.private && <EyeOff size={13} />}
              <span>{t.url ? new URL(t.url).hostname : t.query ? t.query : 'Новая вкладка'}</span>
            </button>
            {tabs.length > 1 && (
              <button
                type="button"
                className="brw__close"
                aria-label="Закрыть вкладку"
                onClick={() => {
                  const rest = tabs.filter((x) => x.id !== t.id);
                  setTabs(rest);
                  if (t.id === tab.id) setActiveId(rest[rest.length - 1]!.id);
                }}
              >
                <X size={13} />
              </button>
            )}
          </div>
        ))}
        <button type="button" className="brw__new" aria-label="Новая вкладка" onClick={() => (setTabs((ts) => [...ts, newTab()]), setActiveId(''))}>
          <Plus size={16} />
        </button>
        <button type="button" className="brw__new" aria-label="Приватная вкладка" title="Приватная вкладка — без истории" onClick={() => {
          const t = newTab(true);
          setTabs((ts) => [...ts, t]);
          setActiveId(t.id);
        }}>
          <EyeOff size={15} />
        </button>
      </div>
      <form
        className="brw__bar"
        onSubmit={(e) => {
          e.preventDefault();
          go(address);
        }}
      >
        <button type="button" aria-label="Назад" disabled={!tab.back.length} onClick={() => step('back')}>
          <ArrowLeft size={17} />
        </button>
        <button type="button" aria-label="Вперёд" disabled={!tab.forward.length} onClick={() => step('forward')}>
          <ArrowRight size={17} />
        </button>
        <button type="button" aria-label="Обновить" onClick={() => tab.url && patch(tab.id, (t) => ({ ...t, url: `${t.url!.split('#')[0]}#${uid()}` }))}>
          <RotateCw size={16} />
        </button>
        <label className="brw__address">
          {tab.url ? <Lock size={14} className="brw__lock" /> : <Search size={14} />}
          <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Введите запрос или адрес сайта" aria-label="Адрес или запрос" spellCheck={false} />
        </label>
        <button type="button" aria-label={marked ? 'Убрать из закладок' : 'В закладки'} disabled={!tab.url} onClick={toggleMark} className={marked ? 'is-on' : ''}>
          {marked ? <BookmarkCheck size={17} /> : <Bookmark size={17} />}
        </button>
        <button type="button" aria-label="Скачать на рабочий стол" title="Скачать файл по этой ссылке на рабочий стол" disabled={!tab.url} onClick={() => tab.url && void download(tab.url)}>
          <CloudDownload size={17} />
        </button>
        <button type="button" aria-label="История" onClick={() => setPanel(panel === 'history' ? 'none' : 'history')}>
          <History size={17} />
        </button>
        <button type="button" aria-label="Закладки" onClick={() => setPanel(panel === 'bookmarks' ? 'none' : 'bookmarks')}>
          <Bookmark size={17} />
        </button>
      </form>

      <div className="brw__body">
        {tab.url ? (
          <Site url={tab.url} />
        ) : tab.query ? (
          <Results q={tab.query} onOpen={go} onDownload={(u) => void download(u)} />
        ) : (
          <Home onSearch={go} priv={tab.private} bookmarks={bookmarks} onOpen={go} />
        )}
        {panel !== 'none' && (
          <aside className="brw__panel">
            <header>
              <b>{{ history: 'История', bookmarks: 'Закладки', downloads: 'Загрузки' }[panel]}</b>
              {panel === 'history' && history.length > 0 && (
                <button type="button" onClick={() => (setHistory([]), write('sunnet-browser-history', []))}>
                  <Trash2 size={14} /> Очистить
                </button>
              )}
              <button type="button" aria-label="Закрыть" onClick={() => setPanel('none')}>
                <X size={15} />
              </button>
            </header>
            {panel === 'downloads' ? (
              <ul>
                {downloads.map((d, i) => (
                  <li key={i} className={`brw__dl brw__dl--${d.state}`}>
                    <b>{d.name}</b>
                    <span>{d.state === 'loading' ? 'Скачиваем и проверяем…' : d.text}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <VisitList items={panel === 'history' ? history : bookmarks} onOpen={(u) => (go(u), setPanel('none'))} searchable={panel === 'history'} />
            )}
          </aside>
        )}
      </div>
    </div>
  );
}

function VisitList({ items, onOpen, searchable }: { items: Visit[]; onOpen: (u: string) => void; searchable: boolean }) {
  const [f, setF] = useState('');
  const list = useMemo(() => items.filter((v) => !f || v.url.toLowerCase().includes(f.toLowerCase())), [items, f]);
  return (
    <>
      {searchable && <input className="brw__find" value={f} onChange={(e) => setF(e.target.value)} placeholder="Поиск по истории" aria-label="Поиск по истории" />}
      {list.length === 0 && <p className="brw__muted">Пусто</p>}
      <ul>
        {list.map((v) => (
          <li key={v.url + v.at}>
            <button type="button" onClick={() => onOpen(v.url)}>
              <b>{v.title}</b>
              <span>{v.url}</span>
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}

function Home({ onSearch, priv }: { onSearch: (q: string) => void; priv: boolean; bookmarks?: Visit[]; onOpen?: (u: string) => void }) {
  const [q, setQ] = useState('');
  return (
    <div className="brw-home">
      {/* Вместо надписи — живое солнце: лучи вращаются, вокруг плывут орбиты и искры */}
      <div className="brw-home__hero" aria-hidden>
        <span className="brw-home__orbit brw-home__orbit--a" />
        <span className="brw-home__orbit brw-home__orbit--b" />
        {Array.from({ length: 7 }, (_, i) => (
          <span key={i} className="brw-home__spark" style={{ '--k': i } as React.CSSProperties} />
        ))}
        <SunBurst size={118} spin />
      </div>
      {priv && (
        <p className="brw-home__private">
          <EyeOff size={15} /> Приватная вкладка: история и поисковые запросы не сохраняются
        </p>
      )}
      <form
        className="brw-home__form"
        onSubmit={(e) => {
          e.preventDefault();
          if (q.trim()) onSearch(q);
        }}
      >
        <label className="brw-home__box">
          <Search size={19} />
          <input value={q} onChange={(e) => setQ(e.target.value)} aria-label="Поиск или адрес сайта" placeholder="Найдите что угодно или введите адрес сайта" autoFocus />
          <button type="submit" className="brw-home__go" aria-label="Искать" disabled={!q.trim()}>
            <ArrowRight size={19} />
          </button>
        </label>
      </form>
    </div>
  );
}

function Results({ q, onOpen, onDownload }: { q: string; onOpen: (u: string) => void; onDownload: (u: string) => void }) {
  const r = useQuery({
    queryKey: ['browser-search', q],
    queryFn: () =>
      api.get<{ web: { title: string; url: string; snippet: string; source: string }[]; sunnet: { users: { username: string; displayName: string }[]; spaces: { id: string; name: string }[]; posts: { id: string; text: string; author: string }[] } }>(
        `/browser/search?q=${encodeURIComponent(q)}`,
      ),
  });
  return (
    <div className="brw-res">
      {r.isLoading && <p className="brw__muted">Ищем…</p>}
      {r.isError && <p className="brw__muted">{errorMessage(r.error)}</p>}
      {r.data && (
        <>
          {(r.data.sunnet.users.length > 0 || r.data.sunnet.spaces.length > 0) && (
            <section className="brw-res__sunnet">
              <h3>В Sunnet</h3>
              {r.data.sunnet.users.map((u) => (
                <Link key={u.username} to={`/u/${u.username}`}>
                  {u.displayName} <span>@{u.username}</span>
                </Link>
              ))}
              {r.data.sunnet.spaces.map((s) => (
                <Link key={s.id} to={`/communities/${s.id}`}>
                  {s.name} <span>сообщество</span>
                </Link>
              ))}
            </section>
          )}
          {r.data.web.length === 0 && <p className="brw__muted">В интернете ничего не нашлось. Попробуйте другие слова.</p>}
          {r.data.web.map((w, i) => (
            <article key={w.url} className="brw-hit" style={{ '--i': i } as React.CSSProperties}>
              <span className="brw-hit__url">
                {w.source} · {decodeURIComponent(w.url).replace(/^https:\/\//, '')}
              </span>
              <button type="button" className="brw-hit__title" onClick={() => onOpen(w.url)}>
                {w.title}
              </button>
              <p>{w.snippet}</p>
              <span className="brw-hit__acts">
                <a href={w.url} target="_blank" rel="noopener noreferrer">
                  <ExternalLink size={13} /> Открыть отдельно
                </a>
                {/\.(pdf|zip|png|jpe?g|webp|gif|mp4|mp3|webm)$/i.test(w.url) && (
                  <button type="button" onClick={() => onDownload(w.url)}>
                    <CloudDownload size={13} /> В облако
                  </button>
                )}
              </span>
            </article>
          ))}
        </>
      )}
    </div>
  );
}

/** Сайт внутри: в изоляции (sandbox). Многие сайты запрещают показ внутри — тогда открываем отдельно. */
function Site({ url }: { url: string }) {
  return (
    <div className="brw-site">
      <iframe src={url} title={url} sandbox="allow-scripts allow-forms allow-same-origin allow-popups allow-popups-to-escape-sandbox" referrerPolicy="strict-origin-when-cross-origin" />
      <div className="brw-site__hint">
        Страница пустая? Сайт запрещает показ внутри других приложений.{' '}
        <a href={url} target="_blank" rel="noopener noreferrer">
          Открыть отдельно <ExternalLink size={12} />
        </a>
      </div>
    </div>
  );
}
