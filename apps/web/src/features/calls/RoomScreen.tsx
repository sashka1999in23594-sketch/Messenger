/**
 * Групповой звонок. На компьютере — отдельное окно поверх Sunnet: заголовок
 * с таймером и раскладками (сетка 2×2, 3×3, 4×4, боковая панель), сцена с
 * плитками участников, панель управления, участники, чат и студия трансляции.
 * На телефоне — полноэкранный звонок, как во всех мессенджерах.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Hand,
  LayoutGrid,
  Maximize2,
  MessageSquare,
  Mic,
  MicOff,
  Minimize2,
  Minus,
  MonitorUp,
  MoreHorizontal,
  PanelRight,
  PencilLine,
  Phone,
  PhoneOff,
  Pin,
  PinOff,
  Send,
  Square,
  UserPlus,
  Users,
  Video,
  VideoOff,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import type { UserSummary } from '@omni/shared';
import { DESKTOP_QUERY } from '../desktop/store';
import { useMediaQuery } from '../../shared/hooks';
import {
  declineInvite,
  fmt,
  inviteToRoom,
  joinRoom,
  leaveRoom,
  sendRoomChat,
  setRoomChatOpen,
  setRoomMinimized,
  setRoomVolume,
  toggleHand,
  toggleRoomCamera,
  toggleRoomMute,
  toggleScreen,
  useRoom,
  type RoomPeer,
} from '../../shared/calls/room';
import { useSession } from '../../shared/stores/session';
import { cn } from '../../shared/lib/format';
import { Avatar, Logo } from '../../shared/ui';
import { useSpeaking, useLevels } from './levels';
import { PeoplePicker, type Picked } from './PeoplePicker';
import { Studio } from './Studio';
import { resetStudio, useStudio } from './studio';
import './room.css';

type LayoutMode = 'grid2' | 'grid3' | 'grid4' | 'side';
const LAYOUTS: { id: LayoutMode; label: string; per: number }[] = [
  { id: 'grid2', label: 'Сетка 2×2', per: 4 },
  { id: 'grid3', label: 'Сетка 3×3', per: 9 },
  { id: 'grid4', label: 'Сетка 4×4', per: 16 },
  { id: 'side', label: 'Боковая панель', per: 1 },
];

function useTicker(on: boolean) {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!on) return;
    const t = window.setInterval(() => setTick((x) => x + 1), 1000);
    return () => window.clearInterval(t);
  }, [on]);
}

function StreamVideo({ stream, muted = true, className, mirror }: { stream: MediaStream | null; muted?: boolean; className?: string; mirror?: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const v = ref.current;
    if (v && v.srcObject !== stream) {
      v.srcObject = stream;
      void v.play().catch(() => undefined);
    }
  }, [stream]);
  return <video ref={ref} className={cn(className, mirror && 'room-mirror')} autoPlay playsInline muted={muted} />;
}

/** Звук всех участников — всегда, даже в свёрнутом окне; громкость общая. */
function RoomAudio() {
  const peers = useRoom((s) => s.peers);
  const volume = useRoom((s) => s.volume);
  return (
    <>
      {Object.values(peers).map((p) => (
        <PeerAudio key={p.userId} stream={p.stream} screen={p.screen} volume={volume} />
      ))}
    </>
  );
}

function PeerAudio({ stream, screen, volume }: { stream: MediaStream; screen: MediaStream | null; volume: number }) {
  const a = useRef<HTMLAudioElement>(null);
  const b = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    if (a.current && a.current.srcObject !== stream) a.current.srcObject = stream;
    if (b.current && b.current.srcObject !== screen) b.current.srcObject = screen;
  }, [stream, screen]);
  useEffect(() => {
    if (a.current) a.current.volume = volume;
    if (b.current) b.current.volume = volume;
  }, [volume]);
  return (
    <>
      <audio ref={a} autoPlay />
      {screen && <audio ref={b} autoPlay />}
    </>
  );
}

// ─── Плитки ─────────────────────────────────────────────────────────────────

interface TileData {
  key: string;
  userId: string;
  user: UserSummary | undefined;
  stream: MediaStream | null;
  video: boolean;
  audio: boolean;
  hand: boolean;
  screen: boolean;
  me: boolean;
  conn?: RoomPeer['conn'];
}

