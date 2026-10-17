/**
 * Звонки 1:1 на WebRTC. Сервер хранит состояние звонка и пересылает сигналы;
 * медиапоток идёт напрямую между устройствами и шифруется DTLS-SRTP.
 *
 * Порядок: звонящий создаёт звонок (REST) → у собеседника «входящий» →
 * он принимает → звонящий отправляет offer → собеседник отвечает answer →
 * обе стороны обмениваются ICE-кандидатами.
 */
import { create } from 'zustand';
import type { CallInfo, CallSignal, ServerEvent } from '@omni/shared';
import { api, errorMessage } from '../api/client';
import { realtime } from '../realtime/socket';
import { useSession } from '../stores/session';
import { toast } from '../stores/ui';
import { isQuietNow, usePrefs } from '../stores/prefs';
import { desktopNotify } from '../lib/sounds';

export type CallPhase = 'idle' | 'outgoing' | 'incoming' | 'connecting' | 'active' | 'ended';

interface CallState {
  call: CallInfo | null;
  phase: CallPhase;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  muted: boolean;
  cameraOff: boolean;
  remoteMedia: { audio: boolean; video: boolean };
  startedAt: number | null;
  minimized: boolean;
  endedText: string | null;
  /** Соединение на секунду пропало — показываем «Восстанавливаем связь…» */
  reconnecting: boolean;
}

const initial: CallState = {
  call: null,
  phase: 'idle',
  localStream: null,
  remoteStream: null,
  muted: false,
  cameraOff: false,
  remoteMedia: { audio: true, video: true },
  startedAt: null,
  minimized: false,
  endedText: null,
  reconnecting: false,
};

export const useCall = create<CallState>(() => ({ ...initial }));

let pc: RTCPeerConnection | null = null;
let pendingIce: RTCIceCandidateInit[] = [];
let iceServers: RTCIceServer[] | null = null;
let ring: { stop: () => void } | null = null;
let endTimer: number | null = null;
let dropTimer: number | null = null;

/** Звонка нет или на экране только итог прошлого («Звонок завершён») */
const isFree = () => {
  const phase = useCall.getState().phase;
  return phase === 'idle' || phase === 'ended';
};

const me = () => useSession.getState().me?.id ?? '';
const send = (signal: CallSignal) => {
  const call = useCall.getState().call;
  if (call) realtime.send({ t: 'call.signal', callId: call.id, signal });
};

/** Мелодия: входящий — двойной сигнал, исходящий — длинные гудки. */
function startRing(kind: 'in' | 'out') {
  ring?.stop();
  const { sounds, quietHours } = usePrefs.getState();
  // Мелодия входящего выключена или «Не беспокоить» — звоним беззвучно (экран всё равно покажется)
  if (kind === 'in' && (sounds?.calls === false || isQuietNow(quietHours))) return;
  let ctx: AudioContext | null = null;
  try {
    ctx = new AudioContext();
  } catch {
    return;
  }
  const beep = (at: number, freq: number, dur: number) => {
    const o = ctx!.createOscillator();
    const g = ctx!.createGain();
    o.frequency.value = freq;
    o.type = 'sine';
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime((kind === 'in' ? 0.2 : 0.1) * (sounds?.volume ?? 0.6), at + 0.02);
    g.gain.linearRampToValueAtTime(0, at + dur);
    o.connect(g).connect(ctx!.destination);
    o.start(at);
    o.stop(at + dur + 0.05);
  };
  const play = () => {
    if (!ctx) return;
    const t = ctx.currentTime;
    if (kind === 'in') {
      beep(t, 880, 0.35);
      beep(t + 0.45, 660, 0.35);
    } else beep(t, 425, 1.2);
  };
  play();
  const timer = window.setInterval(play, kind === 'in' ? 2200 : 4000);
  ring = {
    stop: () => {
      window.clearInterval(timer);
      void ctx?.close().catch(() => undefined);
      ring = null;
    },
  };
}

async function getIce(): Promise<RTCIceServer[]> {
  if (!iceServers) iceServers = (await api.get<{ iceServers: RTCIceServer[] }>('/calls/config')).iceServers;
  return iceServers;
}

async function getMedia(video: boolean): Promise<MediaStream> {
  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: video ? { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' } : false,
    });
  } catch {
    if (video) {
      // Нет камеры — продолжаем со звуком
      toast({ text: 'Камера недоступна — звонок без видео', kind: 'error' });
      return navigator.mediaDevices.getUserMedia({ audio: true });
    }
    throw new Error('Нет доступа к микрофону — разрешите его в настройках браузера');
  }
}

