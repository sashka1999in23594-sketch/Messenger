/**
 * Карточки и общие элементы раздела «Видео»: карточка видео с превью при
 * наведении и меню «⋮», карточка эфира, полки, чипсы разделов, «Сохранить
 * в плейлист», кнопка подписки на канал, описание с таймкодами.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  Ban,
  Bell,
  BellOff,
  BellRing,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clapperboard,
  Clock,
  EllipsisVertical,
  Flag,
  Globe,
  ListPlus,
  ListVideo,
  Lock,
  Plus,
  Radio,
  Share2,
  Upload,
  UserMinus,
  Video,
} from 'lucide-react';
import type { LiveStream, Playlist, Post, UserProfile, UserSummary } from '@omni/shared';
import { api, errorMessage } from '../../shared/api/client';
import { qk, queryClient } from '../../shared/api/query';
import { useMe } from '../../shared/stores/session';
import { toast } from '../../shared/stores/ui';
import { cn, duration, fullDate, plural, timeAgo, views } from '../../shared/lib/format';
import {
  Avatar,
  Button,
  Menu,
  Modal,
  ReportDialog,
  RichText,
  Skeleton,
  useMenu,
  Verified,
  type MenuEntry,
} from '../../shared/ui';
import { shareLink, usePostActions } from '../posts/actions';
import {
  channelPath,
  countdown,
  premiereState,
  readPosition,
  setHidden,
  subscribersLabel,
  TIMESTAMP_RE,
  parseTime,
  useNow,
  viewersLabel,
  watchingLabel,
} from './lib';
import './video.css';

export { UploadVideoForm } from './upload';

// ─── Плашки на превью ───────────────────────────────────────────────────────

export function LiveBadge({ small, label = 'В эфире' }: { small?: boolean; label?: string }) {
  return (
    <span className={cn('vbadge vbadge--live', small && 'vbadge--sm')}>
      <span className="vbadge__dot" aria-hidden />
      {label}
    </span>
  );
}

function PremiereBadge({ post }: { post: Post }) {
  const now = useNow(1000);
  const state = premiereState(post, now);
  if (state === 'live') return <LiveBadge small label="Премьера" />;
  const left = Date.parse(post.premiereAt!) - now;
  return (
    <span className="vbadge vbadge--premiere">
      <Clapperboard size={12} /> Премьера{left < 7 * 86_400_000 ? ` · ${countdown(left)}` : ''}
    </span>
  );
}

// ─── Карточка видео ─────────────────────────────────────────────────────────

interface VideoCardProps {
  post: Post;
  /** Горизонтальная карточка: «Далее», история, плейлисты */
  row?: boolean;
  /** Ширина превью горизонтальной карточки */
  size?: 'sm' | 'lg';
  /** Сколько секунд уже просмотрено (история) */
  progressSec?: number;
  /** Ссылка вместо стандартной (например, с ?list= для плейлиста) */
  to?: string;
  /** Подсветка текущего видео в списке воспроизведения */
  current?: boolean;
  /** Дополнительные действия под текстом (кнопка «Напомнить») */
  footer?: ReactNode;
  /** Убрать «Не интересно» из меню (библиотека, студия) */
  noHide?: boolean;
}

