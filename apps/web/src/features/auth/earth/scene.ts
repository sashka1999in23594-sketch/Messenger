/**
 * Сборка сцены «Земля»: рендерер, камера с кадрированием под любые пропорции,
 * цикл анимации с паузой вне экрана, параллакс за указателем и полная очистка.
 */
import {
  ACESFilmicToneMapping,
  AmbientLight,
  DirectionalLight,
  Group,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three';
import { disposeTree, type SceneContext, type ScenePart, type SharedUniforms } from './core';
import { createDots } from './dots';
import { createGlobe } from './globe';
import { createMoon, MOON_ORBIT, MOON_RADIUS } from './moon';
import { readPalette } from './palette';
import { createRocket } from './rocket';
import { createSky } from './sky';
import { createTraffic } from './traffic';

export interface EarthSceneOptions {
  /** prefers-reduced-motion: один статичный кадр без цикла. */
  still: boolean;
  /** WebGL-контекст потерян — показать запасной вариант. */
  onLost: () => void;
}

export interface EarthSceneHandle {
  dispose(): void;
}

const FOV = 34;
/** Камера чуть выше плоскости орбиты Луны (≈13°). */
const ELEVATION = 0.23;
const AXIAL_TILT = (23.4 * Math.PI) / 180;
const PARALLAX_YAW = 0.05;
const PARALLAX_PITCH = 0.035;
/** Отступы кадра от краёв холста (доля половины ширины/высоты). */
const MARGIN_X = 0.06;
const MARGIN_Y = 0.08;

export function createEarthScene(host: HTMLElement, opts: EarthSceneOptions): EarthSceneHandle {
  const mobile = matchMedia('(max-width: 767px), (pointer: coarse)').matches;
  // Контекст создаём сами: без WebGL2 тихо бросаем исключение — компонент покажет CSS-вариант
  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl2', {
    alpha: true,
    antialias: true,
    depth: true,
    stencil: false,
    premultipliedAlpha: true,
    powerPreference: 'high-performance',
  });
  if (!gl) throw new Error('WebGL2 недоступен');
  const renderer = new WebGLRenderer({ canvas, context: gl, antialias: true, alpha: true });
  try {
    return build();
  } catch (err) {
    renderer.dispose();
    renderer.forceContextLoss();
    canvas.remove();
    throw err;
  }

  function build(): EarthSceneHandle {
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, mobile ? 1.5 : 2));
    renderer.outputColorSpace = SRGBColorSpace;
    renderer.toneMapping = ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    renderer.setClearColor(0x000000, 0);
    host.appendChild(canvas);

    const scene = new Scene();
    const camera = new PerspectiveCamera(FOV, 1, 0.1, 400);
    scene.add(camera);

    // Солнце слева и чуть спереди: видны и день, и ночная сторона с огнями
    const sunDir = new Vector3(-1, 0.15, 0.22).normalize();
    const sun = new DirectionalLight(0xffffff, 4.2);
    sun.position.copy(sunDir).multiplyScalar(10);
    scene.add(sun, new AmbientLight(0x9db4ff, 0.14));

    // Ось Земли наклонена вправо и слегка к зрителю
    const tilt = new Group();
    tilt.rotation.set(0.17, 0, -AXIAL_TILT);
    const spin = new Group();
    tilt.add(spin);
    scene.add(tilt);

    const uniforms: SharedUniforms = {
      uTime: { value: 0 },
      uRes: { value: new Vector2(1, 1) },
      uDpr: { value: renderer.getPixelRatio() },
      uPxScale: { value: 1 },
    };
    const ctx: SceneContext = {
      scene,
      camera,
      tilt,
      spin,
      sunDir,
      uniforms,
      view: { pxPerUnit: 0, mobile, still: opts.still },
      palette: readPalette(host),
    };

    /** disposed — рисовать больше нельзя (размонтирование или потеря контекста). */
    let disposed = false;
    let released = false;
    let ready = false;
    let sized = false;
    const render = () => {
      if (!disposed && sized) renderer.render(scene, camera);
    };

    const globe = createGlobe(ctx, renderer, {
      onReady: () => {
        if (disposed || ready) return;
        ready = true;
        render();
        // Плавное появление — только когда есть дневная текстура
        canvas.classList.add('is-ready');
      },
      onChange: () => ctx.view.still && render(),
    });
    const moon = createMoon(ctx);
    const dots = createDots(ctx);
    // Сначала двигаем Землю и Луну, затем — всё, что от них зависит
    const kinematics: ScenePart[] = [globe, moon];
    const actors: ScenePart[] = [dots, createTraffic(ctx), createRocket(ctx, moon), createSky(ctx)];
    const parts = [...kinematics, ...actors];

    // Камера: орбита вокруг центра, параллакс — небольшие углы поворота
    let dist = 10;
    let yaw = 0;
    let pitch = 0;
    let yawTarget = 0;
    let pitchTarget = 0;
    const placeCamera = () => {
      const el = ELEVATION + pitch;
      camera.position
        .set(Math.sin(yaw) * Math.cos(el), Math.sin(el), Math.cos(yaw) * Math.cos(el))
        .multiplyScalar(dist);
      camera.lookAt(0, 0, 0);
    };

    /** Расстояние, при котором Земля и вся орбита Луны помещаются в кадр. */
    const sample = new Vector3();
    const frame = (w: number, h: number) => {
      camera.aspect = w / h;
      const tanV = Math.tan((FOV * Math.PI) / 360);
      const fitX = tanV * camera.aspect * (1 - MARGIN_X);
      const fitY = tanV * (1 - MARGIN_Y);
      const se = Math.sin(ELEVATION);
      const ce = Math.cos(ELEVATION);
      const earthR = 1.18;
      let d = Math.max(earthR / Math.sin(Math.atan(fitX)), earthR / Math.sin(Math.atan(fitY)));
      moon.orbit.updateMatrixWorld();
      const pad = MOON_RADIUS * 1.3;
      for (let i = 0; i < 72; i++) {
        const a = (i / 72) * Math.PI * 2;
        sample
          .set(Math.cos(a) * MOON_ORBIT, 0, -Math.sin(a) * MOON_ORBIT)
          .applyMatrix4(moon.orbit.matrixWorld);
        // Базис камеры без параллакса: вправо (1,0,0), вверх (0,cos,−sin), к камере (0,sin,cos)
        const x = sample.x;
        const y = sample.y * ce - sample.z * se;
        const z = sample.y * se + sample.z * ce;
        d = Math.max(d, z + (Math.abs(x) + pad) / fitX, z + (Math.abs(y) + pad) / fitY);
      }
      // Запас на параллакс
      dist = d * 1.03;
      camera.updateProjectionMatrix();
      ctx.view.pxPerUnit = h / (2 * dist * tanV);
      uniforms.uPxScale.value = uniforms.uRes.value.y / (2 * tanV);
    };

    const resize = () => {
      const w = host.clientWidth;
      const h = host.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h, false);
      renderer.getDrawingBufferSize(uniforms.uRes.value);
      uniforms.uDpr.value = renderer.getPixelRatio();
      frame(w, h);
      placeCamera();
      if (ctx.view.still && !sized) {
        // Статичный кадр: «проигрываем» несколько секунд, чтобы сцена была живой
        for (let i = 0; i < 45; i++) step(0.1);
        dots.lightUp(time, 0.4);
      }
      sized = true;
      // Без цикла обновляем размеры объектов и перерисовываем вручную
      if (!raf) {
        step(0);
        render();
      }
      sync();
    };

    // Цикл анимации: время сцены идёт только во время показа
    let raf = 0;
    let last = 0;
    let time = 0;
    let visible = !document.hidden;
    let inView = true;
    const step = (dt: number) => {
      time += dt;
      uniforms.uTime.value = time;
      const k = 1 - Math.exp(-dt * 2.5);
      yaw += (yawTarget - yaw) * k;
      pitch += (pitchTarget - pitch) * k;
      placeCamera();
      for (const p of kinematics) p.update(time, dt);
      scene.updateMatrixWorld();
      for (const p of actors) p.update(time, dt);
    };
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
      last = now;
      step(dt);
      render();
    };
    function sync() {
      const run = !disposed && !ctx.view.still && sized && visible && inView;
      if (run && !raf) {
        last = performance.now();
        raf = requestAnimationFrame(tick);
      } else if (!run && raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
    }

    placeCamera();
    scene.updateMatrixWorld();

    const ro = new ResizeObserver(resize);
    ro.observe(host);
    const io = new IntersectionObserver((entries) => {
      inView = entries.some((e) => e.isIntersecting);
      sync();
    });
    io.observe(host);
    const onVisibility = () => {
      visible = !document.hidden;
      sync();
    };
    document.addEventListener('visibilitychange', onVisibility);

    const parallax = !ctx.view.still && matchMedia('(pointer: fine)').matches;
    const onPointer = (e: PointerEvent) => {
      yawTarget = ((e.clientX / window.innerWidth) * 2 - 1) * PARALLAX_YAW;
      pitchTarget = -((e.clientY / window.innerHeight) * 2 - 1) * PARALLAX_PITCH;
    };
    if (parallax) window.addEventListener('pointermove', onPointer, { passive: true });

    // Смена темы — перечитываем цвета
    const mo = new MutationObserver(() => {
      readPalette(host, ctx.palette);
      for (const p of parts) p.setPalette?.(ctx.palette);
      if (ctx.view.still) render();
    });
    mo.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme', 'data-palette', 'data-accent', 'class', 'style'],
    });

    const onLost = (e: Event) => {
      e.preventDefault();
      disposed = true;
      sync();
      opts.onLost();
    };
    canvas.addEventListener('webglcontextlost', onLost);

    return {
      dispose() {
        if (released) return;
        released = true;
        disposed = true;
        sync();
        if (raf) cancelAnimationFrame(raf);
        raf = 0;
        ro.disconnect();
        io.disconnect();
        mo.disconnect();
        document.removeEventListener('visibilitychange', onVisibility);
        window.removeEventListener('pointermove', onPointer);
        canvas.removeEventListener('webglcontextlost', onLost);
        for (const p of parts) p.dispose?.();
        disposeTree(scene);
        renderer.dispose();
        // Сразу отдаём контекст браузеру (StrictMode монтирует сцену дважды)
        if (!renderer.getContext().isContextLost()) renderer.forceContextLoss();
        canvas.remove();
      },
    };
  }
}
