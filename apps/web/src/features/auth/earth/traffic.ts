/**
 * Движение вокруг Земли: самолёты по дугам большого круга между городами
 * (с инверсионным следом и проблесковым огнём) и спутники на низких орбитах.
 */
import {
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  DynamicDrawUsage,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshLambertMaterial,
  Points,
  Vector3,
  type ShaderMaterial,
} from 'three';
import { CITIES, latLonToVec3 } from './cities';
import {
  clamp,
  createRibbon,
  fillRibbon,
  FLIGHT_ALT_GLSL,
  flightAlt,
  FX_GLSL,
  fxMaterial,
  rand,
  RIBBON_GLSL,
  smoothstep,
  type SceneContext,
  type ScenePart,
} from './core';

const MAX_PLANES = 6;
/** Угловая скорость самолёта, рад/с. */
const PLANE_SPEED = 0.11;
const CONTRAIL_POINTS = 28;
const CONTRAIL_LEN = 0.3;

const CONTRAIL_VERT = /* glsl */ `
attribute float aSide;
attribute float aT;
uniform vec3 uA;
uniform vec3 uB;
uniform float uTheta;
uniform float uOmega;
uniform vec3 uSunDir;
varying float vA;
varying float vSide;
${FLIGHT_ALT_GLSL}
${RIBBON_GLSL}
void main() {
  // След строится прямо в шейдере по дуге маршрута — без обновления буферов
  float th = uTheta - aT * ${CONTRAIL_LEN.toFixed(2)};
  vA = step(0.0, th) * pow(1.0 - aT, 1.6);
  th = max(th, 0.0);
  vec3 dir = uA * cos(th) + uB * sin(th);
  vec3 tang = -uA * sin(th) + uB * cos(th);
  float sun = dot(normalize(mat3(modelMatrix) * dir), uSunDir);
  vA *= 0.3 + 0.7 * smoothstep(-0.2, 0.3, sun);
  vSide = aSide;
  // aT растёт назад по маршруту — касательная тоже назад, иначе лента развернётся изнанкой
  gl_Position = ribbonClip(dir * flightAlt(th / uOmega), -tang, aSide, 2.0 + aT * 2.6);
}
`;

const CONTRAIL_FRAG = /* glsl */ `
uniform float uOpacity;
varying float vA;
varying float vSide;
${FX_GLSL}
void main() {
  float edge = 1.0 - smoothstep(0.2, 1.0, abs(vSide));
  gl_FragColor = fxColor(vec3(1.0), vA * edge * 0.9 * uOpacity, 0.45);
}
`;

const BEACON_VERT = /* glsl */ `
attribute float aPhase;
attribute float aOn;
uniform float uTime;
uniform float uDpr;
varying float vFlash;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  float s = fract(uTime * 1.15 + aPhase);
  float d = min(s, 1.0 - s);
  vFlash = (exp(-pow(d * 16.0, 2.0)) + 0.18) * aOn;
  gl_PointSize = 10.0 * uDpr * aOn;
}
`;

const BEACON_FRAG = /* glsl */ `
varying float vFlash;
${FX_GLSL}
void main() {
  vec2 q = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(q, q);
  float a = (exp(-r2 * 14.0) + exp(-r2 * 4.0) * 0.35) * vFlash;
  gl_FragColor = fxColor(mix(vec3(1.0, 0.3, 0.25), vec3(1.0), exp(-r2 * 30.0)), a, 1.0);
}
`;

const SAT_TRAIL_VERT = /* glsl */ `
attribute vec3 aTan;
attribute float aSide;
attribute float aT;
varying float vT;
varying float vSide;
${RIBBON_GLSL}
void main() {
  vT = aT;
  vSide = aSide;
  gl_Position = ribbonClip(position, aTan, aSide, 1.8);
}
`;

const SAT_TRAIL_FRAG = /* glsl */ `
varying float vT;
varying float vSide;
${FX_GLSL}
void main() {
  float edge = 1.0 - smoothstep(0.2, 1.0, abs(vSide));
  gl_FragColor = fxColor(vec3(0.75, 0.86, 1.0), pow(1.0 - vT, 2.0) * edge * 0.5, 0.8);
}
`;

