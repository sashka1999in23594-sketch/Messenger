/**
 * Звонки: история (личные и групповые вперемешку, по дням), пропущенные,
 * перезвонить в один тап и «+» — новый звонок до 50 человек.
 */
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Phone, PhoneCall, PhoneIncoming, PhoneMissed, PhoneOutgoing, Plus, Users, Video } from 'lucide-react';
import type { CallInfo, CallRoom } from '@omni/shared';
import { api } from '../../shared/api/client';
import { flatPages, useCursorList } from '../../shared/api/query';
import { fmtDuration } from '../../shared/calls/engine';
import { callChat, createRoom, joinRoom, useRoom } from '../../shared/calls/room';
import { useMe } from '../../shared/stores/session';
import { clockTime, cn, dayLabel, fullDate } from '../../shared/lib/format';
import { Avatar, EmptyState, ListSkeleton, LoadMore, PageHeader, TabLinks } from '../../shared/ui';
import { PeoplePicker, type Picked } from './PeoplePicker';
import './calls.css';
import './room.css';

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
    <div className={cn('list-item call-row', missed && 'call-row--missed')}>
      <button type="button" className="call-row__main" onClick={() => navigate(`/chats/${c.chatId}`)} title="Открыть чат">
        <Avatar src={peer.avatarUrl} name={peer.displayName} id={peer.id} size={46} />
        <span className="list-item__body">
          <span className="list-item__title ellipsis" style={{ display: 'block' }}>
            {peer.displayName}
          </span>
          <span className="list-item__sub call-row__sub" title={fullDate(c.createdAt)}>
            <Icon size={14} className="call-row__icon" />
            <span className="ellipsis">
              {c.video ? 'Видео' : 'Аудио'} · {statusText(c, outgoing)}
            </span>
          </span>
        </span>
        <span className="call-row__time">{clockTime(c.createdAt)}</span>
      </button>
      <span className="call-row__actions">
        <button type="button" className="icon-btn" onClick={() => void callChat({ id: c.chatId, peer }, false)} aria-label="Аудиозвонок" title="Аудиозвонок">
          <Phone size={20} />
        </button>
        <button type="button" className="icon-btn" onClick={() => void callChat({ id: c.chatId, peer }, true)} aria-label="Видеозвонок" title="Видеозвонок">
          <Video size={20} />
        </button>
      </span>
    </div>
  );
}

/** Групповой звонок в истории: лица участников, сколько было и сколько длился. */
function RoomRow({ r, myId }: { r: CallRoom; myId: string }) {
  const others = r.members.filter((m) => m.user.id !== myId);
  const mine = r.members.find((m) => m.user.id === myId);
  const missed = mine?.state === 'invited' || (mine?.state !== 'joined' && !mine?.joinedAt && r.owner.id !== myId);
  const live = r.status === 'active';
  const names = others
    .slice(0, 3)
    .map((m) => m.user.displayName.split(' ')[0])
    .join(', ');
  const again = () =>
    void createRoom({
      userIds: others.map((m) => m.user.id),
      usernames: [],
      video: r.video,
      title: r.title ?? undefined,
    });
  return (
    <div className={cn('list-item call-row', missed && !live && 'call-row--missed')}>
      <span className="call-row__main">
        <span className="call-faces" aria-hidden>
          {others.slice(0, 2).map((m) => (
            <Avatar key={m.user.id} src={m.user.avatarUrl} name={m.user.displayName} id={m.user.id} size={32} />
          ))}
        </span>
        <span className="list-item__body">
          <span className="list-item__title ellipsis" style={{ display: 'block' }}>
            {r.title || names || 'Групповой звонок'}
            {others.length > 3 && !r.title ? ` и ещё ${others.length - 3}` : ''}
          </span>
          <span className="list-item__sub call-row__sub" title={fullDate(r.createdAt)}>
            <Users size={14} className="call-row__icon" />
            <span className="ellipsis">
              {live ? 'Идёт сейчас' : missed ? 'Пропущенный групповой' : `Групповой · ${fmtDuration(r.durationSec)}`} · {r.members.length} чел.
            </span>
          </span>
        </span>
        <span className="call-row__time">{clockTime(r.createdAt)}</span>
      </span>
      <span className="call-row__actions">
        {live ? (
          <button type="button" className="btn btn--primary btn--sm" onClick={() => void joinRoom(r.id, r.video)}>
            Войти
          </button>
        ) : (
          <button type="button" className="icon-btn" onClick={again} aria-label="Позвонить снова" title="Позвонить снова">
            <PhoneCall size={20} />
          </button>
        )}
      </span>
    </div>
  );
}

type Entry = { kind: 'call'; at: string; c: CallInfo } | { kind: 'room'; at: string; r: CallRoom };

