import { useRef, useState } from 'react';
import { Link } from 'react-router';
import { useMutation } from '@tanstack/react-query';
import { UploadCloud } from 'lucide-react';
import type { MediaItem, Post } from '@omni/shared';
import { api, ApiError, errorMessage } from '../../shared/api/client';
import { queryClient } from '../../shared/api/query';
import { uploadAny } from '../../shared/lib/media';
import { toast } from '../../shared/stores/ui';
import { cn, duration, fullDate, timeAgo, views } from '../../shared/lib/format';
import { Avatar, Button, Input, Textarea, Verified } from '../../shared/ui';
import './video.css';

export function VideoCard({ post, row, progressSec }: { post: Post; row?: boolean; progressSec?: number }) {
  const m = post.media[0];
  const href = post.kind === 'short' ? `/comets?start=${post.id}` : `/watch/${post.id}`;
  return (
    <Link to={href} className={cn('video-card', row && 'video-card--row')}>
      <div className="video-thumb" style={post.kind === 'short' && !row ? { aspectRatio: '9 / 16' } : undefined}>
        {m?.posterUrl && <img src={m.posterUrl} alt="" loading="lazy" decoding="async" />}
        {post.premiereAt && Date.parse(post.premiereAt) > Date.now() ? (
          <span className="video-thumb__dur video-thumb__premiere">Премьера</span>
        ) : m?.durationSec ? (
          <span className="video-thumb__dur">{duration(m.durationSec)}</span>
        ) : null}
        {progressSec !== undefined && m?.durationSec ? (
          <span className="video-thumb__progress">
            <span style={{ width: `${Math.min(100, (progressSec / m.durationSec) * 100)}%` }} />
          </span>
        ) : null}
      </div>
      <div className="video-card__info">
        {!row && <Avatar src={post.author.avatarUrl} name={post.author.displayName} id={post.author.id} size={36} />}
        <div className="col" style={{ gap: 2, minWidth: 0 }}>
          <span className="video-card__title clamp-2">{post.title ?? post.text}</span>
          <span className="video-card__meta row gap-1">
            {post.author.displayName} {post.author.verified && <Verified size={13} />}
          </span>
          <span className="video-card__meta">
            {post.premiereAt && Date.parse(post.premiereAt) > Date.now() ? `Премьера ${fullDate(post.premiereAt)}` : `${views(post.stats.views)} · ${timeAgo(post.createdAt)}`}
          </span>
        </div>
      </div>
    </Link>
  );
}

