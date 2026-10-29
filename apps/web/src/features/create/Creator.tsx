/**
 * «Солнце» — единая кнопка публикации. Нажал на солнце в центре дока → сразу
 * выбираешь файл из проводника (или пишешь текст). Файл начинает загружаться
 * в фоне, пока заполняешь детали, а тип определяется сам: фото и текст — запись
 * в ленту, горизонтальное видео — ролик, вертикальное — Reels. Красиво, с
 * анимациями, привязанными к действиям, и без лишних экранов.
 */
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { useMutation } from '@tanstack/react-query';
import { create } from 'zustand';
import { CheckCircle2, Clapperboard, FileVideo, Globe, ImagePlus, Lock, MessageSquare, Newspaper, Plus, Type, Users, X } from 'lucide-react';
import { LIMITS, type MediaItem, type Post, type Visibility } from '@omni/shared';
import { api, ApiError, errorMessage } from '../../shared/api/client';
import { queryClient } from '../../shared/api/query';
import { readVideoMeta, uploadAny } from '../../shared/lib/media';
import { toast } from '../../shared/stores/ui';
import { useMe } from '../../shared/stores/session';
import { cn, fileSize } from '../../shared/lib/format';
import { Avatar, Button, Switch } from '../../shared/ui';
import { activeId, closeWindow } from '../desktop/fx';
import { SunBurst } from './SunBurst';
import './create.css';

/** Файл, выбранный у солнца, ждёт, пока откроется окно «Новая публикация». */
interface CreatorState {
  queued: File[] | null;
  nonce: number;
  /** Поставить файлы в очередь и открыть окно создания. */
  enqueue: (files: File[] | null) => void;
  taken: () => void;
}
export const useCreator = create<CreatorState>((set) => ({
  queued: null,
  nonce: 0,
  enqueue: (files) => set((s) => ({ queued: files && files.length ? files : null, nonce: s.nonce + 1 })),
  taken: () => set({ queued: null }),
}));

const VISIBILITY: { id: Visibility; label: string; hint: string; icon: typeof Globe }[] = [
  { id: 'public', label: 'Все', hint: 'Увидят все', icon: Globe },
  { id: 'followers', label: 'Подписчики', hint: 'Только подписчики', icon: Users },
  { id: 'private', label: 'Только я', hint: 'Видно только вам', icon: Lock },
];

interface Item {
  id: string;
  file: File;
  preview: string;
  isVideo: boolean;
  media: MediaItem | null;
  progress: number;
  abort: AbortController;
}

/** Закрыть окно создания (на ПК) или вернуться в ленту (на телефоне). */
function dismiss(navigate: ReturnType<typeof useNavigate>) {
  const id = activeId();
  if (id) void closeWindow(id);
  else navigate('/home');
}