const hasLiveVideo = (s: MediaStream | null) => !!s?.getVideoTracks().some((t) => t.readyState === 'live' && !t.muted);

function useTiles(): TileData[] {
  const room = useRoom((s) => s.room);
  const peers = useRoom((s) => s.peers);
  const local = useRoom((s) => s.local);
  const studio = useRoom((s) => s.studio);
  const screen = useRoom((s) => s.screen);
  const muted = useRoom((s) => s.muted);
  const cameraOff = useRoom((s) => s.cameraOff);
  const hand = useRoom((s) => s.hand);
  const myId = useSession((s) => s.me?.id ?? '');
  const me = useSession((s) => s.me);
  const users = useMemo(() => new Map(room?.members.map((m) => [m.user.id, m.user]) ?? []), [room]);
  const tiles: TileData[] = [];
  // Демонстрации экрана — первыми, это главное на встрече
  if (screen) tiles.push({ key: 'me:screen', userId: myId, user: me ?? undefined, stream: screen, video: true, audio: true, hand: false, screen: true, me: true });
  for (const p of Object.values(peers)) {
    if (p.screen) tiles.push({ key: `${p.userId}:screen`, userId: p.userId, user: users.get(p.userId), stream: p.screen, video: true, audio: true, hand: false, screen: true, me: false, conn: p.conn });
  }
  tiles.push({
    key: 'me',
    userId: myId,
    user: me ?? undefined,
    stream: studio ?? local,
    video: !!studio || (!cameraOff && hasLiveVideo(local)),
    audio: !muted,
    hand,
    screen: false,
    me: true,
  });
  for (const p of Object.values(peers)) {
    tiles.push({
      key: p.userId,
      userId: p.userId,
      user: users.get(p.userId),
      stream: p.stream,
      video: p.media.video && p.stream.getVideoTracks().some((t) => !t.muted),
      audio: p.media.audio,
      hand: p.media.hand,
      screen: false,
      me: false,
      conn: p.conn,
    });
  }
  return tiles;
}

function Tile({ t, pinned, onPin, compact }: { t: TileData; pinned: boolean; onPin: () => void; compact?: boolean }) {
  const speaking = useSpeaking((s) => !t.screen && !!s.ids[t.me ? 'me' : t.userId]);
  const name = t.me ? (t.screen ? 'Ваш экран' : 'Вы') : t.screen ? `Экран: ${t.user?.displayName ?? ''}` : (t.user?.displayName ?? 'Участник');
  return (
    <div className={cn('room-tile', speaking && 'is-speaking', t.screen && 'room-tile--screen', compact && 'room-tile--compact')}>
      {t.video ? (
        <StreamVideo stream={t.stream} className="room-tile__video" mirror={t.me && !t.screen && !useRoom.getState().studio} />
      ) : (
        <div className="room-tile__avatar">
          <Avatar src={t.user?.avatarUrl} name={t.user?.displayName ?? '?'} id={t.userId} size={compact ? 44 : 84} />
        </div>
      )}
      <span className="room-tile__name">
        {!t.screen && !t.audio && <MicOff size={13} className="room-tile__muted" />}
        {name}
      </span>
      {t.hand && (
        <span className="room-tile__hand" title="Поднял руку">
          <Hand size={16} />
        </span>
      )}
      {t.conn && t.conn !== 'connected' && <span className="room-tile__conn">{t.conn === 'failed' ? 'Нет связи' : 'Подключение…'}</span>}
      <button type="button" className={cn('room-tile__pin', pinned && 'is-on')} onClick={onPin} aria-label={pinned ? 'Открепить' : 'Закрепить'} title={pinned ? 'Открепить' : 'Закрепить'}>
        {pinned ? <PinOff size={15} /> : <Pin size={15} />}
      </button>
    </div>
  );
}

