/** Ветки комментариев — общие для постов, фото, видео и Reels. */
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { useMutation, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { Flag, Heart, MessageSquareOff, Trash2 } from 'lucide-react';
import { LIMITS, type Comment, type Paginated } from '@omni/shared';
import { api, errorMessage } from '../../shared/api/client';
import { flatPages, qk, useCursorList } from '../../shared/api/query';
import { useMe } from '../../shared/stores/session';
import { toast } from '../../shared/stores/ui';
import { cn, compactNumber, fullDate, plural } from '../../shared/lib/format';
import { Avatar, confirm, EmptyState, ListSkeleton, LoadMore, ReportDialog, RichText, Segmented, Verified } from '../../shared/ui';
import { shortAgo } from '../misc/kit';
import { patchPostEverywhere } from './actions';

const QUICK = ['❤️', '🙌', '🔥', '👏', '😢', '😍', '😮', '😂'];

function CommentInput({
  postId,
  parentId,
  replyTo,
  onDone,
  autoFocus,
  quick,
  inputRef,
  sticky,
}: {
  postId: string;
  parentId?: string;
  replyTo?: string;
  onDone?: () => void;
  autoFocus?: boolean;
  /** Ряд быстрых эмодзи над полем */
  quick?: boolean;
  inputRef?: React.RefObject<HTMLTextAreaElement | null>;
  /** Прилипает к низу экрана на телефоне */
  sticky?: boolean;
}) {
  const me = useMe();
  const qc = useQueryClient();
  const [text, setText] = useState(replyTo ? `@${replyTo} ` : '');
  const own = useRef<HTMLTextAreaElement>(null);
  const area = inputRef ?? own;
  useEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [text, area]);
  const send = useMutation({
    mutationFn: () => api.post<Comment>(`/posts/${postId}/comments`, { text: text.trim(), parentId }),
    onSuccess: () => {
      setText('');
      patchPostEverywhere(postId, (p) => ({ ...p, stats: { ...p.stats, comments: p.stats.comments + 1 } }));
      void qc.invalidateQueries({ queryKey: ['comments', postId] });
      if (parentId) void qc.invalidateQueries({ queryKey: qk.replies(parentId) });
      onDone?.();
    },
    onError: (e) => toast({ text: errorMessage(e), kind: 'error' }),
  });
  return (
    <div className={cn(sticky && 'comments__composer')}>
      {quick && (
        <div className="comment-input__emoji" aria-label="Быстрые эмодзи">
          {QUICK.map((e) => (
            <button key={e} type="button" onClick={() => (setText((t) => t + e), area.current?.focus())} aria-label={`Добавить ${e}`}>
              {e}
            </button>
          ))}
        </div>
      )}
      <form
        className="comment-input"
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim()) send.mutate();
        }}
      >
        <Avatar src={me.avatarUrl} name={me.displayName} id={me.id} size={parentId ? 28 : 36} />
        <div className="comment-input__field">
          <textarea
            ref={area}
            rows={1}
            value={text}
            maxLength={LIMITS.commentMax}
            onChange={(e) => setText(e.target.value)}
            placeholder={parentId ? 'Ваш ответ…' : 'Добавьте комментарий…'}
            autoFocus={autoFocus}
            aria-label={parentId ? 'Ответ' : 'Комментарий'}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !matchMedia('(pointer: coarse)').matches) {
                e.preventDefault();
                if (text.trim()) send.mutate();
              }
            }}
          />
          <button className="comment-input__send" disabled={!text.trim() || send.isPending}>
            {parentId ? 'Ответить' : 'Опубликовать'}
          </button>
        </div>
      </form>
    </div>
  );
}

