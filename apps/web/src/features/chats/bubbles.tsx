/** Особые виды сообщений: голосовое, видео-кружок, опрос, звонок. */
import { useEffect, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Check, Pause, Phone, PhoneIncoming, PhoneMissed, PhoneOutgoing, Play, Video, Volume2 } from 'lucide-react';
import type { CallInfo, MediaItem, Message, Poll } from '@omni/shared';
import { api, errorMessage } from '../../shared/api/client';
import { useInView } from '../../shared/hooks';
import { toast } from '../../shared/stores/ui';
import { cn, plural } from '../../shared/lib/format';
import { Avatar } from '../../shared/ui';
import { upsertMessage } from './cache';
import { fmtSec } from './recorder';

// ─── Голосовое ───────────────────────────────────────────────────────────────

/** Одновременно играет только одна запись. */
let playing: HTMLAudioElement | null = null;
const SPEEDS = [1, 1.5, 2];

export function VoiceMessage({ media, out }: { media: MediaItem; out: boolean }) {
  const audio = useRef<HTMLAudioElement>(null);
  const [isPlaying, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [speed, setSpeed] = useState(1);
  const duration = media.durationSec ?? 0;
  const bars = media.waveform?.length ? media.waveform : Array.from({ length: 48 }, (_, i) => 60 + ((i * 37) % 120));
  const progress = duration ? Math.min(1, time / duration) : 0;

  const toggle = () => {
    const el = audio.current;
    if (!el) return;
    if (el.paused) {
      if (playing && playing !== el) playing.pause();
      playing = el;
      el.playbackRate = speed;
      void el.play();
    } else el.pause();
  };
  const seek = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = audio.current;
    if (!el || !duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    el.currentTime = ((e.clientX - rect.left) / rect.width) * duration;
    setTime(el.currentTime);
  };

  return (
    <div className={cn('voice', out && 'voice--out')}>
      <button type="button" className="voice__play" onClick={toggle} aria-label={isPlaying ? 'Пауза' : 'Слушать'}>
        {isPlaying ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" style={{ marginLeft: 2 }} />}
      </button>
      <div className="voice__body">
        <div className="voice__wave" onClick={seek} role="slider" aria-label="Перемотка" aria-valuemin={0} aria-valuemax={Math.round(duration)} aria-valuenow={Math.round(time)} tabIndex={0}>
          {bars.map((v, i) => (
            <span key={i} className={cn(i / bars.length < progress && 'voice__bar--done')} style={{ height: `${12 + (v / 255) * 88}%` }} />
          ))}
        </div>
        <div className="voice__meta">
          <span>{fmtSec(isPlaying || time ? time : duration)}</span>
          <button
            type="button"
            className="voice__speed"
            onClick={() => {
              const next = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length]!;
              setSpeed(next);
              if (audio.current) audio.current.playbackRate = next;
            }}
          >
            {speed}×
          </button>
        </div>
      </div>
      <audio
        ref={audio}
        src={media.url}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false);
          setTime(0);
        }}
        onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
      />
    </div>
  );
}

// ─── Видео-кружок ────────────────────────────────────────────────────────────

export function RoundMessage({ media }: { media: MediaItem }) {
  const video = useRef<HTMLVideoElement>(null);
  const [ref, inView] = useInView<HTMLDivElement>(0.6);
  const [withSound, setWithSound] = useState(false);
  const [progress, setProgress] = useState(0);

  // В зоне видимости кружок играет без звука по кругу (как в Telegram)
  useEffect(() => {
    const el = video.current;
    if (!el) return;
    if (inView) void el.play().catch(() => undefined);
    else {
      el.pause();
      setWithSound(false);
    }
  }, [inView]);

  const toggleSound = () => {
    const el = video.current;
    if (!el) return;
    if (!withSound) {
      el.currentTime = 0;
      el.muted = false;
      el.loop = false;
      void el.play();
      setWithSound(true);
    } else if (el.paused) void el.play();
    else el.pause();
  };

  const r = 48;
  const c = 2 * Math.PI * r;
  return (
    <div ref={ref} className={cn('round', withSound && 'round--sound')} onClick={toggleSound} role="button" aria-label="Видеосообщение">
      <video
        ref={video}
        src={media.url}
        poster={media.posterUrl ?? undefined}
        muted={!withSound}
        loop={!withSound}
        playsInline
        preload="metadata"
        onTimeUpdate={(e) => setProgress(e.currentTarget.duration ? e.currentTarget.currentTime / e.currentTarget.duration : 0)}
        onEnded={() => {
          const el = video.current;
          setWithSound(false);
          if (el) {
            el.muted = true;
            el.loop = true;
            void el.play().catch(() => undefined);
          }
        }}
      />
      {withSound && (
        <svg className="round__ring" viewBox="0 0 100 100" aria-hidden>
          <circle cx="50" cy="50" r={r} strokeDasharray={c} strokeDashoffset={c * (1 - progress)} />
        </svg>
      )}
      <span className="round__badge">
        {!withSound && <Volume2 size={12} />} {fmtSec(media.durationSec ?? 0)}
      </span>
    </div>
  );
}

// ─── Опрос ───────────────────────────────────────────────────────────────────