const SAT_HEAD_VERT = /* glsl */ `
uniform float uTime;
uniform float uDpr;
varying float vTw;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  vTw = 0.8 + 0.2 * sin(uTime * 9.0 + position.x * 3.0);
  gl_PointSize = 9.0 * uDpr;
}
`;

const SAT_HEAD_FRAG = /* glsl */ `
varying float vTw;
${FX_GLSL}
void main() {
  vec2 q = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(q, q);
  float a = (exp(-r2 * 22.0) + exp(-r2 * 5.0) * 0.4) * vTw;
  gl_FragColor = fxColor(mix(vec3(0.7, 0.85, 1.0), vec3(1.0), exp(-r2 * 30.0)), a, 1.0);
}
`;

/** Низкополигональный самолёт: нос по +X, верх по +Y, крылья вдоль Z, длина 2. */
function planeGeometry(): BufferGeometry {
  const nose = [1, 0, 0];
  const tail = [-0.92, 0.04, 0];
  const up = [0.25, 0.12, 0];
  const down = [0.25, -0.1, 0];
  const left = [0.25, 0, 0.12];
  const right = [0.25, 0, -0.12];
  const tris = [
    [nose, up, left],
    [nose, left, down],
    [nose, down, right],
    [nose, right, up],
    [tail, left, up],
    [tail, down, left],
    [tail, right, down],
    [tail, up, right],
    // Стреловидные крылья
    [
      [0.32, 0, 0],
      [-0.3, 0, 1],
      [-0.12, 0, 0],
    ],
    [
      [0.32, 0, 0],
      [-0.12, 0, 0],
      [-0.3, 0, -1],
    ],
    // Стабилизатор и киль
    [
      [-0.62, 0, 0],
      [-0.96, 0, 0.42],
      [-0.88, 0, 0],
    ],
    [
      [-0.62, 0, 0],
      [-0.88, 0, 0],
      [-0.96, 0, -0.42],
    ],
    [
      [-0.6, 0.03, 0],
      [-0.98, 0.42, 0],
      [-0.9, 0.03, 0],
    ],
  ];
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(tris.flat(2)), 3));
  g.computeVertexNormals();
  return g;
}

interface Flight {
  active: boolean;
  a: Vector3;
  b: Vector3;
  omega: number;
  theta: number;
  /** Время посадки (след ещё догорает), −1 — в полёте. */
  landed: number;
  trail: Mesh;
  mat: ShaderMaterial;
}

