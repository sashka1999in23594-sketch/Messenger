/**
 * Консоль владельца Sunnet на языке «Луч». Есть только у владельца платформы —
 * сервер отвечает 404 всем остальным. Каждый вызов команды пишется в журнал.
 * Внизу — редактор (Enter — выполнить, Shift+Enter — новая строка, Tab — дописать
 * команду, ↑/↓ — история). Учебник и справочник открываются по кнопкам сверху.
 */
import { Fragment, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Navigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { BookOpen, Check, ChevronRight, Eraser, Library, Play, Search, Sparkles, X } from 'lucide-react';
import { api, errorMessage } from '../../shared/api/client';
import { SunBurst } from '../../shared/ui/SunBurst';
import { LESSONS } from './lessons';
import './console.css';

interface Out {
  kind: 'in' | 'ok' | 'fail' | 'info';
  text: string;
}
interface Cmd {
  name: string;
  usage: string;
  text: string;
}

/** Подсветка кода «Луча»: команды, строки, числа, ключевые слова, конвейер. */
export function highlight(src: string): ReactNode[] {
  const re = /(#.*$)|("(?:[^"\\]|\\.)*"?|«[^»]*»?)|(\b\d+[a-zа-я]*\b)|(\/?[a-z]+\.[a-z_]+)|(\b(?:let|for|in|repeat|if|else|echo|and|or|not|true|false|пусть|для|в|повтор|если|иначе|вывод)\b)|(\|\s*[a-z]+)|([{}()[\],])/gimu;
  const out: ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(src))) {
    if (m.index > last) out.push(src.slice(last, m.index));
    const cls = m[1] ? 'c' : m[2] ? 's' : m[3] ? 'n' : m[4] ? 'f' : m[5] ? 'k' : m[6] ? 'p' : 'b';
    out.push(
      <span key={i++} className={`lx lx--${cls}`}>
        {m[0]}
      </span>,
    );
    last = m.index + m[0].length;
    if (m[0] === '') re.lastIndex++;
  }
  if (last < src.length) out.push(src.slice(last));
  return out;
}

const done = (): string[] => {
  try {
    return JSON.parse(localStorage.getItem('sunnet-luch-lessons') ?? '[]') as string[];
  } catch {
    return [];
  }
};

