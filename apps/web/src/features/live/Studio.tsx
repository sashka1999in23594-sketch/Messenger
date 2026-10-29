/**
 * Студия эфира — минималистичный макет: превью занимает почти всё окно, а
 * управление собрано в тонкую плавающую панель снизу, как у видеоплеера.
 * Источники, фон, музыка и микшер не висят карточками — они выезжают
 * всплывающими панелями по кнопке и прячутся. Сцену и звук собирает движок
 * StudioEngine; этот компонент — только интерфейс.
 */
import { useEffect, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Download, Eye, Film, Image as ImageIcon, Mic, MicOff, Monitor, MonitorOff, Music, Palette, Pause, Play, Radio, RadioTower, SlidersHorizontal, Square, Video, VideoOff, X } from 'lucide-react';
import { LIMITS } from '@omni/shared';
import { errorMessage } from '../../shared/api/client';
import { toast } from '../../shared/stores/ui';
import { Button, Input, confirm } from '../../shared/ui';
import { cn } from '../../shared/lib/format';
import { elapsedLabel, useLocal, useNow } from '../video/lib';
import { SunBurst } from '../create/SunBurst';
import { StudioEngine, type Layout } from './studio';
import { useHost, goLive, endLive, publishRecording, discardRecording } from './host';
import { LiveChat } from './chat';
import './live.css';
import './studio.css';

const BG_COLORS = ['#0b0b12', '#101522', '#1a1020', '#07140f', '#1e1206', '#120a1e'];

