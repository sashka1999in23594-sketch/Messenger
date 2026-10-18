/**
 * Прямые эфиры: кто сейчас в эфире, подготовка (камера или экран), сам эфир —
 * для ведущего с управлением и записью, для зрителя с видео и чатом.
 * Премьеры видео — в premiere.tsx.
 */
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Download, Eye, Mic, MicOff, Monitor, Radio, Square, Users, Video, VideoOff, Volume2, VolumeX } from 'lucide-react';
import type { LiveChatMessage, LiveStream } from '@omni/shared';
import { api, errorMessage } from '../../shared/api/client';
import { useMe } from '../../shared/stores/session';
import { toast, useCrumb } from '../../shared/stores/ui';
import { cn, timeAgo } from '../../shared/lib/format';
import { Avatar, Button, ButtonLink, EmptyState, ErrorState, Input, Loading, PageHeader, Switch, Textarea } from '../../shared/ui';
import { LiveChat } from './chat';
import { liveKey } from './bus';
import { discardRecording, endLive, goLive, prepareSource, publishRecording, releasePreview, toggleCam, toggleMic, useHost, type LiveSource } from './host';
import { useLiveViewer } from './viewer';
import './live.css';

export { PremieresPage, PremiereStage, usePremierePhase } from './premiere';

function StreamVideo({ stream, muted, className }: { stream: MediaStream | null; muted?: boolean; className?: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (ref.current && ref.current.srcObject !== stream) ref.current.srcObject = stream;
  }, [stream]);
  return <video ref={ref} className={className} autoPlay playsInline muted={muted} />;
}

/** Сколько идёт эфир: 12:34 */
function useElapsed(from: string | number | null) {
  const [, tick] = useState(0);
  useEffect(() => {
    if (!from) return;
    const t = window.setInterval(() => tick((x) => x + 1), 1000);
    return () => window.clearInterval(t);
  }, [from]);
  if (!from) return '';
  const s = Math.max(0, Math.floor((Date.now() - (typeof from === 'number' ? from : Date.parse(from))) / 1000));
  const h = Math.floor(s / 3600);
  return `${h ? `${h}:` : ''}${String(Math.floor((s % 3600) / 60)).padStart(h ? 2 : 1, '0')}:${String(s % 60).padStart(2, '0')}`;
}

const LiveBadge = ({ small }: { small?: boolean }) => <span className={cn('live-badge', small && 'live-badge--sm')}>В эфире</span>;

function StreamCard({ s }: { s: LiveStream }) {
  const live = s.status === 'live';
  const to = live ? `/live/${s.id}` : s.recordingPostId ? `/watch/${s.recordingPostId}` : `/live/${s.id}`;
  return (
    <Link to={to} className="stream-card">
      <span className="stream-card__thumb">
        <Avatar src={s.owner.avatarUrl} name={s.owner.displayName} id={s.owner.id} size={64} />
        {live ? <LiveBadge small /> : <span className="stream-card__ended">{s.recordingPostId ? 'Запись' : 'Завершён'}</span>}
        {live && (
          <span className="stream-card__viewers">
            <Eye size={13} /> {s.viewers}
          </span>
        )}
      </span>
      <span className="stream-card__info">
        <b className="clamp-2">{s.title}</b>
        <span className="xs muted">
          {s.owner.displayName} · {live ? `начат ${timeAgo(s.startedAt)}` : `${s.peakViewers} зрит. · ${timeAgo(s.startedAt)}`}
        </span>
      </span>
    </Link>
  );
}