export function AdminConsole() {
  const cmds = useQuery({ queryKey: ['admin-commands'], queryFn: () => api.get<{ count: number; commands: Cmd[] }>('/admin/console/commands'), retry: false, staleTime: 300_000 });
  const [out, setOut] = useState<Out[]>([]);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [hist, setHist] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem('sunnet-luch-history') ?? '[]') as string[];
    } catch {
      return [];
    }
  });
  const [hi, setHi] = useState(-1);
  const [panel, setPanel] = useState<'none' | 'learn' | 'ref'>('none');
  const [learned, setLearned] = useState<string[]>(done);
  const end = useRef<HTMLDivElement>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
  }, [out]);

  const list = cmds.data?.commands ?? [];
  // Бледное продолжение команды прямо в строке (Tab — принять)
  const ghost = useMemo(() => {
    const m = /([a-z]+\.[a-z_]*)$/i.exec(value.split('\n').pop() ?? '');
    if (!m || m[1]!.length < 3) return '';
    const hit = list.find((c) => c.name.startsWith(m[1]!.toLowerCase()) && c.name !== m[1]);
    return hit ? hit.name.slice(m[1]!.length) + '(' : '';
  }, [value, list]);

  const run = async (src = value) => {
    const command = src.trim();
    if (!command || busy) return;
    setBusy(true);
    const nextHist = [command, ...hist.filter((h) => h !== command)].slice(0, 80);
    setHist(nextHist);
    try {
      localStorage.setItem('sunnet-luch-history', JSON.stringify(nextHist));
    } catch {
      /* хранилище недоступно */
    }
    setHi(-1);
    setValue('');
    setOut((l) => [...l, { kind: 'in', text: command }]);
    try {
      const r = await api.post<{ ok: boolean; out?: { kind: 'ok' | 'fail' | 'info'; text: string }[]; lines: string[] }>('/admin/console', { command });
      setOut((l) => [...l, ...(r.out ?? r.lines.map((text) => ({ kind: r.ok ? ('ok' as const) : ('fail' as const), text })))]);
    } catch (e) {
      setOut((l) => [...l, { kind: 'fail', text: errorMessage(e) }]);
    } finally {
      setBusy(false);
      area.current?.focus();
    }
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void run();
    } else if (e.key === 'Tab' && ghost) {
      e.preventDefault();
      setValue((v) => v + ghost);
    } else if (e.key === 'ArrowUp' && !value.includes('\n') && hist.length) {
      e.preventDefault();
      const n = Math.min(hi + 1, hist.length - 1);
      setHi(n);
      setValue(hist[n]!);
    } else if (e.key === 'ArrowDown' && !value.includes('\n')) {
      e.preventDefault();
      const n = hi - 1;
      setHi(n);
      setValue(n >= 0 ? hist[n]! : '');
    }
  };

  const tryExample = (code: string, lessonId?: string) => {
    setPanel('none');
    void run(code);
    if (lessonId && !learned.includes(lessonId)) {
      const next = [...learned, lessonId];
      setLearned(next);
      try {
        localStorage.setItem('sunnet-luch-lessons', JSON.stringify(next));
      } catch {
        /* хранилище недоступно */
      }
    }
  };

  // Консоль только у владельца: остальным её как будто нет
  if (cmds.isError) return <Navigate to="/settings" replace />;

  const lines = value.split('\n').length;
  return (
    <div className="luch">
      <div className="luch__aurora" aria-hidden />
      <header className="luch__head">
        <span className="luch__logo">
          <SunBurst size={30} spin />
        </span>
        <span className="luch__title">
          <b>Луч</b>
          <span>консоль владельца · {cmds.data?.count ?? '…'} команд</span>
        </span>
        <span className="grow" />
        <button type="button" className={`luch__chip${panel === 'learn' ? ' is-on' : ''}`} onClick={() => setPanel(panel === 'learn' ? 'none' : 'learn')}>
          <BookOpen size={16} /> Учебник
          <span className="luch__badge">
            {learned.length}/{LESSONS.length}
          </span>
        </button>
        <button type="button" className={`luch__chip${panel === 'ref' ? ' is-on' : ''}`} onClick={() => setPanel(panel === 'ref' ? 'none' : 'ref')}>
          <Library size={16} /> Справочник
        </button>
        <button type="button" className="luch__chip luch__chip--icon" onClick={() => setOut([])} aria-label="Очистить экран" title="Очистить экран">
          <Eraser size={16} />
        </button>
      </header>

      <div className="luch__log" role="log" aria-live="polite">
        {out.length === 0 && (
          <div className="luch__hello">
            <Sparkles size={22} />
            <b>Напишите команду или целый скрипт</b>
            <span>
              Например <code>{highlight('user.online()')}</code> или <code>{highlight('post.top("like_count", 5)')}</code>
            </span>
            <button type="button" className="luch__start" onClick={() => setPanel('learn')}>
              <Play size={15} /> Пройти учебник за 5 минут
            </button>
          </div>
        )}
        {out.map((l, i) => (
          <div key={i} className={`luch__line luch__line--${l.kind}`} style={{ animationDelay: `${Math.min(i % 30, 12) * 18}ms` }}>
            {l.kind === 'in' ? (
              <>
                <span className="luch__prompt">›</span>
                <pre>{highlight(l.text)}</pre>
              </>
            ) : (
              <>
                <span className="luch__mark">{l.kind === 'ok' ? <Check size={13} /> : l.kind === 'fail' ? '!' : '·'}</span>
                <span>{l.text}</span>
              </>
            )}
          </div>
        ))}
        {busy && <div className="luch__busy" aria-label="Выполняется" />}
        <div ref={end} />
      </div>

      <div className="luch__editor">
        <span className="luch__prompt">›</span>
        <div className="luch__field">
          <pre className="luch__mirror" aria-hidden>
            {highlight(value)}
            <span className="luch__ghost">{ghost}</span>
            {'\n'}
          </pre>
          <textarea
            ref={area}
            aria-label="Команда или скрипт"
            value={value}
            rows={Math.min(8, lines)}
            onChange={(e) => {
              setValue(e.target.value);
              setHi(-1);
            }}
            onKeyDown={onKey}
            placeholder="Команда или скрипт — Enter выполнить, Shift+Enter новая строка"
            autoComplete="off"
            spellCheck={false}
            autoFocus
          />
        </div>
        <button type="button" className="luch__run" onClick={() => void run()} disabled={!value.trim() || busy} aria-label="Выполнить">
          <Play size={18} />
        </button>
      </div>

      {panel === 'learn' && <Lessons learned={learned} onTry={tryExample} onClose={() => setPanel('none')} />}
      {panel === 'ref' && (
        <Reference
          list={list}
          onPick={(u) => {
            setValue(u);
            setPanel('none');
            area.current?.focus();
          }}
          onClose={() => setPanel('none')}
        />
      )}
    </div>
  );
}

