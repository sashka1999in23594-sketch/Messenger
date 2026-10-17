/** История звонков: все и пропущенные, перезвонить в один тап. */
import { useNavigate } from 'react-router';
import { MessageCircle, Phone, PhoneIncoming, PhoneMissed, PhoneOutgoing, Video } from 'lucide-react';
import type { CallInfo } from '@omni/shared';
import { flatPages, useCursorList } from '../../shared/api/query';
import { fmtDuration, startCall } from '../../shared/calls/engine';
import { useMe } from '../../shared/stores/session';
import { cn, fullDate, timeAgo } from '../../shared/lib/format';
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
            {c.video && <Video size={14} />}
          </span>
          <span title={fullDate(c.createdAt)}>
            {timeAgo(c.createdAt)} · {statusText(c, outgoing)}
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

export function CallsPage({ filter }: { filter: 'all' | 'missed' }) {
  const me = useMe();
  const list = useCursorList<CallInfo>(['calls', filter], `/calls${filter === 'missed' ? '?filter=missed' : ''}`);
  const items = flatPages(list.data);
  return (
    <div className="scroll">
      <div className="page">
        <PageHeader title="Звонки" subtitle="Аудио и видео 1:1 со сквозным шифрованием DTLS-SRTP" icon={<Phone size={22} />} />
        <TabLinks
          tabs={[
            { to: '/calls', label: 'Недавние' },
            { to: '/calls/missed', label: 'Пропущенные' },
          ]}
        />
        <div className="card" style={{ marginTop: 16, overflow: 'hidden' }}>
          {list.isLoading ? (
            <ListSkeleton />
          ) : items.length === 0 ? (
            <EmptyState
              icon={filter === 'missed' ? <PhoneMissed size={28} /> : <Phone size={28} />}
              title={filter === 'missed' ? 'Пропущенных нет' : 'Звонков пока не было'}
              text="Позвонить можно из любого личного чата — кнопки в шапке переписки"
            />
          ) : (
            items.map((c) => <CallRow key={c.id} c={c} myId={me.id} />)
          )}
        </div>
        <LoadMore hasMore={!!list.hasNextPage} loading={list.isFetchingNextPage} onLoad={() => void list.fetchNextPage()} />
      </div>
    </div>
  );
}
