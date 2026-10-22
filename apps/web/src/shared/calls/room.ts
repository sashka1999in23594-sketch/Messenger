/**
 * Групповые звонки до 50 человек на WebRTC: каждый участник соединён с каждым
 * напрямую («сетка»), сервер только пересылает сигналы. Чтобы канал не
 * захлебнулся, качество отправляемого видео подстраивается под число людей:
 * вдвоём — HD, в большой встрече — небольшое изображение с низкой частотой.
 *
 * Согласование по схеме «perfect negotiation»: обе стороны могут в любой момент
 * добавить поток (демонстрация экрана), «вежливая» уступает при столкновении.
 */
import { create } from 'zustand';
import type { CallRoom, LiveChatMessage, RoomSignal, ServerEvent, UserSummary } from '@omni/shared';
import { api, errorMessage } from '../api/client';
import { realtime } from '../realtime/socket';
import { useSession } from '../stores/session';
import { toast } from '../stores/ui';
import { isQuietNow, usePrefs } from '../stores/prefs';
import { desktopNotify } from '../lib/sounds';
import { getIce, useCall } from './engine';

export type RoomPhase = 'idle' | 'incoming' | 'joining' | 'active' | 'ended';

export interface PeerMedia {
  audio: boolean;
  video: boolean;
  /** Идентификатор потока демонстрации экрана (если человек показывает экран) */
  screen: string | null;
  hand: boolean;
}

export interface RoomPeer {
  userId: string;
  /** Камера и микрофон */
  stream: MediaStream;
  /** Демонстрация экрана */
  screen: MediaStream | null;
  media: PeerMedia;
  conn: 'connecting' | 'connected' | 'failed';
}

interface RoomState {
  room: CallRoom | null;
  phase: RoomPhase;
  invitedBy: UserSummary | null;
  local: MediaStream | null;
  screen: MediaStream | null;
  /** Вместо камеры идёт сцена из студии */
  studio: MediaStream | null;
  muted: boolean;
  cameraOff: boolean;
  hand: boolean;
  peers: Record<string, RoomPeer>;
  chat: LiveChatMessage[];
  unread: number;
  chatOpen: boolean;
  startedAt: number | null;
  endedText: string | null;
  minimized: boolean;
  /** Громкость собеседников, 0…1 */
  volume: number;
}

const initial: RoomState = {
  room: null,
  phase: 'idle',
  invitedBy: null,
  local: null,
  screen: null,
  studio: null,
  muted: false,
  cameraOff: false,
  hand: false,
  peers: {},
  chat: [],
  unread: 0,
  chatOpen: false,
  startedAt: null,
  endedText: null,
  minimized: false,
  volume: 1,
};

export const useRoom = create<RoomState>(() => ({ ...initial }));

interface Link {
  pc: RTCPeerConnection;
  polite: boolean;
  makingOffer: boolean;
  ignoreOffer: boolean;
  pendingIce: RTCIceCandidateInit[];
  /** Отправитель видео камеры (или сцены студии) */
  camera: RTCRtpSender | null;
  /** Отправители демонстрации экрана */
  screen: RTCRtpSender[];
  streams: Map<string, MediaStream>;
  /** Каналы настроены — можно самим предлагать пересогласование */
  ready: boolean;
}

const links = new Map<string, Link>();
let ring: { stop: () => void } | null = null;
let ringTimer: number | null = null;
let endTimer: number | null = null;

const me = () => useSession.getState().me?.id ?? '';
const roomId = () => useRoom.getState().room?.id ?? '';

function send(to: string, signal: RoomSignal) {
  const id = roomId();
  if (id) realtime.send({ t: 'room.signal', roomId: id, to, signal });
}

function myMedia(): RoomSignal {
  const s = useRoom.getState();
  return { type: 'media', audio: !s.muted, video: !s.cameraOff || !!s.studio, screen: s.screen?.id ?? null, hand: s.hand };
}

const broadcastMedia = () => links.forEach((_, id) => send(id, myMedia()));

function patchPeer(userId: string, f: (p: RoomPeer) => Partial<RoomPeer>) {
  const p = useRoom.getState().peers[userId];
  if (p) useRoom.setState({ peers: { ...useRoom.getState().peers, [userId]: { ...p, ...f(p) } } });
}

// ─── Мелодия приглашения ─────────────────────────────────────────────────────

