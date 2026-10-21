/**
 * Загрузка видео или Reels в стиле творческой студии: файл перетаскивается
 * или выбирается, загружается сразу, а пока идёт загрузка — заполняются
 * сведения: название, описание с главами, доступ, комментарии и премьера.
 */
import { useEffect, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { CalendarClock, CheckCircle2, Clapperboard, FileVideo, Globe, Lock, MessageSquare, UploadCloud, Users } from 'lucide-react';
import { LIMITS, type MediaItem, type Post, type Visibility } from '@omni/shared';
import { api, ApiError, errorMessage } from '../../shared/api/client';
import { queryClient } from '../../shared/api/query';
import { uploadAny } from '../../shared/lib/media';
import { toast } from '../../shared/stores/ui';
import { cn, duration, fileSize, fullDate } from '../../shared/lib/format';
import { Button, Switch } from '../../shared/ui';
import { parseChapters } from './lib';
import './video.css';

const VISIBILITY: { id: Visibility; label: string; hint: string; icon: typeof Globe }[] = [
  { id: 'public', label: 'Открытый доступ', hint: 'Видео увидят все', icon: Globe },
  { id: 'followers', label: 'Для подписчиков', hint: 'Только те, кто на вас подписан', icon: Users },
  { id: 'private', label: 'Только я', hint: 'Видно только вам', icon: Lock },
];

/** Загрузка видео или Reels: выбор файла, обложка кадром, название, описание. */
export function UploadVideoForm({ kind, onDone, premiereDefault }: { kind: 'video' | 'short'; onDone: (p: Post) => void; premiereDefault?: boolean }) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [media, setMedia] = useState<MediaItem | null>(null);
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [over, setOver] = useState(false);
  const [visibility, setVisibility] = useState<Visibility>('public');
  const [commentsDisabled, setCommentsDisabled] = useState(false);
  /** Премьера: видео откроется всем одновременно в выбранное время */
  const [premiere, setPremiere] = useState(!!premiereDefault && kind === 'video');
  const [premiereAt, setPremiereAt] = useState(() => localInput(Date.now() + 3600_000));
  const [meta, setMeta] = useState<{ w: number; h: number; d: number } | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const abort = useRef<AbortController | null>(null);
  const isVideo = kind === 'video';

  useEffect(() => () => abort.current?.abort(), []);
  useEffect(() => () => void (preview && URL.revokeObjectURL(preview)), [preview]);

  const pick = (f: File) => {
    if (!f.type.startsWith('video/')) return toast({ text: 'Выберите видеофайл', kind: 'error' });
    abort.current?.abort();
    const ctrl = new AbortController();
    abort.current = ctrl;
    setFile(f);
    setPreview(URL.createObjectURL(f));
    setMeta(null);
    if (!title) setTitle(f.name.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ').slice(0, LIMITS.titleMax));
    setMedia(null);
    setProgress(0);
    uploadAny(f, { onProgress: setProgress, signal: ctrl.signal })
      .then((m) => !ctrl.signal.aborted && setMedia(m))
      .catch((e) => {
        if (ctrl.signal.aborted) return;
        toast({ text: errorMessage(e), kind: 'error' });
        setFile(null);
      });
  };

  const reset = () => {
    abort.current?.abort();
    setFile(null);
    setMedia(null);
    setProgress(0);
  };

  const publish = useMutation({
    mutationFn: () =>
      api.post<Post>('/posts', {
        kind,
        title: isVideo ? title.trim() : undefined,
        text,
        mediaIds: [media!.id],
        visibility,
        commentsDisabled,
        premiereAt: isVideo && premiere ? new Date(premiereAt).toISOString() : undefined,
      }),
    onSuccess: (p) => {
      toast({ text: p.premiereAt ? 'Премьера назначена — подписчики смогут поставить напоминание' : isVideo ? 'Видео опубликовано' : 'Видео опубликовано в Reels', kind: 'success' });
      void queryClient.invalidateQueries({ queryKey: ['feed'] });
      void queryClient.invalidateQueries({ queryKey: ['premieres'] });
      onDone(p);
    },
    onError: (e) => toast({ text: e instanceof ApiError && e.fields ? Object.values(e.fields)[0]! : errorMessage(e), kind: 'error' }),
  });

  if (!file) {
    return (
      <div
        className={cn('vup-drop', over && 'vup-drop--over')}
        onClick={() => input.current?.click()}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), input.current?.click())}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          const f = e.dataTransfer.files[0];
          if (f) pick(f);
        }}
        role="button"
        tabIndex={0}
        aria-label="Выбрать видеофайл"
      >
        <span className="vup-drop__circle">
          <UploadCloud size={56} strokeWidth={1.5} />
        </span>
        <b className="vup-drop__title">Перетащите видеофайл сюда</b>
        <span className="vup-drop__hint">
          {isVideo ? 'MP4, WebM или MOV · обложка и длительность определятся автоматически' : 'Вертикальное видео до 3 минут · обложка создаётся автоматически'}
        </span>
        <span className="vup-drop__btn">Выбрать файл</span>
        <input ref={input} type="file" accept="video/*" hidden onChange={(e) => e.target.files?.[0] && pick(e.target.files[0])} />
      </div>
    );
  }

  const chapters = isVideo ? parseChapters(text, meta?.d) : [];
  const done = !!media;
  const minPremiere = localInput(Date.now() + 5 * 60_000);
  const canPublish = done && (!isVideo || !!title.trim()) && !(premiere && premiereAt < minPremiere);

  return (
    <div className={cn('vup', !isVideo && 'vup--short')}>
      <div className="vup__grid">
        <div className="vup__form">
          <h2 className="vup__h">Сведения</h2>
          {isVideo && (
            <label className="vup-field">
              <span className="vup-field__label">Название (обязательно)</span>
              <textarea className="vup-field__input" rows={2} value={title} onChange={(e) => setTitle(e.target.value.replace(/\n/g, ' '))} maxLength={LIMITS.titleMax} placeholder="Расскажите зрителям, о чём видео" />
              <span className="vup-field__count">
                {title.length}/{LIMITS.titleMax}
              </span>
            </label>
          )}
          <label className="vup-field">
            <span className="vup-field__label">{isVideo ? 'Описание' : 'Подпись'}</span>
            <textarea
              className="vup-field__input"
              rows={isVideo ? 6 : 3}
              value={text}
              onChange={(e) => setText(e.target.value)}
              maxLength={LIMITS.postMax}
              placeholder={isVideo ? 'Расскажите о видео, добавьте #хэштеги.\nТаймкоды вида «0:00 Вступление» превратятся в главы' : 'Добавьте подпись и #хэштеги'}
            />
            <span className="vup-field__count">
              {text.length}/{LIMITS.postMax}
            </span>
          </label>
          {chapters.length > 0 && (
            <div className="vup-chapters">
              <Clapperboard size={16} />
              <span>
                Главы: {chapters.length} — {chapters.map((c) => `${duration(c.start)} ${c.title}`).join(' · ')}
              </span>
            </div>
          )}

          <h3 className="vup__h3">Доступ</h3>
          <div className="vup-vis" role="radiogroup" aria-label="Доступ">
            {VISIBILITY.map((v) => (
              <button key={v.id} type="button" role="radio" aria-checked={visibility === v.id} className={cn('vup-vis__opt', visibility === v.id && 'vup-vis__opt--on')} onClick={() => setVisibility(v.id)}>
                <v.icon size={18} />
                <span>
                  <b>{v.label}</b>
                  <span className="vup-vis__hint">{v.hint}</span>
                </span>
              </button>
            ))}
          </div>

          <div className="vup-row">
            <MessageSquare size={18} className="vup-row__icon" />
            <span className="vup-row__text">
              <b>Комментарии</b>
              <span>{commentsDisabled ? 'Зрители не смогут комментировать' : 'Зрители могут оставлять комментарии'}</span>
            </span>
            <Switch checked={!commentsDisabled} onChange={(v) => setCommentsDisabled(!v)} label="Разрешить комментарии" />
          </div>

          {isVideo && (
            <div className={cn('vup-premiere', premiere && 'vup-premiere--on')}>
              <div className="vup-row">
                <CalendarClock size={18} className="vup-row__icon" />
                <span className="vup-row__text">
                  <b>Премьера</b>
                  <span>Видео откроется всем одновременно: зрители смотрят вместе, с общим чатом и обратным отсчётом</span>
                </span>
                <Switch checked={premiere} onChange={setPremiere} label="Премьера" />
              </div>
              {premiere && (
                <label className="vup-field vup-field--inline">
                  <span className="vup-field__label">Начало премьеры</span>
                  <input
                    className="vup-field__input"
                    type="datetime-local"
                    value={premiereAt}
                    min={minPremiere}
                    max={localInput(Date.now() + 30 * 86_400_000)}
                    onChange={(e) => setPremiereAt(e.target.value)}
                  />
                  <span className="vup-field__hint">{premiereAt >= minPremiere ? fullDate(new Date(premiereAt).toISOString()) : 'Не раньше чем через 5 минут'}</span>
                </label>
              )}
            </div>
          )}
        </div>

        <aside className="vup__side">
          <div className="vup-card">
            <div className="vup-card__media">
              {preview && (
                <video
                  src={preview}
                  controls
                  muted
                  playsInline
                  onLoadedMetadata={(e) => setMeta({ w: e.currentTarget.videoWidth, h: e.currentTarget.videoHeight, d: e.currentTarget.duration })}
                />
              )}
            </div>
            <dl className="vup-card__info">
              <div>
                <dt>Файл</dt>
                <dd className="ellipsis" title={file.name}>
                  <FileVideo size={14} /> {file.name}
                </dd>
              </div>
              <div>
                <dt>Размер</dt>
                <dd>
                  {fileSize(file.size)}
                  {meta && meta.w ? ` · ${meta.w}×${meta.h}` : ''}
                  {meta && Number.isFinite(meta.d) ? ` · ${duration(meta.d)}` : ''}
                </dd>
              </div>
              <div>
                <dt>Ссылка</dt>
                <dd className="vup-card__muted">Появится после публикации</dd>
              </div>
            </dl>
          </div>
        </aside>
      </div>

      <footer className="vup__bar">
        <div className="vup__status">
          {done ? (
            <span className="vup__ok">
              <CheckCircle2 size={18} /> Загрузка завершена
            </span>
          ) : (
            <>
              <span className="vup__pct">Загрузка… {Math.round(progress * 100)}%</span>
              <span className="vup__progress" aria-hidden>
                <span style={{ width: `${progress * 100}%` }} />
              </span>
            </>
          )}
        </div>
        <Button variant="ghost" onClick={reset}>
          Другой файл
        </Button>
        <Button disabled={!canPublish} loading={publish.isPending} onClick={() => publish.mutate()}>
          {premiere && isVideo ? 'Назначить премьеру' : 'Опубликовать'}
        </Button>
      </footer>
    </div>
  );
}

/** Значение для <input type="datetime-local"> в местном времени. */
function localInput(ms: number): string {
  const d = new Date(ms - new Date().getTimezoneOffset() * 60_000);
  return d.toISOString().slice(0, 16);
}
