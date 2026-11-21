/**
 * Студия Sunnet: рабочая область с экраном приложения, Explorer и свойства справа,
 * скрипт снизу (подсказки и проверка ошибок), предпросмотр в песочнице,
 * автосохранение в облако и публикация по ссылке.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as RPointerEvent } from 'react';
import { useParams } from 'react-router';
import { BookOpen, Box, Check, Code2, Copy, Image as ImageIcon, Monitor, MousePointer2, Play, Plus, RectangleHorizontal, Rocket, TextCursorInput, Trash2, Type, X } from 'lucide-react';
import { api, errorMessage } from '../../shared/api/client';
import { toast } from '../../shared/stores/ui';
import { openPath } from '../desktop/fx';
import { API, emptyProject, lint, NEW_EL, PERMISSION_INFO, suggest, TYPE_LABEL, uid, type El, type ElType, type Project } from './model';
import './studio.css';

type SaveState = 'idle' | 'saving' | 'saved' | 'error' | 'offline';
const DRAFT = (id: string) => `sunnet-studio-draft:${id}`;

function readDraft(id: string): Project | null {
  try {
    const raw = localStorage.getItem(DRAFT(id));
    return raw ? (JSON.parse(raw) as Project) : null;
  } catch {
    return null;
  }
}

/** Сохранение при закрытии окна: keepalive переживает выгрузку страницы. */
function flushSave(id: string, data: Project) {
  const csrf = document.cookie.split('; ').find((c) => c.startsWith('omni_csrf='))?.split('=')[1] ?? '';
  try {
    void fetch(`/api/v1/desk/items/${id}/data`, {
      method: 'PUT',
      keepalive: true,
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
      body: JSON.stringify({ data }),
    });
  } catch {
    /* черновик всё равно лежит в localStorage */
  }
}