export function StudioPage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<StudioEngine | null>(null);
  const destroyed = useRef(false);
  const micBtn = useRef<HTMLButtonElement>(null);
  const musicBtn = useRef<HTMLButtonElement>(null);
  const micBar = useRef<HTMLSpanElement>(null);
  const musicBar = useRef<HTMLSpanElement>(null);

  const host = useHost();
  const live = !!host.streamId;
  const now = useNow(1000, live);

  const [, force] = useState(0);
  const rerender = () => force((n) => n + 1);

  const [title, setTitle] = useState('');
  const [description] = useState('');
  const [record, setRecord] = useLocal('live-record', true);
  const [camOn, setCamOn] = useState(false);
  const [screenOn, setScreenOn] = useState(false);
  const [micMuted, setMicMuted] = useState(false);
  const [, setLayout] = useState<Layout>('camera');
  const [bgKind, setBgKind] = useState<'color' | 'image' | 'video'>('color');
  const [musicName, setMusicName] = useState<string | null>(null);
  const [musicPlaying, setMusicPlaying] = useState(false);
  const [micVol, setMicVol] = useState(1);
  const [musicVol, setMusicVol] = useState(0.6);
  const [busy, setBusy] = useState(false);
  const [panel, setPanel] = useState<'' | 'bg' | 'music' | 'mix'>('');
  const [chatOpen, setChatOpen] = useState(false);

  const bgImgInput = useRef<HTMLInputElement>(null);
  const bgVideoInput = useRef<HTMLInputElement>(null);
  const musicInput = useRef<HTMLInputElement>(null);

  const micMutedRef = useRef(false);
  micMutedRef.current = micMuted;
  const lastId = useRef<string | null>(null);
  if (host.streamId) lastId.current = host.streamId;

  useEffect(() => {
    const engine = new StudioEngine(canvasRef.current!);
    engineRef.current = engine;
    engine.begin();
    let raf = 0;
    const tick = () => {
      const l = engine.levels();
      const m = micMutedRef.current ? 0 : l.mic;
      micBtn.current?.style.setProperty('--l', String(m));
      musicBtn.current?.style.setProperty('--l', String(l.music));
      micBar.current?.style.setProperty('--l', String(m));
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
    setTimeout(() => setScreenOn(!!eng().screen), 300);
  };

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
    setPanel('music');
  };

  const start = async () => {
    if (!camOn && !screenOn) return toast({ text: 'Включите камеру или экран', kind: 'error' });
    if (!title.trim()) return toast({ text: 'Впишите название вверху экрана', kind: 'error' });
    setBusy(true);
    try {
      useHost.setState({ stream: eng().output, source: screenOn ? 'screen' : 'camera', micOn: !micMuted, camOn });
      await goLive({ title: title.trim(), description, record });
      setPanel('');
      setChatOpen(true);
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

  const toggle = (p: 'bg' | 'music' | 'mix') => setPanel((cur) => (cur === p ? '' : p));
  const nothing = !camOn && !screenOn;
  const elapsed = live && host.startedAt ? elapsedLabel(host.startedAt, now) : '';
  const streamId = host.streamId;

  return (
    <div className="pk-root estu-root">
      <input ref={bgImgInput} type="file" accept="image/*" hidden onChange={(e) => void onBgImage(e.target.files?.[0] ?? undefined)} />
      <input ref={bgVideoInput} type="file" accept="video/*" hidden onChange={(e) => void onBgVideo(e.target.files?.[0] ?? undefined)} />
      <input ref={musicInput} type="file" accept="audio/*" hidden onChange={(e) => void onMusic(e.target.files?.[0] ?? undefined)} />

      <div className="estu">
        <div className="estu__stage" onClick={() => setPanel('')}>
          <canvas ref={canvasRef} className="estu__canvas" />

          {nothing && (
            <div className="estu__empty">
              <SunBurst size={72} spin />
              <b>Соберите сцену</b>
              <span>Включите камеру или экран на панели снизу</span>
            </div>
          )}

          {/* Статус слева сверху */}
          <div className="estu__status">
            {live ? (
              <>
                <span className="estu-chip estu-chip--live">
                  <Radio size={13} /> В ЭФИРЕ
                </span>
                <span className="estu-chip">
                  <Eye size={13} /> {host.viewers}
                </span>
                {elapsed && <span className="estu-chip estu-chip--mono">{elapsed}</span>}
              </>
            ) : (
              <span className="estu-chip">Предпросмотр</span>
            )}
          </div>

          {/* Название — без рамки, по центру сверху */}
          <input
            className="estu__title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={LIMITS.titleMax}
            placeholder="Название трансляции…"
            onClick={(e) => e.stopPropagation()}
          />

          {/* Чат зрителей — выезжает справа в эфире */}
          {live && chatOpen && streamId && (
            <div className="estu__chat" onClick={(e) => e.stopPropagation()}>
              <LiveChat room={`stream:${streamId}`} initial={[]} sendPath={`/live/${streamId}/chat`} title="Чат зрителей" subtitle={`${host.viewers} смотрят`} onClose={() => setChatOpen(false)} />
            </div>
          )}

          {/* Всплывающие панели над доком */}
          {panel === 'bg' && (
            <Pop onClose={() => setPanel('')}>
              <div className="estu-pop__title">Фон сцены</div>
              <div className="estu-colors">
                {BG_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    className={cn('estu-color', bgKind === 'color' && eng()?.bg.color === c && 'estu-color--on')}
                    style={{ background: c }}
                    aria-label="Цвет фона"
                    onClick={() => {
                      eng().setBackgroundColor(c);
                      setBgKind('color');
                      rerender();
                    }}
                  />
                ))}
              </div>
              <div className="estu-pop__row">
                <button type="button" className={cn('estu-mini', bgKind === 'image' && 'estu-mini--on')} onClick={() => bgImgInput.current?.click()}>
                  <ImageIcon size={15} /> Фото
                </button>
                <button type="button" className={cn('estu-mini', bgKind === 'video' && 'estu-mini--on')} onClick={() => bgVideoInput.current?.click()}>
                  <Film size={15} /> Видео
                </button>
              </div>
            </Pop>
          )}

          {panel === 'music' && (
            <Pop onClose={() => setPanel('')}>
              <div className="estu-pop__title">Фоновая музыка</div>
              {musicName ? (
                <>
                  <div className="estu-music">
                    <button type="button" className="estu-iconbtn" onClick={() => setMusicPlaying(eng().toggleMusic())} aria-label={musicPlaying ? 'Пауза' : 'Играть'}>
                      {musicPlaying ? <Pause size={16} /> : <Play size={16} />}
                    </button>
                    <span className="estu-music__name ellipsis" title={musicName}>
                      {musicName.replace(/\.[^.]+$/, '')}
                    </span>
                  </div>
                  <label className="estu-slider">
                    <Music size={14} />
                    <input type="range" min={0} max={1} step={0.01} value={musicVol} onChange={(e) => setMusicVol(+e.target.value)} aria-label="Громкость музыки" />
                  </label>
                  <button type="button" className="estu-mini" onClick={() => musicInput.current?.click()}>
                    Выбрать другой трек
                  </button>
                </>
              ) : (
                <button type="button" className="estu-mini estu-mini--wide" onClick={() => musicInput.current?.click()}>
                  <Music size={15} /> Добавить музыку
                </button>
              )}
            </Pop>
          )}

          {panel === 'mix' && (
            <Pop onClose={() => setPanel('')}>
              <div className="estu-pop__title">Микшер</div>
              <div className="estu-fader">
                <span className="estu-fader__lbl">
                  <Mic size={13} /> Микрофон
                </span>
                <span className="estu-meter">
                  <span ref={micBar} className="estu-meter__bar" />
                </span>
                <input type="range" min={0} max={1.5} step={0.01} value={micVol} onChange={(e) => setMicVol(+e.target.value)} aria-label="Громкость микрофона" />
              </div>
              <div className="estu-fader">
                <span className="estu-fader__lbl">
                  <Music size={13} /> Музыка
                </span>
                <span className="estu-meter">
                  <span ref={musicBar} className="estu-meter__bar estu-meter__bar--music" />
                </span>
                <input type="range" min={0} max={1} step={0.01} value={musicVol} onChange={(e) => setMusicVol(+e.target.value)} aria-label="Громкость музыки" />
              </div>
            </Pop>
          )}

          {/* Плавающая панель управления */}
          <div className="estu__dock" onClick={(e) => e.stopPropagation()}>
            <DockBtn label={camOn ? 'Выключить камеру' : 'Камера'} on={camOn} onClick={() => void toggleCamera()}>
              {camOn ? <Video size={20} /> : <VideoOff size={20} />}
            </DockBtn>
            <DockBtn label={screenOn ? 'Убрать экран' : 'Показать экран'} on={screenOn} onClick={() => void toggleScreen()}>
              {screenOn ? <Monitor size={20} /> : <MonitorOff size={20} />}
            </DockBtn>
            <button ref={micBtn} type="button" className={cn('estu-dbtn estu-dbtn--mic', micMuted && 'estu-dbtn--off')} onClick={() => setMicMuted(!eng().toggleMic())} aria-label={micMuted ? 'Включить микрофон' : 'Выключить микрофон'} title={micMuted ? 'Микрофон выключен' : 'Микрофон'}>
              {micMuted ? <MicOff size={20} /> : <Mic size={20} />}
            </button>
            <button ref={musicBtn} type="button" className={cn('estu-dbtn estu-dbtn--music', panel === 'music' && 'estu-dbtn--active', musicPlaying && 'estu-dbtn--playing')} onClick={() => toggle('music')} aria-label="Музыка" title="Фоновая музыка">
              <Music size={20} />
            </button>
            <DockBtn label="Фон сцены" active={panel === 'bg'} onClick={() => toggle('bg')}>
              <Palette size={20} />
            </DockBtn>
            <DockBtn label="Микшер" active={panel === 'mix'} onClick={() => toggle('mix')}>
              <SlidersHorizontal size={20} />
            </DockBtn>

            <span className="estu__sep" />

            {!live ? (
              <button type="button" className="estu__go" disabled={busy} onClick={() => void start()}>
                {busy ? <span className="estu__spin" /> : <RadioTower size={18} />} В эфир
              </button>
            ) : (
              <>
                <DockBtn label="Чат зрителей" active={chatOpen} onClick={() => setChatOpen((v) => !v)}>
                  <Eye size={20} />
                </DockBtn>
                <button type="button" className="estu__end" onClick={() => void stop()}>
                  <Square size={15} /> Завершить
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {host.recording && streamId === null && <RecordingCard streamId={lastId.current ?? ''} title={title} description={description} />}
    </div>
  );
}

/** Круглая кнопка плавающей панели с подсказкой и состояниями «включено»/«открыто». */
function DockBtn({ children, label, on, active, onClick }: { children: React.ReactNode; label: string; on?: boolean; active?: boolean; onClick: () => void }) {
  return (
    <button type="button" className={cn('estu-dbtn', on && 'estu-dbtn--on', active && 'estu-dbtn--active')} onClick={onClick} aria-label={label} title={label}>
      {children}
    </button>
  );
}

/** Всплывающая панель над доком. */
function Pop({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="estu-pop" onClick={(e) => e.stopPropagation()}>
      <button type="button" className="estu-pop__x" aria-label="Закрыть" onClick={onClose}>
        <X size={15} />
      </button>
      {children}
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
