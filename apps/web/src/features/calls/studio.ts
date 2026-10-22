/**
 * Студия звонка: сцена из слоёв (текст, фото, видео, экран, камера, фигуры)
 * поверх фона рисуется на холсте, а холст уходит участникам вместо камеры.
 * Координаты слоёв — доли холста, поэтому сцена не зависит от качества.
 */
import { create } from 'zustand';
import { setStudioStream, useRoom } from '../../shared/calls/room';

export type LayerKind = 'text' | 'image' | 'video' | 'screen' | 'camera' | 'shape';
export type ShapeKind = 'rect' | 'round' | 'circle';
export type Align = 'left' | 'center' | 'right';

export interface Layer {
  id: string;
  kind: LayerKind;
  /** Положение и размер — доли холста 0…1 */
  x: number;
  y: number;
  w: number;
  h: number;
  text?: string;
  font?: string;
  /** Размер шрифта в точках при ширине холста 1280 */
  size?: number;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  align?: Align;
  color?: string;
  shape?: ShapeKind;
  /** Фото, видео или поток экрана */
  src?: string;
  stream?: MediaStream;
}

export type Quality = '1080p' | '720p' | '480p';
export const QUALITIES: Record<Quality, [number, number]> = { '1080p': [1920, 1080], '720p': [1280, 720], '480p': [854, 480] };

export const FONTS = ['Inter', 'Segoe UI', 'Arial', 'Georgia', 'Courier New', 'Impact'];
export const SIZES = [24, 32, 40, 48, 64, 80, 96, 128];
export const COLORS = ['#ffffff', '#111111', '#ef4444', '#f59e0b', '#22c55e', '#3b82f6', '#a855f7'];

interface StudioState {
  open: boolean;
  bg: string;
  /** Своё фото фоном */
  bgImage: string | null;
  blur: boolean;
  layers: Layer[];
  selected: string | null;
  live: boolean;
  quality: Quality;
}

export const useStudio = create<StudioState>(() => ({
  open: false,
  bg: 'city',
  bgImage: null,
  blur: false,
  layers: [],
  selected: null,
  live: false,
  quality: '720p',
}));

const uid = () => Math.random().toString(36).slice(2, 10);

export function addLayer(layer: Omit<Layer, 'id'>): string {
  const id = uid();
  const s = useStudio.getState();
  useStudio.setState({ layers: [...s.layers, { ...layer, id }], selected: id });
  return id;
}

export function patchLayer(id: string, patch: Partial<Layer>): void {
  useStudio.setState({ layers: useStudio.getState().layers.map((l) => (l.id === id ? { ...l, ...patch } : l)) });
}

export function removeLayer(id: string): void {
  const s = useStudio.getState();
  const layer = s.layers.find((l) => l.id === id);
  release(layer);
  useStudio.setState({ layers: s.layers.filter((l) => l.id !== id), selected: s.selected === id ? null : s.selected });
}

/** Слой выше или ниже остальных. */
export function moveLayer(id: string, dir: 1 | -1): void {
  const layers = [...useStudio.getState().layers];
  const i = layers.findIndex((l) => l.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= layers.length) return;
  [layers[i], layers[j]] = [layers[j]!, layers[i]!];
  useStudio.setState({ layers });
}

export function clearScene(): void {
  useStudio.getState().layers.forEach(release);
  useStudio.setState({ layers: [], selected: null });
}

function release(layer?: Layer) {
  if (!layer) return;
  if (layer.kind === 'screen') layer.stream?.getTracks().forEach((t) => t.stop());
  if ((layer.kind === 'image' || layer.kind === 'video') && layer.src?.startsWith('blob:')) URL.revokeObjectURL(layer.src);
  media.delete(layer.id);
}

// ─── Фоны ────────────────────────────────────────────────────────────────────

export interface Backdrop {
  id: string;
  label: string;
  draw: (c: CanvasRenderingContext2D, w: number, h: number, t: number) => void;
}

/** Повторяемые «случайные» числа: окна домов и звёзды не прыгают от кадра к кадру. */
function seeded(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function sky(c: CanvasRenderingContext2D, w: number, h: number, stops: [number, string][]) {
  const g = c.createLinearGradient(0, 0, 0, h);
  for (const [o, col] of stops) g.addColorStop(o, col);
  c.fillStyle = g;
  c.fillRect(0, 0, w, h);
}

function glow(c: CanvasRenderingContext2D, x: number, y: number, r: number, color: string) {
  const g = c.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, color);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  c.fillStyle = g;
  c.fillRect(x - r, y - r, r * 2, r * 2);
}

