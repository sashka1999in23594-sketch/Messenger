/**
 * Премьеры видео: до начала — зал ожидания с большим обратным отсчётом,
 * «Напомнить» и чатом; во время премьеры все смотрят синхронно, как в эфире
 * (позиция = сколько прошло с начала), с общим чатом; после — обычное видео.
 */
import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Bell, BellRing, Clapperboard, Users } from 'lucide-react';
import type { LiveChatMessage, Post } from '@omni/shared';
import { api, errorMessage } from '../../shared/api/client';
import { toast } from '../../shared/stores/ui';
import { cn, fullDate } from '../../shared/lib/format';
import { EmptyState } from '../../shared/ui';
import { LiveBadge, VideoCard, VideoCardSkeleton, VideoChips } from '../video/components';
import { premiereState, useNow, waitingLabel, watchingLabel } from '../video/lib';
import { LiveChat } from './chat';
import './live.css';

export { countdown } from '../video/lib';

export type PremierePhase = 'before' | 'live' | null;

/** Фаза премьеры с пересчётом каждую секунду, пока она не закончилась. */
export function usePremierePhase(post: Post | undefined): { phase: PremierePhase; left: number; elapsed: number } {
  const [now, setNow] = useState(Date.now());
  const at = post?.premiereAt ? Date.parse(post.premiereAt) : null;
  const dur = (post?.media[0]?.durationSec ?? 0) * 1000;
  const active = !!at && now < at + Math.max(dur, 1000);
  useEffect(() => {
    if (!active) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [active]);
  if (!at) return { phase: null, left: 0, elapsed: 0 };
  if (now < at) return { phase: 'before', left: at - now, elapsed: 0 };
  if (now < at + dur) return { phase: 'live', left: 0, elapsed: now - at };
  return { phase: null, left: 0, elapsed: 0 };
}

/** Комната премьеры: подключаемся, пока страница открыта; сколько зрителей и история чата. */
export function usePremiereRoom(post: Post, enabled = true) {
  const join = useQuery({
    queryKey: ['premiere-room', post.id],
    queryFn: () => api.post<{ watching: number; chat: LiveChatMessage[] }>(`/premieres/${post.id}/join`),
    staleTime: Infinity,
    enabled,
  });
  useEffect(() => {
    if (!enabled) return;
    return () => void api.post(`/premieres/${post.id}/leave`).catch(() => undefined);
  }, [post.id, enabled]);
  return join;
}

export function RemindButton({ post, small }: { post: Post; small?: boolean }) {
  const [on, setOn] = useState(!!post.premiereReminder);
  const toggle = useMutation({
    mutationFn: (v: boolean) => api.post(`/premieres/${post.id}/remind`, { on: v }),
    onSuccess: (_d, v) => {
      setOn(v);
      toast({ text: v ? 'Напомним, когда премьера начнётся' : 'Напоминание отменено', kind: 'success' });
    },
    onError: (e) => toast({ text: errorMessage(e), kind: 'error' }),
  });
  return (
    <button
      type="button"
      className={cn('vremind', on && 'vremind--on', small && 'vremind--sm')}
      disabled={toggle.isPending}
      aria-pressed={on}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        toggle.mutate(!on);
      }}
    >
      {on ? <BellRing size={small ? 15 : 18} /> : <Bell size={small ? 15 : 18} />}
      {on ? 'Напомним' : 'Напомнить'}
    </button>
  );
}