function startRing() {
  ring?.stop();
  const { sounds, quietHours } = usePrefs.getState();
  if (sounds?.calls === false || isQuietNow(quietHours)) return;
  let ctx: AudioContext | null = null;
  try {
    ctx = new AudioContext();
  } catch {
    return;
  }
  const play = () => {
    if (!ctx) return;
    const t = ctx.currentTime;
    for (const [i, f] of [784, 988, 1175].entries()) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = f;
      g.gain.setValueAtTime(0, t + i * 0.16);
      g.gain.linearRampToValueAtTime(0.14 * (sounds?.volume ?? 0.6), t + i * 0.16 + 0.02);
      g.gain.linearRampToValueAtTime(0, t + i * 0.16 + 0.3);
      o.connect(g).connect(ctx.destination);
      o.start(t + i * 0.16);
      o.stop(t + i * 0.16 + 0.35);
    }
  };
  play();
  const timer = window.setInterval(play, 2400);
  ring = {
    stop: () => {
      window.clearInterval(timer);
      void ctx?.close().catch(() => undefined);
      ring = null;
    },
  };
}

function stopRing() {
  ring?.stop();
  if (ringTimer) window.clearTimeout(ringTimer);
  ringTimer = null;
}

// ─── Качество под размер встречи ─────────────────────────────────────────────

/** Чем больше людей, тем меньше картинка и битрейт каждого потока: общий исходящий канал ~3 Мбит/с. */
function videoBudget(peers: number): { maxBitrate: number; scale: number; fps: number } {
  if (peers <= 1) return { maxBitrate: 1_500_000, scale: 1, fps: 30 };
  if (peers <= 3) return { maxBitrate: 800_000, scale: 1.5, fps: 30 };
  if (peers <= 8) return { maxBitrate: 350_000, scale: 2, fps: 24 };
  if (peers <= 16) return { maxBitrate: 180_000, scale: 3, fps: 15 };
  return { maxBitrate: 90_000, scale: 4, fps: 12 };
}

async function tune(link: Link) {
  const sender = link.camera;
  if (!sender?.track) return;
  const b = videoBudget(links.size);
  try {
    const params = sender.getParameters();
    if (!params.encodings?.length) return;
    params.encodings[0]!.maxBitrate = b.maxBitrate;
    params.encodings[0]!.maxFramerate = b.fps;
    // Сцену студии не уменьшаем так сильно — на ней текст
    params.encodings[0]!.scaleResolutionDownBy = useRoom.getState().studio ? Math.min(b.scale, 2) : b.scale;
    await sender.setParameters(params);
  } catch {
    // браузер не поддерживает — оставляем как есть
  }
  // Экран важнее камеры: ему отдаём больше канала
  for (const s of link.screen) {
    try {
      const params = s.getParameters();
      if (!params.encodings?.length) continue;
      params.encodings[0]!.maxBitrate = Math.max(250_000, b.maxBitrate * 2);
      await s.setParameters(params);
    } catch {
      // нет поддержки
    }
  }
}

const tuneAll = () => links.forEach((l) => void tune(l));

// ─── Соединения ─────────────────────────────────────────────────────────────

/** Видео, которое мы сейчас отправляем: сцена студии или камера. */
function outgoingVideo(): MediaStreamTrack | null {
  const s = useRoom.getState();
  return s.studio?.getVideoTracks()[0] ?? s.local?.getVideoTracks()[0] ?? null;
}

/**
 * Соединение с участником. Предлагает соединение тот, кто вошёл позже
 * (`initiator`): он сразу добавляет звук и видеоканал. Вторая сторона ждёт
 * предложения и отвечает на тех же каналах — так у пары ровно по одному
 * каналу звука и видео в каждую сторону.
 */
