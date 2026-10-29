/**
 * Студия эфира — отдельное окно для трансляций, как Twitch Studio / OBS:
 * сцена собирается из источников (фон, экран, камера окошком), звук
 * микшируется (микрофон, звук экрана, фоновая музыка) с живыми шкалами
 * громкости, а всё вместе уходит зрителям одним потоком. Пока эфир идёт —
 * окно остаётся пультом: статистика, управление и чат зрителей.
 */
import { useEffect, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Download, Eye, Film, Image as ImageIcon, Mic, MicOff, Monitor, Music, Palette, Pause, Play, Radio, RadioTower, Square, Video, VideoOff } from 'lucide-react';
import { LIMITS } from '@omni/shared';
import { errorMessage } from '../../shared/api/client';
import { toast } from '../../shared/stores/ui';
import { Button, Input, Switch, confirm } from '../../shared/ui';
import { cn } from '../../shared/lib/format';
import { elapsedLabel, useLocal, useNow } from '../video/lib';
import { SunBurst } from '../create/SunBurst';
import { StudioEngine, type Layout } from './studio';
import { useHost, goLive, endLive, publishRecording, discardRecording } from './host';
import { LiveChat } from './chat';
import './live.css';
import './studio.css';

const BG_COLORS = ['#0b0b12', '#101522', '#1a1020', '#07140f', '#1e1206', '#120a1e'];
const LAYOUTS: { id: Layout; label: string; icon: typeof Video }[] = [
  { id: 'camera', label: 'Камера', icon: Video },
  { id: 'screen', label: 'Экран', icon: Monitor },
  { id: 'screen-cam', label: 'Экран + камера', icon: Monitor },
];

