/**
 * Земля: дневная текстура с рельефом, блик только на воде, огни городов
 * на ночной стороне, отдельный слой облаков и свечение атмосферы.
 */
import {
  BackSide,
  DataTexture,
  Mesh,
  RepeatWrapping,
  ShaderMaterial,
  SphereGeometry,
  SRGBColorSpace,
  TextureLoader,
  Vector2,
  type Texture,
  type WebGLRenderer,
} from 'three';
import { FX_GLSL, fxMaterial, type SceneContext, type ScenePart } from './core';
import type { Palette } from './palette';

const BASE = `${import.meta.env.BASE_URL}earth/`;
/** Оборот Земли за 120 с. */
const EARTH_SPEED = (Math.PI * 2) / 120;
/** Облака обгоняют поверхность: лишний оборот за 600 с. */
const CLOUD_DRIFT = (Math.PI * 2) / 600;
/** Стартовый поворот: к камере обращена долгота ≈ 50° в. д. */
const SPIN0 = -Math.PI / 2 - (50 * Math.PI) / 180;

const SURFACE_VERT = /* glsl */ `
varying vec2 vUv;
varying vec3 vNormalW;
varying vec3 vEastW;
varying vec3 vNorthW;
varying vec3 vPosW;
void main() {
  vUv = uv;
  vec3 n = normalize(normal);
  // Касательный базис сферы: восток (+u) и север (+v)
  vec3 east = cross(vec3(0.0, 1.0, 0.0), n);
  float el = length(east);
  east = el > 1e-4 ? east / el : vec3(1.0, 0.0, 0.0);
  mat3 m = mat3(modelMatrix);
  vNormalW = normalize(m * n);
  vEastW = m * east;
  vNorthW = m * cross(n, east);
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vPosW = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const EARTH_FRAG = /* glsl */ `
uniform sampler2D uDay;
uniform sampler2D uNight;
uniform sampler2D uBump;
uniform sampler2D uWater;
uniform sampler2D uClouds;
uniform vec3 uSunDir;
uniform vec3 uAtmo;
uniform vec2 uTexel;
uniform float uBumpScale;
uniform float uCloudShift;
uniform float uCloudAmt;
varying vec2 vUv;
varying vec3 vNormalW;
varying vec3 vEastW;
varying vec3 vNorthW;
varying vec3 vPosW;

