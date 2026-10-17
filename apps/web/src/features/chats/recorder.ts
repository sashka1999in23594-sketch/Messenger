/**
 * Запись голосовых сообщений и видео-кружков в браузере (MediaRecorder).
 * Волна голосового считается на устройстве по громкости и отправляется
 * вместе с файлом — так её не нужно вычислять на сервере.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { LIMITS } from '@omni/shared';

export interface Recording {
  blob: Blob;
  mime: string;
  ext: string;
  durationSec: number;
  /** Волна: 64 значения 0–255 (только голосовые) */
  waveform: number[];
  /** Кадр-обложка (только кружки) */
  poster: Blob | null;
}

type Mode = 'voice' | 'round';

const AUDIO_TYPES = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4', 'audio/webm'];
const VIDEO_TYPES = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/mp4', 'video/webm'];

function pickType(list: string[]): string {
  return list.find((t) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t)) ?? '';
}

/** Сжимает поток уровней громкости в N столбиков 0–255. */
export function compressLevels(levels: number[], bars = 64): number[] {
  if (!levels.length) return Array(bars).fill(0);
  const out: number[] = [];
  for (let i = 0; i < bars; i++) {
    const from = Math.floor((i * levels.length) / bars);
    const to = Math.max(from + 1, Math.floor(((i + 1) * levels.length) / bars));
    const slice = levels.slice(from, to);
    out.push(Math.max(...slice));
  }
  const peak = Math.max(...out, 0.01);
  return out.map((v) => Math.round(Math.min(1, v / peak) * 255));
}

export function waveformToBase64(w: number[]): string {
  let bin = '';
  for (const v of w) bin += String.fromCharCode(v);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function useRecorder(mode: Mode) {
  const [state, setState] = useState<'idle' | 'starting' | 'recording'>('idle');
  const [elapsed, setElapsed] = useState(0);
  const [levels, setLevels] = useState<number[]>([]);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const rec = useRef<{
    recorder: MediaRecorder;
    chunks: Blob[];
    started: number;
    all: number[];
    ctx: AudioContext | null;
    timer: number;
    poster: Blob | null;
    mime: string;
  } | null>(null);

  const cleanup = useCallback(() => {
    const r = rec.current;
    if (r) {
      window.clearInterval(r.timer);
      void r.ctx?.close().catch(() => undefined);
    }
    stream?.getTracks().forEach((t) => t.stop());
    rec.current = null;
    setStream(null);
    setState('idle');
    setElapsed(0);
    setLevels([]);
  }, [stream]);

  useEffect(() => () => rec.current?.recorder.stream.getTracks().forEach((t) => t.stop()), []);

  const start = useCallback(async () => {
    setError(null);
    if (typeof MediaRecorder === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setError('Браузер не поддерживает запись');
      return false;
    }
    setState('starting');
    let media: MediaStream;
    try {
      media = await navigator.mediaDevices.getUserMedia(
        mode === 'voice'
          ? { audio: { echoCancellation: true, noiseSuppression: true } }
          : { audio: { echoCancellation: true }, video: { width: { ideal: 480 }, height: { ideal: 480 }, aspectRatio: 1, facingMode: 'user' } },
      );
    } catch {
      setState('idle');
      setError(mode === 'voice' ? 'Нет доступа к микрофону — разрешите его в настройках браузера' : 'Нет доступа к камере или микрофону');
      return false;
    }
    const mime = pickType(mode === 'voice' ? AUDIO_TYPES : VIDEO_TYPES);
    const recorder = new MediaRecorder(media, mime ? { mimeType: mime, audioBitsPerSecond: 64_000, videoBitsPerSecond: 900_000 } : undefined);
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);

    // Уровень громкости — для живой волны и итоговой формы
    let ctx: AudioContext | null = null;
    let analyser: AnalyserNode | null = null;
    try {
      ctx = new AudioContext();
      analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      ctx.createMediaStreamSource(media).connect(analyser);
    } catch {
      ctx = null;
    }
    const buf = new Uint8Array(analyser?.fftSize ?? 0);
    const all: number[] = [];
    const started = Date.now();
    const max = mode === 'voice' ? LIMITS.voiceMaxSec : LIMITS.roundMaxSec;
    const timer = window.setInterval(() => {
      const sec = (Date.now() - started) / 1000;
      setElapsed(sec);
      if (analyser) {
        analyser.getByteTimeDomainData(buf);
        let sum = 0;
        for (const v of buf) sum += ((v - 128) / 128) ** 2;
        const level = Math.min(1, Math.sqrt(sum / buf.length) * 3.2);
        all.push(level);
        setLevels((l) => [...l.slice(-47), level]);
      }
      if (sec >= max) recorder.stop();
    }, 80);

    rec.current = { recorder, chunks, started, all, ctx, timer, poster: null, mime: recorder.mimeType || mime };
    recorder.start(250);
    setStream(media);
    setState('recording');
    return true;
  }, [mode]);

  /** Снимок кадра для обложки кружка. */
  const capturePoster = useCallback((video: HTMLVideoElement | null) => {
    const r = rec.current;
    if (!r || !video || !video.videoWidth) return;
    const side = Math.min(video.videoWidth, video.videoHeight);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 320;
    const c2d = canvas.getContext('2d');
    if (!c2d) return;
    c2d.translate(320, 0);
    c2d.scale(-1, 1); // фронтальная камера — зеркально, как видит себя человек
    c2d.drawImage(video, (video.videoWidth - side) / 2, (video.videoHeight - side) / 2, side, side, 0, 0, 320, 320);
    canvas.toBlob((b) => r && (r.poster = b), 'image/jpeg', 0.82);
  }, []);

  const stop = useCallback((): Promise<Recording | null> => {
    const r = rec.current;
    if (!r) return Promise.resolve(null);
    return new Promise((resolve) => {
      const finish = () => {
        const durationSec = Math.max(1, Math.round((Date.now() - r.started) / 100) / 10);
        const type = (r.mime || r.chunks[0]?.type || (mode === 'voice' ? 'audio/webm' : 'video/webm')).split(';')[0]!;
        const blob = new Blob(r.chunks, { type });
        const ext = type.includes('mp4') ? (mode === 'voice' ? 'm4a' : 'mp4') : type.includes('ogg') ? 'ogg' : 'webm';
        const out: Recording = { blob, mime: type, ext, durationSec, waveform: compressLevels(r.all), poster: r.poster };
        cleanup();
        resolve(durationSec < 0.6 || blob.size < 200 ? null : out);
      };
      if (r.recorder.state === 'inactive') finish();
      else {
        r.recorder.addEventListener('stop', finish, { once: true });
        r.recorder.stop();
      }
    });
  }, [cleanup, mode]);

  const cancel = useCallback(() => {
    const r = rec.current;
    if (r && r.recorder.state !== 'inactive') {
      r.recorder.ondataavailable = null;
      r.recorder.stop();
    }
    cleanup();
  }, [cleanup]);

  return { state, elapsed, levels, stream, error, start, stop, cancel, capturePoster };
}

export function fmtSec(sec: number): string {
  const s = Math.floor(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
