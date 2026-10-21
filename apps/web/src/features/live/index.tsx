/**
 * Прямые эфиры: кто сейчас в эфире, студия подготовки (камера или экран,
 * выбор устройств, проверка звука), сам эфир — для ведущего с панелью
 * управления, статистикой и записью, для зрителя с плеером и чатом.
 * Премьеры видео — в premiere.tsx.
 */
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  CircleCheck,
  CircleAlert,
  Clock,
  Copy,
  Download,
  Eye,
  MessageSquare,
  Mic,
  MicOff,
  Monitor,
  PanelRightOpen,
  Radio,
  Share2,
  Signal,
  Square,
  TrendingUp,
  Users,
  Video,
  VideoOff,
} from 'lucide-react';
import type { LiveChatMessage, LiveStream } from '@omni/shared';
import { LIMITS } from '@omni/shared';
import { api, errorMessage } from '../../shared/api/client';
import { useMe } from '../../shared/stores/session';
import { toast, useCrumb } from '../../shared/stores/ui';
import { cn, fullDate, timeAgo } from '../../shared/lib/format';
import { Button, ButtonLink, confirm, EmptyState, ErrorState, Input, Switch, Textarea } from '../../shared/ui';
import { shareLink } from '../posts/actions';
import { ChannelLine, LiveBadge, LiveCard, SubscribeButton, useChannel, useLiveList, VideoCardSkeleton, VideoChips } from '../video/components';
import { Player } from '../video/player';
import { elapsedLabel, useCompact, useLocal, useNow, viewersLabel, watchingLabel } from '../video/lib';
import { LiveChat } from './chat';
import { liveKey, roomKey } from './bus';
import { bitrateFor, discardRecording, endLive, goLive, prepareSource, publishRecording, releasePreview, toggleCam, toggleMic, useHost, type DeviceChoice, type LiveSource } from './host';
import { useLiveViewer } from './viewer';
import '../video/video.css';
import './live.css';

export { PremieresPage, PremiereChat, PremiereWaiting, usePremierePhase, usePremiereRoom } from './premiere';

function StreamVideo({ stream, muted, className, mirror }: { stream: MediaStream | null; muted?: boolean; className?: string; mirror?: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (ref.current && ref.current.srcObject !== stream) ref.current.srcObject = stream;
  }, [stream]);
  return <video ref={ref} className={cn(className, mirror && 'is-mirror')} autoPlay playsInline muted={muted} />;
}

// ─── Сейчас в эфире ─────────────────────────────────────────────────────────

