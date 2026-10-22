/**
 * Лунная сцена Lynnet: звёзды, Земля в небе, спутник и падающие звёзды; на
 * грунт садится ракета, космонавт выходит, прыжками в низкой гравитации идёт
 * ставить флаг, отдаёт честь, возвращается, ракета улетает — и порыв уносит
 * флаг. Прилетает следующая ракета в новой расцветке, и так бесконечно.
 * Следы от прошлых экспедиций постепенно тают.
 *
 * Рисуется на canvas; цвета — часть картины (как пиксели фотографии), поэтому
 * заданы здесь, а не токенами. Тот же код в приложении для компьютера —
 * desktop-app/src/moon-scene.js (собирается из этого файла, см. его шапку).
 */

export interface MoonSceneOptions {
  /** Горизонт — доля высоты холста */
  ground?: number;
  /** Размер ракеты и космонавта: доля высоты на 100 условных единиц */
  scale?: number;
  /** Где садятся ракеты — доля ширины */
  landX?: number;
  /** Земля в небе: центр (доли) и радиус (доля меньшей стороны) */
  earth?: { x: number; y: number; r: number };
  /** Без движения (настройка «меньше движения») */
  still?: boolean;
  /** Параллакс за курсором; без движения мыши сцена «дышит» сама */
  interactive?: boolean;
}

interface Palette {
  body: string;
  shade: string;
  accent: string;
  visor: string;
  flag: [string, string];
}

const PALETTES: Palette[] = [
  { body: '#f4f5f8', shade: '#c9ccd6', accent: '#e63946', visor: '#f5c542', flag: ['#e63946', '#f4f5f8'] },
  { body: '#2b2d42', shade: '#1a1b29', accent: '#ff9f1c', visor: '#64dfdf', flag: ['#ff9f1c', '#2b2d42'] },
  { body: '#eaf4f4', shade: '#b9cfd1', accent: '#2f7bff', visor: '#ffb703', flag: ['#2f7bff', '#a8dadc'] },
  { body: '#3a0ca3', shade: '#24076a', accent: '#f72585', visor: '#4cc9f0', flag: ['#f72585', '#4cc9f0'] },
  { body: '#ffd60a', shade: '#c9a800', accent: '#003566', visor: '#ff4d8d', flag: ['#003566', '#ffd60a'] },
  { body: '#2d6a4f', shade: '#1b4332', accent: '#d8f3dc', visor: '#ffba08', flag: ['#40916c', '#d8f3dc'] },
  { body: '#f8f9fa', shade: '#ced4da', accent: '#7b2cbf', visor: '#80ffdb', flag: ['#7b2cbf', '#f8f9fa'] },
];

/** Длительность одной экспедиции, секунды */
const CYCLE = 20;

