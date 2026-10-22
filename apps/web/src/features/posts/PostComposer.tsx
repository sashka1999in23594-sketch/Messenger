import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { useMutation } from '@tanstack/react-query';
import { CalendarClock, ChevronDown, FileText, Globe, ImagePlus, Lock, Users, X } from 'lucide-react';
import { LIMITS, type MediaItem, type Post, type PostDraft, type Visibility } from '@omni/shared';
import { api, ApiError, errorMessage } from '../../shared/api/client';
import { queryClient } from '../../shared/api/query';
import { uploadAny } from '../../shared/lib/media';
import { useMe } from '../../shared/stores/session';
import { toast } from '../../shared/stores/ui';
import { cn } from '../../shared/lib/format';
import { Avatar, Button, confirm, ScheduleDialog } from '../../shared/ui';
import { Sheet, useOptions } from '../misc/kit';
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
  public: { label: 'Видят все', icon: <Globe size={15} /> },
  followers: { label: 'Подписчики', icon: <Users size={15} /> },
  private: { label: 'Только я', icon: <Lock size={15} /> },
};

/** Поле, растущее по мере ввода. */
function useAutosize(ref: React.RefObject<HTMLTextAreaElement | null>, value: string) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [ref, value]);
}

/**
 * Редактор заметки (как в Threads): текст до 2000 символов, до 4 фото/видео,
 * видимость, черновик и отложенная публикация. С draft — редактирование черновика.
 * variant="sheet" — со своей шапкой «Отмена · Новая публикация · Опубликовать».
 */
