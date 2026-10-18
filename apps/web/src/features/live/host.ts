/**
 * Ведущий эфира: захват камеры или экрана, отдельное WebRTC-соединение с
 * каждым зрителем (сервер только передаёт сигналы), запись эфира в файл.
 * Когда зрителей много, битрейт снижается — чтобы хватило исходящего канала.
 */
import { create } from 'zustand';
import type { CallSignal, LiveStream, MediaItem, Post } from '@omni/shared';
import { api, uploadFile } from '../../shared/api/client';
import { getIce } from '../../shared/calls/engine';
import { realtime } from '../../shared/realtime/socket';
import { toast } from '../../shared/stores/ui';
import { onLive } from './bus';

export type LiveSource = 'camera' | 'screen';

interface HostState {
  streamId: string | null;
  source: LiveSource;
  stream: MediaStream | null;
  micOn: boolean;
  camOn: boolean;
  viewers: number;
  startedAt: number | null;
  /** Запись эфира после завершения — её можно опубликовать как видео или скачать */
  recording: { blob: Blob; durationSec: number; poster: Blob | null; width: number; height: number } | null;
}

const initial: HostState = { streamId: null, source: 'camera', stream: null, micOn: true, camOn: true, viewers: 0, startedAt: null, recording: null };
export const useHost = create<HostState>(() => ({ ...initial }));

const peers = new Map<string, RTCPeerConnection>();
let unsubscribe: (() => void) | null = null;
let recorder: MediaRecorder | null = null;
let chunks: Blob[] = [];
let mixCtx: AudioContext | null = null;

/** Чем больше зрителей, тем ниже битрейт: исходящего канала ведущего должно хватить на всех. */
const bitrateFor = (viewers: number) => (viewers <= 4 ? 1_500_000 : viewers <= 12 ? 800_000 : viewers <= 25 ? 500_000 : 300_000);

function applyBitrate() {
  const max = bitrateFor(peers.size);
  for (const pc of peers.values()) {
    for (const sender of pc.getSenders()) {
      if (sender.track?.kind !== 'video') continue;
      const p = sender.getParameters();
      if (!p.encodings?.length) p.encodings = [{}];
      p.encodings[0]!.maxBitrate = max;
      void sender.setParameters(p).catch(() => undefined);
    }
  }
}

/** Экран со звуком системы + микрофон смешиваются в одну дорожку. */
function mixAudio(tracks: MediaStreamTrack[]): MediaStreamTrack | null {
  if (tracks.length <= 1) return tracks[0] ?? null;
  mixCtx = new AudioContext();
  const dest = mixCtx.createMediaStreamDestination();
  for (const t of tracks) mixCtx.createMediaStreamSource(new MediaStream([t])).connect(dest);
  return dest.stream.getAudioTracks()[0] ?? null;
}

/** Предпросмотр перед эфиром: камера или экран с микрофоном. */
export async function prepareSource(source: LiveSource): Promise<MediaStream> {
  stopTracks();
  let stream: MediaStream;
  if (source === 'camera') {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
      audio: { echoCancellation: true, noiseSuppression: true },
    });
  } else {
    const screen = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 30 } }, audio: true });
    const mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }).catch(() => null);
    const audio = mixAudio([...screen.getAudioTracks(), ...(mic?.getAudioTracks() ?? [])]);
    stream = new MediaStream([...screen.getVideoTracks(), ...(audio ? [audio] : [])]);
    // Показ экрана остановлен кнопкой браузера — завершаем эфир
    screen.getVideoTracks()[0]?.addEventListener('ended', () => {
      if (useHost.getState().streamId) {
        toast('Показ экрана остановлен — эфир завершён');
        void endLive();
      }
    });
  }
  useHost.setState({ source, stream, micOn: true, camOn: true, recording: null });
  return stream;
}

function stopTracks() {
  useHost.getState().stream?.getTracks().forEach((t) => t.stop());
  void mixCtx?.close().catch(() => undefined);
  mixCtx = null;
}

const send = (peer: string, signal: CallSignal) => {
  const id = useHost.getState().streamId;
  if (id) realtime.send({ t: 'live.signal', streamId: id, peer, signal });
};

async function addViewer(peer: string) {
  const { stream } = useHost.getState();
  if (!stream || peers.has(peer)) return;
  const pc = new RTCPeerConnection({ iceServers: await getIce() });
  peers.set(peer, pc);
  stream.getTracks().forEach((t) => pc.addTrack(t, stream));
  pc.onicecandidate = (e) => {
    if (e.candidate) send(peer, { type: 'ice', candidate: e.candidate.candidate, sdpMid: e.candidate.sdpMid, sdpMLineIndex: e.candidate.sdpMLineIndex });
  };
  pc.onconnectionstatechange = () => {
    // Зритель отвалился — он переподключится сам, а соединение освобождаем
    if (pc.connectionState === 'failed' || pc.connectionState === 'closed') dropViewer(peer);
  };
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  send(peer, { type: 'offer', sdp: offer.sdp ?? '' });
  useHost.setState({ viewers: peers.size });
  applyBitrate();
}

