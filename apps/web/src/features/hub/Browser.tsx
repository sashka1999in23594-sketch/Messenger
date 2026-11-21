/**
 * Браузер Sunnet: вкладки, поиск, закладки, история и загрузки в облако.
 *
 * Ограничение веб-версии: большинство сайтов запрещают показ внутри чужой
 * страницы (X-Frame-Options / CSP frame-ancestors). Такие сайты открываются
 * в новой вкладке; в приложении для компьютера страница открывается в
 * изолированном окне Electron без доступа к Sunnet.
 * Страницы в iframe работают в песочнице без same-origin — не видят cookie,
 * облако и окна Sunnet. Загрузки попадают в облако с пометкой «из интернета»
 * и открываются только в песочнице.
 */
import { useState, type CSSProperties } from 'react';
import { ArrowLeft, ArrowRight, Bookmark, BookmarkCheck, Download, ExternalLink, History, Plus, RotateCw, Search, Shield, X } from 'lucide-react';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { cn } from '../../shared/lib/format';
import { toast } from '../../shared/stores/ui';
import { useCloud } from './cloud';
import { CATALOG } from './catalog';
import { AppGlyph } from './AppGlyph';
import './hub.css';

interface Tab {
  id: string;
  url: string;
  title: string;
  back: string[];
  fwd: string[];
}

const useBrowser = create<{
  bookmarks: { url: string; title: string }[];
  history: { url: string; title: string; at: number }[];
  saveHistory: boolean;
  autoCloud: boolean;
  set: (p: Partial<{ bookmarks: { url: string; title: string }[]; history: { url: string; title: string; at: number }[]; saveHistory: boolean; autoCloud: boolean }>) => void;
}>()(persist((set) => ({ bookmarks: [], history: [], saveHistory: true, autoCloud: true, set: (p) => set(p) }), { name: 'sunnet.browser' }));

const HOME = 'sunnet://start';
const uid = () => Math.random().toString(36).slice(2, 8);

