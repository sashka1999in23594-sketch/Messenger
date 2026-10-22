/**
 * Зритель эфира: подключается к ведущему по WebRTC. Сигналы ведущего могут
 * прийти по WebSocket раньше, чем ответ на «подключиться», — поэтому они
 * копятся и обрабатываются, как только известен свой peer.
 */
import { useEffect, useState } from 'react';
import type { CallSignal, LiveStream } from '@omni/shared';
import { api, errorMessage } from '../../shared/api/client';
import { getIce } from '../../shared/calls/engine';
import { realtime } from '../../shared/realtime/socket';
import { onLive } from './bus';

export type ViewerState = 'connecting' | 'playing' | 'failed' | 'ended';

const CONNECT_TIMEOUT_MS = 25_000;

export function useLiveViewer(streamId: string, enabled: boolean) {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [state, setState] = useState<ViewerState>('connecting');
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    let pc: RTCPeerConnection | null = null;
    let peer: string | null = null;
    const early: { peer: string; signal: CallSignal }[] = [];
    const pendingIce: RTCIceCandidateInit[] = [];
    setState('connecting');
    setError(null);

    const send = (signal: CallSignal) =>
      peer && realtime.send({ t: 'live.signal', streamId, peer, signal });

    const handle = async (signal: CallSignal) => {
      if (!pc) return;
      if (signal.type === 'offer') {
        await pc.setRemoteDescription({ type: 'offer', sdp: signal.sdp });
        for (const c of pendingIce.splice(0)) await pc.addIceCandidate(c).catch(() => undefined);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        send({ type: 'answer', sdp: answer.sdp ?? '' });
      } else if (signal.type === 'ice') {
        const c = {
          candidate: signal.candidate,
          sdpMid: signal.sdpMid,
          sdpMLineIndex: signal.sdpMLineIndex,
        };
        if (pc.remoteDescription) await pc.addIceCandidate(c).catch(() => undefined);
        else pendingIce.push(c);
      }
    };

    const off = onLive((e) => {
      if (e.t === 'live.signal' && e.streamId === streamId) {
        if (peer && e.peer === peer) void handle(e.signal);
        else if (!peer) early.push({ peer: e.peer, signal: e.signal });
      }
      if (e.t === 'live.updated' && e.stream.id === streamId && e.stream.status === 'ended')
        setState('ended');
    });

    const timer = window.setTimeout(() => {
      if (!disposed && pc?.connectionState !== 'connected') {
        setState('failed');
        setError(
          'Не удалось подключиться к эфиру: сеть не пропускает видео. Попробуйте другую сеть',
        );
      }
    }, CONNECT_TIMEOUT_MS);

    void (async () => {
      try {
        pc = new RTCPeerConnection({ iceServers: await getIce() });
        const remote = new MediaStream();
        pc.ontrack = (e) => {
          if (!remote.getTracks().includes(e.track)) remote.addTrack(e.track);
          setStream(new MediaStream(remote.getTracks()));
        };
        pc.onicecandidate = (e) => {
          if (e.candidate)
            send({
              type: 'ice',
              candidate: e.candidate.candidate,
              sdpMid: e.candidate.sdpMid,
              sdpMLineIndex: e.candidate.sdpMLineIndex,
            });
        };
        pc.onconnectionstatechange = () => {
          if (pc?.connectionState === 'connected') setState('playing');
          if (pc?.connectionState === 'failed' && !disposed) {
            setState('failed');
            setError('Связь с эфиром прервалась');
          }
        };
        const r = await api.post<{ peer: string; stream: LiveStream }>(`/live/${streamId}/join`);
        if (disposed) {
          void api.post(`/live/${streamId}/leave`, { peer: r.peer }).catch(() => undefined);
          return;
        }
        peer = r.peer;
        for (const s of early.splice(0)) if (s.peer === peer) await handle(s.signal);
      } catch (e) {
        if (disposed) return;
        setState('failed');
        setError(errorMessage(e));
      }
    })();

    return () => {
      disposed = true;
      window.clearTimeout(timer);
      off();
      pc?.close();
      if (peer) void api.post(`/live/${streamId}/leave`, { peer }).catch(() => undefined);
      setStream(null);
    };
  }, [streamId, enabled, attempt]);

  return { stream, state, error, retry: () => setAttempt((n) => n + 1) };
}