export function createTraffic(ctx: SceneContext): ScenePart {
  const cities = CITIES.map(([, lat, lon]) => latLonToVec3(lat, lon));

  // Самолёты: один InstancedMesh на все
  const planes = new InstancedMesh(
    planeGeometry(),
    new MeshLambertMaterial({ color: 0xf3f6fb, emissive: 0x2b3240, side: DoubleSide }),
    MAX_PLANES,
  );
  planes.instanceMatrix.setUsage(DynamicDrawUsage);
  planes.frustumCulled = false;
  ctx.spin.add(planes);

  const beaconPos = new BufferAttribute(new Float32Array(MAX_PLANES * 3), 3);
  beaconPos.setUsage(DynamicDrawUsage);
  const beaconOn = new BufferAttribute(new Float32Array(MAX_PLANES), 1);
  beaconOn.setUsage(DynamicDrawUsage);
  const beaconGeo = new BufferGeometry();
  beaconGeo.setAttribute('position', beaconPos);
  beaconGeo.setAttribute('aOn', beaconOn);
  beaconGeo.setAttribute(
    'aPhase',
    new BufferAttribute(
      Float32Array.from({ length: MAX_PLANES }, () => Math.random()),
      1,
    ),
  );
  const beacons = new Points(
    beaconGeo,
    fxMaterial({
      vertexShader: BEACON_VERT,
      fragmentShader: BEACON_FRAG,
      uniforms: { uTime: ctx.uniforms.uTime, uDpr: ctx.uniforms.uDpr },
    }),
  );
  beacons.frustumCulled = false;
  beacons.renderOrder = 6;
  ctx.spin.add(beacons);

  const trailGeo = createRibbon(CONTRAIL_POINTS, false);
  const sun = { value: ctx.sunDir };
  const flights: Flight[] = Array.from({ length: MAX_PLANES }, () => {
    const mat = fxMaterial({
      vertexShader: CONTRAIL_VERT,
      fragmentShader: CONTRAIL_FRAG,
      uniforms: {
        uRes: ctx.uniforms.uRes,
        uDpr: ctx.uniforms.uDpr,
        uSunDir: sun,
        uA: { value: new Vector3() },
        uB: { value: new Vector3() },
        uTheta: { value: 0 },
        uOmega: { value: 1 },
        uOpacity: { value: 1 },
      },
    });
    const trail = new Mesh(trailGeo, mat);
    trail.frustumCulled = false;
    trail.renderOrder = 5;
    trail.visible = false;
    ctx.spin.add(trail);
    return {
      active: false,
      a: new Vector3(),
      b: new Vector3(),
      omega: 1,
      theta: 0,
      landed: -1,
      trail,
      mat,
    };
  });

  const m = new Matrix4();
  const zero = new Matrix4().makeScale(0, 0, 0);
  const pos = new Vector3();
  const fwd = new Vector3();
  const upv = new Vector3();
  const side = new Vector3();
  const tmp = new Vector3();
  const camDir = new Vector3();
  for (let i = 0; i < MAX_PLANES; i++) planes.setMatrixAt(i, zero);

  /** Маршрут, середина которого видна с камеры (с долей случайности). */
  function launch(f: Flight, progress: number): boolean {
    camDir.copy(ctx.camera.position).normalize();
    let best = -Infinity;
    let from: Vector3 | null = null;
    let to: Vector3 | null = null;
    for (let k = 0; k < 16; k++) {
      const a = cities[Math.floor(Math.random() * cities.length)]!;
      const b = cities[Math.floor(Math.random() * cities.length)]!;
      const ang = a.angleTo(b);
      if (ang < 0.45 || ang > 1.5) continue;
      const s = Math.sin(ang);
      tmp
        .copy(a)
        .multiplyScalar(Math.sin(0.45 * ang) / s)
        .addScaledVector(b, Math.sin(0.55 * ang) / s)
        .applyMatrix4(ctx.spin.matrixWorld);
      const score = tmp.dot(camDir) + rand(0, 0.35);
      if (score > best) {
        best = score;
        from = a;
        to = b;
      }
    }
    if (!from || !to || best < 0.25) return false;
    f.a.copy(from);
    f.b.copy(to).addScaledVector(from, -from.dot(to)).normalize();
    f.omega = from.angleTo(to);
    f.theta = f.omega * progress;
    f.landed = -1;
    f.active = true;
    const u = f.mat.uniforms;
    (u.uA!.value as Vector3).copy(f.a);
    (u.uB!.value as Vector3).copy(f.b);
    u.uOmega!.value = f.omega;
    u.uOpacity!.value = 1;
    f.trail.visible = true;
    return true;
  }

  let target = Math.round(rand(3, 6));
  let nextSpawn = 0;
  let started = false;

  // Спутники: общая геометрия единичного радиуса, орбита задаётся масштабом
  const sats = ctx.view.mobile ? 2 : 3;
  const satTrailPts = Array.from({ length: 24 }, (_, i) => {
    const s = (i / 23) * 0.6;
    return new Vector3(Math.cos(s), 0, Math.sin(s));
  });
  const satTrailGeo = createRibbon(satTrailPts.length);
  fillRibbon(satTrailGeo, satTrailPts);
  const satTrailMat = fxMaterial({
    vertexShader: SAT_TRAIL_VERT,
    fragmentShader: SAT_TRAIL_FRAG,
    uniforms: { uRes: ctx.uniforms.uRes, uDpr: ctx.uniforms.uDpr },
  });
  const satHeadGeo = new BufferGeometry();
  satHeadGeo.setAttribute('position', new BufferAttribute(new Float32Array([1, 0, 0]), 3));
  const satHeadMat = fxMaterial({
    vertexShader: SAT_HEAD_VERT,
    fragmentShader: SAT_HEAD_FRAG,
    uniforms: { uTime: ctx.uniforms.uTime, uDpr: ctx.uniforms.uDpr },
  });
  const orbits = [
    { r: 1.2, period: 19, incl: 0.9, node: 0.4, phase: 0.3 },
    { r: 1.3, period: 27, incl: 1.7, node: 2.1, phase: 2.2 },
    { r: 1.25, period: 23, incl: 0.45, node: 4.2, phase: 4.4 },
  ].slice(0, sats);
  const pivots = orbits.map((o) => {
    const plane = new Group();
    plane.rotation.set(o.incl, o.node, 0, 'YXZ');
    const pivot = new Group();
    pivot.scale.setScalar(o.r);
    const trail = new Mesh(satTrailGeo, satTrailMat);
    trail.renderOrder = 7;
    trail.frustumCulled = false;
    const head = new Points(satHeadGeo, satHeadMat);
    head.renderOrder = 7;
    head.frustumCulled = false;
    pivot.add(trail, head);
    plane.add(pivot);
    ctx.tilt.add(plane);
    return pivot;
  });

  return {
    update(t, dt) {
      // Пара самолётов уже в воздухе с первого кадра
      if (!started && ctx.view.pxPerUnit > 0) {
        started = true;
        let launched = 0;
        for (const f of flights) if (launched < 3 && launch(f, rand(0.15, 0.55))) launched++;
        nextSpawn = t + rand(1, 3);
      }
      let active = 0;
      for (const f of flights) if (f.active) active++;
      if (t > nextSpawn && active < target) {
        for (const f of flights) {
          if (!f.active) {
            launch(f, 0);
            break;
          }
        }
        nextSpawn = t + rand(1.2, 3.5);
        target = Math.round(rand(3, 6));
      }

      const len = clamp(12 / Math.max(ctx.view.pxPerUnit, 1), 0.035, 0.12) / 2;
      for (let i = 0; i < MAX_PLANES; i++) {
        const f = flights[i]!;
        if (!f.active) continue;
        const u = f.mat.uniforms;
        if (f.landed >= 0) {
          // След догорает после посадки
          const k = 1 - (t - f.landed) / 0.8;
          u.uOpacity!.value = Math.max(0, k);
          if (k <= 0) {
            f.active = false;
            f.trail.visible = false;
          }
          continue;
        }
        f.theta = Math.min(f.theta + PLANE_SPEED * dt, f.omega);
        u.uTheta!.value = f.theta;
        const fr = f.theta / f.omega;
        const c = Math.cos(f.theta);
        const s = Math.sin(f.theta);
        pos.copy(f.a).multiplyScalar(c).addScaledVector(f.b, s);
        fwd.copy(f.a).multiplyScalar(-s).addScaledVector(f.b, c);
        upv.copy(pos);
        side.crossVectors(fwd, upv);
        pos.multiplyScalar(flightAlt(fr));
        const k = len * smoothstep(0, 0.04, fr) * (1 - smoothstep(0.96, 1, fr));
        m.makeBasis(fwd, upv, side)
          .scale(tmp.set(k, k, k))
          .setPosition(pos);
        planes.setMatrixAt(i, m);
        tmp
          .copy(upv)
          .multiplyScalar(0.012 + len * 0.15)
          .add(pos);
        beaconPos.setXYZ(i, tmp.x, tmp.y, tmp.z);
        beaconOn.setX(i, k > 0 ? 1 : 0);
        if (fr >= 1) {
          f.landed = t;
          planes.setMatrixAt(i, zero);
          beaconOn.setX(i, 0);
        }
      }
      planes.instanceMatrix.needsUpdate = true;
      beaconPos.needsUpdate = true;
      beaconOn.needsUpdate = true;

      for (let i = 0; i < pivots.length; i++) {
        const o = orbits[i]!;
        pivots[i]!.rotation.y = o.phase + (t / o.period) * Math.PI * 2;
      }
    },
  };
}
