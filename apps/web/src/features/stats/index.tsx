/**
 * Статистика: рост подписчиков как курс на бирже, просмотры профиля,
 * каналы (подписчики, просмотры, лучшие посты), подписки и звонки.
 */
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { ChartSpline, Eye, Megaphone, MessageSquare, Phone, SmilePlus, UserMinus, UserPlus, Users } from 'lucide-react';
import type { ChannelStats, ChannelStatsDetails, ChatSummary, StatsOverview, UserSummary } from '@omni/shared';
import { api } from '../../shared/api/client';
import { flatPages, useCursorList } from '../../shared/api/query';
import { useMe } from '../../shared/stores/session';
import { useCrumb } from '../../shared/stores/ui';
import { cn, members as membersLabel, messageLabel, timeAgo } from '../../shared/lib/format';
import { Avatar, ButtonLink, EmptyState, ErrorState, ListSkeleton, Loading, LoadMore, PageHeader, Segmented, TabLinks, UserRow } from '../../shared/ui';
import { FollowButton } from '../feed';
import { AreaChart, ColumnChart, Delta, num, Sparkline } from './charts';
import './stats.css';

export { CallsPage } from '../calls/CallsPage';

type Range = '7' | '30' | '90';
const RANGES: { value: Range; label: string }[] = [
  { value: '7', label: '7 дней' },
  { value: '30', label: '30 дней' },
  { value: '90', label: '90 дней' },
];
const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);

/** Период один на всю страницу — все цифры ниже считаются за него. */
function useRange() {
  const [range, setRange] = useState<Range>('30');
  return { range, filter: <Segmented value={range} onChange={setRange} options={RANGES} /> };
}

function Tile({ icon, label, value, delta, trend }: { icon: React.ReactNode; label: string; value: string; delta?: React.ReactNode; trend?: number[] }) {
  return (
    <div className="stat-tile">
      <span className="stat-tile__label">
        {icon}
        {label}
      </span>
      <span className="stat-tile__row">
        <span className="stat-tile__value">{value}</span>
        {trend && <Sparkline values={trend} width={96} />}
      </span>
      {delta && <span className="stat-tile__foot">{delta}</span>}
    </div>
  );
}

function ChannelCard({ c }: { c: ChannelStats }) {
  return (
    <Link to={`/stats/channels/${c.chat.id}`} className="channel-stat">
      <Avatar src={c.chat.avatarUrl} name={c.chat.title} id={c.chat.id} size={44} />
      <span className="channel-stat__body">
        <b className="ellipsis">{c.chat.title}</b>
        <span className="xs muted">
          {num(sum(c.views))} просмотров · {c.posts} постов
        </span>
      </span>
      <span className="channel-stat__num">
        <b>{num(c.subscribers.at(-1) ?? 0)}</b>
        <Delta from={c.subscribers[0] ?? 0} to={c.subscribers.at(-1) ?? 0} />
      </span>
      <Sparkline values={c.subscribers} width={96} />
    </Link>
  );
}

const STATS_TABS = [
  { to: '/stats', label: 'Обзор', end: true },
  { to: '/stats/channels', label: 'Каналы' },
  { to: '/stats/subscriptions', label: 'Подписки' },
  { to: '/stats/calls', label: 'Звонки' },
];