void main() {
  vec3 n0 = normalize(vNormalW);
  vec3 L = normalize(uSunDir);
  vec3 V = normalize(cameraPosition - vPosW);
  float water = texture2D(uWater, vUv).r;

  // Рельеф по карте высот, только на суше
  float hl = texture2D(uBump, vUv - vec2(uTexel.x, 0.0)).r;
  float hr = texture2D(uBump, vUv + vec2(uTexel.x, 0.0)).r;
  float hd = texture2D(uBump, vUv - vec2(0.0, uTexel.y)).r;
  float hu = texture2D(uBump, vUv + vec2(0.0, uTexel.y)).r;
  vec3 grad = (hr - hl) * normalize(vEastW) + (hu - hd) * normalize(vNorthW);
  vec3 n = normalize(n0 - uBumpScale * (1.0 - water) * grad);

  float sun = dot(n0, L);
  float diff = max(dot(n, L), 0.0);
  float cloud = texture2D(uClouds, vUv + vec2(uCloudShift, 0.0)).r * uCloudAmt;

  // День: мягкий терминатор с тёплыми сумерками, тени облаков
  vec3 albedo = texture2D(uDay, vUv).rgb;
  vec3 dusk = mix(vec3(1.0, 0.6, 0.4), vec3(1.0), smoothstep(0.0, 0.3, sun));
  vec3 col = albedo * (diff * 1.45 * dusk + 0.006) * (1.0 - 0.4 * cloud);

  // Солнечный блик только на воде
  vec3 H = normalize(L + V);
  float nh = max(dot(n0, H), 0.0);
  float spec = pow(nh, 260.0) * 0.55 + pow(nh, 30.0) * 0.045;
  col += vec3(1.0, 0.9, 0.74) * spec * water * smoothstep(0.0, 0.15, sun) * (1.0 - cloud);

  // Ночь: на карте «чёрного мрамора» рельеф синеватый, а огни серые —
  // выделяем огни по красному каналу; ореол — из грубого мип-уровня
  vec3 nt = texture2D(uNight, vUv).rgb;
  vec3 nb = texture2D(uNight, vUv, 2.5).rgb;
  float city = max(nt.r - nt.b * 0.4, 0.0) * 11.0 + max(nb.r - nb.b * 0.4, 0.0) * 7.0;
  float night = 1.0 - smoothstep(-0.22, 0.05, sun);
  col += (vec3(1.0, 0.68, 0.36) * min(city, 1.6) * (1.0 - 0.7 * cloud) + nt * 0.25) * night;

  // Атмосферная дымка у края диска на освещённой стороне
  float fres = pow(1.0 - max(dot(n0, V), 0.0), 2.4);
  float lit = smoothstep(-0.3, 0.45, sun);
  col = mix(col, uAtmo * 0.9, fres * 0.7 * lit);
  col += uAtmo * fres * 0.2 * lit;

  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const CLOUDS_FRAG = /* glsl */ `
uniform sampler2D uClouds;
uniform vec3 uSunDir;
uniform float uOpacity;
varying vec2 vUv;
varying vec3 vNormalW;
varying vec3 vPosW;
${FX_GLSL}
void main() {
  float c = texture2D(uClouds, vUv).r;
  vec3 n = normalize(vNormalW);
  vec3 V = normalize(cameraPosition - vPosW);
  float sun = dot(n, normalize(uSunDir));
  float lit = smoothstep(-0.12, 0.3, sun);
  vec3 dusk = mix(vec3(1.0, 0.64, 0.46), vec3(1.0), smoothstep(0.0, 0.35, sun));
  vec3 col = mix(vec3(0.012, 0.016, 0.03), dusk * (0.3 + 0.9 * max(sun, 0.0)), lit);
  float fres = 1.0 - max(dot(n, V), 0.0);
  float a = smoothstep(0.1, 0.85, c) * (0.85 + 0.35 * fres) * uOpacity;
  gl_FragColor = fxColor(col, clamp(a, 0.0, 1.0), 0.0);
}
`;

const ATMO_VERT = /* glsl */ `
varying vec3 vPosW;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vPosW = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const ATMO_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform vec3 uSunDir;
uniform float uOuter;
varying vec3 vPosW;
${FX_GLSL}
void main() {
  // Расстояние от центра Земли до луча взгляда: плотность растёт к краю планеты
  vec3 rd = normalize(vPosW - cameraPosition);
  vec3 closest = cameraPosition - rd * dot(cameraPosition, rd);
  float d = length(closest);
  float t = clamp((uOuter - d) / (uOuter - 1.0), 0.0, 1.0);
  float glow = pow(t, 3.2) * 0.9 + pow(t, 14.0) * 0.9;
  float sun = dot(closest / max(d, 1e-4), normalize(uSunDir));
  float lit = 0.1 + 0.9 * smoothstep(-0.5, 0.6, sun);
  gl_FragColor = fxColor(uColor * 1.15, glow * lit, 1.0);
}
`;

function placeholder(v: number): DataTexture {
  const t = new DataTexture(new Uint8Array([v, v, v, 255]), 1, 1);
  t.needsUpdate = true;
  return t;
}

export function createGlobe(
  ctx: SceneContext,
  renderer: WebGLRenderer,
  events: { onReady: () => void; onChange: () => void },
): ScenePart {
  const seg = ctx.view.mobile ? 96 : 128;
  const sun = { value: ctx.sunDir };
  const atmoColor = { value: ctx.palette.atmosphere.clone() };

  const earthMat = new ShaderMaterial({
    vertexShader: SURFACE_VERT,
    fragmentShader: EARTH_FRAG,
    uniforms: {
      uDay: { value: placeholder(18) },
      uNight: { value: placeholder(0) },
      uBump: { value: placeholder(0) },
      uWater: { value: placeholder(0) },
      uClouds: { value: placeholder(0) },
      uSunDir: sun,
      uAtmo: atmoColor,
      uTexel: { value: new Vector2(1 / 1024, 1 / 512) },
      uBumpScale: { value: 2.4 },
      uCloudShift: { value: 0 },
      uCloudAmt: { value: 0 },
    },
  });
  const earth = new Mesh(new SphereGeometry(1, seg, seg / 2), earthMat);
  ctx.spin.add(earth);

  const cloudMat = fxMaterial({
    vertexShader: SURFACE_VERT,
    fragmentShader: CLOUDS_FRAG,
    uniforms: { uClouds: { value: placeholder(0) }, uSunDir: sun, uOpacity: { value: 0 } },
  });
  cloudMat.toneMapped = true;
  const clouds = new Mesh(new SphereGeometry(1.012, seg, seg / 2), cloudMat);
  clouds.renderOrder = 2;
  clouds.visible = false;
  ctx.tilt.add(clouds);

  const atmoMat = fxMaterial({
    vertexShader: ATMO_VERT,
    fragmentShader: ATMO_FRAG,
    uniforms: { uColor: atmoColor, uSunDir: sun, uOuter: { value: 1.16 } },
    side: BackSide,
  });
  const atmo = new Mesh(new SphereGeometry(1.17, 64, 32), atmoMat);
  atmo.renderOrder = 1;
  ctx.scene.add(atmo);

  // Текстуры приходят асинхронно; до этого работают заглушки 1×1
  const loader = new TextureLoader();
  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  let disposed = false;
  let cloudsSince = -1;
  const set = (mat: ShaderMaterial, name: string, tex: Texture) => {
    const u = mat.uniforms[name];
    if (!u) return;
    (u.value as Texture | null)?.dispose();
    u.value = tex;
  };
  const load = (file: string, color: boolean, apply: (tex: Texture) => void, fail?: () => void) => {
    loader.load(
      BASE + file,
      (tex) => {
        if (disposed) return tex.dispose();
        if (color) tex.colorSpace = SRGBColorSpace;
        tex.anisotropy = aniso;
        apply(tex);
        events.onChange();
      },
      undefined,
      () => !disposed && fail?.(),
    );
  };

  load(
    'earth-day.jpg',
    true,
    (tex) => {
      set(earthMat, 'uDay', tex);
      renderer.initTexture(tex);
      events.onReady();
    },
    events.onReady,
  );
  load('earth-night.jpg', true, (tex) => set(earthMat, 'uNight', tex));
  load('earth-bump.jpg', false, (tex) => set(earthMat, 'uBump', tex));
  load('earth-water.jpg', false, (tex) => set(earthMat, 'uWater', tex));
  load('clouds.jpg', false, (tex) => {
    tex.wrapS = RepeatWrapping;
    set(earthMat, 'uClouds', tex);
    // Одна текстура на два материала: заглушку облаков освобождаем отдельно
    (cloudMat.uniforms.uClouds!.value as Texture).dispose();
    cloudMat.uniforms.uClouds!.value = tex;
    clouds.visible = true;
    cloudsSince = -2;
    // В статичном кадре облака появляются сразу
    if (ctx.view.still) setCloudAmount(1);
  });

  function setCloudAmount(k: number) {
    cloudMat.uniforms.uOpacity!.value = k;
    earthMat.uniforms.uCloudAmt!.value = k;
  }

  return {
    update(t) {
      const spin = SPIN0 + t * EARTH_SPEED;
      ctx.spin.rotation.y = spin;
      clouds.rotation.y = spin + t * CLOUD_DRIFT;
      // Сдвиг облаков относительно поверхности — для теней на Земле
      const shift = -((t * CLOUD_DRIFT) / (Math.PI * 2));
      earthMat.uniforms.uCloudShift!.value = shift - Math.floor(shift);
      if (cloudsSince === -2) cloudsSince = t;
      if (cloudsSince >= 0 && !ctx.view.still) setCloudAmount(Math.min(1, (t - cloudsSince) / 1.2));
    },
    setPalette(p: Palette) {
      atmoColor.value.copy(p.atmosphere);
    },
    dispose() {
      disposed = true;
    },
  };
}