async function connect(userId: string, initiator: boolean): Promise<Link> {
  const existing = links.get(userId);
  if (existing) return existing;
  const pc = new RTCPeerConnection({ iceServers: await getIce() });
  const link: Link = { pc, polite: me() < userId, makingOffer: false, ignoreOffer: false, pendingIce: [], camera: null, screen: [], streams: new Map(), ready: initiator };
  // Пока ждали серверы ICE, соединение могли создать параллельно
  const raced = links.get(userId);
  if (raced) {
    pc.close();
    return raced;
  }
  links.set(userId, link);
  const s = useRoom.getState();
  const local = s.local ?? new MediaStream();
  if (initiator) {
    for (const t of local.getAudioTracks()) pc.addTrack(t, local);
    // Видеоканал есть всегда: камеру или сцену можно включить позже без пересогласования
    link.camera = pc.addTransceiver('video', { direction: 'sendrecv', streams: [local] }).sender;
    const video = outgoingVideo();
    if (video) void link.camera.replaceTrack(video);
    if (s.screen) for (const t of s.screen.getTracks()) link.screen.push(pc.addTrack(t, s.screen));
  }

  const stream = new MediaStream();
  useRoom.setState({
    peers: {
      ...useRoom.getState().peers,
      [userId]: { userId, stream, screen: null, media: { audio: true, video: true, screen: null, hand: false }, conn: 'connecting' },
    },
  });

  pc.ontrack = (e) => {
    const src = e.streams[0];
    if (src) link.streams.set(src.id, src);
    const peer = useRoom.getState().peers[userId];
    if (!peer) return;
    if (src && peer.media.screen && src.id === peer.media.screen) {
      patchPeer(userId, () => ({ screen: src }));
      return;
    }
    if (!peer.stream.getTracks().includes(e.track)) peer.stream.addTrack(e.track);
    e.track.onunmute = () => patchPeer(userId, () => ({}));
    patchPeer(userId, () => ({}));
  };
  pc.onicecandidate = (e) => {
    if (e.candidate) send(userId, { type: 'ice', candidate: e.candidate.candidate, sdpMid: e.candidate.sdpMid, sdpMLineIndex: e.candidate.sdpMLineIndex });
  };
  pc.onnegotiationneeded = async () => {
    // Отвечающая сторона не начинает, пока не получила первое предложение
    if (!link.ready) return;
    try {
      link.makingOffer = true;
      await pc.setLocalDescription();
      if (pc.localDescription) send(userId, { type: pc.localDescription.type as 'offer', sdp: pc.localDescription.sdp });
    } catch {
      // повторит следующее согласование
    } finally {
      link.makingOffer = false;
    }
  };
  pc.onconnectionstatechange = () => {
    const st = pc.connectionState;
    if (st === 'connected') {
      patchPeer(userId, () => ({ conn: 'connected' }));
      send(userId, myMedia());
      void tune(link);
    } else if (st === 'failed') {
      patchPeer(userId, () => ({ conn: 'failed' }));
      if (link.ready && initiator) pc.restartIce();
    } else if (st === 'disconnected') patchPeer(userId, () => ({ conn: 'connecting' }));
  };
  tuneAll();
  return link;
}

/** Первое предложение получено: отвечаем своим звуком и видео на предложенных каналах. */
async function answerWithMedia(link: Link) {
  const s = useRoom.getState();
  const local = s.local ?? new MediaStream();
  let audio = false;
  for (const t of link.pc.getTransceivers()) {
    const kind = t.receiver.track.kind;
    if (kind === 'audio' && !audio) {
      audio = true;
      const track = local.getAudioTracks()[0] ?? null;
      await t.sender.replaceTrack(track);
      t.sender.setStreams?.(local);
      t.direction = 'sendrecv';
    } else if (kind === 'video' && !link.camera) {
      link.camera = t.sender;
      await t.sender.replaceTrack(outgoingVideo());
      t.sender.setStreams?.(local);
      t.direction = 'sendrecv';
    }
  }
  link.ready = true;
}

function drop(userId: string) {
  const link = links.get(userId);
  if (link) {
    link.pc.close();
    links.delete(userId);
  }
  const peers = { ...useRoom.getState().peers };
  delete peers[userId];
  useRoom.setState({ peers });
  tuneAll();
}

