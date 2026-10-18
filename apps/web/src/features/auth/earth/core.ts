/**
 * Общие типы и утилиты сцены «Земля»: контекст, материалы эффектов,
 * экранные линии фиксированной толщины и освобождение ресурсов GPU.
 */
import {
  BufferAttribute,
  BufferGeometry,
  InstancedMesh,
  NormalBlending,
  ShaderMaterial,
  Texture,
  type Group,
  type IUniform,
  type Material,
  type Object3D,
  type PerspectiveCamera,
  type Scene,
  type Side,
  type Vector2,
  type Vector3,
} from 'three';
import type { Palette } from './palette';

/** Общие юниформы: один объект на сцену, ссылки раздаются всем материалам. */
export interface SharedUniforms {
  uTime: IUniform<number>;
  /** Размер буфера кадра в физических пикселях. */
  uRes: IUniform<Vector2>;
  uDpr: IUniform<number>;
  /** Физических пикселей на единицу мира на расстоянии 1 (для размеров точек). */
  uPxScale: IUniform<number>;
}

export interface SceneContext {
  scene: Scene;
  camera: PerspectiveCamera;
  /** Наклон земной оси. */
  tilt: Group;
  /** Вращается вместе с поверхностью Земли. */
  spin: Group;
  /** Направление на Солнце в мировых координатах (единичный вектор). */
  sunDir: Vector3;
  uniforms: SharedUniforms;
  /** pxPerUnit — CSS-пикселей на единицу мира у центра Земли; still — статичный кадр. */
  view: { pxPerUnit: number; mobile: boolean; still: boolean };
  palette: Palette;
}

/** Часть сцены: обновляется каждый кадр, сама освобождает то, что не лежит в графе сцены. */
export interface ScenePart {
  update(t: number, dt: number): void;
  setPalette?(p: Palette): void;
  dispose?(): void;
}

export const rand = (min: number, max: number): number => min + Math.random() * (max - min);
export const clamp = (v: number, min: number, max: number): number =>
  v < min ? min : v > max ? max : v;
export const smoothstep = (e0: number, e1: number, x: number): number => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};

/** Высота полёта самолёта по доле пути (одинаково на CPU и в шейдере следа). */
export const flightAlt = (f: number): number =>
  1.006 + 0.03 * smoothstep(0, 0.2, f) * (1 - smoothstep(0.8, 1, f));
export const FLIGHT_ALT_GLSL = /* glsl */ `
float flightAlt(float f) {
  return 1.006 + 0.03 * smoothstep(0.0, 0.2, f) * (1.0 - smoothstep(0.8, 1.0, f));
}
`;

/**
 * Выход фрагментного шейдера эффектов: перевод в sRGB и премультипликация.
 * add = 0 — обычное смешивание, add = 1 — аддитивное (свечение).
 */
export const FX_GLSL = /* glsl */ `
vec4 fxColor(vec3 col, float a, float add) {
  #ifdef TONE_MAPPING
  col = toneMapping(col);
  #endif
  vec3 c = linearToOutputTexel(vec4(col, 1.0)).rgb;
  return vec4(c * a, a * (1.0 - add));
}
`;

export function fxMaterial(params: {
  vertexShader: string;
  fragmentShader: string;
  uniforms: Record<string, IUniform>;
  side?: Side;
  depthTest?: boolean;
}): ShaderMaterial {
  return new ShaderMaterial({
    ...params,
    transparent: true,
    depthWrite: false,
    premultipliedAlpha: true,
    blending: NormalBlending,
    toneMapped: false,
  });
}

/** Лента вдоль кривой: толщина задаётся в пикселях экрана, а не в единицах мира. */
export const RIBBON_GLSL = /* glsl */ `
uniform vec2 uRes;
uniform float uDpr;
vec4 ribbonClip(vec3 center, vec3 tangent, float side, float widthPx) {
  mat4 mvp = projectionMatrix * modelViewMatrix;
  vec4 c0 = mvp * vec4(center, 1.0);
  vec4 c1 = mvp * vec4(center + tangent * 0.01, 1.0);
  vec2 d = (c1.xy / max(c1.w, 1e-4) - c0.xy / max(c0.w, 1e-4)) * uRes;
  float l = length(d);
  d = l > 1e-6 ? d / l : vec2(1.0, 0.0);
  c0.xy += vec2(-d.y, d.x) * side * widthPx * uDpr / uRes * c0.w;
  return c0;
}
`;

/** Геометрия ленты на n точек: атрибуты aSide (−1/1) и aT (0…1 вдоль ленты). */
export function createRibbon(n: number, withPoints = true): BufferGeometry {
  const g = new BufferGeometry();
  const side = new Float32Array(n * 2);
  const t = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    side[i * 2] = -1;
    side[i * 2 + 1] = 1;
    t[i * 2] = t[i * 2 + 1] = i / (n - 1);
  }
  const index: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    const a = i * 2;
    // Обход против часовой стрелки на экране (aSide = +1 — слева по ходу)
    index.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
  }
  // Без точек лента строится в шейдере, позиции нужны только для числа вершин
  g.setAttribute('position', new BufferAttribute(new Float32Array(n * 6), 3));
  if (withPoints) g.setAttribute('aTan', new BufferAttribute(new Float32Array(n * 6), 3));
  g.setAttribute('aSide', new BufferAttribute(side, 1));
  g.setAttribute('aT', new BufferAttribute(t, 1));
  g.setIndex(index);
  return g;
}

/** Записывает точки кривой в ленту; loop — замкнутая (последняя точка совпадает с первой). */
export function fillRibbon(g: BufferGeometry, pts: readonly Vector3[], loop = false): void {
  const pos = g.getAttribute('position') as BufferAttribute;
  const tan = g.getAttribute('aTan') as BufferAttribute;
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const p = pts[i]!;
    const prev = pts[i > 0 ? i - 1 : loop ? n - 2 : 0]!;
    const next = pts[i < n - 1 ? i + 1 : loop ? 1 : n - 1]!;
    const tx = next.x - prev.x;
    const ty = next.y - prev.y;
    const tz = next.z - prev.z;
    const l = Math.hypot(tx, ty, tz) || 1;
    for (let k = 0; k < 2; k++) {
      pos.setXYZ(i * 2 + k, p.x, p.y, p.z);
      tan.setXYZ(i * 2 + k, tx / l, ty / l, tz / l);
    }
  }
  pos.needsUpdate = true;
  tan.needsUpdate = true;
  g.computeBoundingSphere();
}

function disposeMaterial(m: Material): void {
  for (const v of Object.values(m)) if (v instanceof Texture) v.dispose();
  if (m instanceof ShaderMaterial) {
    for (const u of Object.values(m.uniforms)) if (u.value instanceof Texture) u.value.dispose();
  }
  m.dispose();
}

/** Освобождает геометрии, материалы и их текстуры во всём поддереве. */
export function disposeTree(root: Object3D): void {
  root.traverse((o) => {
    const node = o as Object3D & { geometry?: BufferGeometry; material?: Material | Material[] };
    node.geometry?.dispose();
    const mat = node.material;
    if (Array.isArray(mat)) mat.forEach(disposeMaterial);
    else if (mat) disposeMaterial(mat);
    if (o instanceof InstancedMesh) o.dispose();
  });
}