export function LiveHome() {
  const q = useLiveList();
  const live = q.data?.live ?? [];
  const recent = q.data?.recent ?? [];
  return (
    <div className="scroll">
      <div className="vroot">
        <div className="vhome">
          <div className="vhome__top">
            <VideoChips active="live" />
            <ButtonLink to="/live/new" size="sm" pill className="lgo-link" icon={<Radio size={16} />}>
              Начать трансляцию
            </ButtonLink>
          </div>
          {q.isLoading ? (
            <div className="vgrid">
              {Array.from({ length: 6 }, (_, i) => (
                <VideoCardSkeleton key={i} />
              ))}
            </div>
          ) : q.error ? (
            <ErrorState error={q.error} onRetry={() => void q.refetch()} />
          ) : (
            <>
              <section className="vsection">
                <h2 className="vsection__title">
                  <LiveBadge small label="Live" /> Сейчас в эфире
                </h2>
                {live.length ? (
                  <div className="vgrid">
                    {live.map((s) => (
                      <LiveCard key={s.id} s={s} />
                    ))}
                  </div>
                ) : (
                  <div className="lempty">
                    <span className="lempty__icon">
                      <Radio size={30} />
                    </span>
                    <div>
                      <b>Сейчас никто не в эфире</b>
                      <p>Начните первым — подписчики с колокольчиком получат уведомление, а зрители смогут писать в чат</p>
                    </div>
                    <ButtonLink to="/live/new" pill icon={<Radio size={16} />}>
                      Начать трансляцию
                    </ButtonLink>
                  </div>
                )}
              </section>
              {recent.length > 0 && (
                <section className="vsection">
                  <h2 className="vsection__title">Недавние трансляции</h2>
                  <div className="vgrid">
                    {recent.map((s) => (
                      <LiveCard key={s.id} s={s} />
                    ))}
                  </div>
                </section>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Студия: подготовка к эфиру ─────────────────────────────────────────────

/** Уровень звука микрофона 0…1 (для индикатора). */
function useAudioLevel(stream: MediaStream | null): number {
  const [level, setLevel] = useState(0);
  useEffect(() => {
    const track = stream?.getAudioTracks()[0];
    if (!stream || !track) {
      setLevel(0);
      return;
    }
    let ctx: AudioContext | null = null;
    let raf = 0;
    try {
      ctx = new AudioContext();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      ctx.createMediaStreamSource(new MediaStream([track])).connect(analyser);
      const data = new Uint8Array(analyser.fftSize);
      let last = 0;
      const tick = (t: number) => {
        raf = requestAnimationFrame(tick);
        if (t - last < 70) return;
        last = t;
        analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (const v of data) sum += ((v - 128) / 128) ** 2;
        setLevel(track.enabled ? Math.min(1, Math.sqrt(sum / data.length) * 4) : 0);
      };
      raf = requestAnimationFrame(tick);
    } catch {
      /* без индикатора */
    }
    return () => {
      cancelAnimationFrame(raf);
      void ctx?.close().catch(() => undefined);
    };
  }, [stream]);
  return level;
}

function LevelMeter({ level }: { level: number }) {
  return (
    <span className="lmeter" aria-label={`Уровень звука ${Math.round(level * 100)}%`}>
      {Array.from({ length: 12 }, (_, i) => (
        <span key={i} className={cn('lmeter__bar', level * 12 > i && 'lmeter__bar--on', i >= 9 && 'lmeter__bar--hot')} />
      ))}
    </span>
  );
}

function trackInfo(stream: MediaStream | null) {
  const s = stream?.getVideoTracks()[0]?.getSettings();
  return s?.width ? `${s.width}×${s.height}${s.frameRate ? ` · ${Math.round(s.frameRate)} к/с` : ''}` : null;
}

export function GoLivePage() {
  const navigate = useNavigate();
  const host = useHost();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [record, setRecord] = useLocal('live-record', true);
  const [busy, setBusy] = useState(false);
  const [devices, setDevices] = useState<{ cams: MediaDeviceInfo[]; mics: MediaDeviceInfo[] }>({ cams: [], mics: [] });
  const [choice, setChoice] = useState<DeviceChoice>({});
  const level = useAudioLevel(host.stream);

  const refreshDevices = async () => {
    const all = await navigator.mediaDevices?.enumerateDevices().catch(() => []);
    setDevices({ cams: (all ?? []).filter((d) => d.kind === 'videoinput' && d.deviceId), mics: (all ?? []).filter((d) => d.kind === 'audioinput' && d.deviceId) });
  };
  const choose = async (source: LiveSource, next: DeviceChoice = choice) => {
    try {
      await prepareSource(source, next);
      void refreshDevices();
    } catch (e) {
      const name = (e as DOMException).name;
      toast({
        text: name === 'NotAllowedError' ? 'Доступ не разрешён — разрешите камеру и микрофон для сайта' : name === 'NotFoundError' ? 'Устройство не найдено' : errorMessage(e),
        kind: 'error',
      });
    }
  };
  useEffect(() => {
    if (host.streamId) navigate(`/live/${host.streamId}`, { replace: true });
    void refreshDevices();
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
  const info = trackInfo(host.stream);
  const hasAudio = !!host.stream?.getAudioTracks().length;
  const ready = !!host.stream && !!title.trim();

  return (
    <div className="scroll">
      <div className="vroot">
        <div className="lstudio">
          <header className="lstudio__head">
            <h1>Трансляция</h1>
            <span className={cn('lstatus', host.stream && 'lstatus--ready')}>
              <span className="lstatus__dot" /> {host.stream ? 'Предпросмотр' : 'Нет сигнала'}
            </span>
          </header>
          <div className="lstudio__grid">
            <section className="lstudio__main">
              <div className="lstage">
                {host.stream ? (
                  <>
                    <StreamVideo stream={host.stream} muted className="lstage__video" mirror={host.source === 'camera'} />
                    <span className="lstage__badges">
                      <span className="vbadge vbadge--glass">Предпросмотр</span>
                      {!host.micOn && (
                        <span className="vbadge vbadge--glass">
                          <MicOff size={13} /> Без звука
                        </span>
                      )}
                    </span>
                  </>
                ) : (
                  <div className="lstage__pick">
                    <b>Что показываем зрителям?</b>
                    <div className="lstage__choices">
                      <button type="button" className="lchoice" onClick={() => void choose('camera')}>
                        <Video size={26} />
                        <b>Камера</b>
                        <span>Вы в кадре, с микрофоном</span>
                      </button>
                      <button type="button" className="lchoice" onClick={() => void choose('screen')}>
                        <Monitor size={26} />
                        <b>Экран</b>
                        <span>Игра, презентация, код — со звуком</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
              {host.stream && (
                <div className="lstudio__toolbar">
                  <div className="vseg" role="radiogroup" aria-label="Источник">
                    <button type="button" role="radio" aria-checked={host.source === 'camera'} className={cn('vseg__opt', host.source === 'camera' && 'vseg__opt--on')} onClick={() => void choose('camera')}>
                      <Video size={16} /> Камера
                    </button>
                    <button type="button" role="radio" aria-checked={host.source === 'screen'} className={cn('vseg__opt', host.source === 'screen' && 'vseg__opt--on')} onClick={() => void choose('screen')}>
                      <Monitor size={16} /> Экран
                    </button>
                  </div>
                  {host.source === 'camera' && devices.cams.length > 1 && (
                    <select
                      className="lselect"
                      aria-label="Камера"
                      value={choice.cameraId ?? host.stream.getVideoTracks()[0]?.getSettings().deviceId ?? ''}
                      onChange={(e) => {
                        const next = { ...choice, cameraId: e.target.value };
                        setChoice(next);
                        void choose('camera', next);
                      }}
                    >
                      {devices.cams.map((d, i) => (
                        <option key={d.deviceId} value={d.deviceId}>
                          {d.label || `Камера ${i + 1}`}
                        </option>
                      ))}
                    </select>
                  )}
                  {devices.mics.length > 1 && (
                    <select
                      className="lselect"
                      aria-label="Микрофон"
                      value={choice.micId ?? host.stream.getAudioTracks()[0]?.getSettings().deviceId ?? ''}
                      onChange={(e) => {
                        const next = { ...choice, micId: e.target.value };
                        setChoice(next);
                        void choose(host.source, next);
                      }}
                    >
                      {devices.mics.map((d, i) => (
                        <option key={d.deviceId} value={d.deviceId}>
                          {d.label || `Микрофон ${i + 1}`}
                        </option>
                      ))}
                    </select>
                  )}
                  <span className="vp__grow" />
                  <button type="button" className={cn('lround', !host.micOn && 'lround--off')} onClick={toggleMic} aria-label={host.micOn ? 'Выключить микрофон' : 'Включить микрофон'} title="Микрофон">
                    {host.micOn ? <Mic size={18} /> : <MicOff size={18} />}
                  </button>
                  <button type="button" className={cn('lround', !host.camOn && 'lround--off')} onClick={toggleCam} aria-label={host.camOn ? 'Выключить видео' : 'Включить видео'} title="Видео">
                    {host.camOn ? <Video size={18} /> : <VideoOff size={18} />}
                  </button>
                </div>
              )}
              <div className="lchecks">
                <div className="lcheck">
                  {info ? <CircleCheck size={18} className="lcheck__ok" /> : <CircleAlert size={18} className="lcheck__wait" />}
                  <span>
                    <b>Видео</b>
                    <span>{info ?? 'Выберите камеру или экран'}</span>
                  </span>
                </div>
                <div className="lcheck">
                  {hasAudio ? <CircleCheck size={18} className="lcheck__ok" /> : <CircleAlert size={18} className="lcheck__wait" />}
                  <span>
                    <b>Звук</b>
                    {hasAudio ? <LevelMeter level={level} /> : <span>Микрофон не подключён</span>}
                  </span>
                </div>
                <div className="lcheck">
                  <Users size={18} className="lcheck__info" />
                  <span>
                    <b>Зрители</b>
                    <span>До 50 одновременно, качество подстраивается</span>
                  </span>
                </div>
              </div>
            </section>

            <aside className="lstudio__side">
              <label className="vup-field">
                <span className="vup-field__label">Название (обязательно)</span>
                <input className="vup-field__input" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={LIMITS.titleMax} placeholder="О чём трансляция" />
                <span className="vup-field__count">
                  {title.length}/{LIMITS.titleMax}
                </span>
              </label>
              <label className="vup-field">
                <span className="vup-field__label">Описание</span>
                <textarea className="vup-field__input" rows={4} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={1000} placeholder="Расскажите зрителям, что будет в эфире" />
              </label>
              <div className="vup-row">
                <Download size={18} className="vup-row__icon" />
                <span className="vup-row__text">
                  <b>Записывать трансляцию</b>
                  <span>Запись можно будет опубликовать как видео или скачать</span>
                </span>
                <Switch checked={record} onChange={setRecord} label="Записывать трансляцию" />
              </div>
              <button type="button" className="lgo" disabled={!ready || busy} onClick={() => void start()}>
                {busy ? <span className="spinner" style={{ width: 18, height: 18 }} /> : <Radio size={20} />}
                Начать трансляцию
              </button>
              <p className="lstudio__note">{!host.stream ? 'Сначала выберите, что показывать' : !title.trim() ? 'Добавьте название трансляции' : 'Подписчики с колокольчиком получат уведомление'}</p>
            </aside>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── После эфира: запись ────────────────────────────────────────────────────

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
    <div className="lrec">
      <div className="lrec__head">
        <b>Запись трансляции</b>
        <span>
          {mb < 1 ? 'меньше 1' : Math.round(mb)} МБ · {elapsedLabel(0, rec.durationSec * 1000)}
        </span>
      </div>
      <Input label="Название видео" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={LIMITS.titleMax} />
      {progress !== null && (
        <span className="vup__progress" aria-hidden>
          <span style={{ width: `${progress * 100}%` }} />
        </span>
      )}
      <div className="row gap-2 wrap">
        <Button pill loading={progress !== null} onClick={() => void publish()}>
          {progress !== null ? `Загрузка ${Math.round(progress * 100)}%` : 'Опубликовать в «Видео»'}
        </Button>
        <Button variant="secondary" pill icon={<Download size={16} />} onClick={download}>
          Скачать
        </Button>
        <Button variant="ghost" pill onClick={discardRecording}>
          Не сохранять
        </Button>
      </div>
    </div>
  );
}

// ─── Комната эфира ──────────────────────────────────────────────────────────

function StatTile({ icon, label, value }: { icon: React.ReactNode; label: string; value: React.ReactNode }) {
  return (
    <div className="lstat">
      <span className="lstat__label">
        {icon} {label}
      </span>
      <span className="lstat__value">{value}</span>
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
  const now = useNow(1000, !!stream && stream.status === 'live');
  const [chatHidden, setChatHidden] = useLocal('live-chat-hidden', false);
  const [rootRef, compact] = useCompact<HTMLDivElement>(1000);
  const channel = useChannel(stream?.owner);
  const chat = useQuery({ queryKey: roomKey(`stream:${id}`), queryFn: () => q.data?.chat ?? [], enabled: false, initialData: q.data?.chat });
  const [peak, setPeak] = useState(0);
  useCrumb(stream?.title);
  useEffect(() => setPeak((p) => Math.max(p, host.viewers)), [host.viewers]);
  const end = useMutation({
    mutationFn: endLive,
    onError: (e) => toast({ text: errorMessage(e), kind: 'error' }),
  });
  const askEnd = async () => {
    if (await confirm({ title: 'Завершить трансляцию?', text: 'Зрители увидят, что эфир закончился', confirmLabel: 'Завершить', danger: true })) end.mutate();
  };

  if (q.isLoading)
    return (
      <div className="scroll">
        <div className="vroot">
          <div className="lroom">
            <div className="lroom__player">
              <div className="vp-skeleton" />
            </div>
          </div>
        </div>
      </div>
    );
  if (q.error || !stream) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const ended = stream.status === 'ended' || viewer.state === 'ended';
  const viewers = isHost ? host.viewers : stream.viewers;
  const startedMs = isHost && host.startedAt ? host.startedAt : Date.parse(stream.startedAt);
  const elapsed = !ended ? elapsedLabel(startedMs, now) : '';
  const ownOtherDevice = !ended && stream.owner.id === me.id && !isHost;

  const badges = !ended && (
    <>
      <LiveBadge />
      <span className="vbadge vbadge--glass">
        <Eye size={13} /> {viewers}
      </span>
      {elapsed && <span className="vbadge vbadge--glass vbadge--mono">{elapsed}</span>}
    </>
  );

  let stage: React.ReactNode;
  if (ended) {
    stage = (
      <div className="lended">
        <span className="lended__icon">
          <Radio size={28} />
        </span>
        <b>Трансляция завершена</b>
        <span>
          {fullDate(stream.startedAt)} · {viewersLabel(stream.totalViewers || stream.peakViewers)}
        </span>
        {stream.recordingPostId && (
          <ButtonLink to={`/watch/${stream.recordingPostId}`} pill>
            Смотреть запись
          </ButtonLink>
        )}
      </div>
    );
  } else if (isHost) {
    stage = (
      <div className="vp-shell">
        <div className="vp vp--host">
          <StreamVideo stream={host.stream} muted className="vp__video" mirror={host.source === 'camera'} />
          <div className="vp__shade vp__shade--top" aria-hidden />
          <div className="vp__badges">
            {badges}
            {!host.micOn && (
              <span className="vbadge vbadge--glass">
                <MicOff size={13} /> Микрофон выключен
              </span>
            )}
          </div>
        </div>
      </div>
    );
  } else if (ownOtherDevice) {
    stage = (
      <div className="lended">
        <LiveBadge />
        <b>Трансляция ведётся с другого устройства или вкладки</b>
      </div>
    );
  } else {
    stage = (
      <Player
        mode="live"
        stream={viewer.stream}
        autoPlay
        title={stream.title}
        artist={stream.owner.displayName}
        badges={badges}
        overlay={
          viewer.state === 'connecting' && !viewer.stream ? (
            <div className="vp__note">
              <span className="vp__spinner vp__spinner--static" />
              Подключаемся к трансляции…
            </div>
          ) : viewer.state === 'failed' ? (
            <div className="vp__note">
              <span>{viewer.error}</span>
              <button type="button" className="vp__pill" onClick={viewer.retry}>
                Попробовать снова
              </button>
            </div>
          ) : null
        }
      />
    );
  }

  const chatPanel = chatHidden && !compact ? (
    <button type="button" className="lshow-chat" onClick={() => setChatHidden(false)}>
      <PanelRightOpen size={18} /> Показать чат
    </button>
  ) : (
    <LiveChat
      room={`stream:${id}`}
      initial={q.data!.chat}
      sendPath={`/live/${id}/chat`}
      disabled={ended ? 'Трансляция завершена — чат закрыт' : null}
      title="Чат"
      subtitle={ended ? undefined : watchingLabel(viewers)}
      ownerId={stream.owner.id}
      onClose={compact ? undefined : () => setChatHidden(true)}
    />
  );

  return (
    <div className="scroll">
      <div className="vroot" ref={rootRef}>
        <div className={cn('lroom', compact && 'lroom--compact', chatHidden && !compact && 'lroom--nochat')}>
          <div className="lroom__player">{stage}</div>
          <div className="lroom__main">
            {isHost && !ended && (
              <div className="lhost">
                <div className="lhost__bar">
                  <span className="lstatus lstatus--live">
                    <span className="lstatus__dot" /> Вы в эфире · {elapsed}
                  </span>
                  <span className="vp__grow" />
                  <button type="button" className={cn('lround', !host.micOn && 'lround--off')} onClick={toggleMic} aria-label="Микрофон" title={host.micOn ? 'Выключить микрофон' : 'Включить микрофон'}>
                    {host.micOn ? <Mic size={18} /> : <MicOff size={18} />}
                  </button>
                  <button type="button" className={cn('lround', !host.camOn && 'lround--off')} onClick={toggleCam} aria-label="Видео" title={host.camOn ? 'Выключить видео' : 'Включить видео'}>
                    {host.camOn ? host.source === 'screen' ? <Monitor size={18} /> : <Video size={18} /> : <VideoOff size={18} />}
                  </button>
                  <button
                    type="button"
                    className="lround"
                    onClick={() => void navigator.clipboard.writeText(`${location.origin}/live/${id}`).then(() => toast('Ссылка на трансляцию скопирована'))}
                    aria-label="Скопировать ссылку"
                    title="Скопировать ссылку"
                  >
                    <Copy size={18} />
                  </button>
                  <button type="button" className="lend" disabled={end.isPending} onClick={() => void askEnd()}>
                    <Square size={14} fill="currentColor" /> Завершить
                  </button>
                </div>
                <div className="lstats">
                  <StatTile icon={<Eye size={14} />} label="Смотрят сейчас" value={host.viewers} />
                  <StatTile icon={<TrendingUp size={14} />} label="Пик" value={Math.max(peak, stream.peakViewers)} />
                  <StatTile icon={<Clock size={14} />} label="Длительность" value={elapsed} />
                  <StatTile icon={<MessageSquare size={14} />} label="Сообщений" value={chat.data?.length ?? 0} />
                  <StatTile icon={<Signal size={14} />} label="Битрейт" value={`${(bitrateFor(host.viewers) / 1_000_000).toFixed(1).replace('.', ',')} Мбит/с`} />
                </div>
              </div>
            )}
            {stream.owner.id === me.id && !isHost && <RecordingPanel stream={stream} />}
            <h1 className="vwatch__title">{stream.title}</h1>
            <div className="vwatch__bar">
              <div className="vwatch__owner">
                <ChannelLine user={stream.owner} profile={channel.data} />
                <SubscribeButton user={stream.owner} profile={channel.data} />
              </div>
              <div className="vwatch__actions">
                <button type="button" className="vact" onClick={() => shareLink(`/live/${id}`)}>
                  <Share2 size={18} /> Поделиться
                </button>
              </div>
            </div>
            <div className="vdesc vdesc--open">
              <div className="vdesc__meta">
                {ended ? (
                  <b>
                    Трансляция {timeAgo(stream.startedAt)} · {viewersLabel(stream.totalViewers || stream.peakViewers)} · пик {stream.peakViewers}
                  </b>
                ) : (
                  <b>
                    {watchingLabel(viewers)} · Трансляция началась {timeAgo(stream.startedAt)}
                  </b>
                )}
              </div>
              {stream.description ? <div className="vdesc__body pre-wrap">{stream.description}</div> : <div className="vdesc__body vdesc__empty">Без описания</div>}
            </div>
            {!isHost && !ended && (
              <Link to="/live" className="lmore">
                Другие трансляции →
              </Link>
            )}
          </div>
          <aside className="lroom__chat">{chatPanel}</aside>
        </div>
      </div>
    </div>
  );
}