/** Зал ожидания вместо плеера: обложка, большой отсчёт, «Напомнить». */
export function PremiereWaiting({ post, left, watching }: { post: Post; left: number; watching?: number }) {
  const m = post.media[0];
  const s = Math.max(0, Math.ceil(left / 1000));
  const parts: [number, string][] = [
    [Math.floor(s / 86400), 'дн'],
    [Math.floor((s % 86400) / 3600), 'ч'],
    [Math.floor((s % 3600) / 60), 'мин'],
    [s % 60, 'сек'],
  ];
  const visible = parts[0]![0] > 0 ? parts : parts.slice(1);
  const starting = left <= 0;
  return (
    <div className="vwait">
      {m?.posterUrl && <div className="vwait__bg" style={{ backgroundImage: `url("${m.posterUrl}")` }} aria-hidden />}
      <div className="vwait__scrim" aria-hidden />
      <div className="vwait__badges">
        <span className="vbadge vbadge--premiere vbadge--lg">
          <Clapperboard size={14} /> Премьера
        </span>
        {watching !== undefined && watching > 0 && (
          <span className="vbadge vbadge--glass vbadge--lg">
            <Users size={14} /> {waitingLabel(watching)}
          </span>
        )}
      </div>
      <div className="vwait__inner">
        <span className="vwait__label">{starting ? 'Премьера начинается' : 'Премьера начнётся через'}</span>
        {starting ? (
          <span className="vwait__spinner" aria-label="Начинается" />
        ) : (
          <div className="vwait__count" aria-live="polite" role="timer">
            {visible.map(([v, label], i) => (
              <span key={label} className="vwait__cell">
                <span className="vwait__num">{String(v).padStart(i === 0 && label === 'дн' ? 1 : 2, '0')}</span>
                <span className="vwait__unit">{label}</span>
              </span>
            ))}
          </div>
        )}
        <span className="vwait__date">{fullDate(post.premiereAt!)}</span>
        {!starting && <RemindButton post={post} />}
      </div>
    </div>
  );
}

/** Чат премьеры: подключаемся к комнате, пока страница открыта. */
export function PremiereChat({ post, live }: { post: Post; live?: boolean }) {
  const join = usePremiereRoom(post);
  if (!join.data) return <div className="live-chat live-chat--loading" aria-busy />;
  return (
    <LiveChat
      room={`premiere:${post.id}`}
      initial={join.data.chat}
      sendPath={`/premieres/${post.id}/chat`}
      title={live ? 'Чат премьеры' : 'Чат ожидания'}
      subtitle={live ? watchingLabel(join.data.watching) : waitingLabel(join.data.watching)}
      ownerId={post.author.id}
    />
  );
}

export function PremieresPage() {
  const q = useQuery({ queryKey: ['premieres'], queryFn: () => api.get<{ items: Post[] }>('/premieres'), refetchInterval: 60_000 });
  const now = useNow(5000);
  const items = q.data?.items ?? [];
  const live = items.filter((p) => premiereState(p, now) === 'live');
  const upcoming = items.filter((p) => premiereState(p, now) === 'upcoming');
  return (
    <div className="scroll">
      <div className="vroot">
        <div className="vhome">
          <div className="vhome__top">
            <VideoChips active="premieres" />
          </div>
          <header className="vpage-head">
            <h1>Премьеры</h1>
          </header>
          {q.isLoading ? (
            <div className="vgrid">
              {Array.from({ length: 4 }, (_, i) => (
                <VideoCardSkeleton key={i} />
              ))}
            </div>
          ) : items.length === 0 || (live.length === 0 && upcoming.length === 0) ? (
            <EmptyState
              icon={<Clapperboard size={28} />}
              title="Ближайших премьер нет"
              text="Загрузите видео и включите «Премьера» — подписчики получат напоминание и посмотрят вместе"
            />
          ) : (
            <>
              {live.length > 0 && (
                <section className="vsection">
                  <h2 className="vsection__title">
                    <LiveBadge small label="Сейчас" /> Идут прямо сейчас
                  </h2>
                  <div className="vgrid">
                    {live.map((p) => (
                      <VideoCard key={p.id} post={p} />
                    ))}
                  </div>
                </section>
              )}
              {upcoming.length > 0 && (
                <section className="vsection">
                  <h2 className="vsection__title">Скоро</h2>
                  <div className="vgrid">
                    {upcoming.map((p) => (
                      <VideoCard key={p.id} post={p} footer={<RemindButton post={p} small />} />
                    ))}
                  </div>
                </section>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