export function PollMessage({ message, canClose }: { message: Message; canClose: boolean }) {
  const poll = message.poll as Poll;
  const [selected, setSelected] = useState<string[]>([]);
  const vote = useMutation({
    mutationFn: (optionIds: string[]) => api.post<Message>(`/chats/${message.chatId}/messages/${message.id}/vote`, { optionIds }),
    onSuccess: (m) => {
      upsertMessage(message.chatId, m);
      setSelected([]);
    },
    onError: (e) => toast({ text: errorMessage(e), kind: 'error' }),
  });
  const close = useMutation({
    mutationFn: () => api.post<Message>(`/chats/${message.chatId}/messages/${message.id}/close-poll`),
    onSuccess: (m) => upsertMessage(message.chatId, m),
    onError: (e) => toast({ text: errorMessage(e), kind: 'error' }),
  });
  const showResults = poll.voted || poll.closed;
  const max = Math.max(1, ...poll.options.map((o) => o.votes));
  const total = poll.options.reduce((s, o) => s + o.votes, 0);

  return (
    <div className="poll">
      <div className="poll__question">{poll.question}</div>
      <div className="poll__type">
        {poll.quiz ? 'Викторина' : poll.anonymous ? 'Анонимный опрос' : 'Открытый опрос'}
        {poll.multiple && ' · несколько ответов'}
        {poll.closed && ' · завершён'}
      </div>
      <div className="poll__options">
        {poll.options.map((o) => {
          const pct = total ? Math.round((o.votes / total) * 100) : 0;
          const correct = poll.correctOptionId === o.id;
          const wrong = poll.quiz && showResults && o.mine && !correct;
          const isSel = selected.includes(o.id);
          return (
            <button
              key={o.id}
              type="button"
              className={cn('poll__option', showResults && 'poll__option--result', o.mine && 'poll__option--mine', correct && 'poll__option--correct', wrong && 'poll__option--wrong', isSel && 'poll__option--selected')}
              disabled={showResults || vote.isPending}
              onClick={() => {
                if (poll.multiple) setSelected((s) => (s.includes(o.id) ? s.filter((x) => x !== o.id) : [...s, o.id]));
                else vote.mutate([o.id]);
              }}
            >
              {showResults ? (
                <>
                  <span className="poll__pct">{pct}%</span>
                  <span className="poll__text">
                    {o.text} {o.mine && <Check size={14} />}
                  </span>
                  <span className="poll__bar" style={{ width: `${(o.votes / max) * 100}%` }} />
                </>
              ) : (
                <>
                  <span className={cn('poll__check', poll.multiple && 'poll__check--square')}>{isSel && <Check size={12} />}</span>
                  <span className="poll__text">{o.text}</span>
                </>
              )}
            </button>
          );
        })}
      </div>
      <div className="poll__foot">
        {!poll.anonymous && poll.recentVoters.length > 0 && (
          <span className="poll__voters">
            {poll.recentVoters.map((u) => (
              <Avatar key={u.id} src={u.avatarUrl} name={u.displayName} id={u.id} size={20} />
            ))}
          </span>
        )}
        <span>
          {poll.totalVoters} {plural(poll.totalVoters, 'голос', 'голоса', 'голосов')}
        </span>
        {poll.multiple && !showResults && selected.length > 0 && (
          <button type="button" className="poll__action" onClick={() => vote.mutate(selected)} disabled={vote.isPending}>
            Голосовать
          </button>
        )}
        {poll.voted && !poll.closed && !poll.quiz && (
          <button type="button" className="poll__action" onClick={() => vote.mutate([])} disabled={vote.isPending}>
            Отменить голос
          </button>
        )}
        {canClose && !poll.closed && (
          <button type="button" className="poll__action" onClick={() => close.mutate()} disabled={close.isPending}>
            Завершить
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Звонок ──────────────────────────────────────────────────────────────────

export function CallMessage({ call, myId, onCallBack }: { call: CallInfo; myId: string; onCallBack?: (video: boolean) => void }) {
  const outgoing = call.caller.id === myId;
  const missed = !outgoing && (call.status === 'missed' || call.status === 'cancelled');
  const Icon = missed ? PhoneMissed : outgoing ? PhoneOutgoing : PhoneIncoming;
  const title = missed
    ? `Пропущенный ${call.video ? 'видеозвонок' : 'звонок'}`
    : `${outgoing ? 'Исходящий' : 'Входящий'} ${call.video ? 'видеозвонок' : 'звонок'}`;
  const sub =
    call.status === 'ended'
      ? fmtSec(call.durationSec)
      : call.status === 'declined'
        ? 'Отклонён'
        : call.status === 'busy'
          ? 'Занято'
          : call.status === 'cancelled' && outgoing
            ? 'Отменён'
            : call.status === 'active'
              ? 'Идёт разговор'
              : call.status === 'ringing'
                ? 'Вызов…'
                : 'Не отвечен';
  return (
    <div className={cn('call-msg', missed && 'call-msg--missed')}>
      <span className="call-msg__icon">
        <Icon size={18} />
      </span>
      <span className="col grow" style={{ gap: 0 }}>
        <b>{title}</b>
        <span className="small call-msg__sub">{sub}</span>
      </span>
      {onCallBack && (
        <button type="button" className="call-msg__back" onClick={() => onCallBack(call.video)} aria-label="Перезвонить" title="Перезвонить">
          {call.video ? <Video size={18} /> : <Phone size={18} />}
        </button>
      )}
    </div>
  );
}