export function CreatePage() {
  const me = useMe();
  const navigate = useNavigate();
  const queued = useCreator((s) => s.queued);
  const nonce = useCreator((s) => s.nonce);
  const taken = useCreator((s) => s.taken);

  const [items, setItems] = useState<Item[]>([]);
  const [text, setText] = useState('');
  const [title, setTitle] = useState('');
  const [visibility, setVisibility] = useState<Visibility>('public');
  const [commentsDisabled, setCommentsDisabled] = useState(false);
  /** Для видео: длинный ролик или вертикальный Reels. */
  const [videoMode, setVideoMode] = useState<'video' | 'short'>('video');
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const first = items[0];
  const isVideo = !!first?.isVideo;
  const isImages = items.length > 0 && !isVideo;
  // Тип будущей публикации
  const kind: 'note' | 'video' | 'short' = isVideo ? videoMode : 'note';

  const addFiles = (list: File[]) => {
    if (!list.length) return;
    const firstIsVideo = list[0]!.type.startsWith('video/');
    // Видео — всегда один файл и свой режим; фото — до 4 штук, видео среди них отбрасываем
    const chosen = firstIsVideo ? [list[0]!] : list.filter((f) => f.type.startsWith('image/')).slice(0, 4 - items.filter((i) => !i.isVideo).length);
    if (firstIsVideo && items.length) items.forEach((i) => i.abort.abort());
    const base = firstIsVideo ? [] : items;
    const next: Item[] = chosen.map((file) => {
      const id = `${Date.now()}-${Math.random()}`;
      const abort = new AbortController();
      const isVid = file.type.startsWith('video/');
      if (isVid)
        void readVideoMeta(file).then((m) => {
          if (m.width && m.height) setVideoMode(m.height > m.width ? 'short' : 'video');
        });
      if (isVid && !title) setTitle(file.name.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ').slice(0, LIMITS.titleMax));
      const item: Item = { id, file, preview: URL.createObjectURL(file), isVideo: isVid, media: null, progress: 0, abort };
      uploadAny(file, { onProgress: (p) => setItems((cur) => cur.map((x) => (x.id === id ? { ...x, progress: p } : x))), signal: abort.signal })
        .then((media) => !abort.signal.aborted && setItems((cur) => cur.map((x) => (x.id === id ? { ...x, media } : x))))
        .catch((e) => {
          if (abort.signal.aborted) return;
          toast({ text: errorMessage(e), kind: 'error' });
          setItems((cur) => cur.filter((x) => x.id !== id));
        });
      return item;
    });
    setItems([...base, ...next]);
  };

  // Файл, выбранный у солнца, подхватывается при открытии окна
  useEffect(() => {
    if (queued) {
      addFiles(queued);
      taken();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nonce]);

  useEffect(() => () => items.forEach((i) => (i.abort.abort(), URL.revokeObjectURL(i.preview))), []); // eslint-disable-line react-hooks/exhaustive-deps

  const removeItem = (id: string) =>
    setItems((cur) => {
      const it = cur.find((x) => x.id === id);
      if (it) {
        it.abort.abort();
        URL.revokeObjectURL(it.preview);
      }
      return cur.filter((x) => x.id !== id);
    });

  const uploading = items.some((i) => !i.media);
  const hasText = text.trim().length > 0;
  const canPublish = items.length ? !uploading && (kind !== 'video' || !!title.trim()) : hasText;

  const publish = useMutation({
    mutationFn: () =>
      api.post<Post>('/posts', {
        kind,
        title: kind === 'video' ? title.trim() : undefined,
        text: text.trim(),
        mediaIds: items.map((i) => i.media!.id),
        visibility,
        commentsDisabled,
      }),
    onSuccess: (p) => {
      toast({ text: kind === 'short' ? 'Опубликовано в Reels' : kind === 'video' ? 'Видео опубликовано' : 'Опубликовано', kind: 'success' });
      void queryClient.invalidateQueries({ queryKey: ['feed'] });
      void queryClient.invalidateQueries({ queryKey: ['user-posts'] });
      dismiss(navigate);
      navigate(kind === 'short' ? '/reels' : kind === 'video' ? `/watch/${p.id}` : `/post/${p.id}`);
    },
    onError: (e) => toast({ text: e instanceof ApiError && e.fields ? Object.values(e.fields)[0]! : errorMessage(e), kind: 'error' }),
  });

  const pickFiles = () => input.current?.click();

  return (
    <div className="pk-root create">
      <input
        ref={input}
        type="file"
        accept="image/*,video/*"
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files?.length) addFiles([...e.target.files]);
          e.target.value = '';
        }}
      />
      <header className="create__head">
        <span className="create__sun">
          <SunBurst size={30} spin />
        </span>
        <h1 className="create__title">Новая публикация</h1>
        <button type="button" className="create__close" aria-label="Закрыть" onClick={() => dismiss(navigate)}>
          <X size={18} />
        </button>
      </header>

      {!items.length && !hasText ? (
        <div
          className={cn('create-hub', over && 'create-hub--over')}
          onDragOver={(e) => (e.preventDefault(), setOver(true))}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setOver(false);
            if (e.dataTransfer.files.length) addFiles([...e.dataTransfer.files]);
          }}
        >
          <button type="button" className="create-pick" onClick={pickFiles}>
            <span className="create-pick__sun" aria-hidden>
              <SunBurst size={88} spin />
            </span>
            <b className="create-pick__title">Перетащите фото или видео</b>
            <span className="create-pick__hint">Или выберите файл на компьютере — публикация начнёт загружаться сразу</span>
            <span className="create-pick__btn">
              <Plus size={18} /> Выбрать файл
            </span>
          </button>
          <div className="create-kinds">
            <button type="button" className="create-kind" onClick={pickFiles}>
              <span className="create-kind__ic create-kind__ic--photo">
                <ImagePlus size={20} />
              </span>
              Фото
            </button>
            <button type="button" className="create-kind" onClick={pickFiles}>
              <span className="create-kind__ic create-kind__ic--video">
                <Clapperboard size={20} />
              </span>
              Видео / Reels
            </button>
            <button type="button" className="create-kind" onClick={() => setText(' ')}>
              <span className="create-kind__ic create-kind__ic--text">
                <Type size={20} />
              </span>
              Текст
            </button>
          </div>
        </div>
      ) : (
        <div className="create-grid">
          <div className="create-form">
            {isVideo && (
              <div className="create-seg" role="radiogroup" aria-label="Тип видео">
                <button type="button" role="radio" aria-checked={videoMode === 'video'} className={cn('create-seg__opt', videoMode === 'video' && 'create-seg__opt--on')} onClick={() => setVideoMode('video')}>
                  <Clapperboard size={16} /> Видео
                </button>
                <button type="button" role="radio" aria-checked={videoMode === 'short'} className={cn('create-seg__opt', videoMode === 'short' && 'create-seg__opt--on')} onClick={() => setVideoMode('short')}>
                  <Clapperboard size={16} /> Reels
                </button>
              </div>
            )}

            <div className="create-author">
              <Avatar src={me.avatarUrl} name={me.displayName} id={me.id} size={38} />
              <div className="col" style={{ gap: 0, minWidth: 0 }}>
                <b className="ellipsis">{me.displayName}</b>
                <span className="small muted">@{me.username}</span>
              </div>
            </div>

            {kind === 'video' && (
              <label className="create-field">
                <span className="create-field__label">Название</span>
                <textarea className="create-field__input" rows={2} value={title} maxLength={LIMITS.titleMax} onChange={(e) => setTitle(e.target.value.replace(/\n/g, ' '))} placeholder="О чём ролик?" />
              </label>
            )}
            <label className="create-field">
              <span className="create-field__label">{kind === 'note' ? (isImages ? 'Подпись' : 'Текст') : kind === 'video' ? 'Описание' : 'Подпись'}</span>
              <textarea
                className="create-field__input"
                rows={kind === 'note' && !isImages ? 6 : 4}
                value={text}
                maxLength={LIMITS.postMax}
                onChange={(e) => setText(e.target.value)}
                placeholder={kind === 'note' ? 'Что нового? Добавьте #хэштеги' : 'Добавьте описание и #хэштеги'}
                autoFocus={!items.length}
              />
              <span className="create-field__count">
                {text.length}/{LIMITS.postMax}
              </span>
            </label>

            <div className="create-vis" role="radiogroup" aria-label="Кто увидит">
              {VISIBILITY.map((v) => (
                <button key={v.id} type="button" role="radio" aria-checked={visibility === v.id} className={cn('create-vis__opt', visibility === v.id && 'create-vis__opt--on')} onClick={() => setVisibility(v.id)} title={v.hint}>
                  <v.icon size={16} /> {v.label}
                </button>
              ))}
            </div>

            <div className="create-row">
              <MessageSquare size={18} className="create-row__icon" />
              <span className="create-row__text">
                <b>Комментарии</b>
                <span>{commentsDisabled ? 'Выключены' : 'Включены'}</span>
              </span>
              <Switch checked={!commentsDisabled} onChange={(v) => setCommentsDisabled(!v)} label="Комментарии" />
            </div>
          </div>

          <aside className="create-side">
            <div className={cn('create-preview', isVideo && 'create-preview--video', kind === 'short' && 'create-preview--short')}>
              {isImages ? (
                <div className={cn('create-gallery', `create-gallery--${Math.min(items.length, 4)}`)}>
                  {items.map((it) => (
                    <div key={it.id} className="create-thumb">
                      <img src={it.preview} alt="" />
                      {!it.media && <Ring progress={it.progress} />}
                      <button type="button" className="create-thumb__x" aria-label="Убрать" onClick={() => removeItem(it.id)}>
                        <X size={14} />
                      </button>
                    </div>
                  ))}
                  {items.length < 4 && (
                    <button type="button" className="create-thumb create-thumb--add" onClick={pickFiles} aria-label="Добавить фото">
                      <Plus size={24} />
                    </button>
                  )}
                </div>
              ) : first ? (
                <div className="create-vframe">
                  <video src={first.preview} controls muted playsInline />
                  {!first.media && <Ring progress={first.progress} big />}
                </div>
              ) : null}
            </div>
            {first && (
              <div className="create-meta">
                <span className="ellipsis" title={first.file.name}>
                  <FileVideo size={13} /> {first.file.name}
                </span>
                <span>{fileSize(items.reduce((s, i) => s + i.file.size, 0))}</span>
              </div>
            )}
          </aside>
        </div>
      )}

      <footer className="create__bar">
        <div className="create__status">
          {items.length > 0 &&
            (uploading ? (
              <span className="create__pct">
                <span className="create__spin" aria-hidden /> Загрузка… {Math.round((items.reduce((s, i) => s + (i.media ? 1 : i.progress), 0) / items.length) * 100)}%
              </span>
            ) : (
              <span className="create__ok">
                <CheckCircle2 size={16} /> Готово к публикации
              </span>
            ))}
        </div>
        {(items.length > 0 || hasText) && (
          <Button variant="ghost" onClick={() => dismiss(navigate)}>
            Отмена
          </Button>
        )}
        <Button className="create__go" disabled={!canPublish} loading={publish.isPending} onClick={() => publish.mutate()}>
          <Newspaper size={16} /> Опубликовать
        </Button>
      </footer>
    </div>
  );
}

/** Кольцо загрузки поверх превью — заполняется по мере отправки файла. */
function Ring({ progress, big }: { progress: number; big?: boolean }) {
  const r = big ? 26 : 18;
  const c = 2 * Math.PI * r;
  const size = (r + 4) * 2;
  return (
    <span className="create-ring" aria-hidden>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={size / 2} cy={size / 2} r={r} className="create-ring__track" />
        <circle cx={size / 2} cy={size / 2} r={r} className="create-ring__fill" strokeDasharray={c} strokeDashoffset={c * (1 - progress)} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      </svg>
      <span className="create-ring__pct">{Math.round(progress * 100)}%</span>
    </span>
  );
}
