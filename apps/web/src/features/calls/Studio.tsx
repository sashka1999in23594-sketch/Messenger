/**
 * Панель студии под сценой звонка: инструменты слева, свойства, предпросмотр
 * сцены с рамкой выделения (перетащить, растянуть), быстрые плитки, фоны и
 * кнопка трансляции — участники видят сцену вместо камеры.
 */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ArrowDown,
  ArrowUp,
  Bold,
  Camera,
  ChevronLeft,
  ChevronRight,
  Circle,
  Droplets,
  Eraser,
  Image as ImageIcon,
  Italic,
  Maximize,
  Monitor,
  Radio,
  Shapes,
  Square,
  Trash2,
  Type,
  Underline,
  Video,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { setRoomVolume, useRoom } from '../../shared/calls/room';
import { toast } from '../../shared/stores/ui';
import { cn } from '../../shared/lib/format';
import {
  addLayer,
  BACKDROPS,
  clearScene,
  COLORS,
  drawScene,
  FONTS,
  moveLayer,
  patchLayer,
  QUALITIES,
  removeLayer,
  runScene,
  sceneCanvas,
  setLive,
  setQuality,
  SIZES,
  useStudio,
  type Align,
  type Layer,
  type Quality,
  type ShapeKind,
} from './studio';

type Tool = 'text' | 'photo' | 'video' | 'screen' | 'camera' | 'shapes' | 'blur' | 'clear';

const TOOLS: { id: Tool; label: string; icon: ReactNode }[] = [
  { id: 'text', label: 'Текст', icon: <Type size={16} /> },
  { id: 'photo', label: 'Фото', icon: <ImageIcon size={16} /> },
  { id: 'video', label: 'Видео', icon: <Video size={16} /> },
  { id: 'screen', label: 'Экран', icon: <Monitor size={16} /> },
  { id: 'camera', label: 'Камера', icon: <Camera size={16} /> },
  { id: 'shapes', label: 'Фигуры', icon: <Shapes size={16} /> },
  { id: 'blur', label: 'Размыть', icon: <Droplets size={16} /> },
  { id: 'clear', label: 'Очистить', icon: <Eraser size={16} /> },
];

/** Выбрать файл и получить ссылку на него (без загрузки на сервер). */
function pickFile(accept: string): Promise<string | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = () => {
      const f = input.files?.[0];
      resolve(f ? URL.createObjectURL(f) : null);
    };
    input.click();
  });
}

async function addPhoto() {
  const src = await pickFile('image/*');
  if (src) addLayer({ kind: 'image', src, x: 0.3, y: 0.22, w: 0.4, h: 0.56 });
}

async function addVideo() {
  const src = await pickFile('video/*');
  if (src) addLayer({ kind: 'video', src, x: 0.2, y: 0.15, w: 0.6, h: 0.7 });
}

async function addScreen() {
  if (!navigator.mediaDevices?.getDisplayMedia) return toast('Это устройство не умеет показывать экран');
  try {
    const stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 30 } } });
    const id = addLayer({ kind: 'screen', stream, x: 0.04, y: 0.06, w: 0.92, h: 0.88 });
    stream.getVideoTracks()[0]?.addEventListener('ended', () => removeLayer(id));
  } catch {
    // отменили выбор
  }
}

function addCamera() {
  if (!useRoom.getState().local?.getVideoTracks().length) return toast('Включите камеру, чтобы добавить её на сцену');
  addLayer({ kind: 'camera', x: 0.7, y: 0.62, w: 0.26, h: 0.33 });
}

function addText(draft: Partial<Layer>) {
  addLayer({ kind: 'text', text: 'Привет всем!', font: 'Inter', size: 48, bold: true, align: 'center', color: '#ffffff', ...draft, x: 0.25, y: 0.4, w: 0.5, h: 0.2 });
}

// ─── Свойства инструментов ───────────────────────────────────────────────────