async function onSignal(from: string, sig: RoomSignal) {
  if (sig.type === 'media') {
    const link = links.get(from);
    patchPeer(from, (p) => ({
      media: { audio: sig.audio, video: sig.video, screen: sig.screen, hand: sig.hand },
      // Поток экрана мог прийти раньше этого сообщения
      screen: sig.screen ? (link?.streams.get(sig.screen) ?? p.screen) : null,
    }));
    return;
  }
  let link = links.get(from);
  // Человек перезашёл: старое соединение с ним уже не годится
  if (link && sig.type === 'offer' && link.ready && (link.pc.connectionState === 'failed' || link.pc.connectionState === 'closed')) {
    drop(from);
    link = undefined;
  }
  link ??= await connect(from, false);
  const pc = link.pc;
  try {
    if (sig.type === 'offer' || sig.type === 'answer') {
      const collision = sig.type === 'offer' && (link.makingOffer || pc.signalingState !== 'stable');
      link.ignoreOffer = !link.polite && collision;
      if (link.ignoreOffer) return;
      await pc.setRemoteDescription({ type: sig.type, sdp: sig.sdp });
      for (const c of link.pendingIce.splice(0)) await pc.addIceCandidate(c).catch(() => undefined);
      if (sig.type === 'offer') {
        const first = !link.ready;
        if (first) await answerWithMedia(link);
        await pc.setLocalDescription();
        if (pc.localDescription) send(from, { type: 'answer', sdp: pc.localDescription.sdp });
        // Экран, который мы уже показываем, — следующим согласованием
        const screen = useRoom.getState().screen;
        if (first && screen) for (const t of screen.getTracks()) link.screen.push(pc.addTrack(t, screen));
      }
    } else if (sig.type === 'ice') {
      const c = { candidate: sig.candidate, sdpMid: sig.sdpMid, sdpMLineIndex: sig.sdpMLineIndex };
      if (pc.remoteDescription) await pc.addIceCandidate(c).catch(() => undefined);
      else link.pendingIce.push(c);
    }
  } catch {
    // сбой согласования — следующее предложение всё исправит
  }
}

/** Привести соединения к составу звонка: новые — подключить, ушедших — отключить. */
async function sync(room: CallRoom) {
  const joined = room.members.filter((m) => m.state === 'joined' && m.user.id !== me());
  const here = new Set(joined.map((m) => m.user.id));
  for (const id of links.keys()) if (!here.has(id)) drop(id);
  // Вошедший позже сам предлагает соединение тем, кто уже в звонке; новеньких ждём
  const mine = room.members.find((m) => m.user.id === me());
  const at = (m?: { joinedAt: string | null }) => (m?.joinedAt ? Date.parse(m.joinedAt) : 0);
  for (const m of joined) {
    if (links.has(m.user.id)) continue;
    const earlier = at(m) < at(mine) || (at(m) === at(mine) && m.user.id < me());
    if (earlier) await connect(m.user.id, true);
  }
}

// ─── Медиа ──────────────────────────────────────────────────────────────────

async function getMedia(video: boolean): Promise<MediaStream> {
  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: video ? { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' } : false,
    });
  } catch {
    if (video) {
      toast({ text: 'Камера недоступна — входим со звуком', kind: 'error' });
      return getMedia(false);
    }
    throw new Error('Нет доступа к микрофону — разрешите его в настройках браузера');
  }
}

function cleanup(text: string | null) {
  stopRing();
  for (const id of [...links.keys()]) drop(id);
  const s = useRoom.getState();
  s.local?.getTracks().forEach((t) => t.stop());
  s.screen?.getTracks().forEach((t) => t.stop());
  if (endTimer) window.clearTimeout(endTimer);
  if (text) {
    useRoom.setState({ ...initial, phase: 'ended', endedText: text, room: s.room });
    endTimer = window.setTimeout(() => useRoom.setState({ ...initial }), 2200);
  } else useRoom.setState({ ...initial });
}

const busy = () => {
  const call = useCall.getState().phase;
  const room = useRoom.getState().phase;
  return (call !== 'idle' && call !== 'ended') || room === 'joining' || room === 'active';
};

// ─── Действия ───────────────────────────────────────────────────────────────

/** Новый групповой звонок: id выбранных людей и/или имена пользователей. */
export async function createRoom(input: { userIds: string[]; usernames: string[]; video: boolean; title?: string }): Promise<boolean> {
  if (busy()) {
    toast('Сначала завершите текущий звонок');
    return false;
  }
  let local: MediaStream;
  try {
    local = await getMedia(input.video);
  } catch (e) {
    toast({ text: (e as Error).message, kind: 'error' });
    return false;
  }
  useRoom.setState({ ...initial, phase: 'joining', local, cameraOff: !local.getVideoTracks().length });
  try {
    const room = await api.post<CallRoom>('/calls/rooms', input);
    useRoom.setState({ room, phase: 'active', startedAt: Date.now() });
    return true;
  } catch (e) {
    toast({ text: errorMessage(e), kind: 'error' });
    cleanup(null);
    return false;
  }
}

