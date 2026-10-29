/**
 * Студия эфира — архитектура как в OBS, но в стиле Sunnet: большое превью
 * сверху, снизу панели с заголовками — «Сцены», «Источники» (списком),
 * «Микшер» (с живыми шкалами громкости) и «Управление». Яркие солнечные
 * акценты и анимации на каждом шаге. Сцену и звук собирает StudioEngine.
 */
import { useEffect, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Circle, Download, Eye, EyeOff, Film, Image as ImageIcon, Mic, MicOff, Monitor, MessageSquare, Music, Palette, Pause, PictureInPicture2, Play, Radio, RadioTower, Settings2, Square, Video, X } from 'lucide-react';
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
const SCENES: { id: Layout; label: string; icon: typeof Video }[] = [
  { id: 'camera', label: 'Камера', icon: Video },
  { id: 'screen', label: 'Экран', icon: Monitor },
  { id: 'screen-cam', label: 'Экран + камера', icon: PictureInPicture2 },
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
  const [description] = useState('');
  const [record, setRecord] = useLocal('live-record', true);
  const [camOn, setCamOn] = useState(false);
  const [screenOn, setScreenOn] = useState(false);
  const [micMuted, setMicMuted] = useState(false);
  const [scene, setScene] = useState<Layout>('camera');
  const [bgKind, setBgKind] = useState<'color' | 'image' | 'video'>('color');
  const [musicName, setMusicName] = useState<string | null>(null);
  const [musicPlaying, setMusicPlaying] = useState(false);
  const [micVol, setMicVol] = useState(1);
  const [musicVol, setMusicVol] = useState(0.6);
  const [busy, setBusy] = useState(false);
  const [props, setProps] = useState<'' | 'bg' | 'music'>('');
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
    setScene(e.layout);
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
    setScene(e.layout);
    setTimeout(() => {
      setScreenOn(!!eng().screen);
      setScene(eng().layout);
    }, 300);
  };
  const pickScene = (l: Layout) => {
    if (l !== 'camera' && !eng().screen) return void toggleScreen();
    eng().layout = l;
    setScene(l);
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
  };

  const start = async () => {
    if (!camOn && !screenOn) return toast({ text: 'Включите камеру или экран', kind: 'error' });
    if (!title.trim()) return toast({ text: 'Впишите название эфира в «Управлении»', kind: 'error' });
    setBusy(true);
    try {
      useHost.setState({ stream: eng().output, source: screenOn ? 'screen' : 'camera', micOn: !micMuted, camOn });
      await goLive({ title: title.trim(), description, record });
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

  const nothing = !camOn && !screenOn;
  const elapsed = live && host.startedAt ? elapsedLabel(host.startedAt, now) : '';
  const streamId = host.streamId;
  const bgColor = eng()?.bg.color ?? BG_COLORS[0];

  return (
    <div className="pk-root estu-root">
      <input ref={bgImgInput} type="file" accept="image/*" hidden onChange={(e) => void onBgImage(e.target.files?.[0] ?? undefined)} />
      <input ref={bgVideoInput} type="file" accept="video/*" hidden onChange={(e) => void onBgVideo(e.target.files?.[0] ?? undefined)} />
      <input ref={musicInput} type="file" accept="audio/*" hidden onChange={(e) => void onMusic(e.target.files?.[0] ?? undefined)} />

      <div className="estu">
        {/* Превью */}
        <div className="estu__stage">
          <canvas ref={canvasRef} className="estu__canvas" />
          {nothing && (
            <div className="estu__empty">
              <SunBurst size={76} spin />
              <b>Соберите сцену</b>
              <span>Включите камеру или экран в «Источниках» снизу</span>
            </div>
          )}
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
          {live && chatOpen && streamId && (
            <div className="estu__chat">
              <LiveChat room={`stream:${streamId}`} initial={[]} sendPath={`/live/${streamId}/chat`} title="Чат зрителей" subtitle={`${host.viewers} смотрят`} onClose={() => setChatOpen(false)} />
            </div>
          )}
        </div>

        {/* Панели */}
        <div className="estu__panels">
          {/* Сцены */}
          <section className="epanel" style={{ '--i': 0 } as React.CSSProperties}>
            <header className="epanel__h">Сцены</header>
            <div className="epanel__b">
              {SCENES.map((s) => (
                <button key={s.id} type="button" className={cn('escene', scene === s.id && 'escene--on')} onClick={() => pickScene(s.id)} disabled={s.id !== 'camera' && !screenOn && !eng()?.screen}>
                  <s.icon size={16} />
                  <span>{s.label}</span>
                  {scene === s.id && <span className="escene__live">●</span>}
                </button>
              ))}
            </div>
          </section>

          {/* Источники */}
          <section className="epanel" style={{ '--i': 1 } as React.CSSProperties}>
            <header className="epanel__h">Источники</header>
            <div className="epanel__b">
              <SourceRow icon={<Video size={17} />} name="Камера" sub={camOn ? 'в эфире' : 'выключена'} on={camOn} onToggle={() => void toggleCamera()} />
              <SourceRow icon={<Monitor size={17} />} name="Экран" sub={screenOn ? 'показывается' : 'не показан'} on={screenOn} onToggle={() => void toggleScreen()} />
              <SourceRow icon={<Palette size={17} />} name="Фон" sub={bgKind === 'color' ? 'цвет' : bgKind === 'image' ? 'фото' : 'видео'} swatch={bgKind === 'color' ? bgColor : undefined} onClick={() => setProps(props === 'bg' ? '' : 'bg')} active={props === 'bg'} />
              <SourceRow icon={<Music size={17} />} name="Музыка" sub={musicName ? (musicPlaying ? 'играет' : 'пауза') : 'не добавлена'} onClick={() => setProps(props === 'music' ? '' : 'music')} active={props === 'music'} />
            </div>
          </section>

          {/* Микшер */}
          <section className="epanel" style={{ '--i': 2 } as React.CSSProperties}>
            <header className="epanel__h">Микшер</header>
            <div className="epanel__b">
              <MixChannel label="Микрофон" value={micVol} max={1.5} onChange={setMicVol} muted={micMuted} onMute={() => setMicMuted(!eng().toggleMic())} meterRef={micBar} />
              <MixChannel
                label="Музыка"
                value={musicVol}
                max={1}
                onChange={setMusicVol}
                muted={!musicName || !musicPlaying}
                onMute={() => (musicName ? setMusicPlaying(eng().toggleMusic()) : musicInput.current?.click())}
                meterRef={musicBar}
                music
                playing={musicPlaying}
              />
            </div>
          </section>

          {/* Управление */}
          <section className="epanel epanel--ctrl" style={{ '--i': 3 } as React.CSSProperties}>
            <header className="epanel__h">Управление</header>
            <div className="epanel__b">
              <input className="ectrl-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={LIMITS.titleMax} placeholder="Название эфира…" />
              {!live ? (
                <>
                  <button type="button" className="ego" disabled={busy} onClick={() => void start()}>
                    {busy ? <span className="ego__spin" /> : <RadioTower size={18} />} Выйти в эфир
                  </button>
                  <button type="button" className={cn('ectrl-row', record && 'ectrl-row--on')} onClick={() => setRecord(!record)}>
                    <Circle size={15} className="ectrl-row__rec" /> Запись эфира <span className="ectrl-row__state">{record ? 'вкл.' : 'выкл.'}</span>
                  </button>
                </>
              ) : (
                <>
                  <button type="button" className="ego ego--end" onClick={() => void stop()}>
                    <Square size={16} /> Завершить эфир
                  </button>
                  <button type="button" className={cn('ectrl-row', chatOpen && 'ectrl-row--on')} onClick={() => setChatOpen((v) => !v)}>
                    <MessageSquare size={15} /> Чат зрителей <span className="ectrl-row__state">{chatOpen ? 'открыт' : 'скрыт'}</span>
                  </button>
                </>
              )}
            </div>
          </section>
        </div>

        {/* Свойства источника */}
        {props === 'bg' && (
          <Pop title="Фон сцены" onClose={() => setProps('')}>
            <div className="estu-colors">
              {BG_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  className={cn('estu-color', bgKind === 'color' && bgColor === c && 'estu-color--on')}
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
        {props === 'music' && (
          <Pop title="Фоновая музыка" onClose={() => setProps('')}>
            {musicName ? (
              <div className="estu-music">
                <button type="button" className="estu-iconbtn" onClick={() => setMusicPlaying(eng().toggleMusic())} aria-label={musicPlaying ? 'Пауза' : 'Играть'}>
                  {musicPlaying ? <Pause size={16} /> : <Play size={16} />}
                </button>
                <span className="estu-music__name ellipsis" title={musicName}>
                  {musicName.replace(/\.[^.]+$/, '')}
                </span>
                <button type="button" className="estu-mini" onClick={() => musicInput.current?.click()}>
                  Другой
                </button>
              </div>
            ) : (
              <button type="button" className="estu-mini estu-mini--wide" onClick={() => musicInput.current?.click()}>
                <Music size={15} /> Добавить музыку
              </button>
            )}
          </Pop>
        )}
      </div>

      {host.recording && streamId === null && <RecordingCard streamId={lastId.current ?? ''} title={title} description={description} />}
    </div>
  );
}

/** Строка источника: значок, название, статус и действие (глазок/свотч). */
function SourceRow({ icon, name, sub, on, onToggle, onClick, active, swatch }: { icon: React.ReactNode; name: string; sub: string; on?: boolean; onToggle?: () => void; onClick?: () => void; active?: boolean; swatch?: string }) {
  const toggleable = onToggle !== undefined;
  return (
    <div className={cn('esrc', on && 'esrc--on', active && 'esrc--active')} onClick={onClick} role={onClick ? 'button' : undefined} tabIndex={onClick ? 0 : undefined}>
      <span className="esrc__ic">{icon}</span>
      <span className="esrc__text">
        <b>{name}</b>
        <em>{sub}</em>
      </span>
      {swatch && <span className="esrc__swatch" style={{ background: swatch }} />}
      {toggleable ? (
        <button
          type="button"
          className={cn('esrc__eye', on && 'esrc__eye--on')}
          onClick={(e) => {
            e.stopPropagation();
            onToggle!();
          }}
          aria-label={on ? `Выключить: ${name}` : `Включить: ${name}`}
        >
          {on ? <Eye size={16} /> : <EyeOff size={16} />}
        </button>
      ) : (
        <span className="esrc__gear">
          <Settings2 size={15} />
        </span>
      )}
    </div>
  );
}

/** Канал микшера: мьют + живая шкала громкости + ползунок. */
function MixChannel({ label, value, max, onChange, muted, onMute, meterRef, music, playing }: { label: string; value: number; max: number; onChange: (v: number) => void; muted: boolean; onMute: () => void; meterRef: React.RefObject<HTMLSpanElement | null>; music?: boolean; playing?: boolean }) {
  const Icon = music ? (playing ? Pause : Play) : muted ? MicOff : Mic;
  return (
    <div className="emix">
      <button type="button" className={cn('emix__mute', muted && 'emix__mute--off', music && 'emix__mute--music')} onClick={onMute} aria-label={label}>
        <Icon size={16} />
      </button>
      <div className="emix__col">
        <div className="emix__top">
          <span>{label}</span>
          <span className="emix__db">{Math.round(value * 100)}</span>
        </div>
        <span className="emeter">
          <span ref={meterRef} className={cn('emeter__bar', music && 'emeter__bar--music')} />
        </span>
        <input type="range" min={0} max={max} step={0.01} value={value} onChange={(e) => onChange(+e.target.value)} aria-label={`Громкость: ${label}`} />
      </div>
    </div>
  );
}

/** Всплывающее свойство источника. */
function Pop({ children, title, onClose }: { children: React.ReactNode; title: string; onClose: () => void }) {
  return (
    <div className="estu-pop">
      <div className="estu-pop__head">
        <span className="estu-pop__title">{title}</span>
        <button type="button" className="estu-pop__x" aria-label="Закрыть" onClick={onClose}>
          <X size={15} />
        </button>
      </div>
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