function normalize(input: string): string {
  const s = input.trim();
  if (/^https?:\/\//i.test(s)) return s;
  if (/^[\w-]+(\.[\w-]+)+(\/.*)?$/.test(s)) return `https://${s}`;
  return `sunnet://search?q=${encodeURIComponent(s)}`;
}

interface Hit {
  title: string;
  url: string;
  snippet: string;
}

async function search(q: string): Promise<Hit[]> {
  // Открытый API Википедии (CORS разрешён) + каталог Орбиты
  const local = CATALOG.filter((a) => a.name.toLowerCase().includes(q.toLowerCase())).slice(0, 4).map((a) => ({ title: a.name, url: a.url.startsWith('http') ? a.url : `https://${a.url}`, snippet: a.blurb }));
  try {
    const r = await fetch(`https://ru.wikipedia.org/w/api.php?action=query&list=search&format=json&origin=*&srlimit=8&srsearch=${encodeURIComponent(q)}`);
    const j = (await r.json()) as { query?: { search?: { title: string; snippet: string }[] } };
    const wiki = (j.query?.search ?? []).map((x) => ({ title: x.title, url: `https://ru.wikipedia.org/wiki/${encodeURIComponent(x.title)}`, snippet: x.snippet.replace(/<[^>]+>/g, '') }));
    return [...local, ...wiki];
  } catch {
    return local;
  }
}

function Start({ go }: { go: (u: string) => void }) {
  const [q, setQ] = useState('');
  const bookmarks = useBrowser((s) => s.bookmarks);
  return (
    <div className="br-start">
      <div className="br-start__sun" aria-hidden />
      <h1 className="br-start__logo">Sunnet</h1>
      <form className="br-start__search" onSubmit={(e) => (e.preventDefault(), q.trim() && go(normalize(q)))}>
        <Search size={18} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Искать в интернете или ввести адрес" autoFocus />
      </form>
      <div className="br-start__tiles">
        {(bookmarks.length ? bookmarks : CATALOG.filter((a) => a.pop > 93 && a.via !== 'sunnet').slice(0, 8).map((a) => ({ url: a.url, title: a.name }))).map((b, i) => (
          <button key={b.url} type="button" className="br-tile" style={{ '--i': i } as CSSProperties} onClick={() => go(b.url)}>
            <AppGlyph app={{ name: b.title, color: ['#ff9f2e', '#3d8bff', '#2fbf71', '#ff5f8f'][i % 4]! }} size={42} />
            <span className="ellipsis">{b.title}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function Results({ q, go }: { q: string; go: (u: string) => void }) {
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [key, setKey] = useState('');
  if (key !== q) {
    setKey(q);
    setHits(null);
    void search(q).then(setHits);
  }
  return (
    <div className="br-results">
      <div className="hub-muted">Результаты по запросу «{q}»</div>
      {!hits && <div className="br-skel" />}
      {hits?.map((h, i) => (
        <button key={h.url} type="button" className="br-hit" style={{ '--i': i } as CSSProperties} onClick={() => go(h.url)}>
          <span className="br-hit__url">{h.url.replace(/^https?:\/\//, '').slice(0, 60)}</span>
          <span className="br-hit__t">{h.title}</span>
          <span className="br-hit__s">{h.snippet}</span>
        </button>
      ))}
      {hits && !hits.length && <div className="hub-muted">Ничего не нашлось</div>}
    </div>
  );
}

export function BrowserPage() {
  const [tabs, setTabs] = useState<Tab[]>([{ id: uid(), url: HOME, title: 'Новая вкладка', back: [], fwd: [] }]);
  const [cur, setCur] = useState(tabs[0]!.id);
  const [panel, setPanel] = useState<'none' | 'history' | 'privacy'>('none');
  const b = useBrowser();
  const tab = tabs.find((t) => t.id === cur) ?? tabs[0]!;
  const [addr, setAddr] = useState('');
  const patchTab = (p: Partial<Tab>) => setTabs((ts) => ts.map((t) => (t.id === tab.id ? { ...t, ...p } : t)));
  const go = (url: string) => {
    const title = url.startsWith('sunnet://search') ? decodeURIComponent(url.split('q=')[1] ?? '') : url.replace(/^https?:\/\//, '').split('/')[0]!;
    patchTab({ url, title, back: [...tab.back, tab.url], fwd: [] });
    setAddr('');
    if (b.saveHistory) b.set({ history: [{ url, title, at: Date.now() }, ...b.history].slice(0, 500) });
  };
  const marked = b.bookmarks.some((x) => x.url === tab.url);
  const isWeb = tab.url.startsWith('http');

  const download = () => {
    const name = decodeURIComponent(tab.url.split('/').pop() || 'страница.html').slice(0, 80);
    if (!b.autoCloud) return window.open(tab.url, '_blank', 'noopener');
    useCloud.getState().create('file', name, { quarantined: true, mime: 'application/octet-stream' });
    useCloud.getState().log({ level: 'info', text: `Загрузка из браузера помещена в облако в карантин: ${name}` });
    toast({ text: `«${name}» сохранён на рабочем столе (карантин)`, kind: 'success' });
  };

  return (
    <div className="br">
      <div className="br-tabs">
        {tabs.map((t) => (
          <div key={t.id} className={cn('br-tab', t.id === tab.id && 'br-tab--on')} onClick={() => setCur(t.id)} role="tab">
            <span className="ellipsis">{t.title}</span>
            {tabs.length > 1 && (
              <button
                type="button"
                className="br-tab__x"
                onClick={(e) => {
                  e.stopPropagation();
                  const rest = tabs.filter((x) => x.id !== t.id);
                  setTabs(rest);
                  if (t.id === cur) setCur(rest[0]!.id);
                }}
              >
                <X size={12} />
              </button>
            )}
          </div>
        ))}
        <button type="button" className="br-tab__new" onClick={() => {
          const t = { id: uid(), url: HOME, title: 'Новая вкладка', back: [], fwd: [] };
          setTabs([...tabs, t]);
          setCur(t.id);
        }} aria-label="Новая вкладка">
          <Plus size={15} />
        </button>
      </div>
      <div className="br-bar">
        <button type="button" className="icon-btn icon-btn--sm" disabled={!tab.back.length} onClick={() => patchTab({ url: tab.back.at(-1)!, back: tab.back.slice(0, -1), fwd: [tab.url, ...tab.fwd] })}><ArrowLeft size={16} /></button>
        <button type="button" className="icon-btn icon-btn--sm" disabled={!tab.fwd.length} onClick={() => patchTab({ url: tab.fwd[0]!, fwd: tab.fwd.slice(1), back: [...tab.back, tab.url] })}><ArrowRight size={16} /></button>
        <button type="button" className="icon-btn icon-btn--sm" onClick={() => patchTab({ url: tab.url })}><RotateCw size={15} /></button>
        <form className="br-addr" onSubmit={(e) => (e.preventDefault(), addr.trim() && go(normalize(addr)))}>
          <Shield size={14} className="orbit-ok" />
          <input value={addr || (tab.url === HOME ? '' : tab.url)} onChange={(e) => setAddr(e.target.value)} placeholder="Поиск или адрес" />
        </form>
        <button type="button" className="icon-btn icon-btn--sm" disabled={!isWeb} onClick={() => b.set({ bookmarks: marked ? b.bookmarks.filter((x) => x.url !== tab.url) : [...b.bookmarks, { url: tab.url, title: tab.title }] })}>
          {marked ? <BookmarkCheck size={16} className="orbit-ok" /> : <Bookmark size={16} />}
        </button>
        <button type="button" className="icon-btn icon-btn--sm" disabled={!isWeb} onClick={download} title="Скачать в облако"><Download size={16} /></button>
        <button type="button" className="icon-btn icon-btn--sm" onClick={() => setPanel(panel === 'history' ? 'none' : 'history')}><History size={16} /></button>
        <button type="button" className="icon-btn icon-btn--sm" onClick={() => setPanel(panel === 'privacy' ? 'none' : 'privacy')}><Shield size={16} /></button>
      </div>
      <div className="br-body">
        {tab.url === HOME ? (
          <Start go={go} />
        ) : tab.url.startsWith('sunnet://search') ? (
          <Results q={decodeURIComponent(tab.url.split('q=')[1] ?? '')} go={go} />
        ) : (
          <div className="br-frame">
            <iframe key={tab.url} src={tab.url} title={tab.title} sandbox="allow-scripts allow-forms allow-popups" referrerPolicy="no-referrer" />
            <div className="br-frame__note">
              Если страница пустая — сайт запрещает показ внутри других приложений.
              <a className="btn btn--secondary btn--sm" href={tab.url} target="_blank" rel="noopener noreferrer">
                <ExternalLink size={14} /> Открыть во вкладке
              </a>
            </div>
          </div>
        )}
        {panel !== 'none' && (
          <aside className="br-panel">
            {panel === 'history' ? (
              <>
                <b>История</b>
                {b.history.slice(0, 60).map((h, i) => (
                  <button key={i} type="button" className="br-hist" onClick={() => go(h.url)}>
                    <span className="ellipsis">{h.title}</span>
                    <span className="hub-muted">{new Date(h.at).toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' })}</span>
                  </button>
                ))}
                <button type="button" className="btn btn--danger-ghost btn--sm" onClick={() => b.set({ history: [] })}>Очистить историю</button>
              </>
            ) : (
              <>
                <b>Приватность</b>
                <label className="sysdlg__perm"><input type="checkbox" checked={b.saveHistory} onChange={(e) => b.set({ saveHistory: e.target.checked })} /> Сохранять историю</label>
                <label className="sysdlg__perm"><input type="checkbox" checked={b.autoCloud} onChange={(e) => b.set({ autoCloud: e.target.checked })} /> Загрузки — сразу на рабочий стол</label>
                <p className="hub-muted">Страницы работают в песочнице и не видят ваш аккаунт Sunnet, облако и другие окна.</p>
              </>
            )}
          </aside>
        )}
      </div>
    </div>
  );
}
