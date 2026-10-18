/**
 * Ракета: каждые 12–20 с стартует с космодрома, поднимается, ложится на курс
 * и летит к текущему положению Луны. Мерцающее пламя, дымный след из частиц,
 * вспышка при прибытии.
 */
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  DynamicDrawUsage,
  Group,
  LatheGeometry,
  Mesh,
  MeshLambertMaterial,
  Points,
  Vector2,
  Vector3,
} from 'three';
import { latLonToVec3, SPACEPORTS } from './cities';
import { clamp, FX_GLSL, fxMaterial, rand, type SceneContext, type ScenePart } from './core';
import { MOON_RADIUS, type Moon } from './moon';
import type { Palette } from './palette';

const POOL = 640;
const FLIGHT = 6.5;
const FLASH = 1.1;

const PARTICLE_VERT = /* glsl */ `
attribute vec3 aVel;
attribute float aBirth;
attribute float aLife;
attribute float aSize;
attribute vec3 aColor;
attribute float aAdd;
uniform float uTime;
uniform float uPxScale;
varying float vAge;
varying vec3 vColor;
varying float vAdd;
void main() {
  float tt = uTime - aBirth;
  float age = tt / aLife;
  if (age < 0.0 || age > 1.0) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    gl_PointSize = 0.0;
    return;
  }
  // Скорость гаснет со временем (сопротивление)
  vec3 p = position + aVel * (1.0 - exp(-tt * 1.4)) / 1.4;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  float grow = aAdd > 0.5 ? 1.0 - age * 0.6 : 0.5 + age * 1.7;
  gl_PointSize = clamp(aSize * grow * uPxScale / -mv.z, 1.0, 128.0);
  vAge = age;
  vColor = aColor;
  vAdd = aAdd;
}
`;

const PARTICLE_FRAG = /* glsl */ `
varying float vAge;
varying vec3 vColor;
varying float vAdd;
${FX_GLSL}
void main() {
  vec2 q = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(q, q);
  if (r2 > 1.0) discard;
  float shape = exp(-r2 * 3.2);
  float a = vAdd > 0.5
    ? 1.0 - vAge
    : smoothstep(0.0, 0.08, vAge) * pow(1.0 - vAge, 1.4) * 0.5;
  gl_FragColor = fxColor(vColor, shape * a, vAdd);
}
`;

const GLOW_VERT = /* glsl */ `
uniform float uSize;
uniform float uDpr;
void main() {
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = uSize * uDpr;
}
`;

