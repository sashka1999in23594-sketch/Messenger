/** Экран звонка поверх приложения: входящий, исходящий, разговор и свёрнутый вид. */
import { useEffect, useRef, useState } from 'react';
import { Maximize2, Mic, MicOff, Minimize2, Phone, PhoneOff, Video, VideoOff } from 'lucide-react';
import { acceptCall, fmtDuration, hangup, setMinimized, toggleCamera, toggleMute, useCall } from '../../shared/calls/engine';
import { useSession } from '../../shared/stores/session';
import { cn } from '../../shared/lib/format';
import { Avatar } from '../../shared/ui';
import './calls.css';

function useTicker(on: boolean) {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!on) return;
    const t = window.setInterval(() => setTick((x) => x + 1), 1000);
    return () => window.clearInterval(t);
  }, [on]);
}

function StreamVideo({ stream, muted, className }: { stream: MediaStream | null; muted?: boolean; className?: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (ref.current && ref.current.srcObject !== stream) ref.current.srcObject = stream;
  }, [stream]);
  return <video ref={ref} className={className} autoPlay playsInline muted={muted} />;
}

/** Звук собеседника играет всегда, даже в свёрнутом виде и в аудиозвонке. */
function RemoteAudio({ stream }: { stream: MediaStream | null }) {
  const ref = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    if (ref.current && ref.current.srcObject !== stream) ref.current.srcObject = stream;
  }, [stream]);
  return <audio ref={ref} autoPlay />;
}

function CtrlButton({ label, onClick, active, danger, success, children }: { label: string; onClick: () => void; active?: boolean; danger?: boolean; success?: boolean; children: React.ReactNode }) {
  return (
    <button type="button" className="call-ctrl" onClick={onClick} aria-label={label} aria-pressed={active}>
      <span className={cn('call-ctrl__btn', active && 'call-ctrl__btn--on', danger && 'call-ctrl__btn--danger', success && 'call-ctrl__btn--success')}>{children}</span>
      <span className="call-ctrl__label">{label}</span>
    </button>
  );
}

export function CallScreen() {
  const s = useCall();
  const myId = useSession((x) => x.me?.id);
  useTicker(s.phase === 'active');
  // Esc сворачивает разговор
  useEffect(() => {
    if (s.phase === 'idle') return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && s.phase === 'active' && setMinimized(true);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [s.phase]);

  if (s.phase === 'idle' || !s.call) return null;
  const peer = s.call.caller.id === myId ? s.call.callee : s.call.caller;
  const duration = s.startedAt ? fmtDuration((Date.now() - s.startedAt) / 1000) : '';
  const status =
    s.phase === 'incoming'
      ? s.call.video
        ? 'Входящий видеозвонок'
        : 'Входящий звонок'
      : s.phase === 'outgoing'
        ? 'Вызов…'
        : s.phase === 'connecting'
          ? 'Соединение…'
          : s.phase === 'ended'
            ? s.endedText
            : duration;
  const remoteVideo = s.phase === 'active' && s.remoteMedia.video && !!s.remoteStream?.getVideoTracks().length;
  const localVideo = !!s.localStream?.getVideoTracks().length && !s.cameraOff;

  if (s.minimized && s.phase !== 'incoming') {
    return (
      <div className="call-pill" role="status">
        <RemoteAudio stream={s.remoteStream} />
        <span className="call-pill__dot" />
        <button type="button" className="call-pill__main" onClick={() => setMinimized(false)} aria-label="Развернуть звонок">
          <Avatar src={peer.avatarUrl} name={peer.displayName} id={peer.id} size={28} />
          <span className="col" style={{ gap: 0, minWidth: 0 }}>
            <b className="ellipsis">{peer.displayName}</b>
            <span className="xs">{status}</span>
          </span>
          <Maximize2 size={16} />
        </button>
        <button type="button" className="call-pill__btn" onClick={toggleMute} aria-label={s.muted ? 'Включить микрофон' : 'Выключить микрофон'}>
          {s.muted ? <MicOff size={18} /> : <Mic size={18} />}
        </button>
        <button type="button" className="call-pill__btn call-pill__btn--danger" onClick={() => void hangup()} aria-label="Завершить">
          <PhoneOff size={18} />
        </button>
      </div>
    );
  }

  return (
    <div className={cn('call-screen', remoteVideo && 'call-screen--video', s.phase === 'ended' && 'call-screen--ended')} role="dialog" aria-modal="true" aria-label={`Звонок: ${peer.displayName}`}>
      <RemoteAudio stream={s.remoteStream} />
      <div className="call-screen__bg" style={peer.avatarUrl ? { backgroundImage: `url(${peer.avatarUrl})` } : undefined} />
      {remoteVideo && <StreamVideo stream={s.remoteStream} muted className="call-screen__remote" />}

      <div className="call-screen__top">
        <span className="call-screen__badge">
          {s.call.video ? <Video size={14} /> : <Phone size={14} />} Сквозное шифрование
        </span>
        {s.phase !== 'incoming' && s.phase !== 'ended' && (
          <button type="button" className="call-screen__min" onClick={() => setMinimized(true)} aria-label="Свернуть">
            <Minimize2 size={18} />
          </button>
        )}
      </div>

      {!remoteVideo && (
        <div className="call-screen__peer">
          <div className={cn('call-screen__avatar', (s.phase === 'incoming' || s.phase === 'outgoing') && 'call-screen__avatar--ringing')}>
            <Avatar src={peer.avatarUrl} name={peer.displayName} id={peer.id} size={132} />
          </div>
          <h2 className="call-screen__name">{peer.displayName}</h2>
          <div className="call-screen__status">{status}</div>
          {s.phase === 'active' && !s.remoteMedia.audio && (
            <div className="call-screen__note">
              <MicOff size={14} /> Собеседник выключил микрофон
            </div>
          )}
        </div>
      )}
      {remoteVideo && (
        <div className="call-screen__overlay-info">
          <b>{peer.displayName}</b>
          <span>{status}</span>
        </div>
      )}

      {localVideo && s.phase !== 'ended' && <StreamVideo stream={s.localStream} muted className="call-screen__local" />}

      <div className="call-screen__controls">
        {s.phase === 'incoming' ? (
          <>
            <CtrlButton label="Отклонить" danger onClick={() => void hangup()}>
              <PhoneOff size={28} />
            </CtrlButton>
            {s.call.video && (
              <CtrlButton label="Без видео" success onClick={() => void acceptCall(false)}>
                <Phone size={28} />
              </CtrlButton>
            )}
            <CtrlButton label={s.call.video ? 'С видео' : 'Ответить'} success onClick={() => void acceptCall()}>
              {s.call.video ? <Video size={28} /> : <Phone size={28} />}
            </CtrlButton>
          </>
        ) : s.phase === 'ended' ? null : (
          <>
            <CtrlButton label={s.muted ? 'Микрофон выкл.' : 'Микрофон'} active={s.muted} onClick={toggleMute}>
              {s.muted ? <MicOff size={26} /> : <Mic size={26} />}
            </CtrlButton>
            {!!s.localStream?.getVideoTracks().length && (
              <CtrlButton label={s.cameraOff ? 'Камера выкл.' : 'Камера'} active={s.cameraOff} onClick={toggleCamera}>
                {s.cameraOff ? <VideoOff size={26} /> : <Video size={26} />}
              </CtrlButton>
            )}
            <CtrlButton label={s.phase === 'outgoing' ? 'Отменить' : 'Завершить'} danger onClick={() => void hangup()}>
              <PhoneOff size={28} />
            </CtrlButton>
          </>
        )}
      </div>
    </div>
  );
}