export function StudioPage() {
  const { projectId = '' } = useParams();
  const [project, setProject] = useState<Project | null>(null);
  const [screenId, setScreenId] = useState('');
  const [sel, setSel] = useState<string | null>(null);
  const [scriptId, setScriptId] = useState('');
  const [save, setSave] = useState<SaveState>('idle');
  const [preview, setPreview] = useState(false);
  const [publish, setPublish] = useState(false);
  const dirty = useRef(false);
  const latest = useRef<Project | null>(null);

  // Загрузка: облако; если там пусто — новый шаблон; если есть несохранённый черновик новее — он
  useEffect(() => {
    let alive = true;
    api
      .get<{ data: Project | null; updatedAt: string }>(`/desk/items/${projectId}/data`)
      .then(({ data }) => {
        if (!alive) return;
        const draft = readDraft(projectId);
        const p = draft ?? data ?? emptyProject();
        if (draft) toast('Восстановили несохранённые изменения');
        setProject(p);
        setScreenId(p.screens[0]!.id);
        setScriptId(p.scripts[0]?.id ?? '');
        if (!data || draft) dirty.current = true;
      })
      .catch((e) => toast({ text: errorMessage(e), kind: 'error' }));
    return () => {
      alive = false;
    };
  }, [projectId]);

  // Автосохранение через 1,2 с после правки + черновик в браузере на случай обрыва связи
  useEffect(() => {
    if (!project) return;
    latest.current = project;
    if (!dirty.current) return;
    try {
      localStorage.setItem(DRAFT(projectId), JSON.stringify(project));
    } catch {
      /* хранилище недоступно */
    }
    setSave('saving');
    const t = setTimeout(() => {
      api
        .put(`/desk/items/${projectId}/data`, { data: project })
        .then(() => {
          dirty.current = false;
          setSave('saved');
          try {
            localStorage.removeItem(DRAFT(projectId));
          } catch {
            /* ничего */
          }
        })
        .catch(() => setSave(navigator.onLine ? 'error' : 'offline'));
    }, 1200);
    return () => clearTimeout(t);
  }, [project, projectId]);

  // Закрыли окно или вкладку — досохраняем
  useEffect(() => {
    const out = () => {
      if (dirty.current && latest.current) flushSave(projectId, latest.current);
    };
    window.addEventListener('pagehide', out);
    document.addEventListener('visibilitychange', out);
    return () => {
      out();
      window.removeEventListener('pagehide', out);
      document.removeEventListener('visibilitychange', out);
    };
  }, [projectId]);

  const update = useCallback((f: (p: Project) => Project) => {
    dirty.current = true;
    setProject((p) => (p ? f(p) : p));
  }, []);

  if (!project) return <div className="sst sst--loading">Открываем проект…</div>;
  const screen = project.screens.find((s) => s.id === screenId) ?? project.screens[0]!;
  const el = screen.elements.find((e) => e.id === sel) ?? null;
  const script = project.scripts.find((s) => s.id === scriptId) ?? null;

  const patchEl = (id: string, patch: Partial<El>) =>
    update((p) => ({ ...p, screens: p.screens.map((s) => (s.id === screen.id ? { ...s, elements: s.elements.map((e) => (e.id === id ? { ...e, ...patch } : e)) } : s)) }));
  const addEl = (type: ElType) => {
    const n = screen.elements.filter((e) => e.type === type).length + 1;
    const e: El = { id: uid(), name: `${TYPE_LABEL[type]}${n > 1 ? ` ${n}` : ''}`, x: 40 + n * 12, y: 80 + n * 12, ...NEW_EL[type] };
    update((p) => ({ ...p, screens: p.screens.map((s) => (s.id === screen.id ? { ...s, elements: [...s.elements, e] } : s)) }));
    setSel(e.id);
  };
  const delEl = (id: string) => {
    update((p) => ({ ...p, screens: p.screens.map((s) => (s.id === screen.id ? { ...s, elements: s.elements.filter((e) => e.id !== id) } : s)) }));
    setSel(null);
  };

  const saveLabel = { idle: 'Сохранено в облаке', saving: 'Сохраняем…', saved: 'Сохранено в облаке', error: 'Не сохранилось — повторим', offline: 'Нет сети — сохраним позже' }[save];

  return (
    <div className="sst">
      <header className="sst__bar">
        <span className={`sst__save sst__save--${save}`}>
          {save === 'saving' ? <span className="sst__spin" aria-hidden /> : <Check size={14} />} {saveLabel}
        </span>
        <div className="sst__tools" role="toolbar" aria-label="Создать элемент">
          <button type="button" className="is-on" title="Выбор" aria-label="Выбор" onClick={() => setSel(null)}>
            <MousePointer2 size={17} />
          </button>
          <button type="button" title="Текст" aria-label="Добавить текст" onClick={() => addEl('text')}>
            <Type size={17} />
          </button>
          <button type="button" title="Image" aria-label="Добавить изображение" onClick={() => addEl('image')}>
            <ImageIcon size={17} />
          </button>
          <button type="button" title="Кнопка" aria-label="Добавить кнопку" onClick={() => addEl('button')}>
            <RectangleHorizontal size={17} />
          </button>
          <button type="button" title="Поле ввода" aria-label="Добавить поле ввода" onClick={() => addEl('input')}>
            <TextCursorInput size={17} />
          </button>
          <button type="button" title="Блок" aria-label="Добавить блок" onClick={() => addEl('box')}>
            <Box size={17} />
          </button>
        </div>
        <div className="sst__actions">
          <button type="button" className="sst__ghost" onClick={() => void openPath('/studio/academy', { newWindow: true })}>
            <BookOpen size={16} /> Академия
          </button>
          <button
            type="button"
            className="sst__ghost"
            onClick={async () => {
              await api.put(`/desk/items/${projectId}/data`, { data: project }).catch(() => undefined);
              dirty.current = false;
              setSave('saved');
              setPreview(true);
            }}
          >
            <Play size={16} /> Просмотр
          </button>
          <button type="button" className="sst__primary" onClick={() => setPublish(true)}>
            <Rocket size={16} /> Опубликовать
          </button>
        </div>
      </header>

      <div className="sst__main">
        <div className="sst__left">
          <Canvas project={project} screen={screen} sel={sel} setSel={setSel} patchEl={patchEl} />
          <ScriptEditor
            key={script?.id}
            scripts={project.scripts}
            script={script}
            setScriptId={setScriptId}
            onChange={(code) => script && update((p) => ({ ...p, scripts: p.scripts.map((s) => (s.id === script.id ? { ...s, code } : s)) }))}
            onAdd={() => {
              const s = { id: uid(), name: `script${project.scripts.length + 1}`, code: '// Новый скрипт\n' };
              update((p) => ({ ...p, scripts: [...p.scripts, s] }));
              setScriptId(s.id);
            }}
          />
        </div>
        <aside className="sst__right">
          <Explorer
            project={project}
            screenId={screen.id}
            sel={sel}
            onScreen={(id) => (setScreenId(id), setSel(null))}
            onSel={setSel}
            onScript={setScriptId}
            onAddScreen={() => {
              const s = { id: uid(), name: `Экран ${project.screens.length + 1}`, bg: '#ffffff', elements: [] };
              update((p) => ({ ...p, screens: [...p.screens, s] }));
              setScreenId(s.id);
            }}
            onDelete={delEl}
          />
          <Properties el={el} patch={(patch) => el && patchEl(el.id, patch)} onDelete={() => el && delEl(el.id)} />
        </aside>
      </div>
      {preview && <Preview projectId={projectId} onClose={() => setPreview(false)} />}
      {publish && <Publish projectId={projectId} onClose={() => setPublish(false)} />}
    </div>
  );
}

