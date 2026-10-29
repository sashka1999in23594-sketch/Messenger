/**
 * Студия трансляций: сцена собирается на <canvas> из нескольких источников
 * (фон — цвет, фото или видео; экран; камера отдельным окошком), а звук
 * микшируется из микрофона, звука экрана и фоновой музыки. Готовый кадр и
 * звук отдаются одним потоком (canvas.captureStream + микс), который и уходит
 * зрителям — как в OBS. Переключение источников и громкости на лету не рвёт
 * соединение: видеодорожка холста и общая аудиодорожка остаются теми же.
 */

export type Layout = 'camera' | 'screen' | 'screen-cam';
export type BgKind = 'color' | 'image' | 'video';

export interface StudioLevels {
  mic: number;
  music: number;
}

const W = 1280;
const H = 720;

export class StudioEngine {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private raf = 0;

  // Источники видео
  camera: MediaStream | null = null;
  screen: MediaStream | null = null;
  private camEl = document.createElement('video');
  private screenEl = document.createElement('video');
  private bgVideoEl = document.createElement('video');
  private bgImg: HTMLImageElement | null = null;

  bg: { kind: BgKind; color: string } = { kind: 'color', color: '#0b0b12' };
  layout: Layout = 'camera';
  camShape: 'rect' | 'circle' = 'rect';
  camOn = true;
  showOverlay = true;
  title = '';

  // Звук
  private audioCtx: AudioContext | null = null;
  private dest: MediaStreamAudioDestinationNode | null = null;
  private micGain: GainNode | null = null;
  private screenGain: GainNode | null = null;
  private musicGain: GainNode | null = null;
  private micAnalyser: AnalyserNode | null = null;
  private musicAnalyser: AnalyserNode | null = null;
  private musicEl: HTMLAudioElement | null = null;
  private musicSrc: MediaElementAudioSourceNode | null = null;
  micMuted = false;