/** Загрузка видео или кометы: выбор файла, обложка кадром, название, описание. */
export function UploadVideoForm({ kind, onDone }: { kind: 'video' | 'short'; onDone: (p: Post) => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [media, setMedia] = useState<MediaItem | null>(null);
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [over, setOver] = useState(false);
  const [commentsDisabled, setCommentsDisabled] = useState(false);
  /** Премьера: видео откроется всем одновременно в выбранное время */
  const [premiere, setPremiere] = useState(false);
  const [premiereAt, setPremiereAt] = useState(() => localInput(Date.now() + 3600_000));
  const input = useRef<HTMLInputElement>(null);

  const pick = (f: File) => {
    if (!f.type.startsWith('video/')) return toast({ text: 'Выберите видеофайл', kind: 'error' });
    setFile(f);
    setPreview(URL.createObjectURL(f));
    if (!title) setTitle(f.name.replace(/\.[^.]+$/, '').slice(0, 120));
    setMedia(null);
    setProgress(0);
    uploadAny(f, { onProgress: setProgress })
      .then(setMedia)
      .catch((e) => {
        toast({ text: errorMessage(e), kind: 'error' });
        setFile(null);
      });
  };

  const publish = useMutation({
    mutationFn: () =>
      api.post<Post>('/posts', {
        kind,
        title: kind === 'video' ? title : undefined,
        text,
        mediaIds: [media!.id],
        visibility: 'public',
        commentsDisabled,
        premiereAt: kind === 'video' && premiere ? new Date(premiereAt).toISOString() : undefined,
      }),
    onSuccess: (p) => {
      toast({ text: p.premiereAt ? 'Премьера назначена — подписчики смогут поставить напоминание' : kind === 'video' ? 'Видео опубликовано' : 'Комета запущена', kind: 'success' });
      void queryClient.invalidateQueries({ queryKey: ['feed'] });
      onDone(p);
    },
    onError: (e) => toast({ text: e instanceof ApiError && e.fields ? Object.values(e.fields)[0]! : errorMessage(e), kind: 'error' }),
  });

  if (!file) {
    return (
      <div
        className={cn('dropzone', over && 'dropzone--over')}
        onClick={() => input.current?.click()}
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
      >
        <UploadCloud size={44} className="faint" />
        <div className="bold">Перетащите видео сюда или нажмите, чтобы выбрать</div>
        <div className="muted small">{kind === 'short' ? 'Вертикальное видео до 3 минут' : 'MP4, WebM или MOV'} · обложка создаётся автоматически</div>
        <input ref={input} type="file" accept="video/*" hidden onChange={(e) => e.target.files?.[0] && pick(e.target.files[0])} />
      </div>
    );
  }
  return (
    <div className="col gap-4">
      <div className="player" style={kind === 'short' ? { aspectRatio: '9 / 16', maxWidth: 320 } : undefined}>
        {preview && <video src={preview} controls muted playsInline />}
      </div>
      {!media ? (
        <div className="col">
          <div className="progress">
            <div className="progress__bar" style={{ width: `${progress * 100}%` }} />
          </div>
          <span className="small muted">Загрузка… {Math.round(progress * 100)}%</span>
        </div>
      ) : (
        <span className="tag tag--success" style={{ alignSelf: 'flex-start' }}>
          Файл загружен
        </span>
      )}
      {kind === 'video' && <Input label="Название" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} />}
      <Textarea label={kind === 'video' ? 'Описание' : 'Подпись'} value={text} onChange={(e) => setText(e.target.value)} maxLength={2000} placeholder="Расскажите о видео, добавьте #хэштеги" />
      <label className="row" style={{ gap: 10 }}>
        <input type="checkbox" checked={commentsDisabled} onChange={(e) => setCommentsDisabled(e.target.checked)} /> Отключить комментарии
      </label>
      {kind === 'video' && (
        <div className="card premiere-pick">
          <label className="row" style={{ gap: 10 }}>
            <input type="checkbox" checked={premiere} onChange={(e) => setPremiere(e.target.checked)} />
            <span className="col" style={{ gap: 0 }}>
              <b>Премьера</b>
              <span className="xs muted">Видео откроется всем одновременно, зрители смотрят вместе с общим чатом</span>
            </span>
          </label>
          {premiere && (
            <label className="field">
              <span className="field__label">Начало премьеры</span>
              <input
                className="input"
                type="datetime-local"
                value={premiereAt}
                min={localInput(Date.now() + 5 * 60_000)}
                max={localInput(Date.now() + 30 * 86_400_000)}
                onChange={(e) => setPremiereAt(e.target.value)}
              />
            </label>
          )}
        </div>
      )}
      <div className="row">
        <Button disabled={!media || (kind === 'video' && !title.trim())} loading={publish.isPending} onClick={() => publish.mutate()}>
          {premiere && kind === 'video' ? 'Назначить премьеру' : 'Опубликовать'}
        </Button>
        <Button
          variant="ghost"
          onClick={() => {
            setFile(null);
            setMedia(null);
          }}
        >
          Выбрать другой файл
        </Button>
      </div>
    </div>
  );
}

/** Значение для <input type="datetime-local"> в местном времени. */
function localInput(ms: number): string {
  const d = new Date(ms - new Date().getTimezoneOffset() * 60_000);
  return d.toISOString().slice(0, 16);
}