function TextProps() {
  const selected = useStudio((s) => s.layers.find((l) => l.id === s.selected && l.kind === 'text'));
  const [draft, setDraft] = useState<Partial<Layer>>({ text: 'Привет всем!', font: 'Inter', size: 48, bold: true, align: 'center', color: '#ffffff' });
  const v = selected ?? draft;
  const set = (patch: Partial<Layer>) => (selected ? patchLayer(selected.id, patch) : setDraft((d) => ({ ...d, ...patch })));
  const toggle = (k: 'bold' | 'italic' | 'underline', label: string, icon: ReactNode) => (
    <button type="button" className={cn('studio__fmt', v[k] && 'is-on')} aria-pressed={!!v[k]} aria-label={label} title={label} onClick={() => set({ [k]: !v[k] })}>
      {icon}
    </button>
  );
  const align = (a: Align, label: string, icon: ReactNode) => (
    <button type="button" className={cn('studio__fmt', (v.align ?? 'center') === a && 'is-on')} aria-label={label} title={label} onClick={() => set({ align: a })}>
      {icon}
    </button>
  );
  return (
    <>
      <h3 className="studio__h">Текст</h3>
      <textarea className="studio__input" rows={2} value={v.text ?? ''} onChange={(e) => set({ text: e.target.value })} aria-label="Текст на экране" />
      <div className="studio__row">
        <select className="studio__select" value={v.font ?? 'Inter'} onChange={(e) => set({ font: e.target.value })} aria-label="Шрифт">
          {FONTS.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
        <select className="studio__select studio__select--sm" value={v.size ?? 48} onChange={(e) => set({ size: Number(e.target.value) })} aria-label="Размер">
          {SIZES.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </div>
      <div className="studio__row studio__row--fmt">
        {toggle('bold', 'Жирный', <Bold size={15} />)}
        {toggle('italic', 'Курсив', <Italic size={15} />)}
        {toggle('underline', 'Подчёркнутый', <Underline size={15} />)}
        <span className="studio__sep" />
        {align('left', 'По левому краю', <AlignLeft size={15} />)}
        {align('center', 'По центру', <AlignCenter size={15} />)}
        {align('right', 'По правому краю', <AlignRight size={15} />)}
      </div>
      <Swatches value={v.color ?? '#ffffff'} onPick={(color) => set({ color })} />
      <button type="button" className="studio__primary" onClick={() => addText(selected ? { ...selected } : draft)}>
        {selected ? 'Добавить ещё такой' : 'Добавить на экран'}
      </button>
    </>
  );
}

function Swatches({ value, onPick }: { value: string; onPick: (c: string) => void }) {
  return (
    <div className="studio__swatches" role="radiogroup" aria-label="Цвет">
      {COLORS.map((c) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={value === c}
          aria-label={c}
          className={cn('studio__swatch', value === c && 'is-on')}
          // Цвет образца — это данные (выбор пользователя), а не оформление
          style={{ background: c }}
          onClick={() => onPick(c)}
        />
      ))}
    </div>
  );
}

function ShapeProps() {
  const [color, setColor] = useState('#3b82f6');
  const add = (shape: ShapeKind) => addLayer({ kind: 'shape', shape, color, x: 0.38, y: 0.3, w: shape === 'circle' ? 0.24 : 0.3, h: shape === 'circle' ? 0.42 : 0.3 });
  return (
    <>
      <h3 className="studio__h">Фигуры</h3>
      <div className="studio__row">
        <button type="button" className="studio__chip" onClick={() => add('rect')}>
          <Square size={15} /> Прямоугольник
        </button>
        <button type="button" className="studio__chip" onClick={() => add('round')}>
          <Square size={15} /> Скруглённый
        </button>
        <button type="button" className="studio__chip" onClick={() => add('circle')}>
          <Circle size={15} /> Круг
        </button>
      </div>
      <Swatches value={color} onPick={setColor} />
      <p className="studio__hint">Фигура пригодится как подложка под текст или рамка для фото.</p>
    </>
  );
}

function ToolProps({ tool }: { tool: Tool }) {
  const blur = useStudio((s) => s.blur);
  const bgImage = useStudio((s) => s.bgImage);
  switch (tool) {
    case 'text':
      return <TextProps />;
    case 'shapes':
      return <ShapeProps />;
    case 'photo':
      return (
        <>
          <h3 className="studio__h">Фото</h3>
          <button type="button" className="studio__primary" onClick={() => void addPhoto()}>
            Добавить фото на сцену
          </button>
          <button
            type="button"
            className="studio__secondary"
            onClick={() => void pickFile('image/*').then((src) => src && useStudio.setState({ bgImage: src }))}
          >
            Сделать фото фоном
          </button>
          {bgImage && (
            <button type="button" className="studio__link" onClick={() => useStudio.setState({ bgImage: null })}>
              Вернуть фон из списка
            </button>
          )}
          <p className="studio__hint">Файлы не загружаются на сервер — участники видят их только в трансляции.</p>
        </>
      );
    case 'video':
      return (
        <>
          <h3 className="studio__h">Видео</h3>
          <button type="button" className="studio__primary" onClick={() => void addVideo()}>
            Добавить видео на сцену
          </button>
          <p className="studio__hint">Видео идёт по кругу без звука — говорите поверх него.</p>
        </>
      );
    case 'screen':
      return (
        <>
          <h3 className="studio__h">Экран</h3>
          <button type="button" className="studio__primary" onClick={() => void addScreen()}>
            Выбрать окно или экран
          </button>
          <p className="studio__hint">Экран станет частью сцены: поверх можно добавить камеру и подписи.</p>
        </>
      );
    case 'camera':
      return (
        <>
          <h3 className="studio__h">Камера</h3>
          <button type="button" className="studio__primary" onClick={addCamera}>
            Добавить камеру на сцену
          </button>
          <p className="studio__hint">Камеру можно перетащить в любой угол и растянуть за края рамки.</p>
        </>
      );
    case 'blur':
      return (
        <>
          <h3 className="studio__h">Размытие</h3>
          <label className="studio__switch">
            <input type="checkbox" checked={blur} onChange={(e) => useStudio.setState({ blur: e.target.checked })} />
            <span>Размыть фон сцены</span>
          </label>
          <p className="studio__hint">Слои поверх фона остаются чёткими.</p>
        </>
      );
    case 'clear':
      return (
        <>
          <h3 className="studio__h">Очистить</h3>
          <button type="button" className="studio__danger" onClick={clearScene}>
            Убрать всё со сцены
          </button>
          <p className="studio__hint">Фон останется, слои — текст, фото, видео, экран и камера — будут удалены.</p>
        </>
      );
  }
}

// ─── Предпросмотр с рамкой выделения ────────────────────────────────────────

type Grip = 'move' | 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';
const GRIPS: Exclude<Grip, 'move'>[] = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];