/** Сцена: сетка с листанием или главный участник с лентой сбоку. */
function Stage({ layout, pinned, setPinned }: { layout: LayoutMode; pinned: string | null; setPinned: (k: string | null) => void }) {
  const tiles = useTiles();
  const last = useSpeaking((s) => s.last);
  const [page, setPage] = useState(0);
  const pin = (k: string) => setPinned(pinned === k ? null : k);

  if (layout === 'side' || pinned) {
    const main =
      tiles.find((t) => t.key === pinned) ??
      tiles.find((t) => t.screen) ??
      tiles.find((t) => !t.me && t.userId === last) ??
      tiles.find((t) => !t.me) ??
      tiles[0]!;
    const rest = tiles.filter((t) => t !== main);
    return (
      <div className="room-stage room-stage--side">
        <div className="room-stage__main">
          <Tile t={main} pinned={pinned === main.key} onPin={() => pin(main.key)} />
        </div>
        {rest.length > 0 && (
          <div className="room-stage__strip">
            {rest.map((t) => (
              <Tile key={t.key} t={t} compact pinned={pinned === t.key} onPin={() => pin(t.key)} />
            ))}
          </div>
        )}
      </div>
    );
  }

  const per = LAYOUTS.find((l) => l.id === layout)!.per;
  const pages = Math.max(1, Math.ceil(tiles.length / per));
  const p = Math.min(page, pages - 1);
  const shown = tiles.slice(p * per, p * per + per);
  const cols = Math.min(Math.ceil(Math.sqrt(shown.length)), Math.round(Math.sqrt(per)));
  // Двое — собеседник на всю сцену, вы — в углу (как в обычном видеозвонке)
  if (tiles.length === 2 && !tiles.some((t) => t.screen)) {
    const [mine, other] = tiles[0]!.me ? [tiles[0]!, tiles[1]!] : [tiles[1]!, tiles[0]!];
    return (
      <div className="room-stage room-stage--duo">
        <Tile t={other} pinned={false} onPin={() => pin(other.key)} />
        <div className="room-stage__pip">
          <Tile t={mine} compact pinned={false} onPin={() => pin(mine.key)} />
        </div>
      </div>
    );
  }
  return (
    <div className="room-stage room-stage--grid" style={{ ['--cols' as string]: cols, ['--rows' as string]: Math.ceil(shown.length / cols) }}>
      {shown.map((t) => (
        <Tile key={t.key} t={t} pinned={pinned === t.key} onPin={() => pin(t.key)} />
      ))}
      {pages > 1 && (
        <div className="room-stage__pager">
          <button type="button" onClick={() => setPage(Math.max(0, p - 1))} disabled={p === 0} aria-label="Предыдущие участники">
            <ChevronLeft size={18} />
          </button>
          <span>
            {p + 1} / {pages}
          </span>
          <button type="button" onClick={() => setPage(Math.min(pages - 1, p + 1))} disabled={p >= pages - 1} aria-label="Следующие участники">
            <ChevronRight size={18} />
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Панели ─────────────────────────────────────────────────────────────────

function ChatPanel({ onClose }: { onClose?: () => void }) {
  const chat = useRoom((s) => s.chat);
  const myId = useSession((s) => s.me?.id);
  const [text, setText] = useState('');
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight });
  }, [chat.length]);
  const submit = () => {
    if (!text.trim()) return;
    void sendRoomChat(text);
    setText('');
  };
  return (
    <aside className="room-panel" aria-label="Чат звонка">
      <header className="room-panel__head">
        <b>Чат звонка</b>
        {onClose && (
          <button type="button" className="room-icon" onClick={onClose} aria-label="Закрыть чат">
            <X size={18} />
          </button>
        )}
      </header>
      <div className="room-chat" ref={list}>
        {!chat.length && <p className="room-panel__empty">Сообщения видят все, кто сейчас в звонке. После звонка они не сохраняются.</p>}
        {chat.map((m) => (
          <div key={m.id} className={cn('room-chat__msg', m.user.id === myId && 'is-mine')}>
            {m.user.id !== myId && <span className="room-chat__who">{m.user.displayName}</span>}
            <span className="room-chat__text">{m.text}</span>
          </div>
        ))}
      </div>
      <form
        className="room-chat__form"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Сообщение" aria-label="Сообщение в чат звонка" maxLength={1000} />
        <button type="submit" className="room-chat__send" disabled={!text.trim()} aria-label="Отправить">
          <Send size={17} />
        </button>
      </form>
    </aside>
  );
}

