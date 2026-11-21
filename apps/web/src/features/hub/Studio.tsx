/**
 * Студия Sunnet — редактор приложений: холст в центре, Explorer и Свойства
 * справа, панель вставки сверху, скрипты на SunScript (обычный JavaScript +
 * объект `sunnet`). Запуск — в изолированном iframe (sandbox без same-origin):
 * у приложения нет доступа к cookie, облаку и окнам Sunnet, только к
 * сообщениям через `sunnet.*`, которые проверяет хозяин окна.
 *
 * Проект автоматически сохраняется при каждом изменении и при закрытии окна.
 */
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useSearchParams } from 'react-router';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { BookOpen, Box, CheckCircle2, ChevronRight, Code2, Copy, Eye, FileCode2, Image as ImageIcon, Layers, MousePointer2, Move, Play, Rocket, Save, Sparkles, Square, Trash2, Type, Wand2, X } from 'lucide-react';
import { cn } from '../../shared/lib/format';
import { toast } from '../../shared/stores/ui';
import { useCloud } from './cloud';
import './hub.css';

type NodeKind = 'Frame' | 'Text' | 'Button' | 'Image' | 'Script';
interface SNode {
  id: string;
  kind: NodeKind;
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  text?: string;
  bg?: string;
  color?: string;
  radius?: number;
  src?: string;
  anim?: 'none' | 'fade' | 'pop' | 'float' | 'spin';
  code?: string;
}
interface Project {
  nodes: SNode[];
  savedAt: number;
}

const useProjects = create<{ p: Record<string, Project>; save: (id: string, nodes: SNode[]) => void }>()(
  persist((set, get) => ({ p: {}, save: (id, nodes) => set({ p: { ...get().p, [id]: { nodes, savedAt: Date.now() } } }) }), { name: 'sunnet.studio' }),
);

const uid = () => Math.random().toString(36).slice(2, 8);
const STARTER: SNode[] = [
  { id: 'bg', kind: 'Frame', name: 'Экран', x: 40, y: 30, w: 520, h: 340, bg: '#fff7e6', radius: 24, anim: 'none' },
  { id: 'title', kind: 'Text', name: 'Заголовок', x: 80, y: 70, w: 440, h: 50, text: 'Привет, Sunnet! ☀️', color: '#1b2a4a', anim: 'fade' },
  { id: 'btn', kind: 'Button', name: 'Кнопка', x: 80, y: 150, w: 200, h: 52, text: 'Нажми меня', bg: '#ff9f2e', color: '#ffffff', radius: 16, anim: 'pop' },
  {
    id: 'main',
    kind: 'Script',
    name: 'main.sun',
    x: 0,
    y: 0,
    w: 0,
    h: 0,
    code: `// SunScript — это JavaScript + объект sunnet\nconst btn = sunnet.find('Кнопка');\nlet n = 0;\nbtn.on('click', () => {\n  n++;\n  btn.text = 'Нажато: ' + n;\n  sunnet.notify('Кнопку нажали ' + n + ' раз');\n  sunnet.animate(btn, 'pop');\n});`,
  },
];

const INSERT: { kind: NodeKind; icon: typeof Box; label: string }[] = [
  { kind: 'Frame', icon: Square, label: 'Frame' },
  { kind: 'Text', icon: Type, label: 'Text' },
  { kind: 'Button', icon: MousePointer2, label: 'Button' },
  { kind: 'Image', icon: ImageIcon, label: 'Image' },
  { kind: 'Script', icon: FileCode2, label: 'Script' },
];

const KIND_ICON: Record<NodeKind, typeof Box> = { Frame: Square, Text: Type, Button: MousePointer2, Image: ImageIcon, Script: FileCode2 };