export function PostComposer({
  communityId,
  quoteOf,
  onDone,
  autoFocus,
  placeholder = 'Что нового?',
  draft,
  onDraftSaved,
  variant = 'card',
  onCancel,
}: {
  communityId?: string;
  quoteOf?: Post;
  onDone?: (p: Post) => void;
  autoFocus?: boolean;
  placeholder?: string;
  draft?: PostDraft;
  onDraftSaved?: (d: PostDraft) => void;
  variant?: 'card' | 'sheet';
  onCancel?: () => void;
}) {
  const me = useMe();
  const navigate = useNavigate();
  const [text, setText] = useState(draft?.text ?? '');
  const [visibility, setVisibility] = useState<Visibility>(draft?.visibility ?? 'public');
  const [files, setFiles] = useState<Pending[]>(() => (draft?.media ?? []).map(fromMedia));
  const [scheduling, setScheduling] = useState(false);
  const canDraft = !communityId && !quoteOf;
  const fileInput = useRef<HTMLInputElement>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  useAutosize(area, text);
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
      if (variant === 'sheet' && !draft) onCancel?.();
    },
    onError: (e) => toast({ text: e instanceof ApiError && e.fields ? Object.values(e.fields)[0]! : errorMessage(e), kind: 'error' }),
  });

  const visMenu = useOptions(
    (Object.keys(VIS) as Visibility[]).map((k) => ({ label: VIS[k].label + (k === visibility ? ' ✓' : ''), icon: VIS[k].icon, onClick: () => setVisibility(k) })),
    <span className="small muted">Кто увидит публикацию</span>,
  );

  const uploading = files.some((f) => !f.media);
  const canPost = !uploading && left >= 0 && (text.trim().length > 0 || files.length > 0 || !!quoteOf);
  const dirty = text.trim().length > 0 || files.length > 0;
  const cancel = async () => {
    if (dirty && !(await confirm({ title: 'Закрыть без публикации?', text: 'Текст и вложения пропадут. Чтобы вернуться к ним позже, сохраните черновик.', confirmLabel: 'Закрыть', danger: true }))) return;
    onCancel?.();
  };
  const publishButton = (
    <Button pill size="sm" className="cmp__publish" disabled={!canPost} loading={publish.isPending} onClick={() => publish.mutate()}>
      {quoteOf ? 'Цитировать' : 'Опубликовать'}
    </Button>
  );

  return (
    <div className={cn('cmp', `cmp--${variant}`)}>
      {variant === 'sheet' && (
        <div className="cmp__bar">
          <button type="button" className="cmp__cancel" onClick={() => void cancel()}>
            Отмена
          </button>
          <b className="cmp__heading">{quoteOf ? 'Цитата' : draft ? 'Черновик' : 'Новая публикация'}</b>
          {publishButton}
        </div>
      )}
      <div className="cmp__main">
        <div className="cmp__row">
          <div className="cmp__aside">
            <Avatar src={me.avatarUrl} name={me.displayName} id={me.id} size={40} />
          </div>
          <div className="cmp__content">
            <b className="cmp__name">{me.displayName}</b>
            <textarea
              ref={area}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={placeholder}
              autoFocus={autoFocus}
              rows={variant === 'sheet' ? 3 : 2}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && canPost) publish.mutate();
              }}
              aria-label="Текст публикации"
            />
            {files.length > 0 && (
              <div className="cmp__files">
                {files.map((f) => (
                  <div key={f.id} className="cmp__file">
                    {f.isVideo ? <video src={f.preview} muted playsInline /> : <img src={f.preview} alt="" />}
                    {!f.media && (
                      <div className="cmp__progress">
                        <i style={{ width: `${f.progress * 100}%` }} />
                      </div>
                    )}
                    <button type="button" className="cmp__remove" aria-label="Убрать вложение" onClick={() => setFiles((l) => l.filter((x) => x.id !== f.id))}>
                      <X size={15} />
                    </button>
                  </div>
                ))}
              </div>
            )}
            {quoteOf && <PostEmbed post={quoteOf} />}
            <div className="cmp__tools">
              <button type="button" className="pk-icon cmp__tool" aria-label="Фото или видео" title="Фото или видео" onClick={() => fileInput.current?.click()} disabled={files.length >= 4 || !!quoteOf}>
                <ImagePlus size={21} />
              </button>
              <input ref={fileInput} type="file" hidden multiple accept="image/*,video/*" onChange={(e) => (e.target.files && add(e.target.files), (e.target.value = ''))} />
              {canDraft && (
                <>
                  <button
                    type="button"
                    className="pk-icon cmp__tool"
                    aria-label="Сохранить черновик"
                    title="Сохранить черновик"
                    onClick={() => saveDraft.mutate(null)}
                    disabled={uploading || (!text.trim() && !files.length) || saveDraft.isPending}
                  >
                    <FileText size={20} />
                  </button>
                  <button type="button" className="pk-icon cmp__tool" aria-label="Запланировать публикацию" title="Запланировать публикацию" onClick={() => setScheduling(true)} disabled={!canPost}>
                    <CalendarClock size={20} />
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
      <div className="cmp__foot">
        {!communityId ? (
          <button type="button" className="cmp__vis" onClick={(e) => visMenu.open(e)} aria-label="Кто видит">
            {VIS[visibility].icon}
            {VIS[visibility].label}
            <ChevronDown size={14} />
          </button>
        ) : (
          <span />
        )}
        <span className="grow" />
        {left < 200 && <span className={cn('cmp__counter', left < 100 && 'cmp__counter--warn', left < 0 && 'cmp__counter--over')}>{left}</span>}
        {variant === 'card' && publishButton}
      </div>
      {visMenu.element}
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

/** Редактор в шторке: на телефоне — почти на весь экран, мышью — окно по центру. */
export function ComposeSheet({ onClose, quoteOf, communityId, placeholder }: { onClose: () => void; quoteOf?: Post; communityId?: string; placeholder?: string }) {
  return (
    <Sheet open full locked onClose={onClose} className="cmp-sheet">
      <PostComposer variant="sheet" autoFocus quoteOf={quoteOf} communityId={communityId} placeholder={placeholder} onCancel={onClose} onDone={onClose} />
    </Sheet>
  );
}

export function QuoteDialog({ post, onClose }: { post: Post; onClose: () => void }) {
  return <ComposeSheet quoteOf={post} placeholder="Добавьте комментарий" onClose={onClose} />;
}
