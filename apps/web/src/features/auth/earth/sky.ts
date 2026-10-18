/** Звёздное небо с мерцанием и редкие падающие звёзды. */
import { BufferAttribute, BufferGeometry, Color, Mesh, Points, Vector3 } from 'three';
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

const STAR_RADIUS = 90;
/** Падающая звезда рисуется в системе камеры на этой глубине. */
const METEOR_DEPTH = 60;
const METEOR_TIME = 0.9;

const STAR_VERT = /* glsl */ `
attribute float aSize;
attribute float aPhase;
attribute float aTw;
attribute vec3 aColor;
uniform float uTime;
uniform float uDpr;
varying vec3 vColor;
varying float vA;
void main() {
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  vA = 1.0 - aTw * (0.5 + 0.5 * sin(uTime * (0.6 + aPhase * 2.4) + aPhase * 37.0));
  vColor = aColor;
  gl_PointSize = aSize * uDpr;
}
`;

const STAR_FRAG = /* glsl */ `
varying vec3 vColor;
varying float vA;
${FX_GLSL}
void main() {
  vec2 q = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(q, q);
  float a = (exp(-r2 * 7.0) + exp(-r2 * 2.0) * 0.12) * vA;
  gl_FragColor = fxColor(vColor, a, 1.0);
}
`;

const METEOR_VERT = /* glsl */ `
attribute vec3 aTan;
attribute float aSide;
attribute float aT;
uniform float uHead;
varying float vT;
varying float vSide;
${RIBBON_GLSL}
void main() {
  vT = aT;
  vSide = aSide;
  float w = mix(0.4, 2.6, smoothstep(uHead - 0.5, uHead, aT));
  gl_Position = ribbonClip(position, aTan, aSide, w);
}
`;

const METEOR_FRAG = /* glsl */ `
uniform float uHead;
uniform float uAlpha;
varying float vT;
varying float vSide;
${FX_GLSL}
void main() {
  float k = clamp((vT - (uHead - 0.55)) / 0.55, 0.0, 1.0) * step(vT, uHead);
  float edge = 1.0 - smoothstep(0.25, 1.0, abs(vSide));
  gl_FragColor = fxColor(mix(vec3(0.65, 0.78, 1.0), vec3(1.0), k), k * k * edge * uAlpha, 1.0);
}
`;

export function createSky(ctx: SceneContext): ScenePart {
  const n = ctx.view.mobile ? 700 : 1400;
  const pos = new Float32Array(n * 3);
  const size = new Float32Array(n);
  const phase = new Float32Array(n);
  const tw = new Float32Array(n);
  const color = new Float32Array(n * 3);
  const v = new Vector3();
  const c = new Color();
  const tints = [new Color(0.72, 0.82, 1), new Color(1, 1, 1), new Color(1, 0.88, 0.72)];
  for (let i = 0; i < n; i++) {
    v.set(rand(-1, 1), rand(-1, 1), rand(-1, 1));
    if (v.lengthSq() > 1 || v.lengthSq() < 1e-4) {
      i--;
      continue;
    }
    v.normalize().multiplyScalar(STAR_RADIUS);
    pos.set([v.x, v.y, v.z], i * 3);
    // Большинство звёзд тусклые и мелкие, единицы — яркие
    const r = Math.random();
    const bright = r > 0.97 ? rand(0.9, 1.2) : r > 0.8 ? rand(0.55, 0.85) : rand(0.25, 0.55);
    size[i] = r > 0.97 ? rand(4, 5.5) : r > 0.8 ? rand(2.6, 3.6) : rand(1.6, 2.6);
    phase[i] = Math.random();
    tw[i] = Math.random() < 0.35 ? rand(0.3, 0.75) : rand(0, 0.15);
    c.copy(tints[Math.floor(Math.random() * tints.length)]!).multiplyScalar(bright);
    color.set([c.r, c.g, c.b], i * 3);
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(pos, 3));
  geo.setAttribute('aSize', new BufferAttribute(size, 1));
  geo.setAttribute('aPhase', new BufferAttribute(phase, 1));
  geo.setAttribute('aTw', new BufferAttribute(tw, 1));
  geo.setAttribute('aColor', new BufferAttribute(color, 3));
  const stars = new Points(
    geo,
    fxMaterial({
      vertexShader: STAR_VERT,
      fragmentShader: STAR_FRAG,
      uniforms: { uTime: ctx.uniforms.uTime, uDpr: ctx.uniforms.uDpr },
    }),
  );
  stars.frustumCulled = false;
  ctx.scene.add(stars);

  // Падающая звезда — отрезок 0…1 по оси X, положение и длина задаются трансформацией
  const meteorGeo = createRibbon(12);
  fillRibbon(
    meteorGeo,
    Array.from({ length: 12 }, (_, i) => new Vector3(i / 11, 0, 0)),
  );
  const head = { value: 0 };
  const alpha = { value: 0 };
  const meteor = new Mesh(
    meteorGeo,
    fxMaterial({
      vertexShader: METEOR_VERT,
      fragmentShader: METEOR_FRAG,
      uniforms: { uRes: ctx.uniforms.uRes, uDpr: ctx.uniforms.uDpr, uHead: head, uAlpha: alpha },
    }),
  );
  meteor.frustumCulled = false;
  meteor.visible = false;
  ctx.camera.add(meteor);

  let next = rand(2.5, 5);
  let born = -1;

  return {
    update(t) {
      if (born < 0 && t > next && !ctx.view.still) {
        const halfH = METEOR_DEPTH * Math.tan((ctx.camera.fov * Math.PI) / 360);
        const halfW = halfH * ctx.camera.aspect;
        meteor.position.set(rand(-0.8, 0.8) * halfW, rand(0.15, 0.9) * halfH, -METEOR_DEPTH);
        const ang = rand(0.25, 0.6);
        meteor.rotation.z = Math.random() < 0.5 ? Math.PI + ang : -ang;
        meteor.scale.set(halfH * rand(0.35, 0.55), 1, 1);
        meteor.visible = true;
        born = t;
      }
      if (born >= 0) {
        const k = (t - born) / METEOR_TIME;
        head.value = k * 1.55;
        alpha.value = Math.min(1, k * 6) * (1 - Math.max(0, (k - 0.7) / 0.3));
        if (k >= 1) {
          meteor.visible = false;
          born = -1;
          next = t + rand(3.5, 9);
        }
      }
    },
  };
}