export function VideoCard({
  post,
  row,
  size = 'sm',
  progressSec,
  to,
  current,
  footer,
  noHide,
}: VideoCardProps) {
  const m = post.media[0];
  const short = post.kind === 'short';
  const href = to ?? (short ? `/reels?start=${post.id}` : `/watch/${post.id}`);
  const title = post.title || post.text || 'Без названия';
  const premiere = premiereState(post);
  const [preview, setPreview] = useState(false);
  const [previewT, setPreviewT] = useState(0);
  const hoverTimer = useRef(0);
  const menu = useMenu();
  const [dialog, setDialog] = useState<null | 'save' | 'report'>(null);
  const watched = useMemo(
    () => progressSec ?? readPosition(post.id) ?? undefined,
    [progressSec, post.id],
  );
  const canPreview = !!m?.url && !short && premiere !== 'upcoming';

  useEffect(() => () => window.clearTimeout(hoverTimer.current), []);

  const meta =
    premiere === 'upcoming'
      ? `Премьера ${fullDate(post.premiereAt!)}`
      : premiere === 'live'
        ? 'Премьера идёт сейчас'
        : short
          ? views(post.stats.views)
          : `${views(post.stats.views)} · ${timeAgo(post.premiereAt ?? post.createdAt)}`;

  return (
    <article
      className={cn(
        'vcard',
        row && 'vcard--row',
        row && size === 'lg' && 'vcard--row-lg',
        short && !row && 'vcard--short',
        current && 'vcard--current',
      )}
      onPointerEnter={(e) => {
        if (e.pointerType !== 'mouse' || !canPreview) return;
        window.clearTimeout(hoverTimer.current);
        hoverTimer.current = window.setTimeout(() => setPreview(true), 650);
      }}
      onPointerLeave={() => {
        window.clearTimeout(hoverTimer.current);
        setPreview(false);
        setPreviewT(0);
      }}
    >
      <div className="vcard__media">
        <Link to={href} className="vcard__thumb" aria-label={title} draggable={false}>
          {m?.posterUrl ? (
            <img src={m.posterUrl} alt="" loading="lazy" decoding="async" draggable={false} />
          ) : (
            <span className="vcard__noposter">
              <Video size={28} />
            </span>
          )}
          {preview && m?.url && (
            <video
              className="vcard__preview"
              src={m.url}
              muted
              autoPlay
              playsInline
              loop
              onTimeUpdate={(e) => setPreviewT(e.currentTarget.currentTime)}
              onError={() => setPreview(false)}
            />
          )}
          {premiere ? (
            <span className="vcard__badges">
              <PremiereBadge post={post} />
            </span>
          ) : m?.durationSec ? (
            <span className="vbadge vbadge--dur">
              {preview
                ? `${duration(Math.max(0, m.durationSec - previewT))}`
                : duration(m.durationSec)}
            </span>
          ) : null}
          {watched !== undefined && m?.durationSec && !preview ? (
            <span className="vcard__watched">
              <span style={{ width: `${Math.min(100, (watched / m.durationSec) * 100)}%` }} />
            </span>
          ) : null}
          {preview && m?.durationSec ? (
            <span className="vcard__watched vcard__watched--preview">
              <span style={{ width: `${Math.min(100, (previewT / m.durationSec) * 100)}%` }} />
            </span>
          ) : null}
        </Link>
        {!short && premiere !== 'upcoming' && <WatchLaterQuick post={post} />}
      </div>
      <div className="vcard__body">
        {!row && !short && (
          <Link
            to={channelPath(post.author)}
            className="vcard__avatar"
            aria-label={post.author.displayName}
          >
            <Avatar
              src={post.author.avatarUrl}
              name={post.author.displayName}
              id={post.author.id}
              size={36}
            />
          </Link>
        )}
        <div className="vcard__text">
          <Link to={href} className="vcard__title" title={title}>
            {title}
          </Link>
          {!short && (
            <Link to={channelPath(post.author)} className="vcard__channel">
              <span className="ellipsis">{post.author.displayName}</span>
              {post.author.verified && <Verified size={13} />}
            </Link>
          )}
          <span className="vcard__meta">{meta}</span>
          {footer}
        </div>
        <button
          type="button"
          className="vcard__more"
          aria-label="Действия"
          onClick={(e) => menu.openFromEvent(e)}
        >
          <EllipsisVertical size={18} />
        </button>
      </div>
      {menu.anchor && (
        <CardMenu
          post={post}
          anchor={menu.anchor}
          onClose={menu.close}
          onDialog={setDialog}
          noHide={noHide}
        />
      )}
      {dialog === 'save' && <SaveDialog post={post} onClose={() => setDialog(null)} />}
      <ReportDialog
        open={dialog === 'report'}
        onClose={() => setDialog(null)}
        entityType="post"
        entityId={post.id}
      />
    </article>
  );
}