function Preview() {
  const box = useRef<HTMLDivElement>(null);
  const layers = useStudio((s) => s.layers);
  const selected = useStudio((s) => s.selected);
  const drag = useRef<{ id: string; grip: Grip; sx: number; sy: number; start: Layer } | null>(null);

  // Холст сцены живёт в предпросмотре, пока открыта студия
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const c = sceneCanvas();
    c.className = 'studio__canvas';
    el.prepend(c);
    runScene(true);
    return () => {
      c.remove();
      if (!useStudio.getState().live) runScene(false);
    };
  }, []);

  // Delete убирает выбранный слой
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const sel = useStudio.getState().selected;
      if (!sel || (e.key !== 'Delete' && e.key !== 'Backspace')) return;
      if ((e.target as HTMLElement).closest('input, textarea, select')) return;
      e.preventDefault();
      removeLayer(sel);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const begin = (id: string, grip: Grip) => (e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    const start = useStudio.getState().layers.find((l) => l.id === id);
    if (!start) return;
    useStudio.setState({ selected: id });
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { id, grip, sx: e.clientX, sy: e.clientY, start };
  };
  const move = (e: React.PointerEvent) => {
    const d = drag.current;
    const el = box.current;
    if (!d || !el) return;
    const r = el.getBoundingClientRect();
    const dx = (e.clientX - d.sx) / r.width;
    const dy = (e.clientY - d.sy) / r.height;
    const s = d.start;
    const min = 0.04;
    let { x, y, w, h } = s;
    if (d.grip === 'move') {
      x = Math.min(1 - min, Math.max(min - w, s.x + dx));
      y = Math.min(1 - min, Math.max(min - h, s.y + dy));
    } else {
      if (d.grip.includes('e')) w = Math.max(min, s.w + dx);
      if (d.grip.includes('s')) h = Math.max(min, s.h + dy);
      if (d.grip.includes('w')) {
        w = Math.max(min, s.w - dx);
        x = s.x + s.w - w;
      }
      if (d.grip.includes('n')) {
        h = Math.max(min, s.h - dy);
        y = s.y + s.h - h;
      }
    }
    patchLayer(d.id, { x, y, w, h });
  };
  const end = () => (drag.current = null);
  const sel = layers.find((l) => l.id === selected);

  return (
    <div className="studio__preview" ref={box} onPointerDown={() => useStudio.setState({ selected: null })} onPointerMove={move} onPointerUp={end} onPointerCancel={end}>
      {layers.map((l) => (
        <div
          key={l.id}
          className={cn('studio__box', l.id === selected && 'is-selected')}
          style={{ left: `${l.x * 100}%`, top: `${l.y * 100}%`, width: `${l.w * 100}%`, height: `${l.h * 100}%` }}
          onPointerDown={begin(l.id, 'move')}
          aria-label="Слой сцены"
        >
          {l.id === selected && GRIPS.map((g) => <span key={g} className={`studio__grip studio__grip--${g}`} onPointerDown={begin(l.id, g)} />)}
        </div>
      ))}
      {sel && (
        <div className="studio__layerbar" onPointerDown={(e) => e.stopPropagation()}>
          <button type="button" onClick={() => moveLayer(sel.id, 1)} aria-label="Выше" title="Выше">
            <ArrowUp size={15} />
          </button>
          <button type="button" onClick={() => moveLayer(sel.id, -1)} aria-label="Ниже" title="Ниже">
            <ArrowDown size={15} />
          </button>
          <button type="button" onClick={() => removeLayer(sel.id)} aria-label="Удалить" title="Удалить (Delete)">
            <Trash2 size={15} />
          </button>
        </div>
      )}
      {!layers.length && <span className="studio__empty">Добавьте текст, фото, видео, экран или камеру</span>}
    </div>
  );
}

