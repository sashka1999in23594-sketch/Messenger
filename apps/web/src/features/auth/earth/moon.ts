/**
 * Луна на наклонной орбите вокруг Земли и светящаяся линия орбиты.
 * Текстура Луны рисуется процедурно на canvas: реголит, моря, кратеры.
 */
import {
  CanvasTexture,
  Group,
  Mesh,
  MeshStandardMaterial,
  SphereGeometry,
  SRGBColorSpace,
  Vector3,
} from 'three';
import {
  createRibbon,
  fillRibbon,
  FX_GLSL,
  fxMaterial,
  rand,
  RIBBON_GLSL,
  type SceneContext,
  type ScenePart,
} from './core';
import type { Palette } from './palette';

export const MOON_ORBIT = 2.15;
export const MOON_RADIUS = 0.17;
/** Наклон плоскости орбиты (рад) — эллипс читается под небольшим углом. */
export const ORBIT_TILT_X = 0.1;
export const ORBIT_TILT_Z = 0.07;
const PERIOD = 50;
/** Стартовое положение — впереди справа, чтобы Луна сразу была на виду. */
const A0 = -Math.PI / 4;
const RING_POINTS = 257;

const RING_VERT = /* glsl */ `
attribute vec3 aTan;
attribute float aSide;
attribute float aT;
uniform float uWidth;
varying float vT;
varying float vSide;
${RIBBON_GLSL}
void main() {
  vT = aT;
  vSide = aSide;
  gl_Position = ribbonClip(position, aTan, aSide, uWidth);
}
`;