function PeoplePanel({ onInvite, onClose }: { onInvite: () => void; onClose?: () => void }) {
  const room = useRoom((s) => s.room);
  const peers = useRoom((s) => s.peers);
  const myId = useSession((s) => s.me?.id);
  if (!room) return null;
  const order = { joined: 0, invited: 1, declined: 2, left: 3 } as const;
  const members = [...room.members].sort((a, b) => order[a.state] - order[b.state]);
  const joined = members.filter((m) => m.state === 'joined').length;
  return (
    <aside className="room-panel" aria-label="Участники">
      <header className="room-panel__head">
        <b>Участники · {joined}</b>
        {onClose && (
          <button type="button" className="room-icon" onClick={onClose} aria-label="Закрыть">
            <X size={18} />
          </button>
        )}
      </header>
      <button type="button" className="room-panel__invite" onClick={onInvite}>
        <UserPlus size={17} /> Пригласить
      </button>
      <div className="room-people">
        {members.map((m) => {
          const p = peers[m.user.id];
          const state =
            m.user.id === myId
              ? 'Вы'
              : m.state === 'joined'
                ? p?.conn === 'connected'
                  ? 'В звонке'
                  : 'Подключается…'
                : m.state === 'invited'
                  ? 'Звоним…'
                  : m.state === 'declined'
                    ? 'Отклонил'
                    : 'Вышел';
          return (
            <div key={m.user.id} className={cn('room-person', m.state !== 'joined' && 'is-away')}>
              <Avatar src={m.user.avatarUrl} name={m.user.displayName} id={m.user.id} size={36} />
              <span className="room-person__text">
                <b>{m.user.displayName}</b>
                <span>
                  {state}
                  {m.role === 'owner' ? ' · организатор' : ''}
                </span>
              </span>
              {p && !p.media.audio && <MicOff size={15} className="room-person__icon" />}
              {p?.media.hand && <Hand size={15} className="room-person__icon room-person__icon--hand" />}
            </div>
          );
        })}
      </div>
    </aside>
  );
}

function InviteDialog({ onClose }: { onClose: () => void }) {
  const room = useRoom((s) => s.room);
  const [picked, setPicked] = useState<Picked>({ users: [], usernames: [] });
  const [busy, setBusy] = useState(false);
  const exclude = room?.members.filter((m) => m.state === 'joined').map((m) => m.user.id) ?? [];
  const count = picked.users.length + picked.usernames.length;
  return (
    <div className="room-modal" role="dialog" aria-modal="true" aria-label="Пригласить в звонок" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="room-modal__card">
        <header className="room-panel__head">
          <b>Пригласить в звонок</b>
          <button type="button" className="room-icon" onClick={onClose} aria-label="Закрыть">
            <X size={18} />
          </button>
        </header>
        <PeoplePicker value={picked} onChange={setPicked} exclude={exclude} />
        <button
          type="button"
          className="room-modal__go"
          disabled={!count || busy}
          onClick={async () => {
            setBusy(true);
            const ok = await inviteToRoom({ userIds: picked.users.map((u) => u.id), usernames: picked.usernames });
            setBusy(false);
            if (ok) onClose();
          }}
        >
          <UserPlus size={17} /> {count ? `Пригласить (${count})` : 'Выберите людей'}
        </button>
      </div>
    </div>
  );
}

// ─── Управление ─────────────────────────────────────────────────────────────

function Ctrl({ label, onClick, on, off, danger, children, badge }: { label: string; onClick: () => void; on?: boolean; off?: boolean; danger?: boolean; children: ReactNode; badge?: number }) {
  return (
    <button type="button" className={cn('room-ctrl', danger && 'room-ctrl--danger', on && 'is-on', off && 'is-off')} onClick={onClick} aria-label={label} aria-pressed={on || off ? true : undefined}>
      <span className="room-ctrl__btn">
        {children}
        {!!badge && <span className="room-ctrl__badge">{badge > 9 ? '9+' : badge}</span>}
      </span>
      <span className="room-ctrl__label">{label}</span>
    </button>
  );
}

