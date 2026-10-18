/**
 * Зелёные точки «люди на связи»: вспыхивают в случайных городах, пульсируют
 * расходящимся кольцом и гаснут. Все точки — один вызов отрисовки.
 * Иногда между двумя горящими точками пробегает дуга «соединения».
 */
import {
  BufferAttribute,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  Vector3,
  type ShaderMaterial,
} from 'three';
import { CITIES, latLonToVec3 } from './cities';
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

/** Точки чуть выше поверхности — без z-конфликта с глобусом. */
const DOT_ALT = 1.006;
const ARC_POINTS = 48;
const ARC_COUNT = 3;

const DOT_VERT = /* glsl */ `
attribute vec3 aDir;
attribute float aStart;
attribute float aDur;
attribute float aSeed;
uniform float uTime;
uniform float uSize;
varying vec2 vQ;
varying float vAge;
varying float vFade;
varying float vSeed;
void main() {
  float life = (uTime - aStart) / aDur;
  if (life < 0.0 || life > 1.0) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  // Квадрат лежит в касательной плоскости к сфере
  vec3 n = normalize(aDir);
  vec3 t = normalize(cross(abs(n.y) > 0.99 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0), n));
  vec3 b = cross(n, t);
  vec3 p = n * ${DOT_ALT.toFixed(3)} + (t * position.x + b * position.y) * uSize;
  vec4 wp = modelMatrix * vec4(p, 1.0);
  vec3 wn = normalize(mat3(modelMatrix) * n);
  float facing = dot(wn, normalize(cameraPosition - wp.xyz));
  vFade = smoothstep(0.0, 0.22, facing) * smoothstep(0.0, 0.1, life) * (1.0 - smoothstep(0.75, 1.0, life));
  vQ = position.xy;
  vAge = uTime - aStart;
  vSeed = aSeed;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const DOT_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uCore;
varying vec2 vQ;
varying float vAge;
varying float vFade;
varying float vSeed;
${FX_GLSL}
void main() {
  float r = length(vQ);
  if (r > 1.0) discard;
  // Ядро слегка «дышит», вокруг — мягкий ореол
  float core = uCore * (1.0 + 0.14 * sin(vAge * 5.0 + vSeed * 6.283));
  float disc = 1.0 - smoothstep(core * 0.72, core, r);
  float hot = 1.0 - smoothstep(0.0, core * 0.65, r);
  float halo = exp(-pow(r / (core * 2.2), 2.0)) * 0.5;
  // Расходящееся и гаснущее кольцо
  float ph = fract(vAge / 1.7);
  float rr = mix(core, 0.95, ph);
  float w = 0.04 + 0.05 * ph;
  float ring = (1.0 - smoothstep(w * 0.35, w, abs(r - rr))) * pow(1.0 - ph, 1.2);
  float a = clamp(max(disc, halo) + ring * 0.9, 0.0, 1.0) * vFade;
  vec3 col = mix(uColor * (1.0 + 0.25 * disc), vec3(1.0), hot * 0.65);
  gl_FragColor = fxColor(col, a, 0.2);
}
`;

const ARC_VERT = /* glsl */ `
attribute vec3 aTan;
attribute float aSide;
attribute float aT;
uniform float uProg;
varying float vT;
varying float vSide;
${RIBBON_GLSL}
void main() {
  vT = aT;
  vSide = aSide;
  float head = exp(-pow((aT - uProg) * 9.0, 2.0));
  gl_Position = ribbonClip(position, aTan, aSide, 2.0 + 2.5 * head);
}
`;