/** «Смотреть позже» прямо на превью — появляется при наведении. */
function WatchLaterQuick({ post }: { post: Post }) {
  const { watchLater } = usePostActions(post);
  const on = post.viewer.watchLater;
  return (
    <button
      type="button"
      className={cn('vcard__quick', on && 'vcard__quick--on')}
      aria-label={on ? 'Убрать из «Смотреть позже»' : 'Смотреть позже'}
      data-tip={on ? 'Добавлено' : 'Смотреть позже'}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        watchLater.mutate(!on, {
          onSuccess: () =>
            toast(on ? 'Убрано из «Смотреть позже»' : 'Добавлено в «Смотреть позже»'),
        });
      }}
    >
      {on ? <Check size={18} /> : <Clock size={18} />}
    </button>
  );
}

function CardMenu({
  post,
  anchor,
  onClose,
  onDialog,
  noHide,
}: {
  post: Post;
  anchor: { x: number; y: number };
  onClose: () => void;
  onDialog: (d: 'save' | 'report') => void;
  noHide?: boolean;
}) {
  const { watchLater } = usePostActions(post);
  const me = useMe();
  const short = post.kind === 'short';
  const items: MenuEntry[] = [
    {
      label: post.viewer.watchLater ? 'Убрать из «Смотреть позже»' : 'Смотреть позже',
      icon: <Clock size={18} />,
      hidden: short,
      onClick: () =>
        watchLater.mutate(!post.viewer.watchLater, {
          onSuccess: () =>
            toast(
              post.viewer.watchLater
                ? 'Убрано из «Смотреть позже»'
                : 'Добавлено в «Смотреть позже»',
            ),
        }),
    },
    {
      label: 'Сохранить в плейлист',
      icon: <ListPlus size={18} />,
      hidden: short,
      onClick: () => onDialog('save'),
    },
    {
      label: 'Поделиться',
      icon: <Share2 size={18} />,
      onClick: () => shareLink(short ? `/reels?start=${post.id}` : `/watch/${post.id}`),
    },
    'separator',
    {
      label: 'Не интересно',
      icon: <Ban size={18} />,
      hidden: noHide || post.author.id === me.id,
      onClick: () => {
        setHidden(post.id, true);
        toast({
          text: 'Видео скрыто. Будем показывать меньше похожего',
          action: { label: 'Отменить', onClick: () => setHidden(post.id, false) },
        });
      },
    },
    {
      label: 'Пожаловаться',
      icon: <Flag size={18} />,
      hidden: post.author.id === me.id,
      onClick: () => onDialog('report'),
    },
  ];
  return <Menu anchor={anchor} items={items} onClose={onClose} />;
}

/** Заглушка карточки при загрузке. */
export function VideoCardSkeleton({ row }: { row?: boolean }) {
  return (
    <div className={cn('vcard vcard--skeleton', row && 'vcard--row')} aria-hidden>
      <div className="vcard__thumb">
        <Skeleton width="100%" height="100%" radius={0} />
      </div>
      <div className="vcard__body">
        {!row && <Skeleton width={36} height={36} radius={18} />}
        <div className="vcard__text" style={{ gap: 8 }}>
          <Skeleton width="92%" height={14} />
          <Skeleton width="60%" height={12} />
        </div>
      </div>
    </div>
  );
}

// ─── Эфиры ──────────────────────────────────────────────────────────────────