function stars(c: CanvasRenderingContext2D, w: number, h: number, t: number, n: number, top = 1) {
  const r = seeded(7);
  for (let i = 0; i < n; i++) {
    const x = r() * w;
    const y = r() * h * top;
    const a = 0.35 + 0.65 * Math.abs(Math.sin(t / 900 + i));
    c.fillStyle = `rgba(255,255,255,${a * r()})`;
    c.fillRect(x, y, 1.6, 1.6);
  }
}

export const BACKDROPS: Backdrop[] = [
  {
    id: 'city',
    label: 'Ночной город',
    draw: (c, w, h, t) => {
      sky(c, w, h, [
        [0, '#1a1036'],
        [0.55, '#4b2a7a'],
        [0.75, '#7a3f8f'],
        [1, '#0d0a1c'],
      ]);
      stars(c, w, h, t, 90, 0.45);
      const r = seeded(11);
      const base = h * 0.78;
      for (let x = 0; x < w; ) {
        const bw = w * (0.03 + r() * 0.05);
        const bh = h * (0.12 + r() * 0.38);
        c.fillStyle = '#120c22';
        c.fillRect(x, base - bh, bw - 2, bh);
        for (let wy = base - bh + 8; wy < base - 6; wy += 12) {
          for (let wx = x + 5; wx < x + bw - 8; wx += 9) {
            if (r() > 0.62) {
              c.fillStyle = r() > 0.5 ? 'rgba(255,214,140,0.85)' : 'rgba(170,140,255,0.7)';
              c.fillRect(wx, wy, 3, 5);
            }
          }
        }
        x += bw;
      }
      // Отражение в воде
      const g = c.createLinearGradient(0, base, 0, h);
      g.addColorStop(0, 'rgba(120,70,180,0.55)');
      g.addColorStop(1, 'rgba(10,8,20,1)');
      c.fillStyle = g;
      c.fillRect(0, base, w, h - base);
      for (let i = 0; i < 40; i++) {
        const y = base + ((i * 13 + t / 40) % (h - base));
        c.fillStyle = `rgba(255,200,150,${0.05 + (i % 3) * 0.03})`;
        c.fillRect((i * 97) % w, y, 40 + (i % 5) * 20, 1.5);
      }
    },
  },
  {
    id: 'dusk',
    label: 'Сумерки',
    draw: (c, w, h, t) => {
      sky(c, w, h, [
        [0, '#2b1a5e'],
        [0.5, '#8a3f9a'],
        [0.8, '#f08a6a'],
        [1, '#ffc58a'],
      ]);
      glow(c, w * 0.5, h * 0.95, h * 0.6, 'rgba(255,200,140,0.55)');
      for (let i = 0; i < 6; i++) {
        const x = ((i * w) / 5 + t / 60) % (w + 300) - 150;
        glow(c, x, h * (0.25 + (i % 3) * 0.12), 160, 'rgba(255,255,255,0.08)');
      }
    },
  },
  {
    id: 'fire',
    label: 'Камин',
    draw: (c, w, h, t) => {
      sky(c, w, h, [
        [0, '#1b0f0a'],
        [1, '#2b140a'],
      ]);
      const f = 0.85 + 0.15 * Math.sin(t / 120) * Math.sin(t / 77);
      glow(c, w * 0.5, h * 0.82, h * 0.75 * f, 'rgba(255,140,40,0.55)');
      glow(c, w * 0.5, h * 0.9, h * 0.35 * f, 'rgba(255,210,120,0.6)');
      c.fillStyle = 'rgba(0,0,0,0.35)';
      c.fillRect(0, h * 0.92, w, h * 0.08);
    },
  },
  {
    id: 'ocean',
    label: 'Глубина',
    draw: (c, w, h, t) => {
      sky(c, w, h, [
        [0, '#0d5f86'],
        [0.5, '#073b5c'],
        [1, '#02121f'],
      ]);
      c.save();
      c.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 7; i++) {
        const x = w * (0.1 + i * 0.13) + Math.sin(t / 1500 + i) * 40;
        const g = c.createLinearGradient(x, 0, x + 80, h);
        g.addColorStop(0, 'rgba(160,230,255,0.16)');
        g.addColorStop(1, 'rgba(160,230,255,0)');
        c.fillStyle = g;
        c.beginPath();
        c.moveTo(x, 0);
        c.lineTo(x + 50, 0);
        c.lineTo(x + 220, h);
        c.lineTo(x + 120, h);
        c.fill();
      }
      c.restore();
      const r = seeded(5);
      for (let i = 0; i < 50; i++) {
        const y = (r() * h - t / (20 + r() * 30)) % h;
        c.fillStyle = 'rgba(200,240,255,0.35)';
        c.beginPath();
        c.arc(r() * w, y < 0 ? y + h : y, 1 + r() * 2, 0, Math.PI * 2);
        c.fill();
      }
    },
  },
  {
    id: 'neon',
    label: 'Неон',
    draw: (c, w, h, t) => {
      sky(c, w, h, [
        [0, '#0a0618'],
        [0.55, '#2a0b3d'],
        [1, '#09040f'],
      ]);
      glow(c, w * 0.5, h * 0.55, h * 0.5, 'rgba(255,60,180,0.35)');
      c.strokeStyle = 'rgba(0,229,255,0.45)';
      c.lineWidth = 1.5;
      const horizon = h * 0.58;
      for (let i = -12; i <= 12; i++) {
        c.beginPath();
        c.moveTo(w / 2 + i * 12, horizon);
        c.lineTo(w / 2 + i * w * 0.12, h);
        c.stroke();
      }
      for (let i = 0; i < 12; i++) {
        const p = ((i + (t / 900) % 1) / 12) ** 2;
        const y = horizon + p * (h - horizon);
        c.beginPath();
        c.moveTo(0, y);
        c.lineTo(w, y);
        c.stroke();
      }
    },
  },
  {
    id: 'space',
    label: 'Космос',
    draw: (c, w, h, t) => {
      sky(c, w, h, [
        [0, '#02030a'],
        [1, '#0a0f24'],
      ]);
      stars(c, w, h, t, 220);
      const x = w * 0.72;
      const y = h * 0.62;
      const r = h * 0.42;
      glow(c, x, y, r * 1.35, 'rgba(90,150,255,0.35)');
      const g = c.createRadialGradient(x - r * 0.4, y - r * 0.4, r * 0.1, x, y, r);
      g.addColorStop(0, '#9cc4ff');
      g.addColorStop(0.5, '#2f5fb8');
      g.addColorStop(1, '#050b1f');
      c.fillStyle = g;
      c.beginPath();
      c.arc(x, y, r, 0, Math.PI * 2);
      c.fill();
    },
  },
  {
    id: 'forest',
    label: 'Лес',
    draw: (c, w, h, t) => {
      sky(c, w, h, [
        [0, '#9fd4c9'],
        [0.55, '#4f8f7a'],
        [1, '#11251d'],
      ]);
      glow(c, w * 0.3, h * 0.25, h * 0.5, 'rgba(255,250,220,0.45)');
      const r = seeded(3);
      for (let layer = 0; layer < 3; layer++) {
        c.fillStyle = ['#2f5e4c', '#1d3d31', '#0d1f18'][layer]!;
        const base = h * (0.62 + layer * 0.12);
        for (let x = -40; x < w + 40; x += 30 + r() * 40) {
          const th = h * (0.18 + r() * 0.2) * (1 + layer * 0.2);
          c.beginPath();
          c.moveTo(x, base - th);
          c.lineTo(x - th * 0.28, base);
          c.lineTo(x + th * 0.28, base);
          c.fill();
        }
        c.fillRect(0, base - 2, w, h - base + 2);
      }
      c.fillStyle = `rgba(255,255,255,${0.06 + 0.03 * Math.sin(t / 2000)})`;
      c.fillRect(0, h * 0.6, w, h * 0.2);
    },
  },
  {
    id: 'sunset',
    label: 'Закат',
    draw: (c, w, h) => {
      sky(c, w, h, [
        [0, '#2a4a8a'],
        [0.45, '#e58a5a'],
        [0.62, '#ffd08a'],
        [1, '#1b2340'],
      ]);
      glow(c, w * 0.5, h * 0.6, h * 0.5, 'rgba(255,230,170,0.75)');
      c.fillStyle = 'rgba(20,24,48,0.85)';
      c.fillRect(0, h * 0.68, w, h * 0.32);
    },
  },
  {
    id: 'plain',
    label: 'Однотонный',
    draw: (c, w, h) => sky(c, w, h, [[0, '#14171f'], [1, '#0b0d12']]),
  },
];