export function StatsPage() {
  const { range, filter } = useRange();
  const q = useQuery({ queryKey: ['stats', range], queryFn: () => api.get<StatsOverview>(`/stats/overview?days=${range}`), placeholderData: (p) => p });
  const s = q.data;
  return (
    <div className="scroll">
      <div className="page page--wide">
        <PageHeader title="Статистика" icon={<ChartSpline size={22} />} />
        <TabLinks tabs={STATS_TABS} className="mb" />
        <div className="stats-filters">{filter}</div>
        {q.error ? (
          <ErrorState error={q.error} onRetry={() => void q.refetch()} />
        ) : !s ? (
          <Loading />
        ) : (
          <div className={cn('col gap-4', q.isFetching && 'stats--refetch')}>
            <section className="stats-hero">
              <div className="stats-hero__head">
                <span className="stats-hero__label">Подписчики</span>
                <span className="stats-hero__value">{num(s.followers.total)}</span>
                <Delta from={s.followers.series[0] ?? 0} to={s.followers.total} suffix={`за ${range} дн.`} />
              </div>
              <AreaChart days={s.days} values={s.followers.series} label="Подписчики" />
            </section>
            <div className="stat-tiles">
              <Tile icon={<UserPlus size={16} />} label="Новые подписчики" value={num(sum(s.followers.gained))} trend={s.followers.gained} />
              <Tile icon={<UserMinus size={16} />} label="Отписались" value={num(sum(s.followers.lost))} />
              <Tile
                icon={<Eye size={16} />}
                label="Просмотры профиля"
                value={num(s.profileViews.total)}
                delta={<Delta from={s.profileViews.previousTotal} to={s.profileViews.total} suffix="к прошлому периоду" />}
                trend={s.profileViews.series}
              />
              <Tile
                icon={<Phone size={16} />}
                label="Звонки"
                value={num(s.calls.total)}
                delta={
                  <span className="xs muted">
                    {num(s.calls.minutes)} мин разговоров{s.calls.missed ? ` · пропущено ${s.calls.missed}` : ''}
                  </span>
                }
              />
            </div>
            <section className="stats-card">
              <div className="stats-card__head">
                <h2>Новые и ушедшие подписчики</h2>
              </div>
              <ColumnChart
                days={s.days}
                series={[
                  { label: 'Подписались', values: s.followers.gained },
                  { label: 'Отписались', values: s.followers.lost },
                ]}
              />
            </section>
            <section className="stats-card">
              <div className="stats-card__head">
                <h2>Мои каналы</h2>
                <Link to="/stats/channels" className="small">
                  Все →
                </Link>
              </div>
              {s.channels.length ? (
                s.channels.slice(0, 5).map((c) => <ChannelCard key={c.chat.id} c={c} />)
              ) : (
                <EmptyState icon={<Megaphone size={26} />} title="У вас пока нет каналов" text="Создайте канал — здесь появится рост подписчиков и просмотры" action={<ButtonLink to="/channels/new">Создать канал</ButtonLink>} />
              )}
            </section>
          </div>
        )}
      </div>
    </div>
  );
}

export function ChannelsStatsPage() {
  const { range, filter } = useRange();
  const q = useQuery({ queryKey: ['stats', range], queryFn: () => api.get<StatsOverview>(`/stats/overview?days=${range}`), placeholderData: (p) => p });
  const items = q.data?.channels ?? [];
  return (
    <div className="scroll">
      <div className="page page--wide">
        <PageHeader title="Статистика каналов" icon={<Megaphone size={22} />} subtitle="Каналы, где вы владелец или администратор" />
        <TabLinks tabs={STATS_TABS} className="mb" />
        <div className="stats-filters">{filter}</div>
        {q.isLoading ? (
          <ListSkeleton rows={3} avatar={44} />
        ) : items.length === 0 ? (
          <EmptyState icon={<Megaphone size={28} />} title="Нет каналов" action={<ButtonLink to="/channels/new">Создать канал</ButtonLink>} />
        ) : (
          <section className="stats-card">
            {items.map((c) => (
              <ChannelCard key={c.chat.id} c={c} />
            ))}
          </section>
        )}
      </div>
    </div>
  );
}

