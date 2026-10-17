import { useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { useMutation } from '@tanstack/react-query';
import { CalendarClock, FileText, Globe, ImagePlus, Lock, Users, X } from 'lucide-react';
import { LIMITS, type MediaItem, type Post, type PostDraft, type Visibility } from '@omni/shared';
import { api, ApiError, errorMessage } from '../../shared/api/client';
import { queryClient } from '../../shared/api/query';
import { uploadAny } from '../../shared/lib/media';
import { useMe } from '../../shared/stores/session';
import { toast } from '../../shared/stores/ui';
import { cn } from '../../shared/lib/format';
import { Avatar, Button, IconButton, Modal, ScheduleDialog } from '../../shared/ui';
import { PostEmbed } from './PostCard';

interface Pending {
  id: string;
  preview: string;
  isVideo: boolean;
  /** Превью — локальный objectURL, который нужно освободить */
  local: boolean;
  progress: number;
  media: MediaItem | null;
}

const fromMedia = (m: MediaItem): Pending => ({
  id: m.id,
  preview: m.kind === 'video' ? (m.posterUrl ?? m.url) : m.url,
  isVideo: false,
  local: false,
  progress: 1,
  media: m,
});

export const draftsKey = ['drafts'] as const;

const VIS: Record<Visibility, { label: string; icon: React.ReactNode }> = {
  public: { label: 'Все', icon: <Globe size={16} /> },
  followers: { label: 'Подписчики', icon: <Users size={16} /> },
  private: { label: 'Только я', icon: <Lock size={16} /> },
};

/**
 * Редактор заметки (как в X): текст до 2000 символов, до 4 фото/видео, видимость,
 * черновик и отложенная публикация. С draft — редактирование черновика.
 */
export function PostComposer({
  communityId,
  quoteOf,
  onDone,
  autoFocus,
  placeholder = 'Что нового?',
  draft,
  onDraftSaved,
}: {
  communityId?: string;
  quoteOf?: Post;
  onDone?: (p: Post) => void;
  autoFocus?: boolean;
  placeholder?: string;
  draft?: PostDraft;
  onDraftSaved?: (d: PostDraft) => void;
}) {
  const me = useMe();
  const navigate = useNavigate();
  const [text, setText] = useState(draft?.text ?? '');
  const [visibility, setVisibility] = useState<Visibility>(draft?.visibility ?? 'public');
  const [files, setFiles] = useState<Pending[]>(() => (draft?.media ?? []).map(fromMedia));
  const [scheduling, setScheduling] = useState(false);
  const canDraft = !communityId && !quoteOf;
  const fileInput = useRef<HTMLInputElement>(null);
  const left = LIMITS.postMax - text.length;

  const add = (list: FileList) => {
    for (const file of [...list].slice(0, 4 - files.length)) {
      const id = `${Date.now()}-${Math.random()}`;
      setFiles((f) => [...f, { id, preview: URL.createObjectURL(file), isVideo: file.type.startsWith('video/'), local: true, progress: 0, media: null }]);
      uploadAny(file, { onProgress: (p) => setFiles((f) => f.map((x) => (x.id === id ? { ...x, progress: p } : x))) })
        .then((media) => setFiles((f) => f.map((x) => (x.id === id ? { ...x, media } : x))))
        .catch((e) => {
          toast({ text: errorMessage(e), kind: 'error' });
          setFiles((f) => f.filter((x) => x.id !== id));
        });
    }
  };

  const reset = () => {
    setText('');
    files.forEach((f) => f.local && URL.revokeObjectURL(f.preview));
    setFiles([]);
  };
  const draftBody = (publishAt: string | null) => ({ kind: 'note', text: text.trim(), mediaIds: files.map((f) => f.media!.id), visibility, commentsDisabled: false, publishAt });

  const publish = useMutation({
    mutationFn: async () => {
      if (draft) {
        await api.put(`/me/drafts/${draft.id}`, draftBody(null));
        return api.post<Post>(`/me/drafts/${draft.id}/publish`);
      }
      return api.post<Post>('/posts', {
        kind: 'note',
        text: text.trim(),
        mediaIds: files.map((f) => f.media!.id),
        visibility,
        communityId,
        repostOfId: quoteOf?.id,
      });
    },
    onSuccess: (post) => {
      reset();
      if (draft) void queryClient.invalidateQueries({ queryKey: draftsKey });
      toast({ text: 'Опубликовано', kind: 'success' });
      void queryClient.invalidateQueries({ queryKey: ['feed'] });
      void queryClient.invalidateQueries({ queryKey: ['user-posts'] });
      void queryClient.invalidateQueries({ queryKey: ['community-posts'] });
      onDone?.(post);
    },
    onError: (e) => toast({ text: e instanceof ApiError && e.fields ? Object.values(e.fields)[0]! : errorMessage(e), kind: 'error' }),
  });

  const saveDraft = useMutation({
    mutationFn: (publishAt: string | null) =>
      draft ? api.put<PostDraft>(`/me/drafts/${draft.id}`, draftBody(publishAt)) : api.post<PostDraft>('/me/drafts', draftBody(publishAt)),
    onSuccess: (d) => {
      void queryClient.invalidateQueries({ queryKey: draftsKey });
      if (!draft) reset();
      toast({
        text: d.publishAt ? `Публикация запланирована на ${new Date(d.publishAt).toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}` : 'Черновик сохранён',
        kind: 'success',
        action: draft ? undefined : { label: 'Открыть', onClick: () => navigate(d.publishAt ? '/feed/scheduled' : '/feed/drafts') },
      });
      onDraftSaved?.(d);
    },
    onError: (e) => toast({ text: e instanceof ApiError && e.fields ? Object.values(e.fields)[0]! : errorMessage(e), kind: 'error' }),
  });

  const uploading = files.some((f) => !f.media);
  const canPost = !uploading && left >= 0 && (text.trim().length > 0 || files.length > 0 || !!quoteOf);

  return (
    <div className="composer-card">
      <Avatar src={me.avatarUrl} name={me.displayName} id={me.id} size={44} />
      <div className="col grow" style={{ gap: 8 }}>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={placeholder}
          autoFocus={autoFocus}
          rows={2}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && canPost) publish.mutate();
          }}
          aria-label="Текст публикации"
        />
        {quoteOf && <PostEmbed post={quoteOf} />}
        {files.length > 0 && (
          <div className="composer__attachments">
            {files.map((f) => (
              <div key={f.id} className="attachment" style={{ width: 110, height: 110 }}>
                {f.isVideo ? <video src={f.preview} muted /> : <img src={f.preview} alt="" />}
                {!f.media && (
                  <div className="progress attachment__progress">
                    <div className="progress__bar" style={{ width: `${f.progress * 100}%` }} />
                  </div>
                )}
                <button className="attachment__remove" aria-label="Убрать" onClick={() => setFiles((l) => l.filter((x) => x.id !== f.id))}>
                  <X size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="composer-card__tools">
          <IconButton label="Фото или видео" onClick={() => fileInput.current?.click()} disabled={files.length >= 4 || !!quoteOf}>
            <ImagePlus size={20} />
          </IconButton>
          <input ref={fileInput} type="file" hidden multiple accept="image/*,video/*" onChange={(e) => e.target.files && add(e.target.files)} />
          {!communityId && (
            <select className="select" style={{ width: 'auto', minHeight: 36, paddingTop: 4, paddingBottom: 4, paddingLeft: 14, borderRadius: 999 }} value={visibility} onChange={(e) => setVisibility(e.target.value as Visibility)} aria-label="Кто видит">
              {Object.entries(VIS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v.label}
                </option>
              ))}
            </select>
          )}
          {canDraft && (
            <>
              <IconButton label="Сохранить черновик" onClick={() => saveDraft.mutate(null)} disabled={uploading || (!text.trim() && !files.length) || saveDraft.isPending}>
                <FileText size={19} />
              </IconButton>
              <IconButton label="Запланировать публикацию" onClick={() => setScheduling(true)} disabled={!canPost}>
                <CalendarClock size={19} />
              </IconButton>
            </>
          )}
          <span className="grow" />
          {text.length > 0 && <span className={cn('counter', left < 100 && 'counter--warn', left < 0 && 'counter--over')}>{left}</span>}
          <Button pill size="sm" disabled={!canPost} loading={publish.isPending} onClick={() => publish.mutate()}>
            {quoteOf ? 'Цитировать' : 'Опубликовать'}
          </Button>
        </div>
      </div>
      {scheduling && (
        <ScheduleDialog
          title="Запланировать публикацию"
          hint="Публикация выйдет автоматически в выбранное время. До этого её можно изменить в разделе «Запланированные»."
          initial={draft?.publishAt ? new Date(draft.publishAt) : undefined}
          onClose={() => setScheduling(false)}
          onSchedule={async (at) => {
            await saveDraft.mutateAsync(at.toISOString());
          }}
        />
      )}
    </div>
  );
}

export function QuoteDialog({ post, onClose }: { post: Post; onClose: () => void }) {
  return (
    <Modal open onClose={onClose} title="Цитата" wide>
      <PostComposer quoteOf={post} autoFocus placeholder="Добавьте комментарий" onDone={onClose} />
    </Modal>
  );
}