export function StudioPage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<StudioEngine | null>(null);
  const destroyed = useRef(false);
  const micBar = useRef<HTMLSpanElement>(null);
  const musicBar = useRef<HTMLSpanElement>(null);

  const host = useHost();
  const live = !!host.streamId;
  const now = useNow(1000, live);

  const [, force] = useState(0);
  const rerender = () => force((n) => n + 1);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [record, setRecord] = useLocal('live-record', true);
  const [camOn, setCamOn] = useState(false);
  const [screenOn, setScreenOn] = useState(false);
  const [micMuted, setMicMuted] = useState(false);
  const [layout, setLayout] = useState<Layout>('camera');
  const [bgKind, setBgKind] = useState<'color' | 'image' | 'video'>('color');
  const [musicName, setMusicName] = useState<string | null>(null);
  const [musicPlaying, setMusicPlaying] = useState(false);
  const [micVol, setMicVol] = useState(1);
  const [musicVol, setMusicVol] = useState(0.6);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<'pult' | 'chat'>('pult');

  const bgImgInput = useRef<HTMLInputElement>(null);
  const bgVideoInput = useRef<HTMLInputElement>(null);
  const musicInput = useRef<HTMLInputElement>(null);

  const micMutedRef = useRef(false);
  micMutedRef.current = micMuted;
  const lastId = useRef<string | null>(null);
  if (host.streamId) lastId.current = host.streamId;

  // Создать движок, запустить отрисовку и шкалы громкости
  useEffect(() => {
    const engine = new StudioEngine(canvasRef.current!);
    engineRef.current = engine;
    engine.begin();
    let raf = 0;
    const tick = () => {
      const l = engine.levels();
      micBar.current?.style.setProperty('--l', String(micMutedRef.current ? 0 : l.mic));
      musicBar.current?.style.setProperty('--l', String(l.music));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      if (useHost.getState().streamId) void endLive();
      if (!destroyed.current) engine.destroy();
      destroyed.current = true;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const eng = () => engineRef.current!;
  const syncLayout = () => setLayout(eng().layout);

  const toggleCamera = async () => {
    const e = eng();
    if (camOn) {
      e.disableCamera();
      setCamOn(false);
    } else {
      try {
        await e.enableCamera();
        setCamOn(true);
      } catch (err) {
        toast({ text: mediaError(err), kind: 'error' });
      }
    }
    syncLayout();
  };
  const toggleScreen = async () => {
    const e = eng();
    if (screenOn) {
      e.disableScreen();
      setScreenOn(false);
    } else {
      try {
        await e.enableScreen();
        setScreenOn(true);
      } catch (err) {
        if ((err as DOMException).name !== 'NotAllowedError') toast({ text: mediaError(err), kind: 'error' });
      }
    }
    syncLayout();
    // Экран мог завершиться кнопкой браузера — подхватим состояние
    setTimeout(() => setScreenOn(!!eng().screen), 300);
  };

  const pickLayout = (l: Layout) => {
    if (l !== 'camera' && !eng().screen) return void toggleScreen();
    eng().layout = l;
    setLayout(l);
  };

  // Синхронизируем заголовок оверлея и громкости с движком
  useEffect(() => {
    if (engineRef.current) engineRef.current.title = title;
  }, [title]);
  useEffect(() => {
    engineRef.current?.setMicVolume(micVol);
  }, [micVol]);
  useEffect(() => {
    engineRef.current?.setMusicVolume(musicVol);
  }, [musicVol]);

  const onBgImage = async (f?: File) => {
    if (!f) return;
    await eng().setBackgroundImage(f);
    setBgKind('image');
  };
  const onBgVideo = async (f?: File) => {
    if (!f) return;
    await eng().setBackgroundVideo(f);
    setBgKind('video');
  };
  const onMusic = async (f?: File) => {
    if (!f) return;
    await eng().setMusic(f);
    setMusicName(f.name);
    setMusicPlaying(true);
  };

  const start = async () => {
    if (!camOn && !screenOn) return toast({ text: 'Включите камеру или экран', kind: 'error' });
    if (!title.trim()) return toast({ text: 'Придумайте название эфира', kind: 'error' });
    setBusy(true);
    try {
      useHost.setState({ stream: eng().output, source: screenOn ? 'screen' : 'camera', micOn: !micMuted, camOn });
      await goLive({ title: title.trim(), description, record });
      setTab('chat');
    } catch (e) {
      toast({ text: errorMessage(e) === 'Что-то пошло не так' ? (e as Error).message : errorMessage(e), kind: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const stop = async () => {
    if (!(await confirm({ title: 'Завершить эфир?', text: 'Зрители увидят, что трансляция закончилась', confirmLabel: 'Завершить', danger: true }))) return;
    await endLive().catch((e) => toast({ text: errorMessage(e), kind: 'error' }));
  };

  const elapsed = live && host.startedAt ? elapsedLabel(host.startedAt, now) : '';
  const streamId = host.streamId;

  return (
    <div className="pk-root estu-root">
      <input ref={bgImgInput} type="file" accept="image/*" hidden onChange={(e) => void onBgImage(e.target.files?.[0] ?? undefined)} />
      <input ref={bgVideoInput} type="file" accept="video/*" hidden onChange={(e) => void onBgVideo(e.target.files?.[0] ?? undefined)} />
      <input ref={musicInput} type="file" accept="audio/*" hidden onChange={(e) => void onMusic(e.target.files?.[0] ?? undefined)} />

      <div className="estu">
        {/* Сцена */}
        <section className="estu__stage">
          <div className="estu__screen">
            <canvas ref={canvasRef} className="estu__canvas" />
            {!camOn && !screenOn && (
              <div className="estu__empty">
                <SunBurst size={64} spin />
                <b>Соберите сцену</b>
                <span>Включите камеру или покажите экран — справа</span>
              </div>
            )}
            <div className="estu__badges">
              {live ? (
                <>
                  <span className="vbadge live-badge live-badge--on">
                    <Radio size={13} /> В ЭФИРЕ
                  </span>
                  <span className="vbadge vbadge--glass">
                    <Eye size={13} /> {host.viewers}
                  </span>
                  {elapsed && <span className="vbadge vbadge--glass vbadge--mono">{elapsed}</span>}
                </>
              ) : (
                <span className="vbadge vbadge--glass">Предпросмотр</span>
              )}
            </div>
          </div>

          {/* Выбор компоновки сцены */}
          <div className="estu__scenes" role="radiogroup" aria-label="Сцена">
            {LAYOUTS.map((l) => (
              <button
                key={l.id}
                type="button"
                role="radio"
                aria-checked={layout === l.id}
                className={cn('estu-scene', layout === l.id && 'estu-scene--on')}
                onClick={() => pickLayout(l.id)}
                disabled={l.id !== 'camera' && !screenOn && !eng()?.screen}
              >
                <l.icon size={16} /> {l.label}
              </button>
            ))}
          </div>
        </section>

        {/* Боковой пульт */}
        <aside className="estu__side">
          {live && (
            <div className="estu-tabs">
              <button type="button" className={cn('estu-tab', tab === 'pult' && 'estu-tab--on')} onClick={() => setTab('pult')}>
                Пульт
              </button>
              <button type="button" className={cn('estu-tab', tab === 'chat' && 'estu-tab--on')} onClick={() => setTab('chat')}>
                Чат зрителей
              </button>
            </div>
          )}

          {(!live || tab === 'pult') && (
            <div className="estu__scroll">
              {/* Источники */}
              <div className="estu-group">
                <h3 className="estu-group__title">Источники</h3>
                <div className="estu-sources">
                  <button type="button" className={cn('estu-src', camOn && 'estu-src--on')} onClick={() => void toggleCamera()}>
                    {camOn ? <Video size={20} /> : <VideoOff size={20} />}
                    <span>Камера</span>
                    <i>{camOn ? 'в эфире' : 'выключена'}</i>
                  </button>
                  <button type="button" className={cn('estu-src', screenOn && 'estu-src--on')} onClick={() => void toggleScreen()}>
                    <Monitor size={20} />
                    <span>Экран</span>
                    <i>{screenOn ? 'показывается' : 'не показан'}</i>
                  </button>
                </div>
              </div>

              {/* Фон */}
              <div className="estu-group">
                <h3 className="estu-group__title">Фон сцены</h3>
                <div className="estu-colors">
                  {BG_COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      className={cn('estu-color', bgKind === 'color' && eng()?.bg.color === c && 'estu-color--on')}
                      style={{ background: c }}
                      aria-label={`Цвет фона ${c}`}
                      onClick={() => {
                        eng().setBackgroundColor(c);
                        setBgKind('color');
                        rerender();
                      }}
                    />
                  ))}
                </div>
                <div className="estu-bgrow">
                  <button type="button" className={cn('estu-chip', bgKind === 'image' && 'estu-chip--on')} onClick={() => bgImgInput.current?.click()}>
                    <ImageIcon size={15} /> Фото
                  </button>
                  <button type="button" className={cn('estu-chip', bgKind === 'video' && 'estu-chip--on')} onClick={() => bgVideoInput.current?.click()}>
                    <Film size={15} /> Видео
                  </button>
                </div>
              </div>

              {/* Микшер */}
              <div className="estu-group">
                <h3 className="estu-group__title">Микшер</h3>
                <div className="estu-mix">
                  <button type="button" className={cn('estu-mute', micMuted && 'estu-mute--off')} onClick={() => setMicMuted(!eng().toggleMic())} aria-label="Микрофон">
                    {micMuted ? <MicOff size={18} /> : <Mic size={18} />}
                  </button>
                  <div className="estu-fader">
                    <span className="estu-meter" aria-hidden>
                      <span ref={micBar} className="estu-meter__bar" />
                    </span>
                    <input type="range" min={0} max={1.5} step={0.01} value={micVol} onChange={(e) => setMicVol(+e.target.value)} aria-label="Громкость микрофона" />
                  </div>
                  <span className="estu-mix__name">Микрофон</span>
                </div>

                <div className="estu-mix">
                  <button
                    type="button"
                    className={cn('estu-mute', !musicPlaying && 'estu-mute--off')}
                    onClick={() => (musicName ? setMusicPlaying(eng().toggleMusic()) : musicInput.current?.click())}
                    aria-label="Музыка"
                  >
                    {musicName ? musicPlaying ? <Pause size={18} /> : <Play size={18} /> : <Music size={18} />}
                  </button>
                  <div className="estu-fader">
                    <span className="estu-meter" aria-hidden>
                      <span ref={musicBar} className="estu-meter__bar estu-meter__bar--music" />
                    </span>
                    <input type="range" min={0} max={1} step={0.01} value={musicVol} onChange={(e) => setMusicVol(+e.target.value)} aria-label="Громкость музыки" />
                  </div>
                  <span className="estu-mix__name ellipsis" title={musicName ?? ''}>
                    {musicName ? musicName.replace(/\.[^.]+$/, '') : 'Добавить музыку'}
                  </span>
                </div>
              </div>

              {/* Детали эфира — до старта */}
              {!live && (
                <div className="estu-group">
                  <h3 className="estu-group__title">Эфир</h3>
                  <Input label="Название" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={LIMITS.titleMax} placeholder="О чём трансляция?" />
                  <label className="estu-field">
                    <span className="estu-field__label">Описание</span>
                    <textarea className="estu-field__input" rows={2} value={description} maxLength={LIMITS.postMax} onChange={(e) => setDescription(e.target.value)} placeholder="Коротко для зрителей" />
                  </label>
                  <label className="estu-row">
                    <Palette size={16} />
                    <span className="grow">Показывать название на сцене</span>
                    <Switch checked={eng()?.showOverlay ?? true} onChange={(v) => { eng().showOverlay = v; rerender(); }} label="Оверлей" />
                  </label>
                  <label className="estu-row">
                    <Download size={16} />
                    <span className="grow">Записать эфир в файл</span>
                    <Switch checked={record} onChange={setRecord} label="Запись" />
                  </label>
                </div>
              )}
            </div>
          )}

          {live && tab === 'chat' && streamId && (
            <div className="estu__chat">
              <LiveChat room={`stream:${streamId}`} initial={[]} sendPath={`/live/${streamId}/chat`} title="Чат зрителей" subtitle={`${host.viewers} смотрят`} ownerId={undefined} />
            </div>
          )}

          {/* Нижняя кнопка */}
          <div className="estu__action">
            {!live ? (
              <Button block size="lg" className="estu__go" loading={busy} onClick={() => void start()} icon={<RadioTower size={18} />}>
                Выйти в эфир
              </Button>
            ) : (
              <Button block size="lg" variant="danger" onClick={() => void stop()} icon={<Square size={16} />}>
                Завершить эфир
              </Button>
            )}
          </div>
        </aside>
      </div>

      {host.recording && streamId === null && <RecordingCard streamId={lastId.current ?? ''} title={title} description={description} />}
    </div>
  );
}

function mediaError(e: unknown): string {
  const name = (e as DOMException).name;
  if (name === 'NotAllowedError') return 'Доступ не разрешён — разрешите камеру и микрофон для сайта';
  if (name === 'NotFoundError') return 'Устройство не найдено';
  return errorMessage(e);
}

/** После эфира: опубликовать или скачать запись. */
function RecordingCard({ streamId, title, description }: { streamId: string; title: string; description: string }) {
  const rec = useHost((s) => s.recording);
  const [name, setName] = useState(title);
  const [progress, setProgress] = useState<number | null>(null);
  const publish = useMutation({
    mutationFn: () => publishRecording(streamId, name.trim() || title || 'Эфир', description, setProgress),
    onSuccess: () => toast({ text: 'Запись опубликована в «Видео»', kind: 'success' }),
    onError: (e) => {
      setProgress(null);
      toast({ text: `${errorMessage(e)}. Запись можно скачать`, kind: 'error' });
    },
  });
  if (!rec) return null;
  const mb = rec.blob.size / 1024 / 1024;
  const download = () => {
    const url = URL.createObjectURL(rec.blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(title || 'efir').replace(/[^\p{L}\p{N} _-]/gu, '').slice(0, 60)}.${rec.blob.type.includes('mp4') ? 'mp4' : 'webm'}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  };
  return (
    <div className="estu-rec">
      <div className="estu-rec__card">
        <b>Эфир завершён — осталась запись</b>
        <span className="small muted">{mb < 1 ? 'меньше 1' : Math.round(mb)} МБ</span>
        <Input label="Название видео" value={name} onChange={(e) => setName(e.target.value)} maxLength={LIMITS.titleMax} />
        {progress !== null && (
          <span className="vup__progress" aria-hidden>
            <span style={{ width: `${progress * 100}%` }} />
          </span>
        )}
        <div className="row gap-2 wrap">
          <Button pill loading={progress !== null} onClick={() => publish.mutate()}>
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
    </div>
  );
}