// ─── Отрисовка ──────────────────────────────────────────────────────────────

/** Картинки и видео слоёв (по id слоя). */
const media = new Map<string, HTMLImageElement | HTMLVideoElement>();
let bgImageEl: HTMLImageElement | null = null;
let cameraEl: HTMLVideoElement | null = null;

function elementFor(layer: Layer): HTMLImageElement | HTMLVideoElement | null {
  if (layer.kind === 'camera') {
    const stream = useRoom.getState().local;
    if (!stream?.getVideoTracks().length) return null;
    if (!cameraEl) {
      cameraEl = document.createElement('video');
      cameraEl.muted = true;
      cameraEl.playsInline = true;
    }
    if (cameraEl.srcObject !== stream) {
      cameraEl.srcObject = stream;
      void cameraEl.play().catch(() => undefined);
    }
    return cameraEl;
  }
  let el = media.get(layer.id);
  if (el) return el;
  if (layer.kind === 'image' && layer.src) {
    const img = new Image();
    img.src = layer.src;
    el = img;
  } else if ((layer.kind === 'video' && layer.src) || (layer.kind === 'screen' && layer.stream)) {
    const v = document.createElement('video');
    v.muted = true;
    v.playsInline = true;
    v.loop = true;
    if (layer.stream) v.srcObject = layer.stream;
    else v.src = layer.src!;
    void v.play().catch(() => undefined);
    el = v;
  }
  if (el) media.set(layer.id, el);
  return el ?? null;
}