export function LiveCard({ s }: { s: LiveStream }) {
  const live = s.status === 'live';
  const to = live
    ? `/live/${s.id}`
    : s.recordingPostId
      ? `/watch/${s.recordingPostId}`
      : `/live/${s.id}`;
  return (
    <article className="vcard vcard--stream">
      <Link to={to} className="vcard__thumb vcard__thumb--stream" aria-label={s.title}>
        {s.owner.avatarUrl && (
          <span
            className="vcard__stream-bg"
            style={{ backgroundImage: `url("${s.owner.avatarUrl}")` }}
            aria-hidden
          />
        )}
        <span className={cn('vcard__stream-avatar', live && 'vcard__stream-avatar--live')}>
          <Avatar src={s.owner.avatarUrl} name={s.owner.displayName} id={s.owner.id} size={64} />
        </span>
        {live ? (
          <span className="vcard__badges">
            <LiveBadge small />
          </span>
        ) : (
          <span className="vbadge vbadge--dur">{s.recordingPostId ? 'Запись' : 'Завершён'}</span>
        )}
      </Link>
      <div className="vcard__body">
        <Link to={channelPath(s.owner)} className="vcard__avatar" aria-label={s.owner.displayName}>
          <Avatar src={s.owner.avatarUrl} name={s.owner.displayName} id={s.owner.id} size={36} />
        </Link>
        <div className="vcard__text">
          <Link to={to} className="vcard__title">
            {s.title}
          </Link>
          <Link to={channelPath(s.owner)} className="vcard__channel">
            <span className="ellipsis">{s.owner.displayName}</span>
            {s.owner.verified && <Verified size={13} />}
          </Link>
          <span className="vcard__meta">
            {live ? (
              <>
                <b className="vcard__live-count">{watchingLabel(s.viewers)}</b> · начат{' '}
                {timeAgo(s.startedAt)}
              </>
            ) : (
              `Трансляция ${timeAgo(s.startedAt)} · ${viewersLabel(s.totalViewers || s.peakViewers)}`
            )}
          </span>
        </div>
      </div>
    </article>
  );
}

// ─── Полка с горизонтальной прокруткой ──────────────────────────────────────

export function Shelf({
  title,
  icon,
  more,
  children,
  className,
}: {
  title: ReactNode;
  icon?: ReactNode;
  more?: { to: string; label?: string };
  children: ReactNode;
  className?: string;
}) {
  const row = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ start: true, end: false });
  const update = () => {
    const el = row.current;
    if (!el) return;
    setEdges({
      start: el.scrollLeft < 8,
      end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 8,
    });
  };
  useEffect(update, [children]);
  const scroll = (dir: 1 | -1) =>
    row.current?.scrollBy({ left: dir * row.current.clientWidth * 0.85, behavior: 'smooth' });
  return (
    <section className={cn('vshelf', className)}>
      <header className="vshelf__head">
        <h2 className="vshelf__title">
          {icon}
          {title}
        </h2>
        {more && (
          <Link to={more.to} className="vshelf__more">
            {more.label ?? 'Все'}
          </Link>
        )}
      </header>
      <div className="vshelf__wrap">
        {!edges.start && (
          <button
            type="button"
            className="vshelf__arrow vshelf__arrow--l"
            onClick={() => scroll(-1)}
            aria-label="Назад"
          >
            <ChevronLeft size={20} />
          </button>
        )}
        <div className="vshelf__row" ref={row} onScroll={update}>
          {children}
        </div>
        {!edges.end && (
          <button
            type="button"
            className="vshelf__arrow vshelf__arrow--r"
            onClick={() => scroll(1)}
            aria-label="Дальше"
          >
            <ChevronRight size={20} />
          </button>
        )}
      </div>
    </section>
  );
}

// ─── Чипсы разделов (как у видеохостингов) ──────────────────────────────────

export type ChipId = 'all' | 'subscriptions' | 'live' | 'premieres' | 'trending' | `tag:${string}`;

export function useLiveList() {
  return useQuery({
    queryKey: ['live-list'],
    queryFn: () => api.get<{ live: LiveStream[]; recent: LiveStream[] }>('/live'),
    refetchInterval: 30_000,
  });
}

export function VideoChips({ active }: { active: ChipId }) {
  const tags = useQuery({
    queryKey: ['trends', 30],
    queryFn: () => api.get<{ items: { tag: string }[] }>('/hashtags/trending?days=30'),
    staleTime: 5 * 60_000,
  });
  const live = useLiveList();
  const liveNow = live.data?.live.length ?? 0;
  const chips: { id: ChipId; label: ReactNode; to: string }[] = [
    { id: 'all', label: 'Все', to: '/video' },
    { id: 'subscriptions', label: 'Подписки', to: '/video/subscriptions' },
    {
      id: 'live',
      label: (
        <>
          {liveNow > 0 && <span className="vchip__live" aria-hidden />}В эфире
          {liveNow ? ` · ${liveNow}` : ''}
        </>
      ),
      to: '/live',
    },
    { id: 'premieres', label: 'Премьеры', to: '/premieres' },
    { id: 'trending', label: 'В тренде', to: '/video/trending' },
    ...(tags.data?.items ?? [])
      .slice(0, 10)
      .map((t) => ({
        id: `tag:${t.tag}` as ChipId,
        label: t.tag,
        to: `/video?tag=${encodeURIComponent(t.tag)}`,
      })),
  ];
  return (
    <nav className="vchips" aria-label="Подборки видео">
      {chips.map((c) => (
        <Link
          key={c.id}
          to={c.to}
          className={cn('vchip', active === c.id && 'vchip--on')}
          aria-current={active === c.id ? 'page' : undefined}
        >
          {c.label}
        </Link>
      ))}
    </nav>
  );
}