// ─── Рабочая область ────────────────────────────────────────────────────────

function Canvas({ project, screen, sel, setSel, patchEl }: { project: Project; screen: Project['screens'][number]; sel: string | null; setSel: (id: string | null) => void; patchEl: (id: string, p: Partial<El>) => void }) {
  const drag = useRef<{ id: string; mode: 'move' | 'size'; sx: number; sy: number; ox: number; oy: number; ow: number; oh: number } | null>(null);
  const [live, setLive] = useState<{ id: string; x: number; y: number; w: number; h: number } | null>(null);
  const W = project.width ?? 380;
  const H = project.height ?? 620;

  const down = (e: RPointerEvent, item: El, mode: 'move' | 'size') => {
    e.stopPropagation();
    setSel(item.id);
    drag.current = { id: item.id, mode, sx: e.clientX, sy: e.clientY, ox: item.x, oy: item.y, ow: item.w, oh: item.h };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const move = (e: RPointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.sx;
    const dy = e.clientY - d.sy;
    const snap = (v: number) => Math.round(v / 4) * 4;
    setLive(
      d.mode === 'move'
        ? { id: d.id, x: snap(Math.max(0, Math.min(W - 10, d.ox + dx))), y: snap(Math.max(0, Math.min(H - 10, d.oy + dy))), w: d.ow, h: d.oh }
        : { id: d.id, x: d.ox, y: d.oy, w: snap(Math.max(16, d.ow + dx)), h: snap(Math.max(16, d.oh + dy)) },
    );
  };
  const up = () => {
    if (drag.current && live) patchEl(live.id, { x: live.x, y: live.y, w: live.w, h: live.h });
    drag.current = null;
    setLive(null);
  };

  return (
    <div className="sst__canvas" onPointerDown={() => setSel(null)}>
      <div className="sst__device" style={{ width: W, height: H, background: screen.bg || '#fff' } as CSSProperties} onPointerMove={move} onPointerUp={up}>
        {screen.elements.map((item) => {
          const g = live?.id === item.id ? live : item;
          const st: CSSProperties = {
            left: g.x,
            top: g.y,
            width: g.w,
            height: g.h,
            color: item.color,
            background: item.type === 'button' && !item.bg ? undefined : item.bg,
            borderRadius: item.radius,
            fontSize: item.fontSize,
            fontWeight: item.weight,
            animation: item.anim && item.anim !== 'none' ? `sn-${item.anim} 2.4s ease-in-out infinite` : undefined,
          };
          return (
            <div key={item.id} className={`st-el st-el--${item.type}${sel === item.id ? ' is-sel' : ''}`} style={st} onPointerDown={(e) => down(e, item, 'move')}>
              {item.type === 'image' ? item.src ? <img src={item.src} alt={item.name} draggable={false} /> : <span className="st-el__ph">Image</span> : item.type === 'input' ? <span className="st-el__ph">{item.text}</span> : item.text}
              {sel === item.id && (
                <>
                  <span className="st-el__tag">
                    {TYPE_LABEL[item.type]} · {item.name} · {Math.round(g.w)}×{Math.round(g.h)}
                  </span>
                  <span className="st-el__size" onPointerDown={(e) => down(e, item, 'size')} aria-hidden />
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Explorer ───────────────────────────────────────────────────────────────

function Explorer(props: {
  project: Project;
  screenId: string;
  sel: string | null;
  onScreen: (id: string) => void;
  onSel: (id: string) => void;
  onScript: (id: string) => void;
  onAddScreen: () => void;
  onDelete: (id: string) => void;
}) {
  const icon = (t: ElType) => ({ text: <Type size={14} />, image: <ImageIcon size={14} />, button: <RectangleHorizontal size={14} />, box: <Box size={14} />, input: <TextCursorInput size={14} /> })[t];
  return (
    <section className="sst__panel">
      <h2>
        Explorer
        <button type="button" onClick={props.onAddScreen} title="Новый экран" aria-label="Новый экран">
          <Plus size={14} />
        </button>
      </h2>
      <ul className="st-tree">
        {props.project.screens.map((s) => (
          <li key={s.id}>
            <button type="button" className={`st-tree__row${s.id === props.screenId ? ' is-open' : ''}`} onClick={() => props.onScreen(s.id)}>
              <Monitor size={14} /> {s.name}
            </button>
            {s.id === props.screenId && (
              <ul>
                {s.elements.map((e) => (
                  <li key={e.id}>
                    <button type="button" className={`st-tree__row st-tree__row--child${props.sel === e.id ? ' is-sel' : ''}`} onClick={() => props.onSel(e.id)} onKeyDown={(k) => k.key === 'Delete' && props.onDelete(e.id)}>
                      {icon(e.type)} {e.name}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
        {props.project.scripts.map((s) => (
          <li key={s.id}>
            <button type="button" className="st-tree__row" onClick={() => props.onScript(s.id)}>
              <Code2 size={14} /> {s.name}.sun
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ─── Свойства ───────────────────────────────────────────────────────────────

function Properties({ el, patch, onDelete }: { el: El | null; patch: (p: Partial<El>) => void; onDelete: () => void }) {
  if (!el) return <section className="sst__panel sst__panel--props"><h2>Свойства</h2><p className="st-hint">Выберите элемент на экране или в Explorer</p></section>;
  const num = (k: keyof El, label: string) => (
    <label className="st-prop">
      <span>{label}</span>
      <input type="number" value={Number(el[k] ?? 0)} onChange={(e) => patch({ [k]: Number(e.target.value) } as Partial<El>)} />
    </label>
  );
  const text = (k: keyof El, label: string, ph?: string) => (
    <label className="st-prop">
      <span>{label}</span>
      <input value={String(el[k] ?? '')} placeholder={ph} onChange={(e) => patch({ [k]: e.target.value } as Partial<El>)} />
    </label>
  );
  return (
    <section className="sst__panel sst__panel--props">
      <h2>
        Свойства · {TYPE_LABEL[el.type]}
        <button type="button" onClick={onDelete} title="Удалить элемент" aria-label="Удалить элемент">
          <Trash2 size={14} />
        </button>
      </h2>
      {text('name', 'Имя')}
      {el.type !== 'image' && el.type !== 'box' && text('text', el.type === 'input' ? 'Подсказка' : 'Текст')}
      {el.type === 'image' && (
        <>
          {text('src', 'Адрес', 'https://…')}
          <label className="st-prop">
            <span>Файл</span>
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                if (f.size > 300_000) return toast({ text: 'Картинка больше 300 КБ — уменьшите её', kind: 'error' });
                const r = new FileReader();
                r.onload = () => patch({ src: String(r.result) });
                r.readAsDataURL(f);
              }}
            />
          </label>
        </>
      )}
      <div className="st-props-grid">
        {num('x', 'X')}
        {num('y', 'Y')}
        {num('w', 'Ширина')}
        {num('h', 'Высота')}
        {num('radius', 'Скругление')}
        {el.type !== 'image' && el.type !== 'box' && num('fontSize', 'Размер')}
      </div>
      {el.type !== 'image' && text('color', 'Цвет текста', '#0d1a2d')}
      {text('bg', 'Фон', '#ffffff или linear-gradient(…)')}
      <label className="st-prop">
        <span>Анимация</span>
        <select value={el.anim ?? 'none'} onChange={(e) => patch({ anim: e.target.value as El['anim'] })}>
          <option value="none">Нет</option>
          <option value="pulse">Пульс</option>
          <option value="float">Парение</option>
          <option value="spin">Вращение</option>
          <option value="fade">Мерцание</option>
          <option value="pop">Появление</option>
        </select>
      </label>
    </section>
  );
}

// ─── Скрипт ─────────────────────────────────────────────────────────────────

function ScriptEditor({ scripts, script, setScriptId, onChange, onAdd }: { scripts: Project['scripts']; script: Project['scripts'][number] | null; setScriptId: (id: string) => void; onChange: (code: string) => void; onAdd: () => void }) {
  const [code, setCode] = useState(script?.code ?? '');
  const [word, setWord] = useState('');
  const ta = useRef<HTMLTextAreaElement>(null);
  const problems = useMemo(() => lint(code), [code]);
  const hints = useMemo(() => suggest(word), [word]);
  useEffect(() => {
    const t = setTimeout(() => onChange(code), 400);
    return () => clearTimeout(t);
    // onChange меняется при каждом рендере — сохраняем только по изменению кода
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);
  const lines = code.split('\n').length;
  const onInput = (v: string, pos: number) => {
    setCode(v);
    const before = v.slice(0, pos);
    setWord(/([\w.]+)$/.exec(before)?.[1] ?? '');
  };
  const insert = (doc: (typeof API)[number]) => {
    const el = ta.current;
    if (!el) return;
    const pos = el.selectionStart;
    const start = pos - word.length;
    const ins = doc.name.includes('.') ? doc.name : `${doc.name}()`;
    const v = code.slice(0, start) + ins + code.slice(pos);
    setCode(v);
    setWord('');
    requestAnimationFrame(() => {
      el.focus();
      el.selectionStart = el.selectionEnd = start + ins.length;
    });
  };
  return (
    <section className="st-code">
      <div className="st-code__tabs">
        {scripts.map((s) => (
          <button key={s.id} type="button" className={s.id === script?.id ? 'is-on' : ''} onClick={() => setScriptId(s.id)}>
            {s.name}.sun
          </button>
        ))}
        <button type="button" onClick={onAdd} aria-label="Новый скрипт" title="Новый скрипт">
          <Plus size={14} />
        </button>
        <span className={`st-code__status${problems.length ? ' is-bad' : ''}`}>{problems.length ? `Ошибок: ${problems.length}` : 'Ошибок нет'}</span>
      </div>
      <div className="st-code__body">
        <pre className="st-code__lines" aria-hidden>
          {Array.from({ length: lines }, (_, i) => `${i + 1}\n`).join('')}
        </pre>
        <textarea
          ref={ta}
          className="st-code__text"
          value={code}
          spellCheck={false}
          aria-label="Код скрипта"
          onChange={(e) => onInput(e.target.value, e.target.selectionStart)}
          onKeyDown={(e) => {
            if (e.key === 'Tab') {
              e.preventDefault();
              if (hints[0] && word) return insert(hints[0]);
              const p = e.currentTarget.selectionStart;
              setCode(code.slice(0, p) + '  ' + code.slice(p));
              requestAnimationFrame(() => ta.current && (ta.current.selectionStart = ta.current.selectionEnd = p + 2));
            }
            if (e.key === 'Escape') setWord('');
          }}
        />
        {hints.length > 0 && word.length > 1 && (
          <ul className="st-code__hints" role="listbox" aria-label="Подсказки">
            {hints.map((h, i) => (
              <li key={h.name} className={i === 0 ? 'is-first' : ''}>
                <button type="button" onMouseDown={(e) => (e.preventDefault(), insert(h))}>
                  <b>{h.sig}</b>
                  <span>{h.text}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {problems.length > 0 && (
        <ul className="st-code__problems">
          {problems.map((p, i) => (
            <li key={i}>
              {p.line ? `Строка ${p.line}: ` : ''}
              {p.text}
              {p.hint && <span> — {p.hint}</span>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ─── Предпросмотр ───────────────────────────────────────────────────────────

/** Окно предпросмотра: приложение в песочнице, сообщения от него показываем как тосты. */
function Preview({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [log, setLog] = useState<string[]>([]);
  useEffect(() => {
    const on = (e: MessageEvent) => {
      if (e.source !== frame.current?.contentWindow) return;
      const d = e.data as { __sunnet?: number; type?: string; text?: string; permission?: string };
      if (!d?.__sunnet) return;
      if (d.type === 'notify') toast(String(d.text ?? '').slice(0, 300));
      if (d.type === 'error') setLog((l) => [...l.slice(-20), `Ошибка: ${String(d.text).slice(0, 200)}`]);
      if (d.type === 'request') setLog((l) => [...l.slice(-20), `Приложение просит разрешение «${PERMISSION_INFO[d.permission ?? '']?.label ?? d.permission}» — пользователь увидит запрос`]);
    };
    window.addEventListener('message', on);
    return () => window.removeEventListener('message', on);
  }, []);
  return (
    <div className="st-modal" role="dialog" aria-modal="true" aria-label="Предпросмотр">
      <div className="st-modal__card st-modal__card--preview">
        <header>
          <b>Предпросмотр</b>
          <span className="st-hint">Песочница: без доступа к вашим данным и сети</span>
          <button type="button" onClick={onClose} aria-label="Закрыть">
            <X size={18} />
          </button>
        </header>
        <iframe ref={frame} title="Предпросмотр приложения" src={`/api/v1/studio/preview/${projectId}`} sandbox="allow-scripts" className="st-frame" />
        {log.length > 0 && (
          <ul className="st-log">
            {log.map((l, i) => (
              <li key={i}>{l}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// ─── Публикация ─────────────────────────────────────────────────────────────

function Publish({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const [review, setReview] = useState(false);
  const [perms, setPerms] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ slug: string; review: string } | null>(null);
  const link = done ? `${location.origin}/app/${done.slug}` : '';
  return (
    <div className="st-modal" role="dialog" aria-modal="true" aria-label="Публикация">
      <div className="st-modal__card">
        <header>
          <b>{done ? 'Опубликовано' : 'Опубликовать приложение'}</b>
          <button type="button" onClick={onClose} aria-label="Закрыть">
            <X size={18} />
          </button>
        </header>
        {done ? (
          <div className="st-pub">
            <div className="st-pub__burst" aria-hidden />
            <p>Поделитесь ссылкой — по ней приложение добавят на рабочий стол.</p>
            <div className="st-pub__link">
              <code>{link}</code>
              <button
                type="button"
                onClick={() =>
                  void navigator.clipboard
                    .writeText(link)
                    .then(() => toast('Ссылка скопирована'))
                    .catch(() => toast(link))
                }
              >
                <Copy size={15} /> Скопировать
              </button>
            </div>
            <p className="st-hint">{done.review === 'pending' ? 'Отправлено на проверку. После неё приложение появится в каталоге со значком «Проверено».' : 'Без проверки приложение открывается только по ссылке и с предупреждением.'}</p>
          </div>
        ) : (
          <div className="st-pub">
            <h3>Какие разрешения нужны приложению</h3>
            <p className="st-hint">Каждое разрешение пользователь подтверждает отдельно и может отозвать в любой момент.</p>
            {Object.entries(PERMISSION_INFO).map(([k, v]) => (
              <label key={k} className="st-check">
                <input type="checkbox" checked={perms.includes(k)} onChange={(e) => setPerms((p) => (e.target.checked ? [...p, k] : p.filter((x) => x !== k)))} />
                <span>
                  <b>{v.label}</b> — {v.text}
                </span>
              </label>
            ))}
            <label className="st-check st-check--review">
              <input type="checkbox" checked={review} onChange={(e) => setReview(e.target.checked)} />
              <span>
                <b>Отправить на проверку Sunnet.</b> Я согласен, что модераторы изучат исходный код и поведение приложения.
              </span>
            </label>
            <button
              type="button"
              className="sst__primary sst__primary--lg"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  const r = await api.post<{ slug: string; review: string }>('/studio/publish', { projectId, review, permissions: perms });
                  setDone(r);
                } catch (e) {
                  toast({ text: errorMessage(e), kind: 'error' });
                } finally {
                  setBusy(false);
                }
              }}
            >
              <Rocket size={16} /> {busy ? 'Публикуем…' : 'Опубликовать'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
