/** Главная: сводка за день — непрочитанное, уведомления, звонки, запланированное, тренды. */
import { Link, useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import {
  Bell,
  CalendarClock,
  Camera,
  FileText,
  Lock,
  MessageCircle,
  PenLine,
  Phone,
  PhoneIncoming,
  PhoneMissed,
  PhoneOutgoing,
  Rocket,
  Sparkles,
  Star,
  Users,
} from 'lucide-react';
import type { AppNotification, CallInfo, ChatSummary, Paginated, PostDraft, UserProfile } from '@omni/shared';
import { api } from '../../shared/api/client';
import { qk } from '../../shared/api/query';
import { useMe } from '../../shared/stores/session';
import { chatTime, cn, compactNumber, timeAgo } from '../../shared/lib/format';
import { Avatar, ListSkeleton } from '../../shared/ui';
import { TrendsBox, WhoToFollow } from '../feed';
import { StoriesBar } from '../stories';
import { previewText } from '../chats/ChatList';
import { notificationText } from '../notifications';
import './home.css';

function greeting(h: number) {
  if (h < 5) return 'Доброй ночи';
  if (h < 12) return 'Доброе утро';
  if (h < 18) return 'Добрый день';
  return 'Добрый вечер';
}

const ACTIONS = [
  { to: '/chats/new/direct', label: 'Написать', icon: <MessageCircle size={20} />, tile: 'tile-blue' },
  { to: '/stories/new', label: 'История', icon: <Camera size={20} />, tile: 'tile-pink' },
  { to: '/feed/compose', label: 'Пост', icon: <PenLine size={20} />, tile: 'tile-violet' },
  { to: '/calls', label: 'Звонки', icon: <Phone size={20} />, tile: 'tile-green' },
  { to: '/chats/new/group', label: 'Группа', icon: <Users size={20} />, tile: 'tile-orange' },
  { to: '/chats/new/secret', label: 'Секретный чат', icon: <Lock size={20} />, tile: 'tile-teal' },
];

function Card({ title, icon, more, children, badge }: { title: string; icon: React.ReactNode; more?: { to: string; label: string }; children: React.ReactNode; badge?: number }) {
  return (
    <section className="panel home-card">
      <div className="home-card__head">
        {icon}
        <h2>{title}</h2>
        {!!badge && <span className="home-badge">{badge > 99 ? '99+' : badge}</span>}
        {more && (
          <Link className="home-card__more" to={more.to}>
            {more.label}
          </Link>
        )}
      </div>
      {children}
    </section>
  );
}

export function HomePage() {
  const me = useMe();
  const navigate = useNavigate();
  const now = new Date();
  const profile = useQuery({ queryKey: qk.user(me.username), queryFn: () => api.get<UserProfile>(`/users/${me.username}`) });
  const unread = useQuery({ queryKey: qk.chats('unread'), queryFn: () => api.get<Paginated<ChatSummary>>('/chats?folder=unread&limit=6') });
  const notes = useQuery({ queryKey: ['notifications', 'home'], queryFn: () => api.get<Paginated<AppNotification>>('/notifications?limit=5') });
  const calls = useQuery({ queryKey: ['calls', 'home'], queryFn: () => api.get<Paginated<CallInfo>>('/calls?limit=4') });
  const scheduled = useQuery({ queryKey: ['drafts', 'scheduled'], queryFn: () => api.get<{ items: PostDraft[] }>('/me/drafts?filter=scheduled') });
  const drafts = useQuery({ queryKey: ['drafts', 'drafts'], queryFn: () => api.get<{ items: PostDraft[] }>('/me/drafts?filter=drafts') });
  const stats = profile.data?.stats;

  return (
    <div className="scroll">
      <div className="home">
        <div className="home-hero">
          <Avatar src={me.avatarUrl} name={me.displayName} id={me.id} size={64} />
          <div className="home-hero__text">
            <div className="home-hero__date">{now.toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' })}</div>
            <h1 className="home-hero__title">
              {greeting(now.getHours())}, {me.displayName.split(' ')[0]}!
            </h1>
            <Link to="/settings/account/profile" className="home-hero__status">
              {me.status ? `${me.status.emoji} ${me.status.text || 'Статус'}` : '😊 Установить статус'}
            </Link>
          </div>
          {stats && (
            <div className="home-hero__stats">
              <Link to="/contacts/followers" className="home-hero__stat">
                <b>{compactNumber(stats.followers)}</b>
                <span>подписчиков</span>
              </Link>
              <Link to="/profile" className="home-hero__stat">
                <b>{compactNumber(stats.posts)}</b>
                <span>публикаций</span>
              </Link>
              <Link to="/chats/folder/unread" className="home-hero__stat">
                <b>{me.counters.unreadChats}</b>
                <span>непрочитанных</span>
              </Link>
            </div>
          )}
        </div>

        <div className="home-actions">
          {ACTIONS.map((a) => (
            <Link key={a.to} to={a.to} className="home-action">
              <span className={cn('list-item__icon', a.tile)}>{a.icon}</span>
              {a.label}
            </Link>
          ))}
        </div>

        <div className="panel home-stories">
          <div className="home-card__head">
            <Camera size={18} className="faint" />
            <h2>Истории</h2>
            <Link className="home-card__more" to="/stories/archive">
              Архив
            </Link>
          </div>
          <StoriesBar />
        </div>

        <div className="home-grid">
          <div className="col gap-4">
            <Card title="Непрочитанные чаты" icon={<MessageCircle size={18} className="faint" />} badge={me.counters.unreadChats} more={{ to: '/chats/folder/unread', label: 'Все' }}>
              {unread.isLoading ? (
                <ListSkeleton rows={3} />
              ) : unread.data?.items.length ? (
                unread.data.items.map((c) => (
                  <Link key={c.id} to={`/chats/${c.id}`} className="list-item">
                    <Avatar src={c.avatarUrl} name={c.title} id={c.peer?.id ?? c.id} size={42} />
                    <span className="list-item__body">
                      <span className="row" style={{ justifyContent: 'space-between', gap: 6 }}>
                        <b className="ellipsis">{c.title}</b>
                        {c.lastMessage && <span className="xs faint">{chatTime(c.lastMessage.createdAt)}</span>}
                      </span>
                      <span className="list-item__sub ellipsis" style={{ display: 'block' }}>
                        {previewText(c, me.id)}
                      </span>
                    </span>
                    <span className="badge">{c.unreadCount}</span>
                  </Link>
                ))
              ) : (
                <div className="home-card__empty">Всё прочитано 🎉</div>
              )}
            </Card>
            <Card title="Звонки" icon={<Phone size={18} className="faint" />} more={{ to: '/calls', label: 'История' }}>
              {calls.data?.items.length ? (
                calls.data.items.map((c) => {
                  const out = c.caller.id === me.id;
                  const peer = out ? c.callee : c.caller;
                  const missed = !out && (c.status === 'missed' || c.status === 'cancelled');
                  const Icon = missed ? PhoneMissed : out ? PhoneOutgoing : PhoneIncoming;
                  return (
                    <Link key={c.id} to={`/chats/${c.chatId}`} className="list-item">
                      <Avatar src={peer.avatarUrl} name={peer.displayName} id={peer.id} size={38} />
                      <span className="list-item__body">
                        <b className="ellipsis" style={{ display: 'block', color: missed ? 'var(--danger)' : undefined }}>
                          {peer.displayName}
                        </b>
                        <span className="list-item__sub row gap-1">
                          <Icon size={13} /> {timeAgo(c.createdAt)}
                        </span>
                      </span>
                    </Link>
                  );
                })
              ) : (
                <div className="home-card__empty">Звонков пока не было — позвоните из любого личного чата</div>
              )}
            </Card>
          </div>

          <div className="col gap-4">
            <Card title="Уведомления" icon={<Bell size={18} className="faint" />} badge={me.counters.unreadNotifications} more={{ to: '/notifications', label: 'Все' }}>
              {notes.isLoading ? (
                <ListSkeleton rows={3} />
              ) : notes.data?.items.length ? (
                notes.data.items.map((n) => (
                  <button key={n.id} type="button" className="list-item" onClick={() => n.link && navigate(n.link)} style={{ background: n.readAt ? undefined : 'var(--accent-soft)' }}>
                    {n.actor ? <Avatar src={n.actor.avatarUrl} name={n.actor.displayName} id={n.actor.id} size={36} /> : <span className="list-item__icon tile-red"><Bell size={16} /></span>}
                    <span className="list-item__body">
                      <span className="clamp-2 small">
                        {n.actor && <b>{n.actor.displayName} </b>}
                        {n.type === 'security' ? n.preview : `${notificationText(n.type)}${n.preview ? `: ${n.preview}` : ''}`}
                      </span>
                      <span className="xs faint">{timeAgo(n.createdAt)}</span>
                    </span>
                  </button>
                ))
              ) : (
                <div className="home-card__empty">Новых уведомлений нет</div>
              )}
            </Card>
            <Card title="Запланировано" icon={<CalendarClock size={18} className="faint" />} more={{ to: '/feed/scheduled', label: 'Открыть' }}>
              {scheduled.data?.items.length ? (
                scheduled.data.items.slice(0, 3).map((d) => (
                  <Link key={d.id} to="/feed/scheduled" className="list-item">
                    <span className="list-item__icon tile-violet">
                      <CalendarClock size={16} />
                    </span>
                    <span className="list-item__body">
                      <span className="ellipsis" style={{ display: 'block' }}>
                        {d.text || 'Публикация с медиа'}
                      </span>
                      <span className="xs faint">{new Date(d.publishAt!).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                    </span>
                  </Link>
                ))
              ) : (
                <div className="home-card__empty">Нет запланированных публикаций</div>
              )}
              <Link to="/feed/drafts" className="list-item">
                <span className="list-item__icon tile-gray">
                  <FileText size={16} />
                </span>
                <span className="list-item__body">Черновики</span>
                <span className="badge badge--muted">{drafts.data?.items.length ?? 0}</span>
              </Link>
            </Card>
          </div>

          <div className="col gap-4">
            <TrendsBox limit={6} />
            <WhoToFollow limit={4} />
            <Link to="/home/whats-new" className="panel list-item" style={{ padding: 16 }}>
              <span className="list-item__icon tile-yellow">
                <Sparkles size={18} />
              </span>
              <span className="list-item__body">
                <b>Что нового в Omni</b>
                <span className="list-item__sub" style={{ display: 'block' }}>
                  Звонки, истории, папки, списки и ещё 60+ функций
                </span>
              </span>
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

const CHANGES: { icon: React.ReactNode; title: string; items: [string, string?][] }[] = [
  {
    icon: <MessageCircle size={20} />,
    title: 'Мессенджер',
    items: [
      ['Аудио- и видеозвонки 1:1 (WebRTC)', '/calls'],
      ['Голосовые сообщения с волной и скоростью ×1.5/×2'],
      ['Видео-кружки до 60 секунд'],
      ['Опросы и викторины'],
      ['Упоминания @ с подсказками'],
      ['Отложенные и «тихие» сообщения'],
      ['Свои папки чатов', '/chats/folders'],
      ['Пригласительные ссылки с лимитами'],
      ['Медленный режим и автоудаление'],
      ['Обои чатов', '/settings/chats/wallpaper'],
      ['Поиск по всем сообщениям', '/search?type=messages'],
      ['Выбор эмодзи с поиском по-русски'],
    ],
  },
  {
    icon: <Camera size={20} />,
    title: 'Истории',
    items: [
      ['Текстовые истории на градиенте', '/stories/new'],
      ['Реакции на истории'],
      ['«Близкие друзья» — зелёное кольцо', '/settings/privacy/close-friends'],
      ['Архив и «Актуальное» в профиле', '/stories/archive'],
      ['Истории над списком чатов и в ленте'],
    ],
  },
  {
    icon: <Star size={20} />,
    title: 'Лента и профиль',
    items: [
      ['Черновики и отложенные публикации', '/feed/drafts'],
      ['Списки авторов со своей лентой', '/feed/lists'],
      ['Коллекции закладок', '/feed/bookmarks'],
      ['Скрытые слова и #теги', '/settings/privacy/muted-words'],
      ['«Колокольчик» — уведомления о новых публикациях'],
      ['Статус, ссылки и закреплённый пост в профиле'],
      ['Общие подписчики и «кто оценил»'],
    ],
  },
  {
    icon: <Rocket size={20} />,
    title: 'Оформление и настройки',
    items: [
      ['Дизайн «Аврора»: палитры, стекло, сияние', '/settings/appearance/theme'],
      ['Шрифт и скругление углов', '/settings/appearance/font'],
      ['Звуки и «Не беспокоить»', '/settings/notifications/sounds'],
      ['Режим энергосбережения', '/settings/power'],
      ['Поиск по настройкам', '/settings'],
      ['Письма: код при регистрации и входе', '/settings/account/email'],
    ],
  },
];

export function WhatsNewPage() {
  return (
    <div className="scroll">
      <div className="page">
        <div className="home-hero" style={{ marginBottom: 20 }}>
          <span className="home-hero__text">
            <span className="home-hero__date">Обновление Omni</span>
            <h1 className="home-hero__title">Что нового ✨</h1>
            <span className="small">Всё, что появилось в последних версиях — нажмите, чтобы попробовать.</span>
          </span>
        </div>
        <div className="whats-new">
          {CHANGES.map((g) => (
            <section key={g.title} className="panel whats-new__group">
              <h2>
                <span className="list-item__icon tile-violet">{g.icon}</span>
                {g.title}
              </h2>
              <ul className="whats-new__list">
                {g.items.map(([text, to]) => (
                  <li key={text}>{to ? <Link to={to}>{text}</Link> : text}</li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