function cleanup(endedText: string | null) {
  ring?.stop();
  if (dropTimer) window.clearTimeout(dropTimer);
  dropTimer = null;
  pc?.getSenders().forEach((s) => s.track?.stop());
  pc?.close();
  pc = null;
  pendingIce = [];
  const { localStream } = useCall.getState();
  localStream?.getTracks().forEach((t) => t.stop());
  if (endTimer) window.clearTimeout(endTimer);
  if (endedText) {
    useCall.setState({ phase: 'ended', endedText, localStream: null, remoteStream: null });
    endTimer = window.setTimeout(() => useCall.setState({ ...initial }), 2200);
  } else useCall.setState({ ...initial });
}

async function createPeer(): Promise<RTCPeerConnection> {
  const peer = new RTCPeerConnection({ iceServers: await getIce() });
  pc = peer;
  const remote = new MediaStream();
  useCall.setState({ remoteStream: remote });
  peer.ontrack = (e) => {
    for (const t of e.streams[0]?.getTracks() ?? [e.track]) if (!remote.getTracks().includes(t)) remote.addTrack(t);
    useCall.setState({ remoteStream: remote });
  };
  peer.onicecandidate = (e) => {
    if (e.candidate) send({ type: 'ice', candidate: e.candidate.candidate, sdpMid: e.candidate.sdpMid, sdpMLineIndex: e.candidate.sdpMLineIndex });
  };
  peer.onconnectionstatechange = () => {
    if (peer.connectionState === 'connected') {
      if (dropTimer) window.clearTimeout(dropTimer);
      dropTimer = null;
      if (useCall.getState().phase !== 'active') {
        ring?.stop();
        useCall.setState({ phase: 'active', startedAt: Date.now(), reconnecting: false });
      } else useCall.setState({ reconnecting: false });
    }
    // Кратковременный обрыв (смена сети): ждём восстановления 12 секунд, потом завершаем
    if (peer.connectionState === 'disconnected' && useCall.getState().phase === 'active') {
      useCall.setState({ reconnecting: true });
      if (!dropTimer) {
        dropTimer = window.setTimeout(() => {
          dropTimer = null;
          if (pc === peer && peer.connectionState !== 'connected') {
            toast({ text: 'Связь прервалась', kind: 'error' });
            void hangup();
          }
        }, 12_000);
      }
    }
    if (peer.connectionState === 'failed') {
      toast({ text: 'Не удалось установить соединение. Возможно, нужен TURN-сервер для вашей сети', kind: 'error' });
      void hangup();
    }
  };
  const local = useCall.getState().localStream;
  local?.getTracks().forEach((t) => peer.addTrack(t, local));
  return peer;
}

async function flushIce() {
  if (!pc?.remoteDescription) return;
  for (const c of pendingIce) await pc.addIceCandidate(c).catch(() => undefined);
  pendingIce = [];
}

// ─── Действия ────────────────────────────────────────────────────────────────

export async function startCall(chatId: string, video: boolean): Promise<void> {
  if (!isFree()) return toast('Сначала завершите текущий звонок');
  if (endTimer) window.clearTimeout(endTimer);
  let local: MediaStream;
  try {
    local = await getMedia(video);
  } catch (e) {
    return toast({ text: errorMessage(e) === 'Что-то пошло не так' ? (e as Error).message : errorMessage(e), kind: 'error' });
  }
  useCall.setState({ ...initial, phase: 'outgoing', localStream: local, cameraOff: !video });
  try {
    const call = await api.post<CallInfo>('/calls', { chatId, video });
    useCall.setState({ call });
    if (call.status === 'busy') return cleanup('Абонент занят');
    startRing('out');
  } catch (e) {
    toast({ text: errorMessage(e), kind: 'error' });
    cleanup(null);
  }
}

export async function acceptCall(withVideo?: boolean): Promise<void> {
  const { call } = useCall.getState();
  if (!call) return;
  ring?.stop();
  try {
    const local = await getMedia(withVideo ?? call.video);
    useCall.setState({ localStream: local, phase: 'connecting', cameraOff: !(withVideo ?? call.video) });
    await createPeer();
    await api.post<CallInfo>(`/calls/${call.id}/accept`);
  } catch (e) {
    toast({ text: errorMessage(e), kind: 'error' });
    await hangup();
  }
}

export async function hangup(): Promise<void> {
  const { call, phase, startedAt } = useCall.getState();
  const text = phase === 'active' && startedAt ? `Звонок завершён · ${fmtDuration((Date.now() - startedAt) / 1000)}` : phase === 'incoming' ? 'Отклонён' : 'Звонок завершён';
  cleanup(text);
  if (call) await api.post(`/calls/${call.id}/hangup`).catch(() => undefined);
}