export function LiveHome() {
  const q = useQuery({ queryKey: ['live-list'], queryFn: () => api.get<{ live: LiveStream[]; recent: LiveStream[] }>('/live'), refetchInterval: 20_000 });
  const live = q.data?.live ?? [];
  const recent = q.data?.recent ?? [];
  return (
    <div className="scroll">
      <div className="page page--wide">
        <PageHeader
          title="Прямые эфиры"
          icon={<Radio size={22} />}
          subtitle="Камера или экран — в прямом эфире, с чатом и записью"
          actions={
            <ButtonLink to="/live/new" icon={<Radio size={18} />}>
              Начать эфир
            </ButtonLink>
          }
        />
        {q.isLoading ? (
          <Loading />
        ) : (
          <>
            <h2 className="section-title live-section">Сейчас в эфире</h2>
            {live.length ? (
              <div className="stream-grid">
                {live.map((s) => (
                  <StreamCard key={s.id} s={s} />
                ))}
              </div>
            ) : (
              <EmptyState icon={<Radio size={28} />} title="Сейчас никто не в эфире" text="Начните первым — подписчики с колокольчиком получат уведомление" />
            )}
            {recent.length > 0 && (
              <>
                <h2 className="section-title live-section">Недавние эфиры</h2>
                <div className="stream-grid">
                  {recent.map((s) => (
                    <StreamCard key={s.id} s={s} />
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export function GoLivePage() {
  const navigate = useNavigate();
  const host = useHost();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [record, setRecord] = useState(true);
  const [busy, setBusy] = useState(false);
  const choose = async (source: LiveSource) => {
    try {
      await prepareSource(source);
    } catch (e) {
      toast({ text: (e as DOMException).name === 'NotAllowedError' ? 'Доступ не разрешён — разрешите камеру и микрофон для сайта' : errorMessage(e), kind: 'error' });
    }
  };
  useEffect(() => {
    if (host.streamId) navigate(`/live/${host.streamId}`, { replace: true });
    return () => releasePreview();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const start = async () => {
    setBusy(true);
    try {
      const s = await goLive({ title: title.trim(), description, record });
      navigate(`/live/${s.id}`, { replace: true });
    } catch (e) {
      toast({ text: errorMessage(e) === 'Что-то пошло не так' ? (e as Error).message : errorMessage(e), kind: 'error' });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="scroll">
      <div className="page">
        <PageHeader title="Начать эфир" icon={<Radio size={22} />} subtitle="До 50 зрителей одновременно, чат и запись эфира" />
        <div className="col gap-4">
          <div className="live-source" role="radiogroup" aria-label="Что показывать">
            <button type="button" role="radio" aria-checked={host.source === 'camera' && !!host.stream} className={cn('choice-card', host.stream && host.source === 'camera' && 'choice-card--on')} onClick={() => void choose('camera')}>
              <Video size={22} />
              <b>Камера</b>
              <span className="xs muted">Вы в кадре, с микрофоном</span>
            </button>
            <button type="button" role="radio" aria-checked={host.source === 'screen' && !!host.stream} className={cn('choice-card', host.stream && host.source === 'screen' && 'choice-card--on')} onClick={() => void choose('screen')}>
              <Monitor size={22} />
              <b>Экран</b>
              <span className="xs muted">Игра, презентация, код — со звуком</span>
            </button>
          </div>
          <div className="live-preview">
            {host.stream ? <StreamVideo stream={host.stream} muted /> : <span className="muted small">Выберите камеру или экран — здесь появится предпросмотр</span>}
          </div>
          <Input label="Название эфира" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} placeholder="О чём эфир" />
          <Textarea label="Описание" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} maxLength={1000} />
          <div className="card">
            <div className="list-item">
              <span className="list-item__body">
                <span className="list-item__title" style={{ display: 'block' }}>
                  Записывать эфир
                </span>
                <span className="list-item__sub">После эфира запись можно опубликовать как видео или скачать</span>
              </span>
              <Switch checked={record} onChange={setRecord} label="Записывать эфир" />
            </div>
          </div>
          <Button size="lg" icon={<Radio size={18} />} disabled={!host.stream || !title.trim()} loading={busy} onClick={() => void start()}>
            Выйти в эфир
          </Button>
        </div>
      </div>
    </div>
  );
}

/** После эфира: опубликовать запись в «Видео» или скачать. */
function RecordingPanel({ stream }: { stream: LiveStream }) {
  const rec = useHost((s) => s.recording);
  const navigate = useNavigate();
  const [title, setTitle] = useState(stream.title);
  const [progress, setProgress] = useState<number | null>(null);
  if (!rec) return null;
  const mb = rec.blob.size / 1024 / 1024;
  const download = () => {
    const url = URL.createObjectURL(rec.blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${stream.title.replace(/[^\p{L}\p{N} _-]/gu, '').slice(0, 60) || 'efir'}.${rec.blob.type.includes('mp4') ? 'mp4' : 'webm'}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  };
  const publish = async () => {
    setProgress(0);
    try {
      const post = await publishRecording(stream.id, title.trim() || stream.title, stream.description, setProgress);
      toast({ text: 'Запись опубликована в «Видео»', kind: 'success' });
      navigate(`/watch/${post.id}`);
    } catch (e) {
      setProgress(null);
      toast({ text: `${errorMessage(e)}. Запись можно скачать на устройство`, kind: 'error' });
    }
  };
  return (
    <div className="live-recording card">
      <b>Запись эфира · {mb < 1 ? '<1' : Math.round(mb)} МБ</b>
      <Input label="Название видео" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} />
      <div className="row gap-2 wrap">
        <Button loading={progress !== null} onClick={() => void publish()}>
          {progress !== null ? `Загрузка ${Math.round(progress * 100)}%` : 'Опубликовать в «Видео»'}
        </Button>
        <Button variant="secondary" icon={<Download size={16} />} onClick={download}>
          Скачать
        </Button>
        <Button variant="ghost" onClick={discardRecording}>
          Не сохранять
        </Button>
      </div>
    </div>
  );
}

export function LiveRoom() {
  const { id = '' } = useParams();
  const me = useMe();
  const host = useHost();
  const q = useQuery({ queryKey: liveKey(id), queryFn: () => api.get<{ stream: LiveStream; chat: LiveChatMessage[] }>(`/live/${id}`) });
  const stream = q.data?.stream;
  const isHost = host.streamId === id;
  const watching = !!stream && stream.status === 'live' && !isHost && stream.owner.id !== me.id;
  const viewer = useLiveViewer(id, watching);
  const [muted, setMuted] = useState(true);
  const elapsed = useElapsed(isHost ? host.startedAt : stream?.status === 'live' ? stream.startedAt : null);
  useCrumb(stream?.title);
  const end = useMutation({
    mutationFn: endLive,
    onError: (e) => toast({ text: errorMessage(e), kind: 'error' }),
  });

  if (q.isLoading) return <Loading />;
  if (q.error || !stream) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const ended = stream.status === 'ended' || viewer.state === 'ended';
  const viewers = isHost ? host.viewers : stream.viewers;

  return (
    <div className="scroll">
      <div className="live-room">
        <div className="live-room__main">
          <div className="live-stage">
            {isHost ? (
              <StreamVideo stream={host.stream} muted className="live-stage__video" />
            ) : !ended && viewer.stream ? (
              <StreamVideo stream={viewer.stream} muted={muted} className="live-stage__video" />
            ) : null}
            {!ended && !isHost && viewer.state === 'connecting' && <div className="live-stage__note">Подключаемся к эфиру…</div>}
            {!ended && !isHost && viewer.state === 'failed' && (
              <div className="live-stage__note">
                <span>{viewer.error}</span>
                <Button size="sm" onClick={viewer.retry}>
                  Попробовать снова
                </Button>
              </div>
            )}
            {ended && (
              <div className="live-stage__note">
                <b>Эфир завершён</b>
                {stream.recordingPostId && (
                  <ButtonLink to={`/watch/${stream.recordingPostId}`} size="sm">
                    Смотреть запись
                  </ButtonLink>
                )}
              </div>
            )}
            {!ended && stream.owner.id === me.id && !isHost && (
              <div className="live-stage__note">Эфир ведётся с другого устройства или вкладки</div>
            )}
            {!ended && (
              <div className="live-stage__top">
                <LiveBadge />
                <span className="live-stage__chip">
                  <Users size={14} /> {viewers}
                </span>
                {elapsed && <span className="live-stage__chip">{elapsed}</span>}
              </div>
            )}
            {!isHost && !ended && viewer.stream && (
              <button type="button" className="live-stage__sound" onClick={() => setMuted((m) => !m)} aria-label={muted ? 'Включить звук' : 'Выключить звук'}>
                {muted ? <VolumeX size={18} /> : <Volume2 size={18} />} {muted ? 'Включить звук' : ''}
              </button>
            )}
          </div>
          {isHost && (
            <div className="live-controls">
              <Button variant={host.micOn ? 'secondary' : 'danger'} icon={host.micOn ? <Mic size={18} /> : <MicOff size={18} />} onClick={toggleMic}>
                {host.micOn ? 'Микрофон' : 'Микрофон выкл.'}
              </Button>
              <Button variant={host.camOn ? 'secondary' : 'danger'} icon={host.camOn ? <Video size={18} /> : <VideoOff size={18} />} onClick={toggleCam}>
                {host.camOn ? (host.source === 'screen' ? 'Экран' : 'Камера') : 'Видео выкл.'}
              </Button>
              <Button variant="danger" icon={<Square size={16} />} loading={end.isPending} onClick={() => end.mutate()}>
                Завершить эфир
              </Button>
            </div>
          )}
          {stream.owner.id === me.id && !isHost && <RecordingPanel stream={stream} />}
          <h1 className="watch__title">{stream.title}</h1>
          <Link to={`/u/${stream.owner.username}`} className="row gap-2" style={{ color: 'inherit' }}>
            <Avatar src={stream.owner.avatarUrl} name={stream.owner.displayName} id={stream.owner.id} size={40} />
            <span className="col" style={{ gap: 0 }}>
              <b>{stream.owner.displayName}</b>
              <span className="xs muted">{ended ? `эфир ${timeAgo(stream.startedAt)} · до ${stream.peakViewers} зрителей` : 'в прямом эфире'}</span>
            </span>
          </Link>
          {stream.description && <p className="small muted">{stream.description}</p>}
        </div>
        <LiveChat room={`stream:${id}`} initial={q.data!.chat} sendPath={`/live/${id}/chat`} disabled={ended ? 'Эфир завершён — чат закрыт' : null} title="Чат эфира" />
      </div>
    </div>
  );
}