/** Миниатюры фонов рисуются один раз. */
function BackdropThumb({ id }: { id: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    const ctx = c?.getContext('2d');
    if (!c || !ctx) return;
    drawScene(ctx, c.width, c.height, 0, { ...useStudio.getState(), bg: id, bgImage: null, blur: false, layers: [] });
  }, [id]);
  return <canvas ref={ref} width={192} height={108} className="studio__thumb" />;
}

function Backdrops() {
  const bg = useStudio((s) => s.bg);
  const bgImage = useStudio((s) => s.bgImage);
  const strip = useRef<HTMLDivElement>(null);
  const scroll = (dir: number) => strip.current?.scrollBy({ left: dir * strip.current.clientWidth * 0.8, behavior: 'smooth' });
  return (
    <section className="studio__bgs" aria-label="Фон трансляции">
      <h3 className="studio__h studio__h--small">Фон трансляции</h3>
      <div className="studio__bgrow">
        <button type="button" className="studio__arrow" onClick={() => scroll(-1)} aria-label="Назад">
          <ChevronLeft size={18} />
        </button>
        <div className="studio__strip" ref={strip}>
          {BACKDROPS.map((b) => (
            <button
              key={b.id}
              type="button"
              className={cn('studio__bg', !bgImage && bg === b.id && 'is-on')}
              onClick={() => useStudio.setState({ bg: b.id, bgImage: null })}
              aria-pressed={!bgImage && bg === b.id}
              title={b.label}
            >
              <BackdropThumb id={b.id} />
              <span>{b.label}</span>
            </button>
          ))}
        </div>
        <button type="button" className="studio__arrow" onClick={() => scroll(1)} aria-label="Вперёд">
          <ChevronRight size={18} />
        </button>
      </div>
    </section>
  );
}

