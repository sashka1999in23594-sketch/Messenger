/** История звонков: по дням, все и пропущенные, перезвонить в один тап. */
import { Link, useNavigate } from 'react-router';
import { MessageCircle, Phone, PhoneIncoming, PhoneMissed, PhoneOutgoing, Video } from 'lucide-react';
import type { CallInfo } from '@omni/shared';
import { flatPages, useCursorList } from '../../shared/api/query';
import { fmtDuration, startCall } from '../../shared/calls/engine';
import { useMe } from '../../shared/stores/session';
import { clockTime, cn, dayLabel, fullDate } from '../../shared/lib/format';
import { Avatar, EmptyState, ListSkeleton, LoadMore, PageHeader, TabLinks } from '../../shared/ui';
import './calls.css';

function statusText(c: CallInfo, outgoing: boolean): string {
  switch (c.status) {
    case 'ended':
      return fmtDuration(c.durationSec);
    case 'declined':
      return outgoing ? 'Отклонён' : 'Вы отклонили';
    case 'busy':
      return 'Занято';
    case 'failed':
      return 'Связь прервалась';
    case 'active':
      return 'Идёт разговор';
    case 'ringing':
      return 'Вызов…';
    default:
      return outgoing ? 'Нет ответа' : 'Пропущенный';
  }
}

function CallRow({ c, myId }: { c: CallInfo; myId: string }) {
  const navigate = useNavigate();
  const outgoing = c.caller.id === myId;
  const peer = outgoing ? c.callee : c.caller;
  const missed = !outgoing && (c.status === 'missed' || c.status === 'cancelled');
  const Icon = missed ? PhoneMissed : outgoing ? PhoneOutgoing : PhoneIncoming;
  return (
    <div className={cn('list-item', missed && 'call-row--missed')}>
      <Avatar src={peer.avatarUrl} name={peer.displayName} id={peer.id} size={46} />
      <span className="list-item__body">
        <span className="list-item__title ellipsis">{peer.displayName}</span>
        <span className="list-item__sub row" style={{ gap: 6 }}>
          <span className="call-row__icon">
            <Icon size={14} />
          </span>
          <span title={fullDate(c.createdAt)}>
            {clockTime(c.createdAt)} · {c.video ? 'видео' : 'аудио'} · {statusText(c, outgoing)}
          </span>
        </span>
      </span>
      <span className="call-row__actions">
        <button type="button" className="icon-btn" onClick={() => navigate(`/chats/${c.chatId}`)} aria-label="Открыть чат" title="Открыть чат">
          <MessageCircle size={20} />
        </button>
        <button type="button" className="icon-btn" onClick={() => void startCall(c.chatId, false)} aria-label="Аудиозвонок" title="Аудиозвонок">
          <Phone size={20} />
        </button>
        <button type="button" className="icon-btn" onClick={() => void startCall(c.chatId, true)} aria-label="Видеозвонок" title="Видеозвонок">
          <Video size={20} />
        </button>
      </span>
    </div>
  );
}

/** Сводка за 30 дней: сколько разговоров, минут и пропущенных. */
function CallsSummary({ items, myId }: { items: CallInfo[]; myId: string }) {
  const since = Date.now() - 30 * 86400_000;
  const recent = items.filter((c) => Date.parse(c.createdAt) >= since);
  const minutes = Math.round(recent.reduce((a, c) => a + (c.status === 'ended' ? c.durationSec : 0), 0) / 60);
  const missed = recent.filter((c) => c.caller.id !== myId && (c.status === 'missed' || c.status === 'cancelled')).length;
  const video = recent.filter((c) => c.video).length;
  return (
    <div className="calls-summary">
      <span>
        <b>{recent.length}</b> звонков за 30 дней
      </span>
      <span>
        <b>{minutes}</b> мин разговоров
      </span>
      <span>
        <b>{video}</b> видео
      </span>
      <span className={missed ? 'calls-summary--missed' : undefined}>
        <b>{missed}</b> пропущено
      </span>
    </div>
  );
}

export function CallsPage({ filter }: { filter: 'all' | 'missed' }) {
  const me = useMe();
  const list = useCursorList<CallInfo>(['calls', filter], `/calls${filter === 'missed' ? '?filter=missed' : ''}`);
  const items = flatPages(list.data);
  // Группы по дням: «Сегодня», «Вчера», дата
  const groups: { day: string; items: CallInfo[] }[] = [];
  for (const c of items) {
    const day = dayLabel(c.createdAt);
    if (groups.at(-1)?.day === day) groups.at(-1)!.items.push(c);
    else groups.push({ day, items: [c] });
  }
  return (
    <div className="scroll">
      <div className="page">
        <PageHeader title="Звонки" subtitle="Аудио и видео со сквозным шифрованием" icon={<Phone size={22} />} />
        <TabLinks
          className="mb"
          tabs={[
            { to: '/stats', label: 'Обзор', end: true },
            { to: '/stats/channels', label: 'Каналы' },
            { to: '/stats/subscriptions', label: 'Подписки' },
            { to: '/stats/calls', label: 'Звонки' },
          ]}
        />
        <div className="row gap-2 wrap" style={{ margin: '16px 0 12px' }}>
          <Link to="/stats/calls" className={cn('chip', filter === 'all' && 'chip--active')}>
            Все
          </Link>
          <Link to="/stats/calls/missed" className={cn('chip', filter === 'missed' && 'chip--active')}>
            <PhoneMissed size={14} /> Пропущенные
          </Link>
        </div>
        {filter === 'all' && items.length > 0 && <CallsSummary items={items} myId={me.id} />}
        {list.isLoading ? (
          <ListSkeleton />
        ) : items.length === 0 ? (
          <EmptyState
            icon={filter === 'missed' ? <PhoneMissed size={28} /> : <Phone size={28} />}
            title={filter === 'missed' ? 'Пропущенных нет' : 'Звонков пока не было'}
            text="Позвонить можно из любого личного чата — кнопки в шапке переписки"
          />
        ) : (
          groups.map((g) => (
            <section key={g.day} className="calls-day">
              <h2 className="calls-day__title">{g.day}</h2>
              <div className="card" style={{ overflow: 'hidden' }}>
                {g.items.map((c) => (
                  <CallRow key={c.id} c={c} myId={me.id} />
                ))}
              </div>
            </section>
          ))
        )}
        <LoadMore hasMore={!!list.hasNextPage} loading={list.isFetchingNextPage} onLoad={() => void list.fetchNextPage()} />
      </div>
    </div>
  );
}