  output: MediaStream | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    canvas.width = W;
    canvas.height = H;
    this.ctx = canvas.getContext('2d', { alpha: false })!;
    for (const v of [this.camEl, this.screenEl, this.bgVideoEl]) {
      v.muted = true;
      v.playsInline = true;
      v.autoplay = true;
    }
    this.bgVideoEl.loop = true;
  }

  /** Запустить отрисовку и собрать выходной поток. */
  begin(): MediaStream {
    this.audioCtx = new AudioContext();
    this.dest = this.audioCtx.createMediaStreamDestination();
    this.micGain = this.audioCtx.createGain();
    this.screenGain = this.audioCtx.createGain();
    this.musicGain = this.audioCtx.createGain();
    this.musicGain.gain.value = 0.6;
    this.micAnalyser = this.audioCtx.createAnalyser();
    this.musicAnalyser = this.audioCtx.createAnalyser();
    this.micGain.connect(this.micAnalyser).connect(this.dest);
    this.screenGain.connect(this.dest);
    this.musicGain.connect(this.musicAnalyser).connect(this.dest);
    const videoTrack = this.canvas.captureStream(30).getVideoTracks()[0]!;
    const audioTrack = this.dest.stream.getAudioTracks()[0]!;
    this.output = new MediaStream([videoTrack, audioTrack]);
    const loop = () => {
      this.draw();
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
    return this.output;
  }

  private connectMic(track: MediaStreamTrack) {
    if (!this.audioCtx || !this.micGain) return;
    this.audioCtx.createMediaStreamSource(new MediaStream([track])).connect(this.micGain);
  }
  private connectScreenAudio(track: MediaStreamTrack) {
    if (!this.audioCtx || !this.screenGain) return;
    this.audioCtx.createMediaStreamSource(new MediaStream([track])).connect(this.screenGain);
  }

  async enableCamera(deviceId?: string, micId?: string): Promise<void> {
    this.camera?.getTracks().forEach((t) => t.stop());
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 }, ...(deviceId ? { deviceId: { exact: deviceId } } : { facingMode: 'user' }) },
      audio: { echoCancellation: true, noiseSuppression: true, ...(micId ? { deviceId: { exact: micId } } : {}) },
    });
    this.camera = stream;
    this.camEl.srcObject = new MediaStream(stream.getVideoTracks());
    await this.camEl.play().catch(() => undefined);
    const mic = stream.getAudioTracks()[0];
    if (mic) this.connectMic(mic);
    if (this.layout === 'screen') this.layout = this.screen ? 'screen-cam' : 'camera';
    else if (!this.screen) this.layout = 'camera';
  }

  async enableScreen(): Promise<void> {
    const stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 30 } }, audio: true });
    this.screen = stream;
    this.screenEl.srcObject = new MediaStream(stream.getVideoTracks());
    await this.screenEl.play().catch(() => undefined);
    const sa = stream.getAudioTracks()[0];
    if (sa) this.connectScreenAudio(sa);
    this.layout = this.camera ? 'screen-cam' : 'screen';
    stream.getVideoTracks()[0]?.addEventListener('ended', () => this.disableScreen());
  }

  disableCamera(): void {
    this.camera?.getTracks().forEach((t) => t.stop());
    this.camera = null;
    this.camEl.srcObject = null;
    if (this.layout !== 'screen') this.layout = this.screen ? 'screen' : 'camera';
  }

  disableScreen(): void {
    this.screen?.getTracks().forEach((t) => t.stop());
    this.screen = null;
    this.screenEl.srcObject = null;
    this.layout = 'camera';
  }

  setBackgroundColor(color: string): void {
    this.bg = { kind: 'color', color };
    this.bgImg = null;
    this.bgVideoEl.pause();
  }
  async setBackgroundImage(file: File): Promise<void> {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.src = url;
    await img.decode().catch(() => undefined);
    this.bgImg = img;
    this.bg = { kind: 'image', color: this.bg.color };
    this.bgVideoEl.pause();
  }
  async setBackgroundVideo(file: File): Promise<void> {
    this.bgVideoEl.src = URL.createObjectURL(file);
    await this.bgVideoEl.play().catch(() => undefined);
    this.bg = { kind: 'video', color: this.bg.color };
    this.bgImg = null;
  }

  async setMusic(file: File): Promise<void> {
    if (!this.audioCtx || !this.musicGain) return;
    this.musicEl?.pause();
    this.musicSrc?.disconnect();
    const el = new Audio(URL.createObjectURL(file));
    el.loop = true;
    el.crossOrigin = 'anonymous';
    this.musicEl = el;
    this.musicSrc = this.audioCtx.createMediaElementSource(el);
    this.musicSrc.connect(this.musicGain);
    await el.play().catch(() => undefined);
  }
  toggleMusic(): boolean {
    if (!this.musicEl) return false;
    if (this.musicEl.paused) void this.musicEl.play().catch(() => undefined);
    else this.musicEl.pause();
    return !this.musicEl.paused;
  }
  get hasMusic(): boolean {
    return !!this.musicEl;
  }
  get musicPlaying(): boolean {
    return !!this.musicEl && !this.musicEl.paused;
  }

  setMicVolume(v: number): void {
    if (this.micGain) this.micGain.gain.value = this.micMuted ? 0 : v;
  }
  setMusicVolume(v: number): void {
    if (this.musicGain) this.musicGain.gain.value = v;
  }
  toggleMic(): boolean {
    this.micMuted = !this.micMuted;
    if (this.micGain) this.micGain.gain.value = this.micMuted ? 0 : 1;
    return !this.micMuted;
  }
  toggleCam(): boolean {
    this.camOn = !this.camOn;
    return this.camOn;
  }

  levels(): StudioLevels {
    return { mic: analyserLevel(this.micAnalyser), music: analyserLevel(this.musicAnalyser) };
  }

  private draw(): void {
    const ctx = this.ctx;
    // Фон
    if (this.bg.kind === 'image' && this.bgImg?.complete) coverDraw(ctx, this.bgImg, this.bgImg.naturalWidth, this.bgImg.naturalHeight);
    else if (this.bg.kind === 'video' && this.bgVideoEl.readyState >= 2) coverDraw(ctx, this.bgVideoEl, this.bgVideoEl.videoWidth, this.bgVideoEl.videoHeight);
    else {
      ctx.fillStyle = this.bg.color;
      ctx.fillRect(0, 0, W, H);
    }

    const camReady = this.camOn && this.camera && this.camEl.readyState >= 2;
    const screenReady = this.screen && this.screenEl.readyState >= 2;

    if (this.layout !== 'camera' && screenReady) coverDraw(ctx, this.screenEl, this.screenEl.videoWidth, this.screenEl.videoHeight);

    if (camReady) {
      if (this.layout === 'screen-cam' && screenReady) {
        // Камера окошком в углу
        const w = W * 0.26;
        const h = w * 0.5625;
        const x = W - w - 28;
        const y = H - h - 28;
        this.drawCam(x, y, w, h);
      } else if (this.layout !== 'screen') {
        // Камера на весь кадр
        coverDraw(ctx, this.camEl, this.camEl.videoWidth, this.camEl.videoHeight);
      }
    }

    if (this.showOverlay && this.title.trim()) this.drawTitle();
  }

  private drawCam(x: number, y: number, w: number, h: number): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.5)';
    ctx.shadowBlur = 24;
    ctx.shadowOffsetY = 8;
    roundRect(ctx, x, y, w, h, 16);
    ctx.clip();
    coverDraw(ctx, this.camEl, this.camEl.videoWidth, this.camEl.videoHeight, x, y, w, h);
    ctx.restore();
    ctx.save();
    roundRect(ctx, x, y, w, h, 16);
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.stroke();
    ctx.restore();
  }

  private drawTitle(): void {
    const ctx = this.ctx;
    const pad = 36;
    ctx.save();
    ctx.font = '600 34px Inter, system-ui, sans-serif';
    const text = this.title.trim().slice(0, 60);
    const tw = ctx.measureText(text).width;
    const grad = ctx.createLinearGradient(pad, 0, pad + tw + 44, 0);
    grad.addColorStop(0, 'rgba(240,137,15,0.95)');
    grad.addColorStop(1, 'rgba(240,98,15,0.95)');
    roundRect(ctx, pad, H - 92, tw + 44, 52, 26);
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, pad + 22, H - 66);
    ctx.restore();
  }

  destroy(): void {
    cancelAnimationFrame(this.raf);
    this.camera?.getTracks().forEach((t) => t.stop());
    this.screen?.getTracks().forEach((t) => t.stop());
    this.musicEl?.pause();
    this.output?.getTracks().forEach((t) => t.stop());
    void this.audioCtx?.close().catch(() => undefined);
    for (const v of [this.camEl, this.screenEl, this.bgVideoEl]) v.srcObject = null;
  }
}

function analyserLevel(a: AnalyserNode | null): number {
  if (!a) return 0;
  const buf = new Uint8Array(a.fftSize);
  a.getByteTimeDomainData(buf);
  let peak = 0;
  for (let i = 0; i < buf.length; i++) peak = Math.max(peak, Math.abs(buf[i]! - 128));
  return Math.min(1, (peak / 128) * 1.6);
}

/** Нарисовать источник, заполняя область (cover), с центрированием. */
function coverDraw(ctx: CanvasRenderingContext2D, src: CanvasImageSource, sw: number, sh: number, dx = 0, dy = 0, dw = W, dh = H): void {
  if (!sw || !sh) return;
  const scale = Math.max(dw / sw, dh / sh);
  const w = sw * scale;
  const h = sh * scale;
  ctx.drawImage(src, dx + (dw - w) / 2, dy + (dh - h) / 2, w, h);
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