function CommentItem({ c, postId, postAuthorId, highlight }: { c: Comment; postId: string; postAuthorId: string; highlight?: boolean }) {
  const me = useMe();
  const qc = useQueryClient();
  const [replying, setReplying] = useState(false);
  const [showReplies, setShowReplies] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [local, setLocal] = useState(c);
  const replies = useCursorList<Comment>(qk.replies(c.id), `/comments/${c.id}/replies`, { enabled: showReplies && !c.parentId });
  const like = useMutation({
    mutationFn: (on: boolean) => (on ? api.post<Comment>(`/comments/${c.id}/like`) : api.del<Comment>(`/comments/${c.id}/like`)),
    onMutate: (on) => setLocal((x) => ({ ...x, liked: on, likes: x.likes + (on ? 1 : -1) })),
    onError: (_e, on) => setLocal((x) => ({ ...x, liked: !on, likes: x.likes + (on ? -1 : 1) })),
  });
  const remove = async () => {
    if (!(await confirm({ title: 'Удалить комментарий?', danger: true, confirmLabel: 'Удалить' }))) return;
    try {
      await api.del(`/comments/${c.id}`);
      patchPostEverywhere(postId, (p) => ({ ...p, stats: { ...p.stats, comments: Math.max(0, p.stats.comments - 1) } }));
      void qc.invalidateQueries({ queryKey: ['comments', postId] });
      if (c.parentId) void qc.invalidateQueries({ queryKey: qk.replies(c.parentId) });
    } catch (e) {
      toast({ text: errorMessage(e), kind: 'error' });
    }
  };
  const canDelete = !c.deleted && (c.author.id === me.id || postAuthorId === me.id);
  return (
    <div>
      <div className={cn('comment', highlight && 'comment--highlight')} id={`comment-${c.id}`}>
        <Link to={`/u/${c.author.username}`} aria-label={c.author.displayName}>
          <Avatar src={c.author.avatarUrl} name={c.author.displayName} id={c.author.id} size={c.parentId ? 28 : 36} />
        </Link>
        <div className="comment__body">
          <div className="comment__head">
            <Link to={`/u/${c.author.username}`} className="bold">
              {c.author.displayName}
            </Link>
            {c.author.verified && <Verified size={13} />}
            {c.author.id === postAuthorId && <span className="tag tag--accent">автор</span>}
            <span className="comment__time" title={fullDate(c.createdAt)}>
              {shortAgo(c.createdAt)}
              {c.editedAt && ' · изм.'}
            </span>
          </div>
          {c.deleted ? <div className="comment__text faint">Комментарий удалён</div> : <RichText text={c.text} className="comment__text" />}
          {!c.deleted && (
            <div className="comment__actions">
              {local.likes > 0 && (
                <span className="comment__act" style={{ cursor: 'default' }}>
                  {compactNumber(local.likes)} {plural(local.likes, 'отметка', 'отметки', 'отметок')}
                </span>
              )}
              <button type="button" className="comment__act" onClick={() => setReplying((v) => !v)}>
                Ответить
              </button>
              {c.author.id !== me.id && (
                <button type="button" className="comment__act" onClick={() => setReporting(true)} aria-label="Пожаловаться">
                  <Flag size={13} />
                </button>
              )}
              {canDelete && (
                <button type="button" className="comment__act" onClick={() => void remove()} aria-label="Удалить">
                  <Trash2 size={13} />
                </button>
              )}
            </div>
          )}
          {replying && (
            <CommentInput
              postId={postId}
              parentId={c.parentId ?? c.id}
              replyTo={c.author.username}
              autoFocus
              onDone={() => {
                setReplying(false);
                setShowReplies(true);
              }}
            />
          )}
          {!c.parentId && c.replyCount > 0 && (
            <button type="button" className="comment__toggle" onClick={() => setShowReplies((v) => !v)}>
              {showReplies ? 'Скрыть ответы' : `Смотреть ${c.replyCount} ${plural(c.replyCount, 'ответ', 'ответа', 'ответов')}`}
            </button>
          )}
        </div>
        {!c.deleted && (
          <button
            type="button"
            className={cn('comment__like', local.liked && 'comment__like--on')}
            onClick={() => like.mutate(!local.liked)}
            aria-label={local.liked ? 'Убрать отметку' : 'Нравится'}
            aria-pressed={local.liked}
          >
            <Heart size={15} fill={local.liked ? 'currentColor' : 'none'} />
          </button>
        )}
      </div>
      {showReplies && !c.parentId && (
        <div className="comment__replies">
          {flatPages(replies.data).map((r) => (
            <CommentItem key={r.id} c={r} postId={postId} postAuthorId={postAuthorId} />
          ))}
          <LoadMore hasMore={!!replies.hasNextPage} loading={replies.isFetching} onLoad={() => void replies.fetchNextPage()} />
        </div>
      )}
      {reporting && <ReportDialog open entityType="comment" entityId={c.id} onClose={() => setReporting(false)} />}
    </div>
  );
}

export function CommentsSection({
  postId,
  postAuthorId,
  count,
  disabled,
  highlightId,
  inputRef,
  inputAtBottom,
}: {
  postId: string;
  postAuthorId: string;
  count: number;
  disabled?: boolean;
  highlightId?: string | null;
  /** Поле ввода внизу (на телефоне прилипает к низу экрана), иначе — сверху списка */
  inputAtBottom?: boolean;
  /** Ссылка на поле ввода — чтобы кнопка «Комментарии» ставила в него курсор */
  inputRef?: React.RefObject<HTMLTextAreaElement | null>;
}) {
  const [sort, setSort] = useState<'top' | 'new'>('top');
  const list = useCursorList<Comment>(qk.comments(postId, sort), `/posts/${postId}/comments?sort=${sort}`);
  const items = flatPages(list.data as InfiniteData<Paginated<Comment>> | undefined);
  const composer = disabled ? (
    <EmptyState icon={<MessageSquareOff size={26} />} title="Комментарии отключены" text="Автор ограничил обсуждение этой публикации" />
  ) : (
    <CommentInput postId={postId} quick={inputAtBottom} inputRef={inputRef} sticky={inputAtBottom} />
  );
  return (
    <section className="comments" id="comments" aria-label="Комментарии">
      <div className="comments__head">
        <h3>
          {count ? `${count} ${plural(count, 'комментарий', 'комментария', 'комментариев')}` : 'Комментарии'}
        </h3>
        {count > 1 && (
          <Segmented
            value={sort}
            onChange={setSort}
            options={[
              { value: 'top', label: 'Лучшие' },
              { value: 'new', label: 'Новые' },
            ]}
          />
        )}
      </div>
      {!inputAtBottom && composer}
      {list.isLoading ? (
        <ListSkeleton rows={3} avatar={36} />
      ) : (
        items.map((c) => <CommentItem key={c.id} c={c} postId={postId} postAuthorId={postAuthorId} highlight={c.id === highlightId} />)
      )}
      {!list.isLoading && items.length === 0 && !disabled && <p className="muted small" style={{ padding: '8px 0 12px' }}>Комментариев пока нет — начните обсуждение</p>}
      <LoadMore hasMore={!!list.hasNextPage} loading={list.isFetchingNextPage} onLoad={() => void list.fetchNextPage()} />
      {inputAtBottom && composer}
    </section>
  );
}