const GLOW_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uAlpha;
${FX_GLSL}
void main() {
  vec2 q = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(q, q);
  float a = (exp(-r2 * 16.0) + exp(-r2 * 4.0) * 0.45) * uAlpha;
  gl_FragColor = fxColor(mix(uColor, vec3(1.0), exp(-r2 * 24.0)), a, 1.0);
}
`;

function glowPoint(ctx: SceneContext, color: Color) {
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(new Float32Array(3), 3));
  const mat = fxMaterial({
    vertexShader: GLOW_VERT,
    fragmentShader: GLOW_FRAG,
    uniforms: {
      uDpr: ctx.uniforms.uDpr,
      uSize: { value: 20 },
      uAlpha: { value: 1 },
      uColor: { value: color },
    },
  });
  const p = new Points(geo, mat);
  p.frustumCulled = false;
  p.renderOrder = 9;
  return { points: p, u: mat.uniforms };
}

export function createRocket(ctx: SceneContext, moon: Moon): ScenePart {
  // Пул частиц дыма и искр в мировых координатах
  const attr = (size: number) => {
    const a = new BufferAttribute(new Float32Array(POOL * size), size);
    a.setUsage(DynamicDrawUsage);
    return a;
  };
  const pPos = attr(3);
  const pVel = attr(3);
  const pBirth = attr(1);
  const pLife = attr(1);
  const pSize = attr(1);
  const pColor = attr(3);
  const pAdd = attr(1);
  for (let i = 0; i < POOL; i++) pBirth.setX(i, -1e4);
  const pGeo = new BufferGeometry();
  pGeo.setAttribute('position', pPos);
  pGeo.setAttribute('aVel', pVel);
  pGeo.setAttribute('aBirth', pBirth);
  pGeo.setAttribute('aLife', pLife);
  pGeo.setAttribute('aSize', pSize);
  pGeo.setAttribute('aColor', pColor);
  pGeo.setAttribute('aAdd', pAdd);
  const pAttrs = [pPos, pVel, pBirth, pLife, pSize, pColor, pAdd];
  const particles = new Points(
    pGeo,
    fxMaterial({
      vertexShader: PARTICLE_VERT,
      fragmentShader: PARTICLE_FRAG,
      uniforms: { uTime: ctx.uniforms.uTime, uPxScale: ctx.uniforms.uPxScale },
    }),
  );
  particles.frustumCulled = false;
  particles.renderOrder = 8;
  ctx.scene.add(particles);

  let head = 0;
  let dirty = false;
  const emit = (
    t: number,
    p: Vector3,
    v: Vector3,
    life: number,
    size: number,
    c: Color,
    add: number,
  ) => {
    const i = head;
    head = (head + 1) % POOL;
    pPos.setXYZ(i, p.x, p.y, p.z);
    pVel.setXYZ(i, v.x, v.y, v.z);
    pBirth.setX(i, t);
    pLife.setX(i, life);
    pSize.setX(i, size);
    pColor.setXYZ(i, c.r, c.g, c.b);
    pAdd.setX(i, add);
    dirty = true;
  };

  // Корпус — тело вращения, стабилизаторы — три треугольника
  const body = new Mesh(
    new LatheGeometry(
      [
        [0, -0.5],
        [0.075, -0.5],
        [0.09, -0.44],
        [0.09, 0.16],
        [0.078, 0.3],
        [0.042, 0.43],
        [0, 0.5],
      ].map(([x, y]) => new Vector2(x, y)),
      14,
    ),
    new MeshLambertMaterial({ color: 0xf4f6fa, emissive: 0x3a404c }),
  );
  const finPos: number[] = [];
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2;
    const c = Math.cos(a);
    const s = Math.sin(a);
    for (const [r, y] of [
      [0.08, -0.5],
      [0.22, -0.58],
      [0.08, -0.26],
    ] as const) {
      finPos.push(r * c, y, -r * s);
    }
  }
  const finGeo = new BufferGeometry();
  finGeo.setAttribute('position', new BufferAttribute(new Float32Array(finPos), 3));
  finGeo.computeVertexNormals();
  const fins = new Mesh(
    finGeo,
    new MeshLambertMaterial({ color: 0xd8473b, emissive: 0x301010, side: DoubleSide }),
  );
  const flameColor = ctx.palette.flame.clone();
  const flame = glowPoint(ctx, flameColor);
  flame.points.position.set(0, -0.62, 0);
  const rocket = new Group();
  rocket.add(body, fins, flame.points);
  rocket.visible = false;
  ctx.scene.add(rocket);

  // Вспышка у поверхности Луны — дочерний объект Луны, летит вместе с ней
  const flash = glowPoint(ctx, new Color(1, 0.95, 0.85));
  flash.points.visible = false;
  moon.moon.add(flash.points);

  const pads = SPACEPORTS.map(([, lat, lon]) => latLonToVec3(lat, lon));
  const smoke = new Color(0.82, 0.84, 0.88);
  const white = new Color(1, 1, 1);
  const p0 = new Vector3();
  const p1 = new Vector3();
  const p2 = new Vector3();
  const p3 = new Vector3();
  const pos = new Vector3();
  const dir = new Vector3();
  const nozzle = new Vector3();
  const prevNozzle = new Vector3();
  const moonW = new Vector3();
  const prevMoonW = new Vector3();
  const moonVel = new Vector3();
  const tmp = new Vector3();
  const vel = new Vector3();
  const camDir = new Vector3();
  const yAxis = new Vector3(0, 1, 0);

  let launchAt = 2;
  let t0 = -1;
  let flashAt = -1;
  let acc = 0;
  let sparkAcc = 0;

  /** Космодром, обращённый и к Луне, и к камере. */
  function launch(t: number): boolean {
    moon.moon.getWorldPosition(moonW);
    camDir.copy(ctx.camera.position).normalize();
    const moonDir = tmp.copy(moonW).normalize();
    if (moonDir.dot(camDir) < -0.35) return false;
    let best = -Infinity;
    for (const pad of pads) {
      pos.copy(pad).applyMatrix4(ctx.spin.matrixWorld);
      const score = pos.dot(moonDir) + pos.dot(camDir) * 0.8 + rand(0, 0.4);
      if (score > best) {
        best = score;
        p0.copy(pos);
      }
    }
    t0 = t;
    acc = 0;
    prevNozzle.copy(p0);
    rocket.visible = true;
    return true;
  }

  function randomUnit(out: Vector3) {
    return out.set(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize();
  }

  return {
    update(t, dt) {
      moon.moon.getWorldPosition(moonW);
      if (dt > 0) moonVel.copy(moonW).sub(prevMoonW).divideScalar(dt);
      prevMoonW.copy(moonW);

      if (t0 < 0 && t > launchAt && !launch(t)) launchAt = t + 1;

      if (t0 >= 0) {
        const tau = (t - t0) / FLIGHT;
        const u = Math.pow(Math.min(tau, 1), 1.45);
        // Кубическая кривая Безье: вертикальный подъём → разворот → Луна
        p1.copy(p0).multiplyScalar(1.6);
        p2.copy(p1).add(moonW).multiplyScalar(0.5);
        const ml = p2.length();
        if (ml > 0.3) p2.multiplyScalar((ml + 0.5) / ml);
        p3.copy(p2)
          .sub(moonW)
          .normalize()
          .multiplyScalar(MOON_RADIUS * 0.95)
          .add(moonW);
        const v = 1 - u;
        pos
          .copy(p0)
          .multiplyScalar(v * v * v)
          .addScaledVector(p1, 3 * v * v * u)
          .addScaledVector(p2, 3 * v * u * u)
          .addScaledVector(p3, u * u * u);
        const r = pos.length();
        if (r < 1.03) pos.multiplyScalar(1.03 / r);
        dir
          .subVectors(p1, p0)
          .multiplyScalar(3 * v * v)
          .addScaledVector(tmp.subVectors(p2, p1), 6 * v * u)
          .addScaledVector(tmp.subVectors(p3, p2), 3 * u * u)
          .normalize();
        const len = clamp(17 / Math.max(ctx.view.pxPerUnit, 1), 0.07, 0.17);
        rocket.position.copy(pos);
        rocket.quaternion.setFromUnitVectors(yAxis, dir);
        rocket.scale.setScalar(len);
        flame.u.uSize!.value = (ctx.view.mobile ? 16 : 20) * rand(0.75, 1.15);

        // Дым и искры вдоль пути от прошлого положения сопла
        nozzle.copy(pos).addScaledVector(dir, -len * 0.6);
        const near = tau < 0.16;
        acc += (near ? 120 : 60) * dt;
        const count = Math.floor(acc);
        acc -= count;
        for (let k = 0; k < count; k++) {
          tmp.lerpVectors(prevNozzle, nozzle, (k + 1) / count);
          randomUnit(vel).multiplyScalar(near ? 0.06 : 0.03);
          if (near) vel.addScaledVector(p0, 0.02);
          emit(t, tmp, vel, rand(1.8, 2.8), near ? rand(0.06, 0.09) : rand(0.035, 0.055), smoke, 0);
        }
        sparkAcc += 70 * dt;
        const sparks = Math.floor(sparkAcc);
        sparkAcc -= sparks;
        for (let k = 0; k < sparks; k++) {
          randomUnit(vel).multiplyScalar(0.06).addScaledVector(dir, -0.35);
          emit(t, nozzle, vel, rand(0.18, 0.32), 0.03, flameColor, 1);
        }
        prevNozzle.copy(nozzle);

        if (tau >= 1) {
          // Прибытие: вспышка и сноп искр, следующий старт через 12–20 с от предыдущего
          rocket.visible = false;
          flashAt = t;
          // Центр вспышки чуть над поверхностью, чтобы спрайт не прятался за Луной
          tmp
            .subVectors(p3, moonW)
            .normalize()
            .multiplyScalar(MOON_RADIUS * 0.7)
            .add(p3);
          moon.moon.worldToLocal(flash.points.position.copy(tmp));
          flash.points.visible = true;
          for (let k = 0; k < 28; k++) {
            randomUnit(vel).multiplyScalar(rand(0.15, 0.4)).add(moonVel);
            emit(t, p3, vel, rand(0.4, 0.8), 0.04, k % 2 ? flameColor : white, 1);
          }
          launchAt = t0 + rand(12, 20);
          t0 = -1;
        }
      }

      if (flashAt >= 0) {
        const k = (t - flashAt) / FLASH;
        flash.u.uSize!.value = 16 + 90 * Math.sqrt(Math.min(k, 1));
        flash.u.uAlpha!.value = Math.max(0, 1 - k) ** 1.5;
        if (k >= 1) {
          flashAt = -1;
          flash.points.visible = false;
        }
      }
      if (dirty) {
        for (const a of pAttrs) a.needsUpdate = true;
        dirty = false;
      }
    },
    setPalette(p: Palette) {
      flameColor.copy(p.flame);
    },
  };
}