const naturalSize = (el: HTMLImageElement | HTMLVideoElement): [number, number] =>
  el instanceof HTMLVideoElement ? [el.videoWidth, el.videoHeight] : [el.naturalWidth, el.naturalHeight];

/** Вписать картинку в рамку слоя (с сохранением пропорций, по центру). */
function drawFitted(c: CanvasRenderingContext2D, el: HTMLImageElement | HTMLVideoElement, x: number, y: number, w: number, h: number, cover = false) {
  const [nw, nh] = naturalSize(el);
  if (!nw || !nh) return;
  const k = cover ? Math.max(w / nw, h / nh) : Math.min(w / nw, h / nh);
  const dw = nw * k;
  const dh = nh * k;
  c.save();
  c.beginPath();
  c.rect(x, y, w, h);
  c.clip();
  c.drawImage(el, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
  c.restore();
}

function roundRect(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  c.beginPath();
  c.roundRect(x, y, w, h, r);
}

function wrap(c: CanvasRenderingContext2D, text: string, max: number): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const word of para.split(' ')) {
      const next = line ? `${line} ${word}` : word;
      if (c.measureText(next).width > max && line) {
        out.push(line);
        line = word;
      } else line = next;
    }
    out.push(line);
  }
  return out;
}

export function drawScene(c: CanvasRenderingContext2D, w: number, h: number, t: number, s: StudioState = useStudio.getState()): void {
  c.save();
  if (s.blur) c.filter = `blur(${Math.round(w / 90)}px)`;
  if (s.bgImage) {
    if (!bgImageEl || bgImageEl.src !== s.bgImage) {
      bgImageEl = new Image();
      bgImageEl.src = s.bgImage;
    }
    c.fillStyle = '#000';
    c.fillRect(0, 0, w, h);
    drawFitted(c, bgImageEl, 0, 0, w, h, true);
  } else (BACKDROPS.find((b) => b.id === s.bg) ?? BACKDROPS[0]!).draw(c, w, h, t);
  c.restore();

  const k = w / 1280;
  for (const l of s.layers) {
    const x = l.x * w;
    const y = l.y * h;
    const lw = l.w * w;
    const lh = l.h * h;
    if (l.kind === 'text') {
      const size = (l.size ?? 48) * k;
      c.save();
      c.font = `${l.italic ? 'italic ' : ''}${l.bold === false ? 500 : 800} ${size}px "${l.font ?? 'Inter'}", system-ui, sans-serif`;
      c.fillStyle = l.color ?? '#ffffff';
      c.textBaseline = 'middle';
      c.textAlign = l.align ?? 'center';
      c.shadowColor = 'rgba(0,0,0,0.45)';
      c.shadowBlur = 12 * k;
      c.shadowOffsetY = 2 * k;
      const lines = wrap(c, l.text ?? '', lw);
      const lineH = size * 1.2;
      const top = y + lh / 2 - ((lines.length - 1) * lineH) / 2;
      const ax = l.align === 'left' ? x : l.align === 'right' ? x + lw : x + lw / 2;
      lines.forEach((line, i) => {
        const ly = top + i * lineH;
        c.fillText(line, ax, ly);
        if (l.underline) {
          const tw = c.measureText(line).width;
          const ux = l.align === 'left' ? ax : l.align === 'right' ? ax - tw : ax - tw / 2;
          c.fillRect(ux, ly + size * 0.55, tw, Math.max(2, size * 0.06));
        }
      });
      c.restore();
    } else if (l.kind === 'shape') {
      c.save();
      c.fillStyle = l.color ?? '#3b82f6';
      if (l.shape === 'circle') {
        c.beginPath();
        c.ellipse(x + lw / 2, y + lh / 2, lw / 2, lh / 2, 0, 0, Math.PI * 2);
      } else roundRect(c, x, y, lw, lh, l.shape === 'round' ? Math.min(lw, lh) * 0.18 : 0);
      c.fill();
      c.restore();
    } else {
      const el = elementFor(l);
      if (!el) continue;
      c.save();
      if (l.kind === 'camera') {
        // Камера — со скруглением и тенью, как окно ведущего
        c.shadowColor = 'rgba(0,0,0,0.5)';
        c.shadowBlur = 24 * k;
        roundRect(c, x, y, lw, lh, 18 * k);
        c.clip();
        drawFitted(c, el, x, y, lw, lh, true);
      } else drawFitted(c, el, x, y, lw, lh, l.kind !== 'screen' && l.kind !== 'image' && l.kind !== 'video');
      c.restore();
    }
  }
}