function MoreMenu({ onClose, onInvite, onStudio, items }: { onClose: () => void; onInvite: () => void; onStudio?: () => void; items?: ReactNode }) {
  const hand = useRoom((s) => s.hand);
  useEffect(() => {
    const t = window.setTimeout(() => window.addEventListener('pointerdown', onClose, { once: true }), 0);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener('pointerdown', onClose);
    };
  }, [onClose]);
  return (
    <div className="room-menu" role="menu" onPointerDown={(e) => e.stopPropagation()}>
      <button type="button" role="menuitem" onClick={() => (toggleHand(), onClose())}>
        <Hand size={16} /> {hand ? 'Опустить руку' : 'Поднять руку'}
      </button>
      <button type="button" role="menuitem" onClick={() => (onInvite(), onClose())}>
        <UserPlus size={16} /> Пригласить участников
      </button>
      {onStudio && (
        <button type="button" role="menuitem" onClick={() => (onStudio(), onClose())}>
          <PencilLine size={16} /> Студия трансляции
        </button>
      )}
      {items}
    </div>
  );
}

// ─── Окно на компьютере ─────────────────────────────────────────────────────

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

function initialRect(): Rect {
  const w = Math.min(1180, window.innerWidth - 48);
  const h = Math.min(760, window.innerHeight - 64);
  return { x: Math.round((window.innerWidth - w) / 2), y: Math.round((window.innerHeight - h) / 2), w, h };
}

