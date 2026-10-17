import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate } from 'react-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Eye, Heart, Pause, Play, Plus, SendHorizontal, Trash2, X } from 'lucide-react';
import type { ChatSummary, Story, StoryGroup, UserSummary } from '@omni/shared';
import { api, errorMessage } from '../../shared/api/client';
import { qk, queryClient } from '../../shared/api/query';
import { uploadAny } from '../../shared/lib/media';
import { useMe } from '../../shared/stores/session';
import { toast } from '../../shared/stores/ui';
import { randomId, timeAgo } from '../../shared/lib/format';
import { Avatar, Button, confirm, EmptyState, IconButton, Input, Modal, PageHeader, UserRow } from '../../shared/ui';
import './photos.css';

const IMAGE_MS = 5500;

export function useStories() {
  return useQuery({ queryKey: qk.stories, queryFn: () => api.get<{ items: StoryGroup[] }>('/stories') });
}

/** Полноэкранный просмотр историй: прогресс, тапы влево/вправо, пауза удержанием, ответ в личку. */
export function StoryViewer({ groups, startIndex, onClose }: { groups: StoryGroup[]; startIndex: number; onClose: () => void }) {
  const me = useMe();
  const [g, setG] = useState(startIndex);
  const [s, setS] = useState(() => Math.max(0, groups[startIndex]?.stories.findIndex((x) => !x.viewed) ?? 0));
  const [progress, setProgress] = useState(0);
  const [paused, setPaused] = useState(false);
  const [reply, setReply] = useState('');
  const [viewersOpen, setViewersOpen] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const group = groups[g];
  const story = group?.stories[s];
  const mine = story?.author.id === me.id;

  const next = useCallback(() => {
    if (!group) return onClose();
    if (s < group.stories.length - 1) setS(s + 1);
    else if (g < groups.length - 1) {
      setG(g + 1);
      setS(0);
    } else onClose();
    setProgress(0);
  }, [g, s, group, groups.length, onClose]);
  const prev = () => {
    if (s > 0) setS(s - 1);
    else if (g > 0) {
      setG(g - 1);
      setS(0);
    }
    setProgress(0);
  };

  useEffect(() => {
    if (!story || story.viewed || mine) return;
    void api.post(`/stories/${story.id}/view`).then(() => void queryClient.invalidateQueries({ queryKey: qk.stories }));
  }, [story?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Таймер для фото; для видео — по фактическому прогрессу воспроизведения
  useEffect(() => {
    if (!story || paused || viewersOpen) return;
    if (story.media.kind === 'video') return;
    const started = Date.now() - progress * IMAGE_MS;
    const t = setInterval(() => {
      const p = (Date.now() - started) / IMAGE_MS;
      if (p >= 1) {
        clearInterval(t);
        next();
      } else setProgress(p);
    }, 50);
    return () => clearInterval(t);
  }, [story?.id, paused, viewersOpen, next]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const el = video.current;
    if (!el) return;
    if (paused || viewersOpen) el.pause();
    else void el.play().catch(() => undefined);
  }, [paused, viewersOpen, story?.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight') next();
      if (e.key === 'ArrowLeft') prev();
      if (e.key === ' ') setPaused((p) => !p);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const viewers = useQuery({
    queryKey: ['story-viewers', story?.id],
    queryFn: () => api.get<{ items: UserSummary[] }>(`/stories/${story!.id}/viewers`),
    enabled: viewersOpen && !!story && mine,
  });

  const sendReply = async () => {
    if (!story || !reply.trim()) return;
    try {
      const chat = await api.post<ChatSummary>('/chats/direct', { userId: story.author.id });
      await api.post(`/chats/${chat.id}/messages`, { clientId: `s${randomId(12)}`, text: `Ответ на историю: ${reply.trim()}` });
      setReply('');
      toast({ text: 'Ответ отправлен в личные сообщения', kind: 'success' });
    } catch (e) {
      toast({ text: errorMessage(e), kind: 'error' });
    }
  };

  if (!group || !story) return null;
  return createPortal(
    <div className="story-viewer" role="dialog" aria-label={`История ${story.author.displayName}`}>
      <div className="story-viewer__frame" onPointerDown={() => setPaused(true)} onPointerUp={() => setPaused(false)}>
        {story.media.kind === 'video' ? (
          <video
            key={story.id}
            ref={video}
            className="story-viewer__media"
            src={story.media.url}
            autoPlay
            playsInline
            muted
            onTimeUpdate={(e) => setProgress(e.currentTarget.currentTime / (e.currentTarget.duration || 1))}
            onEnded={next}
          />
        ) : (
          <img key={story.id} className="story-viewer__media" src={story.media.url} alt="" />
        )}
        <div className="story-viewer__bars">
          {group.stories.map((x, i) => (
            <span key={x.id}>
              <i style={{ width: `${i < s ? 100 : i === s ? progress * 100 : 0}%` }} />
            </span>
          ))}
        </div>
        <div className="story-viewer__head">
          <Link to={`/u/${story.author.username}`} onClick={onClose} className="row" style={{ color: '#fff', gap: 8 }}>
            <Avatar src={story.author.avatarUrl} name={story.author.displayName} id={story.author.id} size={34} />
            <span className="bold">{story.author.displayName}</span>
          </Link>
          <span style={{ opacity: 0.8, fontSize: 13 }}>{timeAgo(story.createdAt)}</span>
          <span className="grow" />
          <IconButton label={paused ? 'Продолжить' : 'Пауза'} onClick={(e) => (e.stopPropagation(), setPaused(!paused))} style={{ color: '#fff' }}>
            {paused ? <Play size={20} /> : <Pause size={20} />}
          </IconButton>
          <IconButton label="Закрыть" onClick={onClose} style={{ color: '#fff' }}>
            <X size={22} />
          </IconButton>
        </div>
        <button className="story-viewer__tap" style={{ left: 0 }} aria-label="Предыдущая" onClick={prev} />
        <button className="story-viewer__tap" style={{ right: 0 }} aria-label="Следующая" onClick={next} />
        {story.text && <div className="story-viewer__text">{story.text}</div>}
        <div className="story-viewer__foot" onPointerDown={(e) => e.stopPropagation()}>
          {mine ? (
            <>
              <Button variant="ghost" style={{ color: '#fff' }} icon={<Eye size={18} />} onClick={() => setViewersOpen(true)}>
                {story.viewCount ?? 0}
              </Button>
              <span className="grow" />
              <IconButton
                label="Удалить историю"
                style={{ color: '#fff' }}
                onClick={async () => {
                  if (!(await confirm({ title: 'Удалить историю?', danger: true, confirmLabel: 'Удалить' }))) return;
                  await api.del(`/stories/${story.id}`);
                  void queryClient.invalidateQueries({ queryKey: qk.stories });
                  next();
                }}
              >
                <Trash2 size={20} />
              </IconButton>
            </>
          ) : (
            <>
              <input
                placeholder="Ответить…"
                value={reply}
                onFocus={() => setPaused(true)}
                onBlur={() => setPaused(false)}
                onChange={(e) => setReply(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && void sendReply()}
              />
              {reply ? (
                <IconButton label="Отправить" style={{ color: '#fff' }} onClick={() => void sendReply()}>
                  <SendHorizontal size={22} />
                </IconButton>
              ) : (
                <IconButton label="Нравится" style={{ color: '#fff' }} onClick={() => toast('❤️ Реакция отправлена')}>
                  <Heart size={24} />
                </IconButton>
              )}
            </>
          )}
        </div>
      </div>
      {viewersOpen && (
        <Modal open onClose={() => setViewersOpen(false)} title="Просмотры">
          {viewers.data?.items.length === 0 && <p className="muted">Пока никто не посмотрел</p>}
          {viewers.data?.items.map((u) => <UserRow key={u.id} user={u} />)}
        </Modal>
      )}
    </div>,
    document.body,
  );
}

export function StoriesBar() {
  const me = useMe();
  const q = useStories();
  const navigate = useNavigate();
  const [open, setOpen] = useState<number | null>(null);
  const groups = q.data?.items ?? [];
  const hasOwn = groups[0]?.author.id === me.id;
  return (
    <>
      <div className="stories-bar" aria-label="Истории">
        {!hasOwn && (
          <button className="story-chip" onClick={() => navigate('/stories/new')}>
            <Avatar src={me.avatarUrl} name={me.displayName} id={me.id} size={64} />
            <span className="story-chip__add">
              <Plus size={14} />
            </span>
            <span className="story-chip__name">Ваша история</span>
          </button>
        )}
        {groups.map((gr, i) => (
          <button key={gr.author.id} className="story-chip" onClick={() => setOpen(i)}>
            <Avatar src={gr.author.avatarUrl} name={gr.author.displayName} id={gr.author.id} size={64} ring={gr.hasUnseen ? 'unseen' : 'seen'} />
            <span className="story-chip__name">{gr.author.id === me.id ? 'Вы' : gr.author.displayName.split(' ')[0]}</span>
          </button>
        ))}
      </div>
      {open !== null && <StoryViewer groups={groups} startIndex={open} onClose={() => setOpen(null)} />}
    </>
  );
}

export function StoriesPage() {
  const q = useStories();
  const [open, setOpen] = useState<number | null>(null);
  const groups = q.data?.items ?? [];
  return (
    <div className="scroll">
      <div className="page page--wide">
        <PageHeader title="Истории" subtitle="Исчезают через 24 часа" icon={<Eye size={22} />} actions={<Link to="/stories/new" className="btn btn--primary btn--sm"><Plus size={16} /> Новая</Link>} />
        {groups.length === 0 && !q.isLoading && <EmptyState icon={<Eye size={28} />} title="Нет активных историй" text="Подпишитесь на друзей или опубликуйте свою" />}
        <div className="photo-grid photo-grid--wide" style={{ gap: 12 }}>
          {groups.map((gr, i) => (
            <button key={gr.author.id} onClick={() => setOpen(i)} style={{ aspectRatio: '9 / 16', borderRadius: 16 }}>
              {gr.stories[0]!.media.kind === 'video' ? (
                <video src={gr.stories[0]!.media.url} muted preload="metadata" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              ) : (
                <img src={gr.stories[0]!.media.url} alt="" />
              )}
              <span style={{ position: 'absolute', left: 10, top: 10 }}>
                <Avatar src={gr.author.avatarUrl} name={gr.author.displayName} id={gr.author.id} size={40} ring={gr.hasUnseen ? 'unseen' : 'seen'} />
              </span>
              <span style={{ position: 'absolute', left: 10, bottom: 10, color: '#fff', fontWeight: 700, textShadow: '0 1px 4px #000' }}>{gr.author.displayName}</span>
            </button>
          ))}
        </div>
      </div>
      {open !== null && <StoryViewer groups={groups} startIndex={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

export function NewStoryPage() {
  const navigate = useNavigate();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [progress, setProgress] = useState(0);
  const publish = useMutation({
    mutationFn: async () => {
      const media = await uploadAny(file!, { onProgress: setProgress });
      return api.post<Story>('/stories', { mediaId: media.id, text: text || undefined });
    },
    onSuccess: () => {
      toast({ text: 'История опубликована на 24 часа', kind: 'success' });
      void queryClient.invalidateQueries({ queryKey: qk.stories });
      navigate('/photos');
    },
    onError: (e) => toast({ text: errorMessage(e), kind: 'error' }),
  });
  return (
    <div className="scroll">
      <div className="page">
        <PageHeader title="Новая история" subtitle="Фото или видео исчезнет через 24 часа" icon={<Plus size={22} />} />
        {!file ? (
          <label className="dropzone">
            <Plus size={40} className="faint" />
            <span className="bold">Выберите фото или видео</span>
            <input
              type="file"
              accept="image/*,video/*"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) {
                  setFile(f);
                  setPreview(URL.createObjectURL(f));
                }
              }}
            />
          </label>
        ) : (
          <div className="col gap-4" style={{ alignItems: 'center' }}>
            <div style={{ position: 'relative', width: 280, aspectRatio: '9 / 16', borderRadius: 16, overflow: 'hidden', background: '#000' }}>
              {file.type.startsWith('video/') ? (
                <video src={preview!} autoPlay muted loop playsInline style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              ) : (
                <img src={preview!} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              )}
              {text && <div className="story-viewer__text" style={{ bottom: 24, fontSize: 18 }}>{text}</div>}
            </div>
            <div style={{ width: '100%', maxWidth: 420 }} className="col gap-3">
              <Input label="Текст поверх истории" value={text} onChange={(e) => setText(e.target.value)} maxLength={200} />
              {publish.isPending && (
                <div className="progress">
                  <div className="progress__bar" style={{ width: `${progress * 100}%` }} />
                </div>
              )}
              <div className="row">
                <Button loading={publish.isPending} onClick={() => publish.mutate()}>
                  Опубликовать
                </Button>
                <Button variant="ghost" onClick={() => setFile(null)}>
                  Другой файл
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