export function ChannelStatsPage() {
  const { id = '' } = useParams();
  const { range, filter } = useRange();
  const q = useQuery({ queryKey: ['stats-channel', id, range], queryFn: () => api.get<ChannelStatsDetails>(`/stats/channels/${id}?days=${range}`), placeholderData: (p) => p });
  const c = q.data;
  useCrumb(c?.chat.title);
  if (q.error) return <ErrorState error={q.error} />;
  if (!c) return <Loading />;
  const subs = c.subscribers.at(-1) ?? 0;
  return (
    <div className="scroll">
      <div className="page page--wide">
        <PageHeader
          title={c.chat.title}
          icon={<Avatar src={c.chat.avatarUrl} name={c.chat.title} id={c.chat.id} size={44} />}
          subtitle={`${c.chat.handle ? `@${c.chat.handle} · ` : ''}${membersLabel(c.chat.memberCount, 'channel')}`}
          actions={
            <ButtonLink to={`/channels/${c.chat.id}`} variant="secondary" size="sm">
              Открыть канал
            </ButtonLink>
          }
        />
        <div className="stats-filters">{filter}</div>
        <div className={cn('col gap-4', q.isFetching && 'stats--refetch')}>
          <section className="stats-hero">
            <div className="stats-hero__head">
              <span className="stats-hero__label">Подписчики</span>
              <span className="stats-hero__value">{num(subs)}</span>
              <Delta from={c.subscribers[0] ?? 0} to={subs} suffix={`за ${range} дн.`} />
            </div>
            <AreaChart days={c.days} values={c.subscribers} label="Подписчики" />
          </section>
          <div className="stat-tiles">
            <Tile icon={<Eye size={16} />} label="Просмотры" value={num(sum(c.views))} trend={c.views} />
            <Tile icon={<UserPlus size={16} />} label="Подписались" value={num(sum(c.joins))} />
            <Tile icon={<UserMinus size={16} />} label="Отписались" value={num(sum(c.leaves))} />
            <Tile icon={<MessageSquare size={16} />} label="Постов" value={num(c.posts)} delta={<span className="xs muted">в среднем {c.posts ? num(sum(c.views) / c.posts) : 0} просмотров на пост</span>} />
          </div>
          <section className="stats-card">
            <div className="stats-card__head">
              <h2>Просмотры по дням</h2>
            </div>
            <ColumnChart days={c.days} series={[{ label: 'Просмотры', values: c.views }]} />
          </section>
          <section className="stats-card">
            <div className="stats-card__head">
              <h2>Подписки и отписки</h2>
            </div>
            <ColumnChart
              days={c.days}
              series={[
                { label: 'Подписались', values: c.joins },
                { label: 'Отписались', values: c.leaves },
              ]}
            />
          </section>
          <section className="stats-card">
            <div className="stats-card__head">
              <h2>Лучшие посты за период</h2>
            </div>
            {c.topPosts.length === 0 ? (
              <p className="small muted" style={{ padding: '0 16px 16px' }}>
                За этот период постов не было
              </p>
            ) : (
              <table className="top-posts">
                <thead>
                  <tr>
                    <th scope="col">Пост</th>
                    <th scope="col" title="Просмотры">
                      <Eye size={14} aria-label="Просмотры" />
                    </th>
                    <th scope="col" title="Реакции">
                      <SmilePlus size={14} aria-label="Реакции" />
                    </th>
                    <th scope="col" title="Комментарии">
                      <MessageSquare size={14} aria-label="Комментарии" />
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {c.topPosts.map((p) => (
                    <tr key={p.id}>
                      <td>
                        <Link to={`/channels/${c.chat.id}?post=${p.id}`} className="clamp-2">
                          {messageLabel(p.kind, p.text) || 'Пост'}
                        </Link>
                        <span className="xs faint">{timeAgo(p.createdAt)}</span>
                      </td>
                      <td>{num(p.viewCount)}</td>
                      <td>{num(p.reactions)}</td>
                      <td>{num(p.commentCount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

type SubTab = 'people' | 'channels' | 'followers';

export function SubscriptionsPage() {
  const me = useMe();
  const [tab, setTab] = useState<SubTab>('people');
  const people = useCursorList<UserSummary>(['follow-list', me.id, 'following'], `/users/${me.id}/following`, { enabled: tab === 'people' });
  const followers = useCursorList<UserSummary>(['follow-list', me.id, 'followers'], `/users/${me.id}/followers`, { enabled: tab === 'followers' });
  const channels = useCursorList<ChatSummary>(['chats', 'channels'], '/chats?folder=channels', { enabled: tab === 'channels' });
  const list = tab === 'people' ? people : tab === 'followers' ? followers : channels;
  return (
    <div className="scroll">
      <div className="page">
        <PageHeader title="Подписки" icon={<Users size={22} />} />
        <TabLinks tabs={STATS_TABS} className="mb" />
        <div className="stats-filters">
          <Segmented
            value={tab}
            onChange={setTab}
            options={[
              { value: 'people', label: 'Люди' },
              { value: 'channels', label: 'Каналы' },
              { value: 'followers', label: 'Подписчики' },
            ]}
          />
        </div>
        {list.isLoading ? (
          <ListSkeleton />
        ) : tab === 'channels' ? (
          flatPages(channels.data).length ? (
            <div className="card">
              {flatPages(channels.data).map((c) => (
                <Link key={c.id} to={`/channels/${c.id}`} className="list-item">
                  <Avatar src={c.avatarUrl} name={c.title} id={c.id} size={44} />
                  <span className="list-item__body">
                    <span className="list-item__title">{c.title}</span>
                    <span className="list-item__sub">{membersLabel(c.memberCount, 'channel')}</span>
                  </span>
                  {(c.role === 'owner' || c.role === 'admin') && <span className="chip">{c.role === 'owner' ? 'владелец' : 'админ'}</span>}
                </Link>
              ))}
            </div>
          ) : (
            <EmptyState icon={<Megaphone size={28} />} title="Нет подписок на каналы" action={<ButtonLink to="/channels/discover">Найти каналы</ButtonLink>} />
          )
        ) : flatPages((tab === 'people' ? people : followers).data).length ? (
          <div className="card">
            {flatPages((tab === 'people' ? people : followers).data).map((u) => (
              <UserRow key={u.id} user={u} action={tab === 'followers' ? <FollowButton user={u} /> : undefined} />
            ))}
          </div>
        ) : (
          <EmptyState icon={<Users size={28} />} title={tab === 'people' ? 'Вы ни на кого не подписаны' : 'Пока нет подписчиков'} action={<ButtonLink to="/search">Найти людей</ButtonLink>} />
        )}
        <LoadMore hasMore={!!list.hasNextPage} loading={list.isFetchingNextPage} onLoad={() => void list.fetchNextPage()} />
      </div>
    </div>
  );
}