const RING_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uMoonT;
varying float vT;
varying float vSide;
${FX_GLSL}
void main() {
  float e = vSide;
  float core = exp(-e * e * 30.0);
  float glow = exp(-e * e * 4.0) * 0.3;
  // Позади Луны орбита ярче — как след
  float behind = fract(uMoonT - vT);
  float trail = exp(-behind * 9.0);
  float a = (core * 0.75 + glow) * (0.38 + trail * 0.9);
  gl_FragColor = fxColor(mix(uColor, vec3(1.0), core * trail * 0.5), a, 0.65);
}
`;

/** Процедурная текстура Луны (равнопромежуточная проекция, бесшовная по долготе). */
function paintMoon(w: number): HTMLCanvasElement {
  const h = w / 2;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  if (!g) return c;
  g.fillStyle = '#8e8a85';
  g.fillRect(0, 0, w, h);

  const yOf = (lat: number) => (0.5 - lat / 180) * h;
  const stretch = (lat: number) => 1 / Math.max(Math.cos((lat * Math.PI) / 180), 0.3);
  // Рисует фигуру с учётом растяжения у полюсов и переноса через шов
  const stamp = (x: number, lat: number, r: number, draw: (r: number) => void) => {
    const sx = stretch(lat);
    const y = yOf(lat);
    for (const dx of [0, -w, w]) {
      const cx = x + dx;
      if (cx + r * sx * 2 < 0 || cx - r * sx * 2 > w) continue;
      g.save();
      g.translate(cx, y);
      g.scale(sx, 1);
      draw(r);
      g.restore();
    }
  };
  const blob = (r: number, color: string, alpha: number) => {
    const gr = g.createRadialGradient(0, 0, 0, 0, 0, r);
    gr.addColorStop(0, `rgba(${color},${alpha})`);
    gr.addColorStop(0.6, `rgba(${color},${alpha * 0.7})`);
    gr.addColorStop(1, `rgba(${color},0)`);
    g.fillStyle = gr;
    g.beginPath();
    g.arc(0, 0, r, 0, Math.PI * 2);
    g.fill();
  };

  // Моря: [долгота, широта, размер] — видимая сторона обращена к Земле (долгота 0)
  const maria: [number, number, number][] = [
    [-16, 33, 0.07],
    [17, 28, 0.045],
    [31, 8, 0.05],
    [59, 17, 0.032],
    [-57, 18, 0.1],
    [-40, -2, 0.07],
    [-17, -21, 0.045],
    [51, -8, 0.04],
    [35, -15, 0.03],
    [-39, -24, 0.028],
    [5, 56, 0.035],
    [-20, 52, 0.03],
    [140, -20, 0.03],
    [-150, 25, 0.025],
  ];
  for (const [lon, lat, size] of maria) {
    const x = (0.5 + lon / 360) * w;
    for (let k = 0; k < 9; k++) {
      const ox = rand(-1, 1) * size * w * 0.55;
      const oy = rand(-1, 1) * size * w * 0.35;
      stamp(x + ox, lat + (oy / h) * 180 * -1, size * w * rand(0.45, 0.85), (r) =>
        blob(r, '52,51,50', 0.32),
      );
    }
  }

  // Реголит: октавы шума, крайний столбец повторяет первый — шва нет
  const noise = document.createElement('canvas');
  const ng = noise.getContext('2d');
  if (ng) {
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'high';
    g.globalCompositeOperation = 'overlay';
    for (const [cols, alpha] of [
      [6, 0.45],
      [12, 0.38],
      [24, 0.3],
      [48, 0.22],
      [96, 0.18],
      [192, 0.14],
      [w / 2, 0.12],
    ] as const) {
      const rows = Math.max(2, cols / 2);
      noise.width = cols + 1;
      noise.height = rows;
      const img = ng.createImageData(cols + 1, rows);
      for (let y = 0; y < rows; y++) {
        const first = Math.random() * 255;
        for (let x = 0; x <= cols; x++) {
          const v = x === 0 || x === cols ? first : Math.random() * 255;
          const o = (y * (cols + 1) + x) * 4;
          img.data[o] = img.data[o + 1] = img.data[o + 2] = v;
          img.data[o + 3] = 255;
        }
      }
      ng.putImageData(img, 0, 0);
      const cw = w / cols;
      const ch = h / (rows - 1);
      g.globalAlpha = alpha;
      g.drawImage(noise, 0, 0, cols + 1, rows, -cw / 2, -ch / 2, w + cw, rows * ch);
    }
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
  }

  // Кратеры: тёмное дно, светлый вал, у крупных — выброс и центральная горка
  const count = Math.round(w * 0.32);
  for (let i = 0; i < count; i++) {
    const r = w * 0.0022 * Math.pow(14, Math.pow(Math.random(), 2.4));
    const lat = (Math.asin(rand(-1, 1)) * 180) / Math.PI;
    stamp(Math.random() * w, lat, r, (rr) => {
      if (rr > w * 0.01) blob(rr * 1.9, '205,200,193', 0.1);
      const floor = g.createRadialGradient(-rr * 0.15, -rr * 0.15, 0, 0, 0, rr);
      floor.addColorStop(0, 'rgba(38,36,35,0.42)');
      floor.addColorStop(0.75, 'rgba(38,36,35,0.22)');
      floor.addColorStop(1, 'rgba(38,36,35,0)');
      g.fillStyle = floor;
      g.beginPath();
      g.arc(0, 0, rr, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = 'rgba(228,223,215,0.38)';
      g.lineWidth = Math.max(0.8, rr * 0.2);
      g.beginPath();
      g.arc(0, 0, rr * 0.98, 0, Math.PI * 2);
      g.stroke();
      if (rr > w * 0.012) blob(rr * 0.18, '235,230,222', 0.5);
    });
  }

  // Лучевые кратеры (как Тихо)
  for (const [lon, lat] of [
    [-11, -43],
    [-20, 10],
    [-38, 8],
  ] as const) {
    const x = (0.5 + lon / 360) * w;
    stamp(x, lat, w * 0.006, (r) => {
      g.strokeStyle = 'rgba(240,236,228,0.09)';
      for (let k = 0; k < 22; k++) {
        const ang = Math.random() * Math.PI * 2;
        const len = r * rand(5, 18);
        g.lineWidth = rand(0.6, 1.8);
        g.beginPath();
        g.moveTo(0, 0);
        g.lineTo(Math.cos(ang) * len, Math.sin(ang) * len);
        g.stroke();
      }
      blob(r * 2.2, '245,242,236', 0.55);
    });
  }
  return c;
}

export interface Moon extends ScenePart {
  moon: Mesh;
  orbit: Group;
}

export function createMoon(ctx: SceneContext): Moon {
  const orbit = new Group();
  orbit.rotation.set(ORBIT_TILT_X, 0, ORBIT_TILT_Z);
  ctx.scene.add(orbit);

  const tex = new CanvasTexture(paintMoon(ctx.view.mobile ? 512 : 1024));
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = 4;
  const moon = new Mesh(
    new SphereGeometry(MOON_RADIUS, 48, 32),
    new MeshStandardMaterial({
      map: tex,
      bumpMap: tex,
      bumpScale: 1.2,
      roughness: 1,
      metalness: 0,
    }),
  );
  orbit.add(moon);

  // Линия орбиты: лента постоянной толщины в пикселях
  const pts = Array.from({ length: RING_POINTS }, (_, i) => {
    const a = (i / (RING_POINTS - 1)) * Math.PI * 2;
    return new Vector3(Math.cos(a) * MOON_ORBIT, 0, -Math.sin(a) * MOON_ORBIT);
  });
  const ringGeo = createRibbon(RING_POINTS);
  fillRibbon(ringGeo, pts, true);
  const ringColor = { value: ctx.palette.orbit.clone() };
  const moonT = { value: 0 };
  const ring = new Mesh(
    ringGeo,
    fxMaterial({
      vertexShader: RING_VERT,
      fragmentShader: RING_FRAG,
      uniforms: {
        uRes: ctx.uniforms.uRes,
        uDpr: ctx.uniforms.uDpr,
        uWidth: { value: ctx.view.mobile ? 6 : 8 },
        uColor: ringColor,
        uMoonT: moonT,
      },
    }),
  );
  ring.renderOrder = 7;
  ring.frustumCulled = false;
  orbit.add(ring);

  return {
    moon,
    orbit,
    update(t) {
      const a = A0 + (t / PERIOD) * Math.PI * 2;
      moon.position.set(Math.cos(a) * MOON_ORBIT, 0, -Math.sin(a) * MOON_ORBIT);
      // Приливный захват: к Земле всегда обращена видимая сторона
      moon.rotation.y = a + Math.PI;
      const f = a / (Math.PI * 2);
      moonT.value = f - Math.floor(f);
    },
    setPalette(p: Palette) {
      ringColor.value.copy(p.orbit);
    },
  };
}