export function Studio() {
  const [tool, setTool] = useState<Tool>('text');
  const live = useStudio((s) => s.live);
  const quality = useStudio((s) => s.quality);
  const volume = useRoom((s) => s.volume);
  const preview = useRef<HTMLDivElement>(null);
  const quick: { label: string; icon: ReactNode; run: () => void }[] = [
    { label: 'Текст', icon: <Type size={22} />, run: () => (setTool('text'), addText({})) },
    { label: 'Фото', icon: <ImageIcon size={22} />, run: () => void addPhoto() },
    { label: 'Видео', icon: <Video size={22} />, run: () => void addVideo() },
    { label: 'Экран', icon: <Monitor size={22} />, run: () => void addScreen() },
    { label: 'Камера', icon: <Camera size={22} />, run: addCamera },
  ];
  return (
    <section className="studio" aria-label="Студия трансляции">
      <div className="studio__main">
        <nav className="studio__tools" aria-label="Инструменты">
          {TOOLS.map((t) => (
            <button key={t.id} type="button" className={cn('studio__tool', tool === t.id && 'is-on')} onClick={() => setTool(t.id)} aria-pressed={tool === t.id}>
              {t.icon}
              <span>{t.label}</span>
            </button>
          ))}
        </nav>
        <div className="studio__props">
          <ToolProps tool={tool} />
        </div>
        <div className="studio__stage" ref={preview}>
          <Preview />
        </div>
        <div className="studio__quick">
          {quick.map((q) => (
            <button key={q.label} type="button" className="studio__tile" onClick={q.run}>
              {q.icon}
              <span>{q.label}</span>
            </button>
          ))}
        </div>
      </div>
      <Backdrops />
      <footer className="studio__bar">
        <button type="button" className={cn('studio__live', live && 'is-live')} onClick={() => setLive(!live)}>
          <Radio size={16} /> {live ? 'Остановить трансляцию' : 'Начать трансляцию экрана'}
        </button>
        <label className="studio__volume" title="Громкость собеседников">
          <button type="button" onClick={() => setRoomVolume(volume ? 0 : 1)} aria-label={volume ? 'Выключить звук' : 'Включить звук'}>
            {volume ? <Volume2 size={18} /> : <VolumeX size={18} />}
          </button>
          <input type="range" min={0} max={1} step={0.05} value={volume} onChange={(e) => setRoomVolume(Number(e.target.value))} aria-label="Громкость" />
        </label>
        <select className="studio__select studio__select--q" value={quality} onChange={(e) => setQuality(e.target.value as Quality)} aria-label="Качество трансляции">
          {(Object.keys(QUALITIES) as Quality[]).map((q) => (
            <option key={q} value={q}>
              {q}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="studio__icon"
          onClick={() => void preview.current?.querySelector('.studio__preview')?.requestFullscreen?.().catch(() => undefined)}
          aria-label="Предпросмотр на весь экран"
          title="На весь экран"
        >
          <Maximize size={18} />
        </button>
      </footer>
    </section>
  );
}