const ARC_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uProg;
uniform float uAlpha;
varying float vT;
varying float vSide;
${FX_GLSL}
void main() {
  float drawn = 1.0 - smoothstep(uProg - 0.02, uProg + 0.02, vT);
  float head = exp(-pow((vT - uProg) * 10.0, 2.0));
  float edge = 1.0 - smoothstep(0.3, 1.0, abs(vSide));
  float a = (drawn * 0.42 + head * 0.95) * edge * uAlpha;
  gl_FragColor = fxColor(mix(uColor, vec3(1.0), 0.25 + head * 0.5), a, 0.6);
}
`;

interface Dot {
  dir: Vector3;
  start: number;
  dur: number;
}

interface Arc {
  mesh: Mesh;
  mat: ShaderMaterial;
  pts: Vector3[];
  born: number;
  active: boolean;
}

export interface Dots extends ScenePart {
  /** Принудительно зажечь часть точек (для статичного кадра). */
  lightUp(t: number, share: number): void;
}

export function createDots(ctx: SceneContext): Dots {
  const n = CITIES.length;
  const dots: Dot[] = CITIES.map(([, lat, lon]) => ({
    dir: latLonToVec3(lat, lon),
    start: 0,
    dur: 1,
  }));

  // Квадрат −1…1 + атрибуты экземпляров
  const geo = new InstancedBufferGeometry();
  geo.setAttribute(
    'position',
    new BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3),
  );
  geo.setIndex([0, 1, 2, 0, 2, 3]);
  const aDir = new InstancedBufferAttribute(new Float32Array(n * 3), 3);
  const aStart = new InstancedBufferAttribute(new Float32Array(n), 1);
  const aDur = new InstancedBufferAttribute(new Float32Array(n), 1);
  const aSeed = new InstancedBufferAttribute(new Float32Array(n), 1);
  dots.forEach((d, i) => {
    aDir.setXYZ(i, d.dir.x, d.dir.y, d.dir.z);
    aSeed.setX(i, Math.random());
  });
  geo.setAttribute('aDir', aDir);
  geo.setAttribute('aStart', aStart);
  geo.setAttribute('aDur', aDur);
  geo.setAttribute('aSeed', aSeed);
  geo.instanceCount = n;

  const color = { value: ctx.palette.dot.clone() };
  const size = { value: 0.1 };
  const mat = fxMaterial({
    vertexShader: DOT_VERT,
    fragmentShader: DOT_FRAG,
    uniforms: { uTime: ctx.uniforms.uTime, uSize: size, uColor: color, uCore: { value: 0.24 } },
  });
  const mesh = new Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 3;
  ctx.spin.add(mesh);

  const schedule = (d: Dot, i: number, start: number) => {
    d.start = start;
    d.dur = rand(2.8, 5.5);
    aStart.setX(i, d.start);
    aDur.setX(i, d.dur);
  };
  // Старт: около трети точек уже горят
  dots.forEach((d, i) => {
    if (Math.random() < 0.34) {
      schedule(d, i, 0);
      d.start = -rand(0, d.dur * 0.7);
      aStart.setX(i, d.start);
    } else schedule(d, i, rand(0.2, 8));
  });

  // Дуги-соединения
  const arcColor = { value: ctx.palette.dot.clone() };
  const arcs: Arc[] = [];
  for (let i = 0; i < ARC_COUNT; i++) {
    const am = fxMaterial({
      vertexShader: ARC_VERT,
      fragmentShader: ARC_FRAG,
      uniforms: {
        uRes: ctx.uniforms.uRes,
        uDpr: ctx.uniforms.uDpr,
        uColor: arcColor,
        uProg: { value: 0 },
        uAlpha: { value: 0 },
      },
    });
    const m = new Mesh(createRibbon(ARC_POINTS), am);
    m.renderOrder = 4;
    m.visible = false;
    m.frustumCulled = false;
    ctx.spin.add(m);
    const pts = Array.from({ length: ARC_POINTS }, () => new Vector3());
    arcs.push({ mesh: m, mat: am, pts, born: 0, active: false });
  }

  const tmp = new Vector3();
  const camDir = new Vector3();
  const candidates: number[] = [];
  let nextArc = 1.5;

  const isLit = (d: Dot, t: number) => t > d.start + 0.4 && t < d.start + d.dur * 0.6;

  function spawnArc(arc: Arc, t: number): boolean {
    camDir.copy(ctx.camera.position).normalize();
    candidates.length = 0;
    dots.forEach((d, i) => {
      if (!isLit(d, t)) return;
      tmp.copy(d.dir).applyMatrix4(ctx.spin.matrixWorld);
      if (tmp.dot(camDir) > 0.3) candidates.push(i);
    });
    if (candidates.length < 2) return false;
    for (let attempt = 0; attempt < 10; attempt++) {
      const a = dots[candidates[Math.floor(Math.random() * candidates.length)]!]!;
      const b = dots[candidates[Math.floor(Math.random() * candidates.length)]!]!;
      const ang = a.dir.angleTo(b.dir);
      if (ang < 0.2 || ang > 1.1) continue;
      // Дуга большого круга, приподнятая над поверхностью
      const s = Math.sin(ang);
      const lift = 0.05 + ang * 0.16;
      arc.pts.forEach((p, i) => {
        const f = i / (ARC_POINTS - 1);
        const ka = Math.sin((1 - f) * ang) / s;
        const kb = Math.sin(f * ang) / s;
        p.copy(a.dir)
          .multiplyScalar(ka)
          .addScaledVector(b.dir, kb)
          .multiplyScalar(DOT_ALT + lift * Math.sin(Math.PI * f));
      });
      fillRibbon(arc.mesh.geometry, arc.pts);
      arc.born = t;
      arc.active = true;
      arc.mesh.visible = true;
      return true;
    }
    return false;
  }

  return {
    update(t) {
      let changed = false;
      for (let i = 0; i < n; i++) {
        const d = dots[i]!;
        if (t > d.start + d.dur) {
          schedule(d, i, t + rand(4, 11));
          changed = true;
        }
      }
      if (changed) {
        aStart.needsUpdate = true;
        aDur.needsUpdate = true;
      }
      // Размер в пикселях почти постоянный: на телефоне точки не теряются
      const ringPx = ctx.view.mobile ? 13 : 15;
      size.value = Math.min(0.2, ringPx / Math.max(ctx.view.pxPerUnit, 1));

      if (t > nextArc) {
        let free: Arc | undefined;
        for (const a of arcs) if (!a.active) free = a;
        nextArc = t + (free && spawnArc(free, t) ? rand(1.6, 3.4) : 0.5);
      }
      for (const arc of arcs) {
        if (!arc.active) continue;
        const age = t - arc.born;
        const u = arc.mat.uniforms;
        u.uProg!.value = Math.min(age / 1.1, 1.15);
        u.uAlpha!.value = Math.min(1, age / 0.2) * (1 - Math.max(0, (age - 2.4) / 0.8));
        if (age > 3.2) {
          arc.active = false;
          arc.mesh.visible = false;
        }
      }
    },
    lightUp(t, share) {
      dots.forEach((d, i) => {
        if (Math.random() < share) {
          d.dur = 6;
          d.start = t - rand(0.6, 2.4);
        } else d.start = t + 5;
        aStart.setX(i, d.start);
        aDur.setX(i, d.dur);
      });
      aStart.needsUpdate = true;
      aDur.needsUpdate = true;
    },
    setPalette(p: Palette) {
      color.value.copy(p.dot);
      arcColor.value.copy(p.dot);
    },
  };
}