/** «Создать»: загрузить видео, начать эфир, назначить премьеру, снять Reels. */
export function CreateButton({ compact }: { compact?: boolean }) {
  const menu = useMenu();
  const navigate = useNavigate();
  return (
    <>
      <button
        type="button"
        className={cn('vcreate', compact && 'vcreate--icon')}
        onClick={(e) => menu.openFromEvent(e)}
        aria-label="Создать"
      >
        <Plus size={20} />
        {!compact && <span>Создать</span>}
      </button>
      <Menu
        anchor={menu.anchor}
        onClose={menu.close}
        items={[
          {
            label: 'Загрузить видео',
            icon: <Upload size={18} />,
            onClick: () => navigate('/video/upload'),
          },
          {
            label: 'Начать трансляцию',
            icon: <Radio size={18} />,
            onClick: () => navigate('/live/new'),
          },
          {
            label: 'Назначить премьеру',
            icon: <Clapperboard size={18} />,
            onClick: () => navigate('/video/upload?premiere=1'),
          },
          {
            label: 'Снять Reels',
            icon: <Video size={18} />,
            onClick: () => navigate('/reels/new'),
          },
        ]}
      />
    </>
  );
}

// ─── Сохранить в плейлист ───────────────────────────────────────────────────

export function SaveDialog({ post, onClose }: { post: Post; onClose: () => void }) {
  const lists = useQuery({
    queryKey: ['playlists'],
    queryFn: () => api.get<{ items: Playlist[] }>('/me/playlists'),
  });
  const { watchLater } = usePostActions(post);
  const [added, setAdded] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState('');
  const [isPublic, setPublic] = useState(false);
  const add = useMutation({
    mutationFn: (id: string) => api.post(`/playlists/${id}/items`, { postId: post.id }),
    onSuccess: (_d, id) => {
      setAdded((s) => new Set(s).add(id));
      const p = lists.data?.items.find((x) => x.id === id);
      toast({ text: `Сохранено в «${p?.title ?? 'плейлист'}»`, kind: 'success' });
      void queryClient.invalidateQueries({ queryKey: ['playlists'] });
    },
    onError: (e) => toast({ text: errorMessage(e), kind: 'error' }),
  });
  const create = useMutation({
    mutationFn: () => api.post<Playlist>('/playlists', { title: title.trim(), isPublic }),
    onSuccess: (p) => {
      setTitle('');
      setCreating(false);
      add.mutate(p.id);
    },
    onError: (e) => toast({ text: errorMessage(e), kind: 'error' }),
  });
  return (
    <Modal open onClose={onClose} title="Сохранить в…" className="vsave">
      <div className="vsave__list">
        <button
          type="button"
          className="vsave__item"
          onClick={() => watchLater.mutate(!post.viewer.watchLater)}
          aria-pressed={post.viewer.watchLater}
        >
          <span className={cn('vsave__check', post.viewer.watchLater && 'vsave__check--on')}>
            {post.viewer.watchLater && <Check size={14} strokeWidth={3} />}
          </span>
          <span className="vsave__name">Смотреть позже</span>
          <Lock size={15} className="vsave__icon" />
        </button>
        {lists.data?.items.map((p) => {
          const on = added.has(p.id);
          return (
            <button
              key={p.id}
              type="button"
              className="vsave__item"
              disabled={on || add.isPending}
              onClick={() => add.mutate(p.id)}
              aria-pressed={on}
            >
              <span className={cn('vsave__check', on && 'vsave__check--on')}>
                {on && <Check size={14} strokeWidth={3} />}
              </span>
              <span className="vsave__name">
                {p.title}
                <span className="vsave__sub">
                  {p.itemCount} {plural(p.itemCount, 'видео', 'видео', 'видео')}
                </span>
              </span>
              {p.isPublic ? (
                <Globe size={15} className="vsave__icon" />
              ) : (
                <Lock size={15} className="vsave__icon" />
              )}
            </button>
          );
        })}
      </div>
      {creating ? (
        <form
          className="vsave__form"
          onSubmit={(e) => {
            e.preventDefault();
            if (title.trim()) create.mutate();
          }}
        >
          <label className="field">
            <span className="field__label">Название</span>
            <input
              className="input"
              autoFocus
              value={title}
              maxLength={100}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Например, «Посмотреть на выходных»"
            />
          </label>
          <div className="vseg" role="radiogroup" aria-label="Доступ">
            <button
              type="button"
              role="radio"
              aria-checked={!isPublic}
              className={cn('vseg__opt', !isPublic && 'vseg__opt--on')}
              onClick={() => setPublic(false)}
            >
              <Lock size={15} /> Личный
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={isPublic}
              className={cn('vseg__opt', isPublic && 'vseg__opt--on')}
              onClick={() => setPublic(true)}
            >
              <Globe size={15} /> Открытый
            </button>
          </div>
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <Button variant="ghost" onClick={() => setCreating(false)}>
              Отмена
            </Button>
            <Button type="submit" disabled={!title.trim()} loading={create.isPending}>
              Создать
            </Button>
          </div>
        </form>
      ) : (
        <button type="button" className="vsave__new" onClick={() => setCreating(true)}>
          <Plus size={20} /> Новый плейлист
        </button>
      )}
    </Modal>
  );
}