export function toggleMute(): void {
  const s = useCall.getState();
  const muted = !s.muted;
  s.localStream?.getAudioTracks().forEach((t) => (t.enabled = !muted));
  useCall.setState({ muted });
  send({ type: 'media', audio: !muted, video: !s.cameraOff });
}

export function toggleCamera(): void {
  const s = useCall.getState();
  const tracks = s.localStream?.getVideoTracks() ?? [];
  if (!tracks.length) return toast('В этом звонке нет видео');
  const cameraOff = !s.cameraOff;
  tracks.forEach((t) => (t.enabled = !cameraOff));
  useCall.setState({ cameraOff });
  send({ type: 'media', audio: !s.muted, video: !cameraOff });
}

export const setMinimized = (minimized: boolean) => useCall.setState({ minimized });

/** Закрыть итог звонка («Звонок завершён») не дожидаясь таймера */
export function dismissEnded(): void {
  if (useCall.getState().phase !== 'ended') return;
  if (endTimer) window.clearTimeout(endTimer);
  useCall.setState({ ...initial });
}

export function fmtDuration(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60)).padStart(h ? 2 : 1, '0');
  return `${h ? `${h}:` : ''}${mm}:${String(s % 60).padStart(2, '0')}`;
}

// ─── События сервера ─────────────────────────────────────────────────────────

export async function handleCallEvent(event: ServerEvent): Promise<void> {
  const state = useCall.getState();
  if (event.t === 'call.incoming') {
    if (!isFree()) return; // сервер не даст позвонить занятому, это страховка
    if (endTimer) window.clearTimeout(endTimer);
    useCall.setState({ ...initial, call: event.call, phase: 'incoming' });
    startRing('in');
    // Вкладка в фоне — системное уведомление, чтобы звонок не пропустить
    desktopNotify(`${event.call.caller.displayName}`, event.call.video ? 'Входящий видеозвонок' : 'Входящий звонок', () => useCall.setState({ minimized: false }));
    return;
  }
  if (event.t === 'call.updated') {
    if (!state.call || state.call.id !== event.call.id) return;
    const call = event.call;
    useCall.setState({ call });
    if (call.status === 'active') {
      // Принято на другом устройстве этого же аккаунта
      if (state.phase === 'incoming') return cleanup(null);
      if (call.caller.id === me() && !pc) {
        ring?.stop();
        useCall.setState({ phase: 'connecting' });
        const peer = await createPeer();
        const offer = await peer.createOffer();
        await peer.setLocalDescription(offer);
        send({ type: 'offer', sdp: offer.sdp ?? '' });
      }
      return;
    }
    const texts: Record<string, string> = {
      declined: 'Звонок отклонён',
      missed: call.caller.id === me() ? 'Нет ответа' : 'Пропущенный звонок',
      cancelled: 'Звонок отменён',
      busy: 'Абонент занят',
      failed: 'Связь прервалась',
      ended: state.startedAt ? `Звонок завершён · ${fmtDuration((Date.now() - state.startedAt) / 1000)}` : 'Звонок завершён',
    };
    cleanup(texts[call.status] ?? 'Звонок завершён');
    return;
  }
  if (event.t === 'call.signal') {
    if (!state.call || state.call.id !== event.callId) return;
    const sig = event.signal;
    if (sig.type === 'offer' && pc) {
      await pc.setRemoteDescription({ type: 'offer', sdp: sig.sdp });
      await flushIce();
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      send({ type: 'answer', sdp: answer.sdp ?? '' });
    } else if (sig.type === 'answer' && pc) {
      await pc.setRemoteDescription({ type: 'answer', sdp: sig.sdp });
      await flushIce();
    } else if (sig.type === 'ice') {
      const c = { candidate: sig.candidate, sdpMid: sig.sdpMid, sdpMLineIndex: sig.sdpMLineIndex };
      if (pc?.remoteDescription) await pc.addIceCandidate(c).catch(() => undefined);
      else pendingIce.push(c);
    } else if (sig.type === 'media') {
      useCall.setState({ remoteMedia: { audio: sig.audio, video: sig.video } });
    }
  }
}

/** После перезагрузки страницы — подхватываем ещё звонящий входящий вызов. */
export async function restoreIncomingCall(): Promise<void> {
  try {
    const { call } = await api.get<{ call: CallInfo | null }>('/calls/current');
    if (call && call.status === 'ringing' && call.callee.id === me() && isFree()) {
      useCall.setState({ ...initial, call, phase: 'incoming' });
      startRing('in');
    }
  } catch {
    // не критично
  }
}