function RoomWindow() {
  const room = useRoom((s) => s.room);
  const phase = useRoom((s) => s.phase);
  const muted = useRoom((s) => s.muted);
  const cameraOff = useRoom((s) => s.cameraOff);
  const screen = useRoom((s) => s.screen);
  const volume = useRoom((s) => s.volume);
  const chatOpen = useRoom((s) => s.chatOpen);
  const unread = useRoom((s) => s.unread);
  const startedAt = useRoom((s) => s.startedAt);
  const studioOpen = useStudio((s) => s.open);
  const live = useStudio((s) => s.live);
  const [rect, setRect] = useState<Rect>(initialRect);
  const [max, setMax] = useState(false);
  const [layout, setLayout] = useState<LayoutMode>('grid2');
  const [pinned, setPinned] = useState<string | null>(null);
  const [panel, setPanel] = useState<'people' | null>(null);
  const [menu, setMenu] = useState<'layout' | 'more' | null>(null);
  const [inviting, setInviting] = useState(false);
  const drag = useRef<{ kind: 'move' | 'size'; sx: number; sy: number; start: Rect } | null>(null);
  useTicker(phase === 'active');

  const toggleStudio = () => {
    const open = !useStudio.getState().open;
    useStudio.setState({ open });
    // Студии нужно место — окно вырастает
    if (open && !max && rect.h < 900) setRect((r) => ({ ...r, y: 16, h: Math.min(window.innerHeight - 32, Math.max(r.h, 940)) }));
  };

  const begin = (kind: 'move' | 'size') => (e: React.PointerEvent) => {
    if (e.button !== 0 || (kind === 'move' && ((e.target as HTMLElement).closest('button') || max))) return;
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { kind, sx: e.clientX, sy: e.clientY, start: rect };
  };
  const move = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.sx;
    const dy = e.clientY - d.sy;
    if (d.kind === 'move') {
      setRect({ ...d.start, x: Math.min(window.innerWidth - 120, Math.max(120 - d.start.w, d.start.x + dx)), y: Math.min(window.innerHeight - 48, Math.max(0, d.start.y + dy)) });
    } else setRect({ ...d.start, w: Math.max(640, d.start.w + dx), h: Math.max(440, d.start.h + dy) });
  };
  const end = () => (drag.current = null);

  if (!room) return null;
  const joined = room.members.filter((m) => m.state === 'joined').length;
  const title = room.title || (joined > 2 ? 'Групповой звонок' : 'Звонок');
  const style = max ? undefined : { left: rect.x, top: rect.y, width: rect.w, height: rect.h };

  return (
    <div className={cn('room-win', max && 'room-win--max', studioOpen && 'room-win--studio')} style={style} role="dialog" aria-label={title}>
      <header className="room-win__bar" onPointerDown={begin('move')} onPointerMove={move} onPointerUp={end} onDoubleClick={() => setMax((m) => !m)}>
        <span className="room-win__brand">
          <Logo size={22} />
          <b>{title}</b>
          {live && <span className="room-win__live">В эфире</span>}
        </span>
        <span className="room-win__timer">{phase === 'joining' ? 'Подключение…' : startedAt ? fmt((Date.now() - startedAt) / 1000) : ''}</span>
        <span className="room-win__tools">
          <span className="room-win__anchor">
            <button type="button" className={cn('room-icon', menu === 'layout' && 'is-on')} onClick={() => setMenu(menu === 'layout' ? null : 'layout')} aria-label="Раскладка" title="Раскладка">
              <LayoutGrid size={18} />
            </button>
            {menu === 'layout' && (
              <div className="room-menu room-menu--down" role="menu" onPointerDown={(e) => e.stopPropagation()}>
                {LAYOUTS.map((l) => (
                  <button
                    key={l.id}
                    type="button"
                    role="menuitemradio"
                    aria-checked={layout === l.id}
                    className={cn(layout === l.id && 'is-on')}
                    onClick={() => {
                      setLayout(l.id);
                      if (l.id !== 'side') setPinned(null);
                      setMenu(null);
                    }}
                  >
                    {l.id === 'side' ? <PanelRight size={16} /> : <LayoutGrid size={16} />} {l.label}
                  </button>
                ))}
              </div>
            )}
          </span>
          <button type="button" className="room-icon" onClick={() => setRoomVolume(volume ? 0 : 1)} aria-label={volume ? 'Выключить звук собеседников' : 'Включить звук'} title="Звук собеседников">
            {volume ? <Volume2 size={18} /> : <VolumeX size={18} />}
          </button>
          <button type="button" className={cn('room-icon', panel === 'people' && 'is-on')} onClick={() => setPanel(panel === 'people' ? null : 'people')} aria-label="Участники" title="Участники">
            <Users size={18} />
            <span className="room-icon__count">{joined}</span>
          </button>
          <button type="button" className={cn('room-icon', chatOpen && 'is-on')} onClick={() => setRoomChatOpen(!chatOpen)} aria-label="Чат" title="Чат">
            <MessageSquare size={18} />
            {unread > 0 && <span className="room-icon__dot" />}
          </button>
          <span className="room-win__sep" />
          <button type="button" className="room-icon" onClick={() => setRoomMinimized(true)} aria-label="Свернуть" title="Свернуть">
            <Minus size={18} />
          </button>
          <button type="button" className="room-icon" onClick={() => setMax((m) => !m)} aria-label={max ? 'Вернуть размер' : 'Развернуть'} title={max ? 'Вернуть размер' : 'Развернуть'}>
            {max ? <Minimize2 size={16} /> : <Square size={15} />}
          </button>
          <button type="button" className="room-icon room-icon--close" onClick={() => void leaveRoom()} aria-label="Выйти из звонка" title="Выйти из звонка">
            <X size={18} />
          </button>
        </span>
      </header>

      <div className="room-win__body">
        <div className="room-win__center">
          <div className="room-win__stage" onPointerDown={() => menu && setMenu(null)}>
            <Stage layout={layout} pinned={pinned} setPinned={setPinned} />
            <button type="button" className={cn('room-studio-btn', studioOpen && 'is-on')} onClick={toggleStudio} aria-label="Студия трансляции" title="Студия: текст, фото, видео, экран и фон">
              {studioOpen ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
              <PencilLine size={18} />
            </button>
            <div className="room-controls">
              <Ctrl label="Камера" onClick={() => void toggleRoomCamera()} off={cameraOff}>
                {cameraOff ? <VideoOff size={20} /> : <Video size={20} />}
              </Ctrl>
              <Ctrl label="Микрофон" onClick={toggleRoomMute} off={muted}>
                {muted ? <MicOff size={20} /> : <Mic size={20} />}
              </Ctrl>
              <Ctrl label={screen ? 'Остановить' : 'Экран'} onClick={() => void toggleScreen()} on={!!screen}>
                <MonitorUp size={20} />
              </Ctrl>
              <span className="room-win__anchor">
                <Ctrl label="Ещё" onClick={() => setMenu(menu === 'more' ? null : 'more')} on={menu === 'more'}>
                  <MoreHorizontal size={20} />
                </Ctrl>
                {menu === 'more' && <MoreMenu onClose={() => setMenu(null)} onInvite={() => setInviting(true)} onStudio={toggleStudio} />}
              </span>
              <Ctrl label="Завершить" onClick={() => void leaveRoom()} danger>
                <PhoneOff size={20} />
              </Ctrl>
            </div>
          </div>
          {studioOpen && <Studio />}
        </div>
        {(panel === 'people' || chatOpen) && (
          <div className="room-win__side">
            {panel === 'people' && <PeoplePanel onInvite={() => setInviting(true)} onClose={() => setPanel(null)} />}
            {chatOpen && <ChatPanel onClose={() => setRoomChatOpen(false)} />}
          </div>
        )}
      </div>
      {!max && <span className="room-win__resize" onPointerDown={begin('size')} onPointerMove={move} onPointerUp={end} aria-hidden />}
      {inviting && <InviteDialog onClose={() => setInviting(false)} />}
    </div>
  );
}