export async function joinRoom(id: string, video: boolean): Promise<void> {
  if (busy() && useRoom.getState().room?.id !== id) return toast('Сначала завершите текущий звонок');
  stopRing();
  let local: MediaStream;
  try {
    local = await getMedia(video);
  } catch (e) {
    toast({ text: (e as Error).message, kind: 'error' });
    return;
  }
  useRoom.setState({ phase: 'joining', local, cameraOff: !local.getVideoTracks().length, invitedBy: null });
  try {
    const room = await api.post<CallRoom>(`/calls/rooms/${id}/join`);
    useRoom.setState({ room, phase: 'active', startedAt: Date.now() });
    await sync(room);
  } catch (e) {
    toast({ text: errorMessage(e), kind: 'error' });
    cleanup(null);
  }
}

export async function leaveRoom(): Promise<void> {
  const { room, phase, startedAt } = useRoom.getState();
  const text = phase === 'incoming' ? null : startedAt ? `Вы вышли из звонка · ${fmt((Date.now() - startedAt) / 1000)}` : 'Звонок завершён';
  cleanup(text);
  if (room) await api.post(`/calls/rooms/${room.id}/leave`).catch(() => undefined);
}

export async function inviteToRoom(input: { userIds: string[]; usernames: string[] }): Promise<boolean> {
  const id = roomId();
  if (!id) return false;
  try {
    const room = await api.post<CallRoom>(`/calls/rooms/${id}/invite`, input);
    useRoom.setState({ room });
    toast('Приглашения отправлены');
    return true;
  } catch (e) {
    toast({ text: errorMessage(e), kind: 'error' });
    return false;
  }
}

export function toggleRoomMute(): void {
  const s = useRoom.getState();
  const muted = !s.muted;
  s.local?.getAudioTracks().forEach((t) => (t.enabled = !muted));
  useRoom.setState({ muted });
  broadcastMedia();
}

export async function toggleRoomCamera(): Promise<void> {
  const s = useRoom.getState();
  const track = s.local?.getVideoTracks()[0];
  if (track) {
    const cameraOff = !s.cameraOff;
    track.enabled = !cameraOff;
    useRoom.setState({ cameraOff });
    broadcastMedia();
    return;
  }
  // Входили без видео — включаем камеру сейчас
  try {
    const cam = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' } });
    const t = cam.getVideoTracks()[0]!;
    const local = s.local ?? new MediaStream();
    local.addTrack(t);
    useRoom.setState({ local: new MediaStream(local.getTracks()), cameraOff: false });
    if (!useRoom.getState().studio) links.forEach((l) => void l.camera?.replaceTrack(t));
    broadcastMedia();
    tuneAll();
  } catch {
    toast({ text: 'Камера недоступна', kind: 'error' });
  }
}

export function toggleHand(): void {
  useRoom.setState({ hand: !useRoom.getState().hand });
  broadcastMedia();
}

/** Демонстрация экрана — отдельным потоком, камера остаётся видна. */
export async function toggleScreen(): Promise<void> {
  const s = useRoom.getState();
  if (s.screen) return stopScreen();
  if (!navigator.mediaDevices?.getDisplayMedia) return toast('Это устройство не умеет показывать экран');
  try {
    const screen = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 15, max: 30 } }, audio: true });
    screen.getVideoTracks()[0]?.addEventListener('ended', () => stopScreen());
    useRoom.setState({ screen });
    // Сначала говорим, какой поток — экран, потом добавляем его
    broadcastMedia();
    links.forEach((l) => {
      for (const t of screen.getTracks()) l.screen.push(l.pc.addTrack(t, screen));
    });
    tuneAll();
  } catch {
    // отменили выбор экрана
  }
}

function stopScreen() {
  const s = useRoom.getState();
  if (!s.screen) return;
  s.screen.getTracks().forEach((t) => t.stop());
  links.forEach((l) => {
    for (const sender of l.screen) {
      try {
        l.pc.removeTrack(sender);
      } catch {
        // соединение уже закрыто
      }
    }
    l.screen = [];
  });
  useRoom.setState({ screen: null });
  broadcastMedia();
}

/** Студия: вместо камеры участники видят собранную сцену (текст, фото, видео, экран). */
export function setStudioStream(stream: MediaStream | null): void {
  const prev = useRoom.getState().studio;
  if (prev && prev !== stream) prev.getTracks().forEach((t) => t.stop());
  useRoom.setState({ studio: stream });
  const track = outgoingVideo();
  links.forEach((l) => void l.camera?.replaceTrack(track));
  broadcastMedia();
  tuneAll();
}

