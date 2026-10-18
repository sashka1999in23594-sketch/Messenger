/**
 * Премьеры видео: до начала — обратный отсчёт, «Напомнить» и чат ожидания;
 * во время премьеры все смотрят синхронно, как в эфире (позиция = сколько
 * прошло с начала), с общим чатом; после — обычное видео.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Bell, BellRing, CalendarClock, Clapperboard, Users } from 'lucide-react';
import type { LiveChatMessage, Post } from '@omni/shared';
import { api, errorMessage } from '../../shared/api/client';
import { qk, queryClient } from '../../shared/api/query';
import { toast } from '../../shared/stores/ui';
import { cn, fullDate } from '../../shared/lib/format';
import { Avatar, Button, EmptyState, Loading, PageHeader } from '../../shared/ui';
import { LiveChat } from './chat';
import './live.css';

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

export function countdown(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const d = Math.floor(s / 86400);
  const hh = String(Math.floor((s % 86400) / 3600)).padStart(2, '0');
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return d ? `${d} д ${hh}:${mm}:${ss}` : `${hh}:${mm}:${ss}`;
}

function RemindButton({ post }: { post: Post }) {
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
    <Button variant={on ? 'secondary' : 'primary'} icon={on ? <BellRing size={16} /> : <Bell size={16} />} loading={toggle.isPending} onClick={() => toggle.mutate(!on)}>
      {on ? 'Напомним' : 'Напомнить'}
    </Button>
  );
}

/** Сцена премьеры вместо плеера: отсчёт до начала или синхронный показ. */
export function PremiereStage({ post, phase, left, elapsed, video }: { post: Post; phase: Exclude<PremierePhase, null>; left: number; elapsed: number; video: React.RefObject<HTMLVideoElement | null> }) {
  const m = post.media[0];
  const [drift, setDrift] = useState(0);
  // Видео открывается в момент премьеры — берём свежую публикацию со ссылкой на файл
  useEffect(() => {
    if (phase === 'live' && m && !m.url) void queryClient.invalidateQueries({ queryKey: qk.post(post.id) });
  }, [phase, m, post.id]);
  // Все смотрят с одного места: следим, не отстал ли зритель
  useEffect(() => {
    const el = video.current;
    if (phase !== 'live' || !el) return;
    setDrift(Math.abs(el.currentTime - elapsed / 1000));
  }, [elapsed, phase, video]);
  const sync = () => {
    const el = video.current;
    if (!el) return;
    el.currentTime = elapsed / 1000;
    void el.play().catch(() => undefined);
  };
  if (phase === 'before' || !m?.url) {
    return (
      <div className="player premiere-wait" style={m?.posterUrl ? { backgroundImage: `url("${m.posterUrl}")` } : undefined}>
        <div className="premiere-wait__inner">
          <span className="premiere-badge">
            <Clapperboard size={14} /> Премьера
          </span>
          <span className="premiere-wait__count" aria-live="polite">
            {phase === 'before' ? countdown(left) : 'Начинается…'}
          </span>
          <span className="small">{fullDate(post.premiereAt!)}</span>
          {phase === 'before' && <RemindButton post={post} />}
        </div>
      </div>
    );
  }
  return (
    <div className="player premiere-live">
      <video
        ref={video}
        src={m.url}
        poster={m.posterUrl ?? undefined}
        autoPlay
        playsInline
        controls
        onLoadedMetadata={(e) => {
          e.currentTarget.currentTime = elapsed / 1000;
        }}
      />
      <span className="premiere-badge premiere-badge--live">Премьера · идёт</span>
      {drift > 5 && (
        <button type="button" className="premiere-sync" onClick={sync}>
          К общему показу
        </button>
      )}
    </div>
  );
}

/** Чат премьеры: подключаемся к комнате, пока страница открыта. */
export function PremiereChat({ post }: { post: Post }) {
  const join = useQuery({
    queryKey: ['premiere-room', post.id],
    queryFn: () => api.post<{ watching: number; chat: LiveChatMessage[] }>(`/premieres/${post.id}/join`),
    staleTime: Infinity,
  });
  useEffect(() => () => void api.post(`/premieres/${post.id}/leave`).catch(() => undefined), [post.id]);
  if (!join.data) return null;
  return (
    <div className="col gap-2">
      <span className="xs muted row gap-1">
        <Users size={13} /> вместе с вами ждут и смотрят: {join.data.watching}
      </span>
      <LiveChat room={`premiere:${post.id}`} initial={join.data.chat} sendPath={`/premieres/${post.id}/chat`} title="Чат премьеры" />
    </div>
  );
}

function PremiereRow({ post }: { post: Post }) {
  const { phase, left } = usePremierePhase(post);
  const m = post.media[0];
  return (
    <div className="premiere-row">
      <Link to={`/watch/${post.id}`} className="premiere-row__thumb" style={m?.posterUrl ? { backgroundImage: `url("${m.posterUrl}")` } : undefined}>
        <span className={cn('premiere-badge', phase === 'live' && 'premiere-badge--live')}>{phase === 'live' ? 'Идёт сейчас' : countdown(left)}</span>
      </Link>
      <div className="premiere-row__info">
        <Link to={`/watch/${post.id}`} className="bold clamp-2" style={{ color: 'inherit' }}>
          {post.title}
        </Link>
        <span className="row gap-2 small muted">
          <Avatar src={post.author.avatarUrl} name={post.author.displayName} id={post.author.id} size={22} />
          {post.author.displayName}
        </span>
        <span className="xs muted row gap-1">
          <CalendarClock size={13} /> {fullDate(post.premiereAt!)}
        </span>
        {phase === 'before' && <RemindButton post={post} />}
      </div>
    </div>
  );
}

export function PremieresPage() {
  const q = useQuery({ queryKey: ['premieres'], queryFn: () => api.get<{ items: Post[] }>('/premieres') });
  const items = (q.data?.items ?? []).filter((p) => {
    const at = Date.parse(p.premiereAt!);
    return Date.now() < at + (p.media[0]?.durationSec ?? 0) * 1000;
  });
  return (
    <div className="scroll">
      <div className="page">
        <PageHeader title="Премьеры" icon={<Clapperboard size={22} />} subtitle="Новые видео, которые все смотрят одновременно — с общим чатом" />
        {q.isLoading ? (
          <Loading />
        ) : items.length === 0 ? (
          <EmptyState
            icon={<Clapperboard size={28} />}
            title="Ближайших премьер нет"
            text="Загрузите видео и включите «Премьера» — подписчики получат напоминание и посмотрят вместе"
          />
        ) : (
          <div className="col gap-3">
            {items.map((p) => (
              <PremiereRow key={p.id} post={p} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