// ─── Телефон ────────────────────────────────────────────────────────────────

function RoomMobile() {
  const room = useRoom((s) => s.room);
  const phase = useRoom((s) => s.phase);
  const muted = useRoom((s) => s.muted);
  const cameraOff = useRoom((s) => s.cameraOff);
  const volume = useRoom((s) => s.volume);
  const chatOpen = useRoom((s) => s.chatOpen);
  const unread = useRoom((s) => s.unread);
  const startedAt = useRoom((s) => s.startedAt);
  const [sheet, setSheet] = useState<'people' | null>(null);
  const [inviting, setInviting] = useState(false);
  const [pinned, setPinned] = useState<string | null>(null);
  useTicker(phase === 'active');
  if (!room) return null;
  const joined = room.members.filter((m) => m.state === 'joined').length;
  const title = room.title || 'Групповой звонок';
  return (
    <div className="room-mobile" role="dialog" aria-label={title}>
      <header className="room-mobile__top">
        <button type="button" className="room-round" onClick={() => setRoomMinimized(true)} aria-label="Свернуть звонок">
          <ChevronDown size={22} />
        </button>
        <span className="room-mobile__title">
          <b>{title}</b>
          <span>{phase === 'joining' ? 'Подключение…' : `${joined} в звонке · ${startedAt ? fmt((Date.now() - startedAt) / 1000) : ''}`}</span>
        </span>
        <button type="button" className="room-round" onClick={() => setSheet('people')} aria-label="Участники">
          <Users size={20} />
        </button>
      </header>
      <div className="room-mobile__stage">
        <Stage layout={pinned ? 'side' : 'grid2'} pinned={pinned} setPinned={setPinned} />
      </div>
      <footer className="room-mobile__controls">
        <Ctrl label="Динамик" onClick={() => setRoomVolume(volume ? 0 : 1)} off={!volume}>
          {volume ? <Volume2 size={22} /> : <VolumeX size={22} />}
        </Ctrl>
        <Ctrl label="Камера" onClick={() => void toggleRoomCamera()} off={cameraOff}>
          {cameraOff ? <VideoOff size={22} /> : <Video size={22} />}
        </Ctrl>
        <Ctrl label="Микрофон" onClick={toggleRoomMute} off={muted}>
          {muted ? <MicOff size={22} /> : <Mic size={22} />}
        </Ctrl>
        <Ctrl label="Чат" onClick={() => setRoomChatOpen(true)} badge={unread}>
          <MessageSquare size={22} />
        </Ctrl>
        <Ctrl label="Выйти" onClick={() => void leaveRoom()} danger>
          <PhoneOff size={22} />
        </Ctrl>
      </footer>
      {(chatOpen || sheet) && (
        <div className="room-sheet" onPointerDown={(e) => e.target === e.currentTarget && (setRoomChatOpen(false), setSheet(null))}>
          <div className="room-sheet__card">
            {chatOpen ? <ChatPanel onClose={() => setRoomChatOpen(false)} /> : <PeoplePanel onInvite={() => setInviting(true)} onClose={() => setSheet(null)} />}
          </div>
        </div>
      )}
      {inviting && <InviteDialog onClose={() => setInviting(false)} />}
    </div>
  );
}