function dropViewer(peer: string) {
  peers.get(peer)?.close();
  if (peers.delete(peer)) {
    useHost.setState({ viewers: peers.size });
    applyBitrate();
  }
}

async function onSignal(peer: string, signal: CallSignal) {
  const pc = peers.get(peer);
  if (!pc) return;
  if (signal.type === 'answer') await pc.setRemoteDescription({ type: 'answer', sdp: signal.sdp }).catch(() => undefined);
  else if (signal.type === 'ice') await pc.addIceCandidate({ candidate: signal.candidate, sdpMid: signal.sdpMid, sdpMLineIndex: signal.sdpMLineIndex }).catch(() => undefined);
}

function startRecording(stream: MediaStream) {
  chunks = [];
  const type = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'].find((t) => MediaRecorder.isTypeSupported(t));
  if (!type) return;
  recorder = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 900_000, audioBitsPerSecond: 64_000 });
  recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  recorder.start(2000);
}

/** Кадр из эфира — обложка для записи. */
async function grabPoster(stream: MediaStream): Promise<{ poster: Blob | null; width: number; height: number }> {
  const v = document.createElement('video');
  v.muted = true;
  v.playsInline = true;
  v.srcObject = stream;
  await v.play().catch(() => undefined);
  await new Promise((r) => setTimeout(r, 150));
  const scale = Math.min(1, 1280 / Math.max(v.videoWidth || 1, v.videoHeight || 1));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round((v.videoWidth || 1280) * scale);
  canvas.height = Math.round((v.videoHeight || 720) * scale);
  canvas.getContext('2d')?.drawImage(v, 0, 0, canvas.width, canvas.height);
  const poster = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.82));
  v.srcObject = null;
  return { poster, width: v.videoWidth, height: v.videoHeight };
}

export async function goLive(input: { title: string; description: string; record: boolean }): Promise<LiveStream> {
  const { stream } = useHost.getState();
  if (!stream) throw new Error('Сначала выберите камеру или экран');
  const live = await api.post<LiveStream>('/live', input);
  useHost.setState({ streamId: live.id, startedAt: Date.now(), viewers: 0 });
  unsubscribe?.();
  unsubscribe = onLive((e) => {
    if (e.t === 'live.viewer' && e.streamId === live.id) {
      if (e.joined) void addViewer(e.peer);
      else dropViewer(e.peer);
    }
    if (e.t === 'live.signal' && e.streamId === live.id) void onSignal(e.peer, e.signal);
  });
  if (input.record && typeof MediaRecorder !== 'undefined') startRecording(stream);
  return live;
}

export async function endLive(): Promise<void> {
  const { streamId, stream, startedAt } = useHost.getState();
  if (!streamId) return;
  unsubscribe?.();
  unsubscribe = null;
  for (const peer of [...peers.keys()]) dropViewer(peer);
  let recording: HostState['recording'] = null;
  if (recorder && stream) {
    const frame = await grabPoster(stream);
    const stopped = new Promise((r) => recorder!.addEventListener('stop', r, { once: true }));
    recorder.stop();
    await stopped;
    const blob = new Blob(chunks, { type: recorder.mimeType });
    recording = { blob, durationSec: Math.round((Date.now() - (startedAt ?? Date.now())) / 1000), ...frame };
    recorder = null;
    chunks = [];
  }
  await api.post(`/live/${streamId}/end`).catch(() => undefined);
  stopTracks();
  useHost.setState({ ...initial, recording });
}

export function toggleMic(): void {
  const s = useHost.getState();
  s.stream?.getAudioTracks().forEach((t) => (t.enabled = !s.micOn));
  useHost.setState({ micOn: !s.micOn });
}

export function toggleCam(): void {
  const s = useHost.getState();
  s.stream?.getVideoTracks().forEach((t) => (t.enabled = !s.camOn));
  useHost.setState({ camOn: !s.camOn });
}

/** Опубликовать запись эфира как видео в разделе «Видео». */
export async function publishRecording(streamId: string, title: string, description: string, onProgress: (f: number) => void): Promise<Post> {
  const rec = useHost.getState().recording;
  if (!rec) throw new Error('Записи нет');
  let posterId: string | undefined;
  if (rec.poster) posterId = (await uploadFile(rec.poster, 'poster.jpg')).id;
  const ext = rec.blob.type.includes('mp4') ? 'mp4' : 'webm';
  const media: MediaItem = await uploadFile(rec.blob, `efir.${ext}`, { width: rec.width, height: rec.height, duration: rec.durationSec, posterId, onProgress });
  const post = await api.post<Post>('/posts', { kind: 'video', title, text: description, mediaIds: [media.id], visibility: 'public' });
  await api.post(`/live/${streamId}/recording`, { recordingPostId: post.id }).catch(() => undefined);
  useHost.setState({ recording: null });
  return post;
}

export function discardRecording(): void {
  useHost.setState({ recording: null });
}

/** Ушли со страницы подготовки, не начав эфир, — выключаем камеру. */
export function releasePreview(): void {
  if (!useHost.getState().streamId) {
    stopTracks();
    useHost.setState({ stream: null });
  }
}
