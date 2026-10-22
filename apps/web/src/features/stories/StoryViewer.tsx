/**
 * Полноэкранный просмотр историй: прогресс, тапы влево/вправо, пауза удержанием,
 * реакции, ответ в личку, просмотры и реакции для автора, «В Актуальное».
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Eye, Flag, Heart, MoreHorizontal, Pause, Play, SendHorizontal, Star, Trash2, Volume2, VolumeX, X } from 'lucide-react';
import { STORY_REACTIONS, type ChatSummary, type Story, type StoryGroup, type StoryViewerInfo } from '@omni/shared';
import { api, errorMessage } from '../../shared/api/client';
import { useMe } from '../../shared/stores/session';
import { toast } from '../../shared/stores/ui';
import { cn, fullDate, randomId, timeAgo } from '../../shared/lib/format';
import { Avatar, confirm, EmptyState, ListSkeleton, Menu, Modal, ReportDialog, useMenu, UserName } from '../../shared/ui';
import { shortAgo } from '../misc/kit';
import { refreshStories } from './api';
import { AddToHighlightDialog } from './highlight-dialogs';
import './stories.css';

const IMAGE_MS = 5500;

export function StoryViewer({
  groups: initial,
  startIndex = 0,
  startStoryId,
  onClose,
}: {
  groups: StoryGroup[];
  startIndex?: number;
  /** Открыть сразу на этой истории (иначе — на первой непросмотренной) */
  startStoryId?: string;
  onClose: () => void;
}) {
  const me = useMe();
  const [groups, setGroups] = useState(initial);
  const [g, setG] = useState(startIndex);
  const [s, setS] = useState(() => {
    const list = initial[startIndex]?.stories ?? [];
    const byId = startStoryId ? list.findIndex((x) => x.id === startStoryId) : -1;
    return byId >= 0 ? byId : Math.max(0, list.findIndex((x) => !x.viewed));
  });
  const [progress, setProgress] = useState(0);
  const [held, setHeld] = useState(false);
  const [typing, setTyping] = useState(false);
  const [dialog, setDialog] = useState<'viewers' | 'highlight' | 'report' | null>(null);
  const [reply, setReply] = useState('');
  const [muted, setMuted] = useState(true);
  const [burst, setBurst] = useState<{ emoji: string; key: number } | null>(null);
  const menu = useMenu();
  const video = useRef<HTMLVideoElement>(null);
  const group = groups[g];
  const story = group?.stories[s];
  const mine = story?.author.id === me.id;
  const paused = held || typing || !!dialog || !!menu.anchor;

  const next = useCallback(() => {
    if (!group) return onClose();
    setProgress(0);
    if (s < group.stories.length - 1) setS(s + 1);
    else if (g < groups.length - 1) {
      setG(g + 1);
      setS(0);
    } else onClose();
  }, [g, s, group, groups.length, onClose]);
  const prev = useCallback(() => {
    setProgress(0);
    if (s > 0) setS(s - 1);
    else if (g > 0) {
      setG(g - 1);
      setS(0);
    }
  }, [g, s]);

  const jumpGroup = (d: number) => {
    const to = g + d;
    if (to < 0) return;
    if (to >= groups.length) return onClose();
    setProgress(0);
    setG(to);
    const list = groups[to]!.stories;
    setS(Math.max(0, list.findIndex((x) => !x.viewed)));
  };

  const patchStory = (id: string, patch: Partial<Story>) =>
    setGroups((list) => list.map((gr) => ({ ...gr, stories: gr.stories.map((x) => (x.id === id ? { ...x, ...patch } : x)) })));

  // Отмечаем просмотр
  useEffect(() => {
    if (!story || story.viewed || mine) return;
    patchStory(story.id, { viewed: true });
    void api.post(`/stories/${story.id}/view`).then(() => refreshStories());
  }, [story?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Таймер для фото; для видео — по фактическому прогрессу воспроизведения
  useEffect(() => {
    if (!story || paused || story.media.kind === 'video') return;
    const started = Date.now() - progress * IMAGE_MS;
    const t = window.setInterval(() => {
      const p = (Date.now() - started) / IMAGE_MS;
      if (p >= 1) {
        window.clearInterval(t);
        next();
      } else setProgress(p);
    }, 50);
    return () => window.clearInterval(t);
  }, [story?.id, paused, next]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const el = video.current;
    if (!el) return;
    if (paused) el.pause();
    else void el.play().catch(() => undefined);
  }, [paused, story?.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (typing || dialog) return;
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight') next();
      if (e.key === 'ArrowLeft') prev();
      if (e.key === ' ') {
        e.preventDefault();
        setHeld((h) => !h);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [typing, dialog, next, prev, onClose]);

  // Свайп вниз на телефоне — закрыть
  const touch = useRef<{ x: number; y: number } | null>(null);

  const viewers = useQuery({
    queryKey: ['story-viewers', story?.id],
    queryFn: () => api.get<{ items: StoryViewerInfo[] }>(`/stories/${story!.id}/viewers`),
    enabled: dialog === 'viewers' && !!story && mine,
  });

  const react = async (emoji: string) => {
    if (!story) return;
    const value = story.myReaction === emoji ? null : emoji;
    patchStory(story.id, { myReaction: value });
    if (value) setBurst({ emoji: value, key: Date.now() });
    setTyping(false);
    try {
      await api.post(`/stories/${story.id}/react`, { emoji: value });
    } catch (e) {
      patchStory(story.id, { myReaction: story.myReaction });
      toast({ text: errorMessage(e), kind: 'error' });
    }
  };

  const sendReply = async () => {
    if (!story || !reply.trim()) return;
    const text = reply.trim();
    setReply('');
    setTyping(false);
    try {
      const chat = await api.post<ChatSummary>('/chats/direct', { userId: story.author.id });
      const quote = story.text ? `«${story.text}»` : story.media.kind === 'video' ? 'видео' : 'фото';
      await api.post(`/chats/${chat.id}/messages`, { clientId: `s${randomId(12)}`, text: `↩️ Ответ на историю (${quote}):\n${text}` });
      toast({ text: 'Ответ отправлен в личные сообщения', kind: 'success' });
    } catch (e) {
      toast({ text: errorMessage(e), kind: 'error' });
    }
  };

  const remove = async () => {
    if (!story) return;
    if (!(await confirm({ title: 'Удалить историю?', text: 'Она исчезнет и из архива, и из «Актуального».', danger: true, confirmLabel: 'Удалить' }))) return;
    try {
      await api.del(`/stories/${story.id}`);
      refreshStories(me.id);
      const left = group!.stories.filter((x) => x.id !== story.id);
      if (!left.length) {
        const rest = groups.filter((_, i) => i !== g);
        if (!rest.length) return onClose();
        setGroups(rest);
        setG(Math.min(g, rest.length - 1));
        setS(0);
      } else {
        setGroups((list) => list.map((gr, i) => (i === g ? { ...gr, stories: left } : gr)));
        setS(Math.min(s, left.length - 1));
      }
      setProgress(0);
    } catch (e) {
      toast({ text: errorMessage(e), kind: 'error' });
    }
  };

  if (!group || !story) return null;
  const poster = story.media.kind === 'video' ? story.media.posterUrl : story.media.url;
  const closeFriends = story.audience === 'close';

  return createPortal(
    <div className="story-viewer" role="dialog" aria-modal="true" aria-label={`История: ${story.author.displayName}`}>
      {poster && <div className="story-viewer__backdrop" style={{ backgroundImage: `url(${poster})` }} />}
      <button type="button" className="story-viewer__nav story-viewer__close" onClick={onClose} aria-label="Закрыть">
        <X size={24} />
      </button>
      <button type="button" className="story-viewer__nav" onClick={prev} disabled={g === 0 && s === 0} aria-label="Предыдущая история">
        <ChevronLeft size={26} />
      </button>
      <div
        className="story-viewer__frame"
        onPointerDown={(e) => {
          if ((e.target as HTMLElement).closest('button, input, a')) return;
          setHeld(true);
        }}
        onPointerUp={() => setHeld(false)}
        onPointerLeave={() => setHeld(false)}
        onTouchStart={(e) => (touch.current = { x: e.touches[0]!.clientX, y: e.touches[0]!.clientY })}
        onTouchEnd={(e) => {
          const t = touch.current;
          touch.current = null;
          if (!t) return;
          const dy = e.changedTouches[0]!.clientY - t.y;
          const dx = e.changedTouches[0]!.clientX - t.x;
          if (dy > 90 && Math.abs(dx) < 60) onClose();
          // Смахивание влево/вправо — к следующему или предыдущему автору
          else if (Math.abs(dx) > 70 && Math.abs(dy) < 60) jumpGroup(dx < 0 ? 1 : -1);
        }}
      >
        {story.media.kind === 'video' ? (
          <video
            key={story.id}
            ref={video}
            className="story-viewer__media"
            src={story.media.url}
            poster={story.media.posterUrl ?? undefined}
            autoPlay
            playsInline
            muted={muted}
            onTimeUpdate={(e) => setProgress(e.currentTarget.currentTime / (e.currentTarget.duration || 1))}
            onEnded={next}
          />
        ) : (
          <img key={story.id} className="story-viewer__media" src={story.media.url} alt={story.text ?? ''} draggable={false} />
        )}

        <div className="story-viewer__bars">
          {group.stories.map((x, i) => (
            <span key={x.id}>
              <i style={{ width: `${i < s ? 100 : i === s ? progress * 100 : 0}%` }} />
            </span>
          ))}
        </div>

        <div className="story-viewer__head">
          <Link to={`/u/${story.author.username}`} onClick={onClose} className="story-viewer__who">
            <Avatar src={story.author.avatarUrl} name={story.author.displayName} id={story.author.id} size={36} ring={closeFriends ? 'close' : null} />
            <b>{mine ? 'Ваша история' : story.author.displayName}</b>
          </Link>
          <span className="story-viewer__time" title={fullDate(story.createdAt)}>
            {story.expired ? fullDate(story.createdAt) : shortAgo(story.createdAt)}
          </span>
          {closeFriends && (
            <span className="story-viewer__badge" title="Видят только близкие друзья">
              <Star size={11} fill="currentColor" /> Близкие
            </span>
          )}
          <span className="grow" />
          {story.media.kind === 'video' && (
            <button type="button" className="story-viewer__icon" onClick={() => setMuted(!muted)} aria-label={muted ? 'Включить звук' : 'Выключить звук'}>
              {muted ? <VolumeX size={20} /> : <Volume2 size={20} />}
            </button>
          )}
          <button type="button" className="story-viewer__icon" onClick={() => setHeld(!held)} aria-label={paused ? 'Продолжить' : 'Пауза'}>
            {paused ? <Play size={20} /> : <Pause size={20} />}
          </button>
          <button type="button" className="story-viewer__icon" onClick={(e) => menu.openFromEvent(e)} aria-label="Ещё">
            <MoreHorizontal size={20} />
          </button>
          <button type="button" className="story-viewer__icon mobile-only" onClick={onClose} aria-label="Закрыть">
            <X size={22} />
          </button>
        </div>

        <button type="button" className="story-viewer__tap story-viewer__tap--prev" aria-label="Предыдущая" onClick={prev} />
        <button type="button" className="story-viewer__tap story-viewer__tap--next" aria-label="Следующая" onClick={next} />
        {story.text && !typing && <div className="story-viewer__text">{story.text}</div>}
        {burst && (
          <span key={burst.key} className="story-burst" onAnimationEnd={() => setBurst(null)} aria-hidden>
            {burst.emoji}
          </span>
        )}

        <div className="story-viewer__foot">
          {mine ? (
            <div className="story-viewer__row">
              <button type="button" className="story-viewer__stat" onClick={() => setDialog('viewers')}>
                <Eye size={18} /> {story.viewCount ?? 0}
                {(story.reactionCount ?? 0) > 0 && (
                  <>
                    {' · '}
                    <Heart size={16} fill="currentColor" /> {story.reactionCount}
                  </>
                )}
              </button>
              <span className="grow" />
              <button type="button" className="story-viewer__stat" onClick={() => setDialog('highlight')}>
                <Star size={16} /> В Актуальное
              </button>
              <button type="button" className="story-viewer__icon" onClick={() => void remove()} aria-label="Удалить историю">
                <Trash2 size={20} />
              </button>
            </div>
          ) : (
            <>
              {typing && (
                <div className="story-reactions" onPointerDown={(e) => e.preventDefault()}>
                  {STORY_REACTIONS.map((r) => (
                    <button key={r} type="button" className={cn(story.myReaction === r && 'story-reactions__on')} onClick={() => void react(r)} aria-label={`Реакция ${r}`}>
                      {r}
                    </button>
                  ))}
                </div>
              )}
              <div className="story-viewer__row">
                {story.allowReplies ? (
                  <input
                    className="story-viewer__input"
                    placeholder={`Ответить ${story.author.displayName.split(' ')[0]}…`}
                    value={reply}
                    maxLength={1000}
                    onFocus={() => setTyping(true)}
                    onBlur={() => setTyping(false)}
                    onChange={(e) => setReply(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void sendReply();
                      if (e.key === 'Escape') (e.target as HTMLInputElement).blur();
                    }}
                  />
                ) : (
                  <span className="grow story-viewer__time">Автор отключил ответы</span>
                )}
                {reply ? (
                  <button type="button" className="story-viewer__icon" onPointerDown={(e) => e.preventDefault()} onClick={() => void sendReply()} aria-label="Отправить">
                    <SendHorizontal size={22} />
                  </button>
                ) : (
                  <>
                    {!story.allowReplies && (
                      <button type="button" className="story-viewer__icon" onClick={() => setTyping(!typing)} aria-label="Реакции">
                        😊
                      </button>
                    )}
                    <button
                      type="button"
                      className={cn('story-viewer__icon', story.myReaction && 'story-viewer__heart--on')}
                      onClick={() => void react(story.myReaction ?? '❤️')}
                      aria-label={story.myReaction ? 'Убрать реакцию' : 'Нравится'}
                      aria-pressed={!!story.myReaction}
                    >
                      {story.myReaction && story.myReaction !== '❤️' ? <span style={{ fontSize: 24 }}>{story.myReaction}</span> : <Heart size={26} fill={story.myReaction ? 'currentColor' : 'none'} />}
                    </button>
                  </>
                )}
              </div>
            </>
          )}
        </div>
      </div>
      <button type="button" className="story-viewer__nav" onClick={next} aria-label="Следующая история">
        <ChevronRight size={26} />
      </button>

      <Menu
        anchor={menu.anchor}
        onClose={menu.close}
        items={[
          { label: 'Добавить в Актуальное', icon: <Star size={18} />, onClick: () => setDialog('highlight'), hidden: !mine },
          { label: 'Удалить', icon: <Trash2 size={18} />, danger: true, onClick: () => void remove(), hidden: !mine },
          { label: 'Пожаловаться', icon: <Flag size={18} />, danger: true, onClick: () => setDialog('report'), hidden: mine },
        ]}
      />
      {dialog === 'viewers' && (
        <Modal open onClose={() => setDialog(null)} title={`Просмотры · ${story.viewCount ?? 0}`}>
          {viewers.isLoading ? (
            <ListSkeleton rows={4} />
          ) : viewers.data?.items.length ? (
            <div className="col">
              {viewers.data.items.map((v) => (
                <Link key={v.user.id} to={`/u/${v.user.username}`} className="list-item" onClick={onClose}>
                  <Avatar src={v.user.avatarUrl} name={v.user.displayName} id={v.user.id} size={42} />
                  <span className="list-item__body">
                    <UserName user={v.user} />
                    <span className="list-item__sub">{timeAgo(v.viewedAt)}</span>
                  </span>
                  {v.reaction && <span className="viewer-row__reaction">{v.reaction}</span>}
                </Link>
              ))}
            </div>
          ) : (
            <EmptyState icon={<Eye size={26} />} title="Пока никто не посмотрел" />
          )}
        </Modal>
      )}
      {dialog === 'highlight' && <AddToHighlightDialog story={story} onClose={() => setDialog(null)} />}
      {dialog === 'report' && <ReportDialog open onClose={() => setDialog(null)} entityType="story" entityId={story.id} />}
    </div>,
    document.body,
  );
}