// ─── Подписка на канал ──────────────────────────────────────────────────────

/** Профиль автора: число подписчиков и состояние подписки. */
export function useChannel(user: Pick<UserSummary, 'username'> | null | undefined) {
  return useQuery({
    queryKey: qk.user(user?.username ?? ''),
    queryFn: () => api.get<UserProfile>(`/users/${user!.username}`),
    enabled: !!user,
  });
}

function patchChannel(username: string, fn: (p: UserProfile) => UserProfile) {
  queryClient.setQueryData<UserProfile>(qk.user(username), (old) => (old ? fn(old) : old));
}

/** «Подписаться» → «Вы подписаны 🔔» с выбором уведомлений, как у видеохостингов. */
export function SubscribeButton({
  user,
  profile,
}: {
  user: UserSummary;
  profile: UserProfile | undefined;
}) {
  const me = useMe();
  const navigate = useNavigate();
  const menu = useMenu();
  const follow = useMutation({
    mutationFn: async (on: boolean): Promise<{ status: 'accepted' | 'pending' | 'none' }> =>
      on
        ? api.post<{ status: 'accepted' | 'pending' }>(`/users/${user.id}/follow`)
        : api.del(`/users/${user.id}/follow`).then(() => ({ status: 'none' as const })),
    onSuccess: (r, on) => {
      patchChannel(user.username, (p) => ({
        ...p,
        stats: {
          ...p.stats,
          followers: Math.max(
            0,
            p.stats.followers +
              (on && r.status === 'accepted' ? 1 : !on && p.relationship?.following ? -1 : 0),
          ),
        },
        relationship: p.relationship
          ? {
              ...p.relationship,
              following: on && r.status === 'accepted',
              requested: on && r.status === 'pending',
            }
          : p.relationship,
        subscribed: on ? p.subscribed : false,
      }));
      toast(
        on
          ? r.status === 'pending'
            ? 'Заявка на подписку отправлена'
            : 'Подписка оформлена'
          : 'Подписка отменена',
      );
      void queryClient.invalidateQueries({ queryKey: ['feed', 'following'] });
    },
    onError: (e) => toast({ text: errorMessage(e), kind: 'error' }),
  });
  const bell = useMutation({
    mutationFn: (on: boolean) =>
      on ? api.post(`/users/${user.id}/subscribe`) : api.del(`/users/${user.id}/subscribe`),
    onSuccess: (_d, on) => {
      patchChannel(user.username, (p) => ({ ...p, subscribed: on }));
      toast(on ? 'Будем присылать уведомления о новых видео и эфирах' : 'Уведомления отключены');
    },
    onError: (e) => toast({ text: errorMessage(e), kind: 'error' }),
  });

  if (user.id === me.id)
    return (
      <button
        type="button"
        className="vsub vsub--ghost"
        onClick={() => navigate('/video/studio/content')}
      >
        Управление видео
      </button>
    );
  const rel = profile?.relationship;
  if (!profile || !rel) return <span className="vsub vsub--ghost vsub--loading" aria-hidden />;
  if (rel.blocked || rel.blockedBy) return null;
  if (rel.requested)
    return (
      <button
        type="button"
        className="vsub vsub--ghost"
        onClick={() => follow.mutate(false)}
        disabled={follow.isPending}
      >
        Заявка отправлена
      </button>
    );
  if (!rel.following)
    return (
      <button
        type="button"
        className="vsub"
        onClick={() => follow.mutate(true)}
        disabled={follow.isPending}
      >
        Подписаться
      </button>
    );
  return (
    <>
      <button
        type="button"
        className="vsub vsub--ghost"
        onClick={(e) => menu.openFromEvent(e)}
        aria-haspopup="menu"
      >
        {profile.subscribed ? <BellRing size={18} /> : <Bell size={18} />}
        Вы подписаны
        <ChevronDown size={16} />
      </button>
      <Menu
        anchor={menu.anchor}
        onClose={menu.close}
        items={[
          {
            label: profile.subscribed ? '✓ Все уведомления' : 'Все уведомления',
            icon: <BellRing size={18} />,
            onClick: () => !profile.subscribed && bell.mutate(true),
          },
          {
            label: !profile.subscribed ? '✓ Без уведомлений' : 'Без уведомлений',
            icon: <BellOff size={18} />,
            onClick: () => profile.subscribed && bell.mutate(false),
          },
          'separator',
          {
            label: 'Отменить подписку',
            icon: <UserMinus size={18} />,
            danger: true,
            onClick: () => follow.mutate(false),
          },
        ]}
      />
    </>
  );
}