export async function sendRoomChat(text: string): Promise<void> {
  const id = roomId();
  if (!id || !text.trim()) return;
  try {
    await api.post(`/calls/rooms/${id}/chat`, { text: text.trim() });
  } catch (e) {
    toast({ text: errorMessage(e), kind: 'error' });
  }
}

export const setRoomChatOpen = (chatOpen: boolean) => useRoom.setState(chatOpen ? { chatOpen, unread: 0 } : { chatOpen });
export const setRoomMinimized = (minimized: boolean) => useRoom.setState({ minimized });
export const setRoomVolume = (volume: number) => useRoom.setState({ volume: Math.min(1, Math.max(0, volume)) });

export function declineInvite(): void {
  const { room } = useRoom.getState();
  cleanup(null);
  if (room) void api.post(`/calls/rooms/${room.id}/leave`).catch(() => undefined);
}

export function fmt(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  return `${h ? `${String(h).padStart(2, '0')}:` : ''}${mm}:${String(s % 60).padStart(2, '0')}`;
}

// ─── События сервера ────────────────────────────────────────────────────────

export async function handleRoomEvent(event: ServerEvent): Promise<void> {
  const s = useRoom.getState();
  if (event.t === 'room.invite') {
    // Уже в этом звонке (позвали повторно) или заняты другим — не звоним
    if (s.room?.id === event.room.id && s.phase === 'active') return;
    if (busy()) {
      toast({ text: `${event.from.displayName} зовёт в групповой звонок`, action: { label: 'Позже', onClick: () => undefined } });
      return;
    }
    if (endTimer) window.clearTimeout(endTimer);
    useRoom.setState({ ...initial, room: event.room, phase: 'incoming', invitedBy: event.from });
    startRing();
    ringTimer = window.setTimeout(() => {
      if (useRoom.getState().phase === 'incoming') cleanup(null);
    }, 45_000);
    desktopNotify(event.from.displayName, `Групповой звонок · ${event.room.members.length} участников`, () => useRoom.setState({ minimized: false }));
    return;
  }
  if (event.t === 'room.updated') {
    if (s.room?.id !== event.room.id) return;
    const room = event.room;
    if (s.phase === 'incoming') {
      // Звонок закончился, пока звенел, или приглашение приняли на другом устройстве
      const mine = room.members.find((m) => m.user.id === me());
      if (room.status === 'ended' || mine?.state !== 'invited') return cleanup(null);
      useRoom.setState({ room });
      return;
    }
    if (s.phase !== 'active') return;
    const mine = room.members.find((m) => m.user.id === me());
    // Вас нет в звонке (вошли с другого устройства или вышли) — закрываем
    if (room.status === 'ended' || mine?.state !== 'joined') return cleanup('Звонок завершён');
    useRoom.setState({ room });
    await sync(room);
    return;
  }
  if (event.t === 'room.signal') {
    if (s.room?.id !== event.roomId || s.phase !== 'active') return;
    await onSignal(event.from, event.signal);
    return;
  }
  if (event.t === 'room.chat') {
    if (s.room?.id !== event.roomId) return;
    useRoom.setState({ chat: [...s.chat.slice(-199), event.message], unread: s.chatOpen || event.message.user.id === me() ? 0 : s.unread + 1 });
  }
}

/** После перезагрузки: звонящее приглашение снова звонит, а из идущего звонка нас уже вывел сервер. */
export async function restoreRoom(): Promise<void> {
  try {
    const cur = await api.get<{ room: CallRoom | null; state: string | null }>('/calls/rooms/current');
    if (!cur.room || busy()) return;
    if (cur.state === 'invited') {
      const by = cur.room.members.find((m) => m.user.id === me());
      useRoom.setState({ ...initial, room: cur.room, phase: 'incoming', invitedBy: by ? cur.room.owner : null });
      startRing();
      ringTimer = window.setTimeout(() => useRoom.getState().phase === 'incoming' && cleanup(null), 30_000);
    } else if (cur.state === 'joined') {
      // Сеанс тот же, а медиа после перезагрузки нет — предлагаем вернуться
      useRoom.setState({ ...initial, room: cur.room, phase: 'incoming', invitedBy: null });
    }
  } catch {
    // не критично
  }
}