// ─── Трансляция ─────────────────────────────────────────────────────────────

let canvas: HTMLCanvasElement | null = null;
let loop: number | null = null;
const listeners = new Set<(c: HTMLCanvasElement) => void>();

/** Холст сцены: один на звонок, рисуется ~30 раз в секунду, пока открыта студия или идёт трансляция. */
export function sceneCanvas(): HTMLCanvasElement {
  if (!canvas) canvas = document.createElement('canvas');
  const [w, h] = QUALITIES[useStudio.getState().quality];
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
  return canvas;
}

export function onFrame(f: (c: HTMLCanvasElement) => void): () => void {
  listeners.add(f);
  return () => listeners.delete(f);
}

export function runScene(on: boolean): void {
  if (on && loop === null) {
    // Таймер, а не requestAnimationFrame: трансляция идёт и в свёрнутом окне
    const tick = () => {
      const c = sceneCanvas();
      const ctx = c.getContext('2d');
      if (ctx) drawScene(ctx, c.width, c.height, performance.now());
      listeners.forEach((f) => f(c));
      loop = window.setTimeout(tick, 33);
    };
    tick();
  } else if (!on && loop !== null) {
    window.clearTimeout(loop);
    loop = null;
  }
}

/** Начать или остановить трансляцию сцены участникам звонка. */
export function setLive(live: boolean): void {
  if (live) {
    const c = sceneCanvas();
    runScene(true);
    setStudioStream(c.captureStream(30));
  } else {
    setStudioStream(null);
    if (!useStudio.getState().open) runScene(false);
  }
  useStudio.setState({ live });
}

export function setQuality(quality: Quality): void {
  useStudio.setState({ quality });
  sceneCanvas();
}

/** Звонок закончился — сцену и ресурсы отпускаем. */
export function resetStudio(): void {
  runScene(false);
  clearScene();
  if (cameraEl) cameraEl.srcObject = null;
  useStudio.setState({ open: false, live: false, selected: null });
}