// ─── Приглашение, свёрнутый звонок, итог ────────────────────────────────────

function Incoming({ wide }: { wide: boolean }) {
  const room = useRoom((s) => s.room);
  const from = useRoom((s) => s.invitedBy);
  const myId = useSession((s) => s.me?.id);
  if (!room) return null;
  const others = room.members.filter((m) => m.user.id !== myId);
  const joined = room.members.filter((m) => m.state === 'joined').length;
  const rejoin = !from;
  const text = rejoin ? 'Звонок ещё идёт' : `${from.displayName} приглашает в ${room.video ? 'видеозвонок' : 'звонок'}`;
  return (
    <div className={cn('room-incoming', wide && 'room-incoming--card')} role="alertdialog" aria-label={text}>
      <div className="room-incoming__faces">
        {others.slice(0, 4).map((m) => (
          <Avatar key={m.user.id} src={m.user.avatarUrl} name={m.user.displayName} id={m.user.id} size={wide ? 44 : 72} />
        ))}
      </div>
      <b className="room-incoming__title">{room.title || (others.length > 1 ? 'Групповой звонок' : others[0]?.user.displayName)}</b>
      <span className="room-incoming__text">
        {text} · {joined} в звонке
      </span>
      <div className="room-incoming__actions">
        <Ctrl label={rejoin ? 'Не сейчас' : 'Отклонить'} onClick={declineInvite} danger>
          <PhoneOff size={22} />
        </Ctrl>
        <Ctrl label="Без видео" onClick={() => void joinRoom(room.id, false)} on>
          <Phone size={22} />
        </Ctrl>
        <Ctrl label={rejoin ? 'Вернуться' : 'С видео'} onClick={() => void joinRoom(room.id, true)} on>
          <Video size={22} />
        </Ctrl>
      </div>
    </div>
  );
}

function Pill() {
  const room = useRoom((s) => s.room);
  const startedAt = useRoom((s) => s.startedAt);
  const muted = useRoom((s) => s.muted);
  useTicker(true);
  if (!room) return null;
  const joined = room.members.filter((m) => m.state === 'joined').length;
  return (
    <div className="room-pill" role="status">
      <button type="button" className="room-pill__main" onClick={() => setRoomMinimized(false)}>
        <span className="room-pill__dot" />
        <b>{room.title || 'Групповой звонок'}</b>
        <span>
          {joined} · {startedAt ? fmt((Date.now() - startedAt) / 1000) : ''}
        </span>
        <Maximize2 size={15} />
      </button>
      <button type="button" className={cn('room-icon', muted && 'is-off')} onClick={toggleRoomMute} aria-label={muted ? 'Включить микрофон' : 'Выключить микрофон'}>
        {muted ? <MicOff size={17} /> : <Mic size={17} />}
      </button>
      <button type="button" className="room-icon room-icon--hang" onClick={() => void leaveRoom()} aria-label="Выйти из звонка">
        <PhoneOff size={17} />
      </button>
    </div>
  );
}

export function RoomScreen() {
  const phase = useRoom((s) => s.phase);
  const minimized = useRoom((s) => s.minimized);
  const endedText = useRoom((s) => s.endedText);
  const local = useRoom((s) => s.local);
  const peers = useRoom((s) => s.peers);
  const wide = useMediaQuery(DESKTOP_QUERY);
  const inCall = phase === 'active' || phase === 'joining';
  const streams = useMemo(() => {
    const out: Record<string, MediaStream | null> = { me: local };
    for (const p of Object.values(peers)) out[p.userId] = p.stream;
    return out;
  }, [local, peers]);
  useLevels(streams, inCall);

  // Звонок закончился — студия закрывается и отпускает экран и файлы
  useEffect(() => {
    if (!inCall) resetStudio();
  }, [inCall]);

  if (phase === 'idle') return null;
  if (phase === 'ended')
    return (
      <div className="room-ended" role="status">
        <PhoneOff size={16} /> {endedText}
      </div>
    );
  if (phase === 'incoming') return <Incoming wide={wide} />;
  return (
    <>
      <RoomAudio />
      {minimized ? <Pill /> : wide ? <RoomWindow /> : <RoomMobile />}
    </>
  );
}
