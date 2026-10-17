/** Ветки комментариев — общие для постов, фото, видео и клипов. */
import { useState } from 'react';
import { Link } from 'react-router';
import { useMutation, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { Flag, Heart, MessageSquareOff, SendHorizontal, Trash2 } from 'lucide-react';
import { LIMITS, type Comment, type Paginated } from '@omni/shared';
import { api, errorMessage } from '../../shared/api/client';
import { flatPages, qk, useCursorList } from '../../shared/api/query';
import { useMe } from '../../shared/stores/session';
import { toast } from '../../shared/stores/ui';
import { cn, compactNumber, plural, timeAgo } from '../../shared/lib/format';
import { Avatar, confirm, EmptyState, ListSkeleton, LoadMore, ReportDialog, RichText, Segmented, UserName } from '../../shared/ui';
import { patchPostEverywhere } from './actions';

function CommentInput({ postId, parentId, replyTo, onDone, autoFocus }: { postId: string; parentId?: string; replyTo?: string; onDone?: () => void; autoFocus?: boolean }) {
  const me = useMe();
  const qc = useQueryClient();
  const [text, setText] = useState(replyTo ? `@${replyTo} ` : '');
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
    <form
      className="comment-input"
      onSubmit={(e) => {
        e.preventDefault();
        if (text.trim()) send.mutate();
      }}
    >
      <Avatar src={me.avatarUrl} name={me.displayName} id={me.id} size={parentId ? 28 : 36} />
      <textarea
        className="textarea"
        rows={1}
        value={text}
        maxLength={LIMITS.commentMax}
        onChange={(e) => setText(e.target.value)}
        placeholder={parentId ? 'Ваш ответ' : 'Написать комментарий…'}
        autoFocus={autoFocus}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            if (text.trim()) send.mutate();
          }
        }}
      />
      <button className="composer__send" style={{ width: 42, height: 42 }} disabled={!text.trim() || send.isPending} aria-label="Отправить">
        <SendHorizontal size={18} />
      </button>
    </form>
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
        <Link to={`/u/${c.author.username}`}>
          <Avatar src={c.author.avatarUrl} name={c.author.displayName} id={c.author.id} size={c.parentId ? 28 : 36} />
        </Link>
        <div className="comment__body">
          <div className="comment__head">
            <Link to={`/u/${c.author.username}`} style={{ color: 'inherit' }}>
              <UserName user={c.author} />
            </Link>
            {c.author.id === postAuthorId && <span className="tag tag--accent">автор</span>}
            <span className="faint">{timeAgo(c.createdAt)}</span>
            {c.editedAt && <span className="faint xs">(изм.)</span>}
          </div>
          {c.deleted ? <div className="comment__text faint">Комментарий удалён</div> : <RichText text={c.text} className="comment__text" />}
          {!c.deleted && (
            <div className="comment__actions">
              <button className={cn('action action--like', local.liked && 'action--liked')} onClick={() => like.mutate(!local.liked)} aria-label="Нравится">
                <Heart size={15} fill={local.liked ? 'currentColor' : 'none'} />
                {local.likes > 0 && compactNumber(local.likes)}
              </button>
              <button className="action" onClick={() => setReplying((v) => !v)}>
                Ответить
              </button>
              {c.author.id !== me.id && (
                <button className="action" onClick={() => setReporting(true)} aria-label="Пожаловаться">
                  <Flag size={14} />
                </button>
              )}
              {canDelete && (
                <button className="action" onClick={() => void remove()} aria-label="Удалить">
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          )}
          {replying && (
            <CommentInput postId={postId} parentId={c.parentId ?? c.id} replyTo={c.author.username} autoFocus onDone={() => {
              setReplying(false);
              setShowReplies(true);
            }} />
          )}
          {!c.parentId && c.replyCount > 0 && !showReplies && (
            <button className="btn btn--ghost btn--sm" style={{ color: 'var(--accent-fg)', paddingLeft: 0 }} onClick={() => setShowReplies(true)}>
              ── {c.replyCount} {plural(c.replyCount, 'ответ', 'ответа', 'ответов')}
            </button>
          )}
        </div>
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

export function CommentsSection({ postId, postAuthorId, count, disabled, highlightId }: { postId: string; postAuthorId: string; count: number; disabled?: boolean; highlightId?: string | null }) {
  const [sort, setSort] = useState<'top' | 'new'>('top');
  const list = useCursorList<Comment>(qk.comments(postId, sort), `/posts/${postId}/comments?sort=${sort}`);
  const items = flatPages(list.data as InfiniteData<Paginated<Comment>> | undefined);
  return (
    <section className="comments" aria-label="Комментарии">
      <div className="row between" style={{ padding: '8px 0' }}>
        <h3>
          {count} {plural(count, 'комментарий', 'комментария', 'комментариев')}
        </h3>
        <Segmented
          value={sort}
          onChange={setSort}
          options={[
            { value: 'top', label: 'Лучшие' },
            { value: 'new', label: 'Новые' },
          ]}
        />
      </div>
      {disabled ? (
        <EmptyState icon={<MessageSquareOff size={26} />} title="Комментарии отключены" text="Автор ограничил обсуждение этой публикации" />
      ) : (
        <CommentInput postId={postId} />
      )}
      {list.isLoading ? (
        <ListSkeleton rows={3} avatar={36} />
      ) : (
        items.map((c) => <CommentItem key={c.id} c={c} postId={postId} postAuthorId={postAuthorId} highlight={c.id === highlightId} />)
      )}
      {!list.isLoading && items.length === 0 && !disabled && <p className="muted small" style={{ padding: '8px 0 16px' }}>Будьте первым, кто оставит комментарий</p>}
      <LoadMore hasMore={!!list.hasNextPage} loading={list.isFetchingNextPage} onLoad={() => void list.fetchNextPage()} />
    </section>
  );
}