/** Строка канала: аватар, имя с галочкой, подписчики. */
export function ChannelLine({
  user,
  profile,
  size = 40,
  sub,
}: {
  user: UserSummary;
  profile?: UserProfile;
  size?: number;
  sub?: ReactNode;
}) {
  return (
    <Link to={channelPath(user)} className="vchan">
      <Avatar src={user.avatarUrl} name={user.displayName} id={user.id} size={size} />
      <span className="vchan__text">
        <span className="vchan__name">
          <span className="ellipsis">{user.displayName}</span>
          {user.verified && <Verified size={14} />}
        </span>
        <span className="vchan__sub">
          {sub ?? (profile ? subscribersLabel(profile.stats.followers) : ' ')}
        </span>
      </span>
    </Link>
  );
}

// ─── Описание с кликабельными таймкодами ────────────────────────────────────

export function DescriptionText({
  text,
  onSeek,
  max,
}: {
  text: string;
  onSeek?: (sec: number) => void;
  max?: number;
}) {
  const parts: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(TIMESTAMP_RE)) {
    const sec = parseTime(m[0]);
    if (!onSeek || sec === null || (max && sec > max)) continue;
    if (m.index! > last) parts.push(<RichText key={`t${last}`} text={text.slice(last, m.index)} />);
    parts.push(
      <button key={`s${m.index}`} type="button" className="vdesc__ts" onClick={() => onSeek(sec)}>
        {m[0]}
      </button>,
    );
    last = m.index! + m[0].length;
  }
  if (last < text.length) parts.push(<RichText key={`t${last}`} text={text.slice(last)} />);
  return <span className="vdesc__text">{parts}</span>;
}