function Lessons({ learned, onTry, onClose }: { learned: string[]; onTry: (code: string, id: string) => void; onClose: () => void }) {
  const [open, setOpen] = useState(() => LESSONS.find((l) => !learned.includes(l.id))?.id ?? LESSONS[0]!.id);
  const lesson = LESSONS.find((l) => l.id === open)!;
  return (
    <div className="luch-sheet" role="dialog" aria-label="Учебник языка Луч">
      <div className="luch-sheet__head">
        <BookOpen size={18} />
        <b>Учебник «Луча»</b>
        <span className="grow" />
        <button type="button" className="luch__chip luch__chip--icon" onClick={onClose} aria-label="Закрыть">
          <X size={16} />
        </button>
      </div>
      <div className="luch-learn">
        <nav className="luch-learn__nav">
          {LESSONS.map((l, i) => (
            <button key={l.id} type="button" className={l.id === open ? 'is-on' : ''} onClick={() => setOpen(l.id)}>
              <span className={`luch-learn__num${learned.includes(l.id) ? ' is-done' : ''}`}>{learned.includes(l.id) ? <Check size={13} /> : i + 1}</span>
              {l.title}
            </button>
          ))}
        </nav>
        <article className="luch-learn__body" key={lesson.id}>
          <h3>{lesson.title}</h3>
          {lesson.text.map((p, i) => (
            <p key={i}>{p}</p>
          ))}
          {lesson.examples.map((ex, i) => (
            <div key={i} className="luch-ex">
              <pre>{highlight(ex.code)}</pre>
              <div className="luch-ex__foot">
                <span>{ex.note}</span>
                <button type="button" className="luch__start" onClick={() => onTry(ex.code, lesson.id)}>
                  <Play size={14} /> Выполнить
                </button>
              </div>
            </div>
          ))}
        </article>
      </div>
    </div>
  );
}

function Reference({ list, onPick, onClose }: { list: Cmd[]; onPick: (usage: string) => void; onClose: () => void }) {
  const [q, setQ] = useState('');
  const [sec, setSec] = useState<string | null>(null);
  const sections = useMemo(() => {
    const m = new Map<string, Cmd[]>();
    for (const c of list) {
      const s = c.name.split('.')[0]!;
      m.set(s, [...(m.get(s) ?? []), c]);
    }
    return [...m];
  }, [list]);
  const query = q.trim().toLowerCase();
  const found = query ? list.filter((c) => c.name.includes(query) || c.text.toLowerCase().includes(query)).slice(0, 80) : null;
  return (
    <div className="luch-sheet" role="dialog" aria-label="Справочник команд">
      <div className="luch-sheet__head">
        <Library size={18} />
        <b>Справочник · {list.length} команд</b>
        <span className="grow" />
        <button type="button" className="luch__chip luch__chip--icon" onClick={onClose} aria-label="Закрыть">
          <X size={16} />
        </button>
      </div>
      <label className="luch-ref__search">
        <Search size={16} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Найти: блок, рост, платежи…" autoFocus />
      </label>
      <div className="luch-ref">
        {found
          ? found.map((c) => <RefRow key={c.name} c={c} onPick={onPick} />)
          : sections.map(([s, cs]) => (
              <Fragment key={s}>
                <button type="button" className={`luch-ref__sec${sec === s ? ' is-open' : ''}`} onClick={() => setSec(sec === s ? null : s)}>
                  <ChevronRight size={15} />
                  <b>{s}</b>
                  <span>{cs.length}</span>
                </button>
                {sec === s && cs.map((c) => <RefRow key={c.name} c={c} onPick={onPick} />)}
              </Fragment>
            ))}
      </div>
    </div>
  );
}

function RefRow({ c, onPick }: { c: Cmd; onPick: (usage: string) => void }) {
  return (
    <button type="button" className="luch-ref__row" onClick={() => onPick(c.usage.replace(/^\//, ''))}>
      <code>{highlight(c.usage.replace(/^\//, ''))}</code>
      <span>{c.text}</span>
    </button>
  );
}