export function CallsPage({ filter }: { filter: 'all' | 'missed' }) {
  const me = useMe();
  const list = useCursorList<CallInfo>(['calls', filter], `/calls${filter === 'missed' ? '?filter=missed' : ''}`);
  // Групповые — последние 50, вместе с личными по времени
  const rooms = useQuery({ queryKey: ['call-rooms'], queryFn: () => api.get<{ items: CallRoom[] }>('/calls/rooms?limit=50'), refetchInterval: 20_000 });
  const calls = flatPages(list.data);
  const roomItems = (rooms.data?.items ?? []).filter((r) => {
    if (filter !== 'missed') return true;
    const mine = r.members.find((m) => m.user.id === me.id);
    return r.status === 'ended' && !mine?.joinedAt;
  });
  const oldestCall = list.hasNextPage ? calls.at(-1)?.createdAt : undefined;
  const entries: Entry[] = [
    ...calls.map((c) => ({ kind: 'call' as const, at: c.createdAt, c })),
    // Пока личные звонки не догружены, групповые старше них не показываем — иначе порядок «прыгает»
    ...roomItems.filter((r) => !oldestCall || r.createdAt >= oldestCall).map((r) => ({ kind: 'room' as const, at: r.createdAt, r })),
  ].sort((a, b) => b.at.localeCompare(a.at));
  const groups: { day: string; items: Entry[] }[] = [];
  for (const e of entries) {
    const day = dayLabel(e.at);
    if (groups.at(-1)?.day === day) groups.at(-1)!.items.push(e);
    else groups.push({ day, items: [e] });
  }
  return (
    <div className="scroll calls-page">
      <div className="page">
        <PageHeader
          title="Звонки"
          subtitle="Личные и групповые — до 50 человек"
          icon={<Phone size={22} />}
          actions={
            <Link to="/calls/new" className="btn btn--primary">
              <Plus size={18} /> Новый звонок
            </Link>
          }
        />
        <TabLinks
          className="mb"
          tabs={[
            { to: '/calls', label: 'Все', end: true },
            { to: '/calls/missed', label: 'Пропущенные' },
          ]}
        />
        {list.isLoading ? (
          <ListSkeleton />
        ) : entries.length === 0 ? (
          <EmptyState
            icon={filter === 'missed' ? <PhoneMissed size={28} /> : <Phone size={28} />}
            title={filter === 'missed' ? 'Пропущенных нет' : 'Звонков пока не было'}
            text="Нажмите «Новый звонок», чтобы позвать одного человека или собрать встречу до 50 участников"
          />
        ) : (
          groups.map((g) => (
            <section key={g.day} className="calls-day">
              <h2 className="calls-day__title">{g.day}</h2>
              <div className="card" style={{ overflow: 'hidden' }}>
                {g.items.map((e) => (e.kind === 'call' ? <CallRow key={e.c.id} c={e.c} myId={me.id} /> : <RoomRow key={e.r.id} r={e.r} myId={me.id} />))}
              </div>
            </section>
          ))
        )}
        <LoadMore hasMore={!!list.hasNextPage} loading={list.isFetchingNextPage} onLoad={() => void list.fetchNextPage()} />
      </div>
      <Link to="/calls/new" className="calls-fab" aria-label="Новый звонок">
        <Plus size={26} />
      </Link>
    </div>
  );
}

/** Новый звонок: выбрать людей из чатов и подписок или ввести @имя, назвать встречу. */
export function NewCallPage() {
  const navigate = useNavigate();
  const [picked, setPicked] = useState<Picked>({ users: [], usernames: [] });
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const inCall = useRoom((s) => s.phase === 'active');
  const count = picked.users.length + picked.usernames.length;
  const start = async (video: boolean) => {
    setBusy(true);
    const ok = await createRoom({ userIds: picked.users.map((u) => u.id), usernames: picked.usernames, video, title: title.trim() || undefined });
    setBusy(false);
    if (ok) navigate('/calls', { replace: true });
  };
  return (
    <div className="newcall">
      <div className="newcall__head">
        <PageHeader title="Новый звонок" subtitle="Выберите людей из чатов или введите имя пользователя — до 49 собеседников" icon={<PhoneCall size={22} />} />
        {count > 1 && (
          <input className="input newcall__title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Название встречи (необязательно)" maxLength={80} aria-label="Название встречи" />
        )}
      </div>
      <PeoplePicker value={picked} onChange={setPicked} />
      <div className="newcall__actions">
        <button type="button" className="btn btn--secondary btn--lg" disabled={!count || busy || inCall} onClick={() => void start(false)}>
          <Phone size={18} /> Аудиозвонок
        </button>
        <button type="button" className="btn btn--primary btn--lg" disabled={!count || busy || inCall} onClick={() => void start(true)}>
          <Video size={18} /> Видеозвонок
        </button>
      </div>
    </div>
  );
}