function seeded(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const easeOut = (v: number) => 1 - (1 - clamp01(v)) ** 3;
const easeIn = (v: number) => clamp01(v) ** 2.4;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const phase = (u: number, a: number, b: number) => clamp01((u - a) / (b - a));

/** Где космонавт и что делает в момент u экспедиции (единицы: x от ракеты, h над грунтом). */
interface Pose {
  visible: boolean;
  x: number;
  h: number;
  dir: 1 | -1;
  /** Фаза шага для ног 0…1 */
  step: number;
  salute: number;
  carry: boolean;
  /** Номер прыжка — для следов */
  hop: number;
}

const FLAG_X = 74;
const DOOR_H = 30;
const OUT_X = 26;

function hopPath(u: number, t0: number, t1: number, x0: number, x1: number, hops: number, height: number) {
  const p = phase(u, t0, t1);
  const k = p * hops;
  const i = Math.min(hops - 1, Math.floor(k));
  const f = k - i;
  return { x: lerp(x0, x1, p), h: Math.sin(Math.PI * f) * height, step: f, hop: i };
}

function astronaut(u: number): Pose {
  const none: Pose = { visible: false, x: 0, h: 0, dir: 1, step: 0, salute: 0, carry: false, hop: -1 };
  if (u < 6 || u > 13.2) return none;
  if (u < 6.8) {
    const p = phase(u, 6, 6.8);
    return { visible: true, x: lerp(0, OUT_X, p), h: lerp(DOOR_H, 0, p) + Math.sin(Math.PI * p) * 10, dir: 1, step: 0.5, salute: 0, carry: true, hop: -1 };
  }
  if (u < 9.4) {
    const s = hopPath(u, 6.8, 9.4, OUT_X, FLAG_X - 8, 4, 9);
    return { visible: true, ...s, dir: 1, salute: 0, carry: true, hop: s.hop };
  }
  if (u < 10.6) return { visible: true, x: FLAG_X - 8, h: 0, dir: 1, step: 0, salute: 0, carry: false, hop: 10 };
  if (u < 11.4) {
    // Отдаёт честь и подпрыгивает от радости
    const p = phase(u, 10.6, 11.4);
    return { visible: true, x: FLAG_X - 8, h: Math.sin(Math.PI * p) * 16, dir: 1, step: 0.5, salute: 1, carry: false, hop: 11 };
  }
  if (u < 12.6) {
    const s = hopPath(u, 11.4, 12.6, FLAG_X - 8, OUT_X, 2, 10);
    return { visible: true, ...s, dir: -1, salute: 0, carry: false, hop: 20 + s.hop };
  }
  const p = phase(u, 12.6, 13.2);
  return { visible: true, x: lerp(OUT_X, 0, p), h: lerp(0, DOOR_H, p) + Math.sin(Math.PI * p) * 12, dir: -1, step: 0.5, salute: 0, carry: false, hop: -1 };
}

export function startMoonScene(canvas: HTMLCanvasElement, options: MoonSceneOptions = {}): () => void {
  const opt = { ground: 0.72, scale: 0.15, landX: 0.68, earth: { x: 0.2, y: 0.22, r: 0.09 }, still: false, interactive: true, ...options };
  const ctx = canvas.getContext('2d');
  if (!ctx) return () => undefined;
  let W = 0;
  let H = 0;
  let dpr = 1;

  const rnd = seeded(42);
  const stars = Array.from({ length: 260 }, () => ({ x: rnd(), y: rnd(), r: 0.4 + rnd() * 1.3, tw: rnd() * Math.PI * 2, sp: 0.5 + rnd() * 2, z: 0.3 + rnd() * 0.7 }));
  const craters = Array.from({ length: 16 }, () => ({ x: rnd(), d: rnd(), r: 0.02 + rnd() * 0.05 }));
  const hills = Array.from({ length: 24 }, () => rnd());
  const continents = Array.from({ length: 7 }, () => ({ x: rnd() * 2, y: rnd() * 1.6 - 0.8, rx: 0.18 + rnd() * 0.3, ry: 0.1 + rnd() * 0.2, c: rnd() > 0.4 ? '#3f8f4f' : '#8a7a4a' }));
  const clouds = Array.from({ length: 9 }, () => ({ x: rnd() * 2, y: rnd() * 1.7 - 0.85, rx: 0.2 + rnd() * 0.35, ry: 0.04 + rnd() * 0.06 }));

  interface Dust {
    x: number;
    y: number;
    vx: number;
    vy: number;
    life: number;
    r: number;
  }
  let dust: Dust[] = [];
  let prints: { x: number; at: number; dir: number }[] = [];
  let lastHop = '';
  let shooting: { x: number; y: number; vx: number; vy: number; life: number } | null = null;
  let nextShoot = 3;

  const pointer = { x: 0.5, y: 0.5, at: -1e9 };
  const smooth = { x: 0.5, y: 0.5 };
  const onMove = (e: PointerEvent) => {
    const r = canvas.getBoundingClientRect();
    pointer.x = (e.clientX - r.left) / Math.max(1, r.width);
    pointer.y = (e.clientY - r.top) / Math.max(1, r.height);
    pointer.at = performance.now();
  };
  if (opt.interactive && !opt.still) window.addEventListener('pointermove', onMove, { passive: true });

  const resize = () => {
    const rect = canvas.getBoundingClientRect();
    dpr = Math.min(2, window.devicePixelRatio || 1);
    W = Math.max(1, rect.width);
    H = Math.max(1, rect.height);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
  };
  resize();
  const ro = new ResizeObserver(resize);
  ro.observe(canvas);

  // ─── Небо ─────────────────────────────────────────────────────────────────
  function sky(t: number, px: number, py: number) {
    const g = ctx!.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#02030a');
    g.addColorStop(0.6, '#070b1d');
    g.addColorStop(1, '#0d1430');
    ctx!.fillStyle = g;
    ctx!.fillRect(0, 0, W, H);
    for (const s of stars) {
      const a = opt.still ? 0.7 : 0.45 + 0.55 * Math.abs(Math.sin(t * s.sp * 0.6 + s.tw));
      ctx!.fillStyle = `rgba(255,255,255,${(a * (0.4 + s.z * 0.6)).toFixed(3)})`;
      ctx!.beginPath();
      ctx!.arc(s.x * W - px * 14 * s.z, s.y * H * opt.ground - py * 8 * s.z, s.r, 0, Math.PI * 2);
      ctx!.fill();
    }
  }

  function earth(t: number, px: number, py: number) {
    const R = Math.min(W, H) * opt.earth.r;
    const cx = opt.earth.x * W - px * 8;
    const cy = opt.earth.y * H - py * 5;
    const glow = ctx!.createRadialGradient(cx, cy, R * 0.9, cx, cy, R * 1.5);
    glow.addColorStop(0, 'rgba(120,180,255,0.35)');
    glow.addColorStop(1, 'rgba(120,180,255,0)');
    ctx!.fillStyle = glow;
    ctx!.fillRect(cx - R * 1.6, cy - R * 1.6, R * 3.2, R * 3.2);
    ctx!.save();
    ctx!.beginPath();
    ctx!.arc(cx, cy, R, 0, Math.PI * 2);
    ctx!.clip();
    const sea = ctx!.createRadialGradient(cx - R * 0.35, cy - R * 0.35, R * 0.1, cx, cy, R);
    sea.addColorStop(0, '#4f9dff');
    sea.addColorStop(0.7, '#1d4fae');
    sea.addColorStop(1, '#0b2366');
    ctx!.fillStyle = sea;
    ctx!.fillRect(cx - R, cy - R, R * 2, R * 2);
    // Материки и облака плывут — Земля вращается
    const spin = opt.still ? 0 : t * 0.02;
    for (const c of continents) {
      const x = ((((c.x + spin) % 2) + 2) % 2) - 1;
      ctx!.fillStyle = c.c;
      ctx!.beginPath();
      ctx!.ellipse(cx + x * R * 1.2, cy + c.y * R, c.rx * R, c.ry * R, 0.3, 0, Math.PI * 2);
      ctx!.fill();
    }
    for (const c of clouds) {
      const x = ((((c.x + spin * 1.6) % 2) + 2) % 2) - 1;
      ctx!.fillStyle = 'rgba(255,255,255,0.55)';
      ctx!.beginPath();
      ctx!.ellipse(cx + x * R * 1.2, cy + c.y * R, c.rx * R, c.ry * R, -0.15, 0, Math.PI * 2);
      ctx!.fill();
    }
    // Ночная сторона
    const night = ctx!.createLinearGradient(cx - R, cy - R * 0.3, cx + R, cy + R * 0.3);
    night.addColorStop(0, 'rgba(2,4,14,0)');
    night.addColorStop(0.55, 'rgba(2,4,14,0.25)');
    night.addColorStop(1, 'rgba(2,4,14,0.92)');
    ctx!.fillStyle = night;
    ctx!.fillRect(cx - R, cy - R, R * 2, R * 2);
    ctx!.restore();
  }

  function satellite(t: number) {
    const period = 46;
    const p = ((t % period) + period) % period / period;
    if (p > 0.6) return;
    const x = lerp(-20, W + 20, p / 0.6);
    const y = H * opt.ground * 0.14 + Math.sin(p * 4) * 6;
    ctx!.save();
    ctx!.translate(x, y);
    ctx!.fillStyle = '#aab3c5';
    ctx!.fillRect(-2, -1.5, 4, 3);
    ctx!.fillStyle = '#3d6fd8';
    ctx!.fillRect(-9, -1, 6, 2);
    ctx!.fillRect(3, -1, 6, 2);
    if (Math.sin(t * 6) > 0.6) {
      ctx!.fillStyle = '#ff4d4d';
      ctx!.beginPath();
      ctx!.arc(0, -2.5, 1.2, 0, Math.PI * 2);
      ctx!.fill();
    }
    ctx!.restore();
  }

  function shootingStar(t: number, dt: number) {
    if (opt.still) return;
    if (!shooting && t > nextShoot) {
      shooting = { x: Math.random() * W * 0.7, y: Math.random() * H * opt.ground * 0.4, vx: W * (0.5 + Math.random() * 0.4), vy: H * (0.12 + Math.random() * 0.15), life: 1 };
      nextShoot = t + 5 + Math.random() * 7;
    }
    if (!shooting) return;
    shooting.x += shooting.vx * dt;
    shooting.y += shooting.vy * dt;
    shooting.life -= dt * 1.3;
    if (shooting.life <= 0) {
      shooting = null;
      return;
    }
    const len = 0.12;
    const g = ctx!.createLinearGradient(shooting.x, shooting.y, shooting.x - shooting.vx * len, shooting.y - shooting.vy * len);
    g.addColorStop(0, `rgba(255,255,255,${shooting.life.toFixed(3)})`);
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx!.strokeStyle = g;
    ctx!.lineWidth = 1.6;
    ctx!.beginPath();
    ctx!.moveTo(shooting.x, shooting.y);
    ctx!.lineTo(shooting.x - shooting.vx * len, shooting.y - shooting.vy * len);
    ctx!.stroke();
  }

  // ─── Грунт ────────────────────────────────────────────────────────────────
  function ground() {
    const G = H * opt.ground;
    // Дальние холмы
    ctx!.fillStyle = '#5b5e6b';
    ctx!.beginPath();
    ctx!.moveTo(0, G);
    hills.forEach((h, i) => ctx!.lineTo((i / (hills.length - 1)) * W, G - (8 + h * 26) * (H / 800)));
    ctx!.lineTo(W, G + 4);
    ctx!.lineTo(0, G + 4);
    ctx!.fill();
    const g = ctx!.createLinearGradient(0, G, 0, H);
    g.addColorStop(0, '#a3a5b0');
    g.addColorStop(0.35, '#80838f');
    g.addColorStop(1, '#4e505b');
    ctx!.fillStyle = g;
    ctx!.fillRect(0, G, W, H - G);
    for (const c of craters) {
      const y = G + (H - G) * (0.12 + c.d * 0.8);
      const persp = 0.4 + c.d * 0.8;
      const rx = c.r * W * persp;
      const ry = rx * 0.28;
      const x = c.x * W;
      ctx!.fillStyle = 'rgba(40,42,52,0.45)';
      ctx!.beginPath();
      ctx!.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
      ctx!.fill();
      ctx!.strokeStyle = 'rgba(220,222,230,0.35)';
      ctx!.lineWidth = Math.max(1, ry * 0.25);
      ctx!.beginPath();
      ctx!.ellipse(x, y + ry * 0.1, rx, ry, 0, 0.1, Math.PI - 0.1);
      ctx!.stroke();
    }
  }

  // ─── Ракета, космонавт, флаг ──────────────────────────────────────────────
  function rocket(p: Palette, x: number, y: number, k: number, u: number, t: number) {
    const legs = phase(u, 2.4, 3.4) * (1 - phase(u, 14.4, 15.2));
    const door = phase(u, 5, 5.8) * (1 - phase(u, 13.2, 13.9));
    const thrust = (u < 4.3 && u > 0) || (u > 13.9 && u < 18.5);
    ctx!.save();
    ctx!.translate(x, y);
    ctx!.scale(k, k);
    if (thrust) {
      const len = (u < 4.3 ? lerp(46, 18, phase(u, 2.5, 4.3)) : lerp(22, 60, phase(u, 13.9, 15))) * (0.85 + Math.sin(t * 40) * 0.15);
      const glow = ctx!.createRadialGradient(0, -8, 2, 0, -8, len * 1.3);
      glow.addColorStop(0, 'rgba(255,200,120,0.55)');
      glow.addColorStop(1, 'rgba(255,140,60,0)');
      ctx!.fillStyle = glow;
      ctx!.fillRect(-len * 1.3, -8 - len * 1.3, len * 2.6, len * 2.6);
      const f = ctx!.createLinearGradient(0, -12, 0, -12 + len);
      f.addColorStop(0, '#fff6d6');
      f.addColorStop(0.35, '#ffb347');
      f.addColorStop(1, 'rgba(255,90,40,0)');
      ctx!.fillStyle = f;
      ctx!.beginPath();
      ctx!.moveTo(-7, -12);
      ctx!.quadraticCurveTo(0, -12 + len * 1.25, 7, -12);
      ctx!.fill();
    }
    // Опоры
    ctx!.strokeStyle = '#9ba1ad';
    ctx!.lineWidth = 2.4;
    ctx!.lineCap = 'round';
    for (const s of [-1, 1]) {
      ctx!.beginPath();
      ctx!.moveTo(s * 9, -24);
      ctx!.lineTo(s * lerp(12, 23, legs), lerp(-10, 0, legs));
      ctx!.stroke();
      ctx!.fillStyle = '#7d828e';
      ctx!.fillRect(s * lerp(12, 23, legs) - 4, lerp(-10, 0, legs) - 1.5, 8, 2.5);
    }
    // Сопло
    ctx!.fillStyle = '#3b3e47';
    ctx!.beginPath();
    ctx!.moveTo(-7, -21);
    ctx!.lineTo(7, -21);
    ctx!.lineTo(9, -12);
    ctx!.lineTo(-9, -12);
    ctx!.fill();
    // Стабилизаторы
    ctx!.fillStyle = p.accent;
    for (const s of [-1, 1]) {
      ctx!.beginPath();
      ctx!.moveTo(s * 11, -22);
      ctx!.lineTo(s * 20, -16);
      ctx!.lineTo(s * 20, -30);
      ctx!.lineTo(s * 11, -46);
      ctx!.fill();
    }
    // Корпус с объёмом
    const body = ctx!.createLinearGradient(-12, 0, 12, 0);
    body.addColorStop(0, p.shade);
    body.addColorStop(0.45, p.body);
    body.addColorStop(1, p.shade);
    ctx!.fillStyle = body;
    ctx!.beginPath();
    ctx!.moveTo(-11, -21);
    ctx!.lineTo(-11, -78);
    ctx!.bezierCurveTo(-11, -96, -4, -108, 0, -114);
    ctx!.bezierCurveTo(4, -108, 11, -96, 11, -78);
    ctx!.lineTo(11, -21);
    ctx!.closePath();
    ctx!.fill();
    ctx!.fillStyle = p.accent;
    ctx!.fillRect(-11, -64, 22, 6);
    ctx!.beginPath();
    ctx!.moveTo(-5, -104);
    ctx!.bezierCurveTo(-2, -109, 2, -109, 5, -104);
    ctx!.lineTo(0, -114);
    ctx!.fill();
    // Иллюминатор
    ctx!.fillStyle = '#d7dbe3';
    ctx!.beginPath();
    ctx!.arc(0, -86, 6.2, 0, Math.PI * 2);
    ctx!.fill();
    const glass = ctx!.createRadialGradient(-2, -88, 1, 0, -86, 5);
    glass.addColorStop(0, '#d6f0ff');
    glass.addColorStop(1, '#2a6fb5');
    ctx!.fillStyle = glass;
    ctx!.beginPath();
    ctx!.arc(0, -86, 4.6, 0, Math.PI * 2);
    ctx!.fill();
    // Люк
    ctx!.fillStyle = '#16181e';
    ctx!.fillRect(-6, -54, 12, 22 * door);
    ctx!.strokeStyle = p.shade;
    ctx!.lineWidth = 1;
    ctx!.strokeRect(-6, -54, 12, 22);
    if (door > 0) {
      ctx!.fillStyle = p.body;
      ctx!.fillRect(6, -54, 9 * door, 22);
    }
    ctx!.restore();
  }

  function flag(p: Palette, x: number, y: number, k: number, grow: number, wave: number, tilt: number) {
    ctx!.save();
    ctx!.translate(x, y);
    ctx!.scale(k, k);
    ctx!.rotate(tilt);
    const top = -42 * grow;
    ctx!.strokeStyle = '#d0d3da';
    ctx!.lineWidth = 1.6;
    ctx!.beginPath();
    ctx!.moveTo(0, 0);
    ctx!.lineTo(0, top);
    ctx!.stroke();
    if (grow > 0.7) {
      const w = 24 * phase(grow, 0.7, 1);
      const h = 14;
      const yy = (i: number) => top + Math.sin(wave + i * 0.35) * 1.6;
      const band = (y0: number, y1: number, color: string) => {
        ctx!.fillStyle = color;
        ctx!.beginPath();
        for (let i = 0; i <= 8; i++) ctx!.lineTo((i / 8) * w, yy(i) + y0);
        for (let i = 8; i >= 0; i--) ctx!.lineTo((i / 8) * w, yy(i) + y1);
        ctx!.fill();
      };
      band(0, h / 2, p.flag[0]);
      band(h / 2, h, p.flag[1]);
      ctx!.fillStyle = p.accent;
      ctx!.beginPath();
      ctx!.arc(w * 0.28, yy(2) + h / 2, 2.6 * (w / 24), 0, Math.PI * 2);
      ctx!.fill();
    }
    ctx!.restore();
  }

  function spaceman(p: Palette, pose: Pose, x: number, y: number, k: number, t: number) {
    ctx!.save();
    ctx!.translate(x, y);
    ctx!.scale(k * pose.dir, k);
    const swing = Math.sin(pose.step * Math.PI * 2) * 0.5;
    // Рюкзак
    ctx!.fillStyle = '#c3c7d1';
    ctx!.beginPath();
    ctx!.roundRect(-8.5, -22, 5, 11, 1.5);
    ctx!.fill();
    // Ноги
    ctx!.strokeStyle = '#eef0f5';
    ctx!.lineCap = 'round';
    ctx!.lineWidth = 3.4;
    for (const s of [-1, 1]) {
      ctx!.beginPath();
      ctx!.moveTo(s * 1.6, -9);
      ctx!.lineTo(s * 1.6 + swing * s * 3, 0);
      ctx!.stroke();
    }
    ctx!.fillStyle = '#6c717d';
    for (const s of [-1, 1]) ctx!.fillRect(s * 1.6 + swing * s * 3 - 2, -1.5, 4.5, 2);
    // Туловище
    ctx!.fillStyle = '#f4f5f8';
    ctx!.beginPath();
    ctx!.roundRect(-4.5, -21, 9.5, 13, 3);
    ctx!.fill();
    ctx!.fillStyle = p.accent;
    ctx!.fillRect(-4.5, -15.5, 9.5, 2.2);
    // Руки: правая — честь или флаг
    ctx!.strokeStyle = '#eef0f5';
    ctx!.lineWidth = 3;
    ctx!.beginPath();
    ctx!.moveTo(-2.5, -18);
    ctx!.lineTo(-4.5 - swing * 2, -11);
    ctx!.stroke();
    ctx!.beginPath();
    ctx!.moveTo(3, -18);
    if (pose.salute > 0) ctx!.lineTo(6, -25 - Math.sin(t * 10) * 0.6);
    else ctx!.lineTo(6 + swing * 2, -11);
    ctx!.stroke();
    if (pose.carry) {
      // Свёрнутый флаг под мышкой
      ctx!.strokeStyle = '#d0d3da';
      ctx!.lineWidth = 1.4;
      ctx!.beginPath();
      ctx!.moveTo(4, -6);
      ctx!.lineTo(12, -30);
      ctx!.stroke();
      ctx!.fillStyle = p.flag[0];
      ctx!.fillRect(10.2, -31, 2.6, 8);
    }
    // Шлем со стеклом в цвет экспедиции
    ctx!.fillStyle = '#f4f5f8';
    ctx!.beginPath();
    ctx!.arc(0.5, -25.5, 5.4, 0, Math.PI * 2);
    ctx!.fill();
    const visor = ctx!.createLinearGradient(0, -29, 4, -22);
    visor.addColorStop(0, '#ffffff');
    visor.addColorStop(0.3, p.visor);
    visor.addColorStop(1, '#3a2a10');
    ctx!.fillStyle = visor;
    ctx!.beginPath();
    ctx!.ellipse(2.2, -25.4, 3.6, 3, 0, 0, Math.PI * 2);
    ctx!.fill();
    ctx!.restore();
  }

  // ─── Кадр ────────────────────────────────────────────────────────────────
  const t0 = performance.now();
  let last = t0;
  let raf = 0;

  function frame(now: number) {
    const t = opt.still ? 11 : (now - t0) / 1000;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const idle = now - pointer.at > 2500;
    const tx = idle ? 0.5 + Math.cos(t * 0.25) * 0.25 : pointer.x;
    const ty = idle ? 0.5 + Math.sin(t * 0.33) * 0.2 : pointer.y;
    smooth.x += (tx - smooth.x) * 0.05;
    smooth.y += (ty - smooth.y) * 0.05;
    const px = opt.interactive ? smooth.x - 0.5 : 0;
    const py = opt.interactive ? smooth.y - 0.5 : 0;

    ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
    sky(t, px, py);
    shootingStar(t, dt);
    satellite(t);
    earth(t, px, py);
    ground();

    const G = H * opt.ground + Math.min(H * 0.04, 14);
    const k = (H * opt.scale) / 100;
    const LX = W * opt.landX;
    const mission = Math.floor(t / CYCLE);
    const u = t - mission * CYCLE;
    const pal = PALETTES[mission % PALETTES.length]!;
    const sky0 = G / k + 130;

    // Следы: тают за минуту
    prints = prints.filter((f) => t - f.at < 60);
    for (const f of prints) {
      ctx!.fillStyle = `rgba(55,57,68,${(0.5 * (1 - (t - f.at) / 60)).toFixed(3)})`;
      ctx!.beginPath();
      ctx!.ellipse(f.x, G + 1, 2.4 * k, 0.9 * k, 0, 0, Math.PI * 2);
      ctx!.fill();
    }

    // Флаг: растёт, развевается, порыв ветра уносит его после взлёта ракеты
    if (u > 9.6) {
      const grow = phase(u, 9.6, 10.5);
      const gust = phase(u, 15.6, 16.4);
      const fly = Math.max(0, u - 16.4);
      const fx = LX + FLAG_X * k + fly * fly * 60 * k;
      const fy = G - (fly > 0 ? (fly * 22 - fly * fly * 2) * k : 0);
      const tilt = gust * 0.5 + fly * 2.2;
      if (fx < W + 80 * k) {
        ctx!.globalAlpha = 1 - phase(u, 18.8, 19.8);
        flag(pal, fx, fy, k, grow, t * 4 + gust * 6, tilt);
        ctx!.globalAlpha = 1;
      }
    }

    // Ракета
    const rh = u < 4 ? lerp(sky0, 0, easeOut(u / 4)) : u < 14 ? 0 : lerp(0, sky0 + 60, easeIn((u - 14) / 4.2));
    if (u < 18.6) rocket(pal, LX, G - rh * k, k, u, t);

    // Пыль при посадке и взлёте
    if (!opt.still && ((u > 3.3 && u < 4.4) || (u > 13.9 && u < 15))) {
      for (let i = 0; i < 3; i++) {
        const s = Math.random() > 0.5 ? 1 : -1;
        dust.push({ x: LX + s * Math.random() * 10 * k, y: G - 2, vx: s * (20 + Math.random() * 70) * k, vy: -(4 + Math.random() * 18) * k, life: 1, r: (2 + Math.random() * 4) * k });
      }
    }
    dust = dust.filter((d) => (d.life -= dt * 0.7) > 0);
    for (const d of dust) {
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      d.vy += 6 * k * dt;
      d.vx *= 0.985;
      ctx!.fillStyle = `rgba(190,192,202,${(d.life * 0.45).toFixed(3)})`;
      ctx!.beginPath();
      ctx!.arc(d.x, Math.min(d.y, G + 2), d.r * (1.6 - d.life * 0.6), 0, Math.PI * 2);
      ctx!.fill();
    }

    // Космонавт
    const pose = astronaut(u);
    if (pose.visible) {
      const key = `${mission}:${pose.hop}`;
      if (pose.hop >= 0 && pose.h < 0.6 && key !== lastHop && !opt.still) {
        lastHop = key;
        prints.push({ x: LX + pose.x * k, at: t, dir: pose.dir });
      }
      spaceman(pal, pose, LX + pose.x * k, G - pose.h * k, k, t);
    }
    if (!opt.still) raf = requestAnimationFrame(frame);
  }
  raf = requestAnimationFrame(frame);

  return () => {
    cancelAnimationFrame(raf);
    ro.disconnect();
    window.removeEventListener('pointermove', onMove);
  };
}