/** Проверка скрипта до запуска: синтаксис и запрещённые обращения. */
export function lintScript(code: string): string[] {
  const errs: string[] = [];
  try {
    // eslint-disable-next-line no-new-func
    new Function('sunnet', code);
  } catch (e) {
    errs.push(`Синтаксис: ${(e as Error).message}`);
  }
  for (const [re, msg] of [
    [/\bdocument\.cookie\b/, 'cookie недоступны приложениям — используйте sunnet.storage'],
    [/\b(localStorage|indexedDB)\b/, 'хранилище браузера недоступно — используйте sunnet.storage'],
    [/\bparent\.|\btop\./, 'обращение к окну Sunnet запрещено'],
    [/\beval\(/, 'eval запрещён'],
  ] as const)
    if (re.test(code)) errs.push(msg);
  return errs;
}

/** Документ предпросмотра: элементы + рантайм sunnet, всё внутри песочницы. */
function buildPreview(nodes: SNode[]): string {
  const els = nodes
    .filter((n) => n.kind !== 'Script')
    .map((n) => {
      const st = `left:${n.x}px;top:${n.y}px;width:${n.w}px;height:${n.h}px;background:${n.bg ?? 'transparent'};color:${n.color ?? '#1b2a4a'};border-radius:${n.radius ?? 0}px`;
      const inner = n.kind === 'Image' ? `<img src="${(n.src ?? '').replace(/"/g, '')}" alt="">` : (n.text ?? '').replace(/</g, '&lt;');
      return `<div class="n n-${n.kind} a-${n.anim ?? 'none'}" data-name="${n.name.replace(/"/g, '')}" style="${st}">${inner}</div>`;
    })
    .join('');
  const code = nodes.filter((n) => n.kind === 'Script').map((n) => n.code ?? '').join('\n;\n');
  return `<!doctype html><meta charset="utf-8"><style>
body{margin:0;font-family:Inter,system-ui,sans-serif;background:#fffdf7}
.n{position:absolute;display:flex;align-items:center;justify-content:center;box-sizing:border-box;font-weight:600}
.n-Text{font-size:26px;justify-content:flex-start}.n-Button{cursor:pointer;font-size:17px;box-shadow:0 8px 20px -8px #ff9f2e;transition:transform .15s}
.n-Button:active{transform:scale(.95)}.n img{width:100%;height:100%;object-fit:cover;border-radius:inherit}
@keyframes fade{from{opacity:0;transform:translateY(8px)}}@keyframes pop{0%{transform:scale(.6)}70%{transform:scale(1.08)}}
@keyframes float{50%{transform:translateY(-8px)}}@keyframes spin{to{transform:rotate(360deg)}}
.a-fade{animation:fade .6s both}.a-pop{animation:pop .5s both}.a-float{animation:float 3s ease-in-out infinite}.a-spin{animation:spin 4s linear infinite}
</style>${els}<script>
const send=(type,data)=>parent.postMessage({sunnet:1,type,data},'*');
const wrap=el=>el&&({el,on:(e,f)=>el.addEventListener(e,f),get text(){return el.textContent},set text(v){el.textContent=v},
  set color(v){el.style.color=v},set bg(v){el.style.background=v},hide(){el.style.display='none'},show(){el.style.display=''}});
const sunnet={find:n=>wrap(document.querySelector('[data-name="'+CSS.escape(n)+'"]')),
  notify:t=>send('notify',String(t).slice(0,200)),
  animate:(o,a)=>{o.el.classList.remove('a-'+a);void o.el.offsetWidth;o.el.classList.add('a-'+a)},
  create:(kind,props={})=>{const d=document.createElement('div');d.className='n n-'+kind;Object.assign(d.style,{left:(props.x||0)+'px',top:(props.y||0)+'px'});d.textContent=props.text||'';d.dataset.name=props.name||kind;document.body.append(d);return wrap(d)},
  storage:{_m:{},get(k){return this._m[k]},set(k,v){this._m[k]=v}}};
window.onerror=(m,_,l)=>send('error','Строка '+l+': '+m);
try{${code}}catch(e){send('error',e.message)}
<\/script>`;
}

const LESSONS = [
  { t: 'Что такое приложение', b: 'Приложение — это экран с элементами (Frame, Text, Button, Image) и скрипт, который оживляет их. Всё, что вы видите на холсте, есть в Explorer справа.' },
  { t: 'Первая кнопка', b: 'Нажмите «Button» на панели сверху. Кнопка появится на холсте — перетащите её мышью, а размер поменяйте за правый нижний угол.' },
  { t: 'Свойства', b: 'Выберите элемент — снизу справа его свойства: текст, цвета, скругление, анимация. Попробуйте поставить анимацию «float».' },
  { t: 'Первый скрипт', b: "Откройте main.sun в Explorer. sunnet.find('Кнопка') находит элемент по имени, .on('click', ...) — реагирует на нажатие." },
  { t: 'Уведомления', b: "sunnet.notify('Текст') показывает уведомление Sunnet. Приложение не может показать его без вашего разрешения «Уведомления»." },
  { t: 'Создание элементов из кода', b: "sunnet.create('Text', { text: 'Новый', x: 40, y: 300 }) — элемент появится при запуске." },
  { t: 'Проверка ошибок', b: 'Студия проверяет скрипт до запуска: синтаксис и запрещённые вещи (cookie, localStorage, parent). Ошибки — красной полосой над кодом.' },
  { t: 'Публикация', b: 'Кнопка «Опубликовать» даёт уникальную ссылку. Поставьте галочку «Отправить на проверку» — после проверки приложение появится в Орбите.' },
];

const API_DOCS = [
  ['sunnet.find(name)', 'Найти элемент по имени из Explorer'],
  ['el.on(event, fn)', 'Подписаться на событие: click, pointerenter…'],
  ['el.text / el.color / el.bg', 'Изменить текст и цвета'],
  ['el.hide() / el.show()', 'Скрыть и показать'],
  ['sunnet.animate(el, name)', 'Анимация: fade, pop, float, spin'],
  ['sunnet.create(kind, props)', 'Создать элемент из кода'],
  ['sunnet.notify(text)', 'Уведомление (нужно разрешение)'],
  ['sunnet.storage.get/set', 'Данные приложения в его изолированной папке'],
];

export function StudioPage() {
  const [params] = useSearchParams();
  const projectId = params.get('project') ?? 'scratch';
  const admin = params.get('admin') === '1';
  const item = useCloud((s) => s.items.find((i) => i.id === projectId));
  const saved = useProjects((s) => s.p[projectId]);
  const [nodes, setNodes] = useState<SNode[]>(() => saved?.nodes ?? STARTER);
  const [sel, setSel] = useState<string>('btn');
  const [mode, setMode] = useState<'design' | 'code' | 'play'>('design');
  const [panel, setPanel] = useState<'none' | 'learn' | 'docs' | 'publish'>(params.get('learn') ? 'learn' : params.get('docs') ? 'docs' : params.get('publish') ? 'publish' : 'none');
  const [lesson, setLesson] = useState(0);
  const [log, setLog] = useState<string[]>([]);
  const [savedAt, setSavedAt] = useState(saved?.savedAt ?? 0);
  const drag = useRef<{ id: string; x: number; y: number; ox: number; oy: number; resize: boolean; ow: number; oh: number } | null>(null);
  const node = nodes.find((n) => n.id === sel);
  const script = nodes.find((n) => n.id === sel && n.kind === 'Script') ?? nodes.find((n) => n.kind === 'Script');
  const errors = useMemo(() => lintScript(nodes.filter((n) => n.kind === 'Script').map((n) => n.code).join('\n')), [nodes]);

  // Автосохранение: через 600 мс после изменения и при закрытии окна
  useEffect(() => {
    const t = setTimeout(() => {
      useProjects.getState().save(projectId, nodes);
      setSavedAt(Date.now());
    }, 600);
    return () => clearTimeout(t);
  }, [nodes, projectId]);
  useEffect(() => () => useProjects.getState().save(projectId, nodesRef.current), [projectId]);
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;

  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      const d = e.data as { sunnet?: number; type?: string; data?: string };
      if (!d?.sunnet || typeof d.data !== 'string') return;
      if (d.type === 'notify') toast(`${item?.name ?? 'Приложение'}: ${d.data}`);
      if (d.type === 'error') setLog((l) => [...l.slice(-30), d.data!]);
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, [item?.name]);

  const patch = (id: string, p: Partial<SNode>) => setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, ...p } : n)));
  const insert = (kind: NodeKind) => {
    const n: SNode = {
      id: uid(),
      kind,
      name: `${kind}${nodes.filter((x) => x.kind === kind).length + 1}`,
      x: 120 + Math.random() * 120,
      y: 120 + Math.random() * 80,
      w: kind === 'Text' ? 260 : 160,
      h: kind === 'Text' ? 40 : kind === 'Image' ? 120 : 52,
      text: kind === 'Text' ? 'Новый текст' : kind === 'Button' ? 'Кнопка' : undefined,
      bg: kind === 'Button' ? '#3d8bff' : kind === 'Frame' ? '#ffe7b8' : undefined,
      color: kind === 'Button' ? '#fff' : '#1b2a4a',
      radius: 14,
      src: kind === 'Image' ? 'https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?w=400' : undefined,
      anim: 'pop',
      code: kind === 'Script' ? '// новый скрипт\n' : undefined,
    };
    setNodes((ns) => [...ns, n]);
    setSel(n.id);
    if (kind === 'Script') setMode('code');
  };

  return (
    <div className="studio">
      <div className="studio-bar">
        <div className="studio-bar__group">
          <span className="studio-bar__title">
            <Wand2 size={16} /> {item?.name ?? 'Новый проект'} {admin && <span className="tag tag--warning">администратор</span>}
          </span>
        </div>
        <div className="studio-bar__group">
          {INSERT.map((b) => (
            <button key={b.kind} type="button" className="studio-tool" onClick={() => insert(b.kind)} title={`Вставить ${b.label}`}>
              <b.icon size={16} />
              <span>{b.label}</span>
            </button>
          ))}
        </div>
        <div className="studio-bar__group">
          <button type="button" className={cn('studio-tool', mode === 'design' && 'studio-tool--on')} onClick={() => setMode('design')}>
            <Move size={16} /> <span>Дизайн</span>
          </button>
          <button type="button" className={cn('studio-tool', mode === 'code' && 'studio-tool--on')} onClick={() => setMode('code')}>
            <Code2 size={16} /> <span>Код</span>
          </button>
          <button type="button" className={cn('studio-tool studio-tool--play', mode === 'play' && 'studio-tool--on')} onClick={() => (setLog([]), setMode(mode === 'play' ? 'design' : 'play'))} disabled={errors.length > 0 && mode !== 'play'}>
            {mode === 'play' ? <X size={16} /> : <Play size={16} />} <span>{mode === 'play' ? 'Стоп' : 'Запуск'}</span>
          </button>
          <button type="button" className="studio-tool" onClick={() => setPanel(panel === 'learn' ? 'none' : 'learn')}>
            <BookOpen size={16} /> <span>Уроки</span>
          </button>
          <button type="button" className="studio-tool" onClick={() => setPanel(panel === 'docs' ? 'none' : 'docs')}>
            <Sparkles size={16} /> <span>API</span>
          </button>
          <button type="button" className="studio-tool studio-tool--pub" onClick={() => setPanel('publish')}>
            <Rocket size={16} /> <span>Опубликовать</span>
          </button>
        </div>
        <span className="studio-saved">
          <Save size={13} /> {savedAt ? `Сохранено в облаке · ${new Date(savedAt).toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}` : 'Сохраняем…'}
        </span>
      </div>

      <div className="studio-main">
        {panel !== 'none' && (
          <aside className="studio-learn">
            <button type="button" className="icon-btn icon-btn--sm studio-learn__x" onClick={() => setPanel('none')} aria-label="Закрыть">
              <X size={15} />
            </button>
            {panel === 'learn' && (
              <>
                <div className="studio-learn__k">Урок {lesson + 1} из {LESSONS.length}</div>
                <div className="progress"><div className="progress__bar" style={{ width: `${((lesson + 1) / LESSONS.length) * 100}%` }} /></div>
                <h3>{LESSONS[lesson]!.t}</h3>
                <p>{LESSONS[lesson]!.b}</p>
                <div className="studio-learn__nav">
                  <button type="button" className="btn btn--secondary btn--sm" disabled={!lesson} onClick={() => setLesson(lesson - 1)}>Назад</button>
                  <button type="button" className="btn btn--primary btn--sm" disabled={lesson === LESSONS.length - 1} onClick={() => setLesson(lesson + 1)}>Дальше</button>
                </div>
                <div className="studio-learn__list">
                  {LESSONS.map((l, i) => (
                    <button key={l.t} type="button" className={cn('studio-learn__item', i === lesson && 'studio-learn__item--on')} onClick={() => setLesson(i)}>
                      {i < lesson ? <CheckCircle2 size={14} /> : <ChevronRight size={14} />} {l.t}
                    </button>
                  ))}
                </div>
              </>
            )}
            {panel === 'docs' && (
              <>
                <h3>API Sunnet</h3>
                {API_DOCS.map(([sig, d]) => (
                  <div key={sig} className="studio-doc">
                    <code>{sig}</code>
                    <span>{d}</span>
                  </div>
                ))}
              </>
            )}
            {panel === 'publish' && <PublishPanel name={item?.name ?? 'Проект'} id={projectId} errors={errors} />}
          </aside>
        )}

        <div className="studio-stage">
          {mode === 'play' ? (
            <iframe className="studio-preview" title="Предпросмотр" sandbox="allow-scripts" srcDoc={buildPreview(nodes)} />
          ) : mode === 'code' && script ? (
            <div className="studio-code">
              <div className="studio-code__tab">
                <FileCode2 size={14} /> {script.name}
              </div>
              {errors.length > 0 && (
                <div className="studio-code__err">
                  {errors.map((e) => (
                    <div key={e}>⚠ {e}</div>
                  ))}
                </div>
              )}
              <textarea className="studio-code__ta" spellCheck={false} value={script.code ?? ''} onChange={(e) => patch(script.id, { code: e.target.value })} />
              <div className="studio-code__hint">Подсказка: sunnet.find('Имя') · .on('click', fn) · sunnet.notify(текст) · sunnet.animate(el, 'pop')</div>
            </div>
          ) : (
            <div
              className="studio-canvas"
              onPointerMove={(e) => {
                const d = drag.current;
                if (!d) return;
                const dx = e.clientX - d.x;
                const dy = e.clientY - d.y;
                if (d.resize) patch(d.id, { w: Math.max(20, Math.round((d.ow + dx) / 4) * 4), h: Math.max(20, Math.round((d.oh + dy) / 4) * 4) });
                else patch(d.id, { x: Math.round((d.ox + dx) / 4) * 4, y: Math.round((d.oy + dy) / 4) * 4 });
              }}
              onPointerUp={() => (drag.current = null)}
            >
              {nodes
                .filter((n) => n.kind !== 'Script')
                .map((n) => (
                  <div
                    key={n.id}
                    className={cn('studio-node', `studio-node--${n.kind}`, sel === n.id && 'studio-node--sel')}
                    style={{ left: n.x, top: n.y, width: n.w, height: n.h, background: n.bg, color: n.color, borderRadius: n.radius } as CSSProperties}
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      setSel(n.id);
                      drag.current = { id: n.id, x: e.clientX, y: e.clientY, ox: n.x, oy: n.y, ow: n.w, oh: n.h, resize: false };
                      (e.currentTarget.parentElement as HTMLElement).setPointerCapture(e.pointerId);
                    }}
                  >
                    {n.kind === 'Image' ? <img src={n.src} alt="" draggable={false} /> : n.text}
                    {sel === n.id && (
                      <span
                        className="studio-node__grip"
                        onPointerDown={(e) => {
                          e.stopPropagation();
                          drag.current = { id: n.id, x: e.clientX, y: e.clientY, ox: n.x, oy: n.y, ow: n.w, oh: n.h, resize: true };
                          (e.currentTarget.closest('.studio-canvas') as HTMLElement).setPointerCapture(e.pointerId);
                        }}
                      />
                    )}
                  </div>
                ))}
            </div>
          )}
          {log.length > 0 && (
            <div className="studio-console">
              {log.map((l, i) => (
                <div key={i}>✖ {l}</div>
              ))}
            </div>
          )}
        </div>

        <aside className="studio-side">
          <div className="studio-panel">
            <div className="studio-panel__h">
              <Layers size={14} /> Explorer
            </div>
            <div className="studio-tree">
              <div className="studio-tree__root">
                <Box size={14} /> {item?.name ?? 'Проект'}
              </div>
              {nodes.map((n) => {
                const I = KIND_ICON[n.kind];
                return (
                  <button key={n.id} type="button" className={cn('studio-tree__row', sel === n.id && 'studio-tree__row--on')} onClick={() => (setSel(n.id), n.kind === 'Script' && setMode('code'))}>
                    <I size={14} /> {n.name}
                    <span className="studio-tree__kind">{n.kind}</span>
                  </button>
                );
              })}
            </div>
          </div>
          {node && (
            <div className="studio-panel">
              <div className="studio-panel__h">
                <Eye size={14} /> Свойства · {node.kind}
              </div>
              <div className="studio-props">
                <label>Имя<input className="input" value={node.name} onChange={(e) => patch(node.id, { name: e.target.value })} /></label>
                {node.kind !== 'Script' && (
                  <>
                    <div className="studio-props__row">
                      <label>X<input className="input" type="number" value={node.x} onChange={(e) => patch(node.id, { x: +e.target.value })} /></label>
                      <label>Y<input className="input" type="number" value={node.y} onChange={(e) => patch(node.id, { y: +e.target.value })} /></label>
                    </div>
                    <div className="studio-props__row">
                      <label>Ширина<input className="input" type="number" value={node.w} onChange={(e) => patch(node.id, { w: +e.target.value })} /></label>
                      <label>Высота<input className="input" type="number" value={node.h} onChange={(e) => patch(node.id, { h: +e.target.value })} /></label>
                    </div>
                    {node.text !== undefined && <label>Текст<input className="input" value={node.text} onChange={(e) => patch(node.id, { text: e.target.value })} /></label>}
                    {node.kind === 'Image' && <label>Адрес картинки<input className="input" value={node.src ?? ''} onChange={(e) => patch(node.id, { src: e.target.value })} /></label>}
                    <div className="studio-props__row">
                      <label>Фон<input type="color" value={node.bg ?? '#ffffff'} onChange={(e) => patch(node.id, { bg: e.target.value })} /></label>
                      <label>Текст<input type="color" value={node.color ?? '#1b2a4a'} onChange={(e) => patch(node.id, { color: e.target.value })} /></label>
                      <label>Скругление<input className="input" type="number" value={node.radius ?? 0} onChange={(e) => patch(node.id, { radius: +e.target.value })} /></label>
                    </div>
                    <label>
                      Анимация
                      <select className="select" value={node.anim ?? 'none'} onChange={(e) => patch(node.id, { anim: e.target.value as SNode['anim'] })}>
                        <option value="none">Нет</option>
                        <option value="fade">Появление</option>
                        <option value="pop">Пружина</option>
                        <option value="float">Парение</option>
                        <option value="spin">Вращение</option>
                      </select>
                    </label>
                  </>
                )}
                <div className="studio-props__row">
                  <button type="button" className="btn btn--secondary btn--sm" onClick={() => {
                    const c = { ...node, id: uid(), name: `${node.name} копия`, x: node.x + 16, y: node.y + 16 };
                    setNodes((ns) => [...ns, c]);
                    setSel(c.id);
                  }}>
                    <Copy size={14} /> Дублировать
                  </button>
                  <button type="button" className="btn btn--danger-ghost btn--sm" onClick={() => setNodes((ns) => ns.filter((n) => n.id !== node.id))}>
                    <Trash2 size={14} /> Удалить
                  </button>
                </div>
              </div>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

function PublishPanel({ name, id, errors }: { name: string; id: string; errors: string[] }) {
  const [review, setReview] = useState(false);
  const [perms, setPerms] = useState({ notify: true, files: false, camera: false, mic: false, screen: false });
  const [link, setLink] = useState<string | null>(null);
  return (
    <>
      <h3>Публикация «{name}»</h3>
      <p className="studio-muted">Приложение получит постоянную ссылку. Другие люди смогут добавить его на свой рабочий стол.</p>
      <div className="studio-learn__k">Разрешения, которые запросит приложение</div>
      {(Object.keys(perms) as (keyof typeof perms)[]).map((p) => (
        <label key={p} className="sysdlg__perm">
          <input type="checkbox" checked={perms[p]} onChange={(e) => setPerms({ ...perms, [p]: e.target.checked })} />
          <span>{{ notify: 'Уведомления', files: 'Файлы (своя папка)', camera: 'Камера', mic: 'Микрофон', screen: 'Экран' }[p]}</span>
        </label>
      ))}
      <label className="sysdlg__perm sysdlg__perm--ack">
        <input type="checkbox" checked={review} onChange={(e) => setReview(e.target.checked)} />
        <span>Отправить на проверку: я согласен, что команда Sunnet изучит исходный код приложения</span>
      </label>
      {errors.length > 0 && <div className="notice notice--danger">Исправьте ошибки в скрипте перед публикацией</div>}
      <button type="button" className="btn btn--primary btn--block" disabled={errors.length > 0} onClick={() => setLink(`${location.origin}/a/${id}`)}>
        <Rocket size={16} /> Опубликовать
      </button>
      {link && (
        <div className="studio-published">
          <div>✅ Опубликовано{review ? ' и отправлено на проверку' : ' (без проверки — при установке по ссылке будет предупреждение)'}</div>
          <code>{link}</code>
        </div>
      )}
    </>
  );
}
