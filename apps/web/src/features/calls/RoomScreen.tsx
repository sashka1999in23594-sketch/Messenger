/**
 * Звонок на компьютере — отдельное окно поверх Sunnet. Раскладка подстраивается
 * под число людей: вдвоём — собеседник крупно, вы в углу; до пяти — вы (или
 * выбранный) в центре, все участники лентой справа; от шести — сетка. Справа —
 * панель: показ экрана, окна, фото и видео, музыка на фон, участники с
 * поднятыми руками и управлением для организатора, чат. Снизу — студия.
 * На телефоне — полноэкранный звонок, как во всех мессенджерах.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Crown,
  Hand,
  Image as ImageIcon,
  LayoutGrid,
  Lock,
  Maximize2,
  MessageSquare,
  Mic,
  MicOff,
  Minimize2,
  Minus,
  Monitor,
  MonitorUp,
  MoreHorizontal,
  MoreVertical,
  Music,
  PanelRight,
  Pause,
  PencilLine,
  Phone,
  PhoneOff,
  Pin,
  PinOff,
  Play,
  Send,
  Shield,
  Square,
  Sparkles,
  UserPlus,
  Users,
  Video,
  VideoOff,
  Volume2,
  VolumeX,
  X,
  AppWindow,
  Film,
} from 'lucide-react';
import type { RoomMember, UserSummary } from '@omni/shared';
import { DESKTOP_QUERY } from '../desktop/store';
import { useMediaQuery } from '../../shared/hooks';
import {
  can,
  declineInvite,
  fmt,
  inviteToRoom,
  isModerator,
  joinRoom,
  leaveRoom,
  moderate,
  myMember,
  sendRoomChat,
  setMusic,
  setMusicVolume,
  setRoomChatOpen,
  setRoomMinimized,
  setRoomVolume,
  shareDisplay,
  sharePhoto,
  shareVideo,
  stopMusic,
  stopScreen,
  toggleHand,
  toggleMusic,
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

type LayoutMode = 'auto' | 'grid2' | 'grid3' | 'grid4' | 'side';
const LAYOUTS: { id: LayoutMode; label: string; per: number }[] = [
  { id: 'auto', label: 'Авто — по числу людей', per: 16 },
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

/** Выбрать файл с устройства (фото, видео, музыка). */
function pick(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.click();
  });
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
  member: RoomMember | undefined;
  stream: MediaStream | null;
  video: boolean;
  audio: boolean;
  /** Место в очереди поднятых рук (1, 2…) или 0 */
  hand: number;
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
  const myId = useSession((s) => s.me?.id ?? '');
  const me = useSession((s) => s.me);
  const members = useMemo(() => new Map(room?.members.map((m) => [m.user.id, m]) ?? []), [room]);
  // Очередь рук — по времени поднятия
  const queue = useMemo(
    () =>
      (room?.members ?? [])
        .filter((m) => m.state === 'joined' && m.hand)
        .sort((a, b) => a.hand!.localeCompare(b.hand!))
        .map((m) => m.user.id),
    [room],
  );
  const handOf = (id: string) => queue.indexOf(id) + 1;
  const tiles: TileData[] = [];
  // Показы экрана — первыми, это главное на встрече
  if (screen)
    tiles.push({ key: `screen:${myId}`, userId: myId, user: me ?? undefined, member: members.get(myId), stream: screen, video: true, audio: true, hand: 0, screen: true, me: true });
  for (const p of Object.values(peers)) {
    if (p.screen)
      tiles.push({
        key: `screen:${p.userId}`,
        userId: p.userId,
        user: members.get(p.userId)?.user,
        member: members.get(p.userId),
        stream: p.screen,
        video: true,
        audio: true,
        hand: 0,
        screen: true,
        me: false,
        conn: p.conn,
      });
  }
  tiles.push({
    key: myId,
    userId: myId,
    user: me ?? undefined,
    member: members.get(myId),
    stream: studio ?? local,
    video: !!studio || (!cameraOff && hasLiveVideo(local)),
    audio: !muted,
    hand: handOf(myId),
    screen: false,
    me: true,
  });
  for (const p of Object.values(peers)) {
    tiles.push({
      key: p.userId,
      userId: p.userId,
      user: members.get(p.userId)?.user,
      member: members.get(p.userId),
      stream: p.stream,
      video: p.media.video && p.stream.getVideoTracks().some((t) => !t.muted),
      audio: p.media.audio,
      hand: handOf(p.userId),
      screen: false,
      me: false,
      conn: p.conn,
    });
  }
  return tiles;
}

function RoleBadge({ member }: { member: RoomMember | undefined }) {
  if (member?.role === 'owner')
    return (
      <span className="room-role" title="Организатор">
        <Crown size={12} />
      </span>
    );
  if (member?.role === 'cohost')
    return (
      <span className="room-role room-role--co" title="Соорганизатор">
        <Shield size={12} />
      </span>
    );
  return null;
}

function Tile({
  t,
  pinned,
  onPin,
  onSelect,
  compact,
  selected,
  spotlight,
}: {
  t: TileData;
  pinned: boolean;
  onPin: () => void;
  onSelect?: () => void;
  compact?: boolean;
  selected?: boolean;
  spotlight?: boolean;
}) {
  const speaking = useSpeaking((s) => !t.screen && !!s.ids[t.me ? 'me' : t.userId]);
  const name = t.me ? (t.screen ? 'Ваш показ' : 'Вы') : t.screen ? `Показывает ${t.user?.displayName ?? ''}` : (t.user?.displayName ?? 'Участник');
  return (
    <div
      className={cn('room-tile', speaking && 'is-speaking', t.screen && 'room-tile--screen', compact && 'room-tile--compact', selected && 'is-selected', onSelect && 'is-clickable')}
      onClick={onSelect}
      role={onSelect ? 'button' : undefined}
      tabIndex={onSelect ? 0 : undefined}
      onKeyDown={(e) => onSelect && (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onSelect())}
      aria-label={onSelect ? `Показать крупно: ${name}` : undefined}
    >
      {t.video ? (
        <StreamVideo stream={t.stream} className="room-tile__video" mirror={t.me && !t.screen && !useRoom.getState().studio} />
      ) : (
        <div className="room-tile__avatar">
          <Avatar src={t.user?.avatarUrl} name={t.user?.displayName ?? '?'} id={t.userId} size={compact ? 44 : 84} />
        </div>
      )}
      <span className="room-tile__name">
        {!t.screen && !t.audio && <MicOff size={13} className="room-tile__muted" />}
        {!t.screen && <RoleBadge member={t.member} />}
        {name}
      </span>
      {t.hand > 0 && (
        <span className="room-tile__hand" title={`Поднял(а) руку · ${t.hand}-й в очереди`}>
          <Hand size={15} />
          {t.hand}
        </span>
      )}
      {spotlight && (
        <span className="room-tile__spot" title="Закреплено организатором для всех">
          <Pin size={12} /> Для всех
        </span>
      )}
      {t.conn && t.conn !== 'connected' && <span className="room-tile__conn">{t.conn === 'failed' ? 'Нет связи' : 'Подключение…'}</span>}
      <button
        type="button"
        className={cn('room-tile__pin', pinned && 'is-on')}
        onClick={(e) => (e.stopPropagation(), onPin())}
        aria-label={pinned ? 'Открепить' : 'Закрепить у себя'}
        title={pinned ? 'Открепить' : 'Закрепить у себя'}
      >
        {pinned ? <PinOff size={15} /> : <Pin size={15} />}
      </button>
    </div>
  );
}

/**
 * Сцена. «Авто»: вдвоём — собеседник крупно и вы в углу; до пяти — выбранный
 * (по умолчанию вы) в центре, все справа лентой; от шести — сетка.
 * Закреплённое организатором для всех и своё закрепление важнее раскладки.
 */
function Stage({ layout, pinned, setPinned, mobile }: { layout: LayoutMode; pinned: string | null; setPinned: (k: string | null) => void; mobile?: boolean }) {
  const tiles = useTiles();
  const room = useRoom((s) => s.room);
  const last = useSpeaking((s) => s.last);
  const myId = useSession((s) => s.me?.id ?? '');
  const [page, setPage] = useState(0);
  const [focus, setFocus] = useState<string | null>(null);
  const pin = (k: string) => setPinned(pinned === k ? null : k);
  const spot = room?.settings.spotlight ?? null;
  const spotTile = spot ? tiles.find((t) => t.key === spot) : undefined;
  const people = tiles.filter((t) => !t.screen).length;

  const side = (main: TileData, strip: TileData[], select?: (k: string) => void) => (
    <div className="room-stage room-stage--side">
      <div className="room-stage__main">
        <Tile t={main} pinned={pinned === main.key} onPin={() => pin(main.key)} spotlight={spotTile?.key === main.key} />
      </div>
      {strip.length > 0 && (
        <div className="room-stage__strip">
          {strip.map((t) => (
            <Tile
              key={t.key}
              t={t}
              compact
              selected={t.key === main.key}
              pinned={pinned === t.key}
              onPin={() => pin(t.key)}
              onSelect={select ? () => select(t.key) : undefined}
              spotlight={spotTile?.key === t.key}
            />
          ))}
        </div>
      )}
    </div>
  );

  // Своё закрепление, затем закреплённое для всех
  const forced = tiles.find((t) => t.key === pinned) ?? spotTile;
  if (forced) return side(forced, tiles.filter((t) => t !== forced));

  if (layout === 'side') {
    const main = tiles.find((t) => t.screen) ?? tiles.find((t) => !t.me && t.userId === last) ?? tiles.find((t) => !t.me) ?? tiles[0]!;
    return side(
      main,
      tiles.filter((t) => t !== main),
    );
  }

  if (layout === 'auto' && !mobile) {
    // Вдвоём — как в обычном видеозвонке
    if (people === 2 && tiles.length === 2) {
      const mine = tiles.find((t) => t.me)!;
      const other = tiles.find((t) => !t.me)!;
      return (
        <div className="room-stage room-stage--duo">
          <Tile t={other} pinned={false} onPin={() => pin(other.key)} />
          <div className="room-stage__pip">
            <Tile t={mine} compact pinned={false} onPin={() => pin(mine.key)} />
          </div>
        </div>
      );
    }
    // До пяти — вы (или выбранный) в центре, все — справа; щелчок делает участника крупным
    if (people <= 5) {
      const main = tiles.find((t) => t.key === focus) ?? tiles.find((t) => t.screen) ?? tiles.find((t) => t.key === myId) ?? tiles[0]!;
      return side(main, tiles, (k) => setFocus(k === focus ? null : k));
    }
  }

  // Сетка (от шести человек или выбрана вручную)
  const per = layout === 'auto' ? (tiles.length <= 9 ? 9 : 16) : LAYOUTS.find((l) => l.id === layout)!.per;
  const pages = Math.max(1, Math.ceil(tiles.length / per));
  const p = Math.min(page, pages - 1);
  const shown = tiles.slice(p * per, p * per + per);
  const cols = Math.min(Math.ceil(Math.sqrt(shown.length)), Math.round(Math.sqrt(per)));
  if (mobile && tiles.length === 2 && !tiles.some((t) => t.screen)) {
    const mine = tiles.find((t) => t.me)!;
    const other = tiles.find((t) => !t.me)!;
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

// ─── Правая панель: показ и музыка ──────────────────────────────────────────

function MediaPanel({ onStudio }: { onStudio: () => void }) {
  const share = useRoom((s) => s.share);
  const music = useRoom((s) => s.music);
  const room = useRoom((s) => s.room);
  const myId = useSession((s) => s.me?.id ?? '');
  const mod = isModerator(myMember(room));
  const allowed = can('screen', room);
  const spotMine = room?.settings.spotlight === `screen:${myId}`;
  const shareOptions: { label: string; hint: string; icon: ReactNode; run: () => void }[] = [
    { label: 'Экран', hint: 'Весь экран целиком', icon: <Monitor size={20} />, run: () => void shareDisplay('screen') },
    { label: 'Окно или вкладка', hint: 'Одна программа или вкладка браузера', icon: <AppWindow size={20} />, run: () => void shareDisplay('window') },
    { label: 'Фото', hint: 'Картинка с компьютера', icon: <ImageIcon size={20} />, run: () => void pick('image/*').then((f) => f && sharePhoto(f)) },
    { label: 'Видео', hint: 'Ролик со звуком', icon: <Film size={20} />, run: () => void pick('video/*').then((f) => f && shareVideo(f)) },
  ];
  return (
    <div className="room-panel__body">
      <section className="room-sec">
        <h3 className="room-sec__title">Показать участникам</h3>
        {share ? (
          <div className="room-now">
            <span className="room-now__dot" />
            <span className="room-now__text">
              <b>Вы показываете</b>
              <span>{share.label}</span>
            </span>
            <button type="button" className="room-btn room-btn--danger" onClick={stopScreen}>
              Остановить
            </button>
          </div>
        ) : (
          <div className="room-grid2">
            {shareOptions.map((o) => (
              <button key={o.label} type="button" className="room-card" onClick={o.run} disabled={!allowed} title={allowed ? o.hint : 'Организатор запретил участникам показывать экран'}>
                {o.icon}
                <b>{o.label}</b>
                <span>{o.hint}</span>
              </button>
            ))}
          </div>
        )}
        {share && mod && (
          <button type="button" className="room-btn room-btn--wide" onClick={() => void moderate({ action: 'spotlight', spotlight: spotMine ? null : `screen:${myId}` })}>
            <Maximize2 size={16} /> {spotMine ? 'Убрать с экранов всех' : 'Показать всем на весь экран'}
          </button>
        )}
        {!allowed && (
          <p className="room-hint">
            <Lock size={12} /> Показывать могут только организаторы
          </p>
        )}
      </section>

      <section className="room-sec">
        <h3 className="room-sec__title">Музыка на фон</h3>
        {music ? (
          <div className="room-music">
            <span className="room-music__icon">
              <Music size={18} />
            </span>
            <span className="room-music__name" title={music.name}>
              {music.name}
            </span>
            <button type="button" className="room-icon" onClick={toggleMusic} aria-label={music.playing ? 'Пауза' : 'Играть'}>
              {music.playing ? <Pause size={16} /> : <Play size={16} />}
            </button>
            <button type="button" className="room-icon" onClick={stopMusic} aria-label="Убрать музыку">
              <X size={16} />
            </button>
            <input
              className="room-range"
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={music.volume}
              onChange={(e) => setMusicVolume(Number(e.target.value))}
              aria-label="Громкость музыки"
            />
          </div>
        ) : (
          <button type="button" className="room-card room-card--row" onClick={() => void pick('audio/*').then((f) => f && setMusic(f))}>
            <Music size={20} />
            <span>
              <b>Выбрать музыку</b>
              <span>Её услышат все — поверх вашего голоса</span>
            </span>
          </button>
        )}
      </section>

      <section className="room-sec">
        <h3 className="room-sec__title">Студия</h3>
        <button type="button" className="room-card room-card--row" onClick={onStudio}>
          <Sparkles size={20} />
          <span>
            <b>Студия трансляции</b>
            <span>Текст, фото, видео и фоны — участники видят сцену вместо камеры</span>
          </span>
        </button>
      </section>
      <p className="room-hint">Файлы не загружаются на сервер — их видят только участники звонка.</p>
    </div>
  );
}

// ─── Правая панель: участники и управление ─────────────────────────────────

function MemberMenu({ m, onClose }: { m: RoomMember; onClose: () => void }) {
  const room = useRoom((s) => s.room);
  const peers = useRoom((s) => s.peers);
  const mine = myMember(room);
  const owner = mine?.role === 'owner';
  const peer = peers[m.user.id];
  const spotted = room?.settings.spotlight === m.user.id;
  useEffect(() => {
    const t = window.setTimeout(() => window.addEventListener('pointerdown', onClose, { once: true }), 0);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener('pointerdown', onClose);
    };
  }, [onClose]);
  const act = (body: Parameters<typeof moderate>[0]) => () => {
    void moderate(body);
    onClose();
  };
  const id = m.user.id;
  return (
    <div className="room-menu room-menu--member" role="menu" onPointerDown={(e) => e.stopPropagation()}>
      <button type="button" role="menuitem" onClick={act({ action: 'mute', userId: id })} disabled={peer && !peer.media.audio}>
        <MicOff size={16} /> Выключить микрофон
      </button>
      <button type="button" role="menuitem" onClick={act({ action: 'cameraOff', userId: id })}>
        <VideoOff size={16} /> Выключить камеру
      </button>
      {peer?.screen && (
        <button type="button" role="menuitem" onClick={act({ action: 'stopScreen', userId: id })}>
          <MonitorUp size={16} /> Остановить показ экрана
        </button>
      )}
      <button type="button" role="menuitem" onClick={act({ action: 'spotlight', spotlight: spotted ? null : id })}>
        <Pin size={16} /> {spotted ? 'Открепить у всех' : 'Закрепить для всех'}
      </button>
      {peer?.screen && (
        <button type="button" role="menuitem" onClick={act({ action: 'spotlight', spotlight: `screen:${id}` })}>
          <Maximize2 size={16} /> Его экран — всем на весь экран
        </button>
      )}
      {m.hand && (
        <button type="button" role="menuitem" onClick={act({ action: 'lowerHand', userId: id })}>
          <Hand size={16} /> Опустить руку
        </button>
      )}
      <button type="button" role="menuitem" onClick={act({ action: 'allowSpeak', userId: id, on: !m.canSpeak })}>
        <Mic size={16} /> {m.canSpeak ? 'Забрать слово' : 'Дать слово'}
      </button>
      {owner && m.role !== 'owner' && (
        <button type="button" role="menuitem" onClick={act({ action: 'cohost', userId: id, on: m.role !== 'cohost' })}>
          <Shield size={16} /> {m.role === 'cohost' ? 'Снять соорганизатора' : 'Сделать соорганизатором'}
        </button>
      )}
      <button type="button" role="menuitem" className="is-danger" onClick={act({ action: 'remove', userId: id })}>
        <X size={16} /> Удалить из звонка
      </button>
    </div>
  );
}

const RULES: { key: 'allowMic' | 'allowCamera' | 'allowScreen' | 'allowChat' | 'allowInvite'; label: string }[] = [
  { key: 'allowMic', label: 'Участники включают микрофон' },
  { key: 'allowCamera', label: 'Участники включают камеру' },
  { key: 'allowScreen', label: 'Участники показывают экран' },
  { key: 'allowChat', label: 'Участники пишут в чат' },
  { key: 'allowInvite', label: 'Участники приглашают людей' },
];

function HostControls() {
  const room = useRoom((s) => s.room);
  const [renaming, setRenaming] = useState(false);
  const [title, setTitle] = useState(room?.title ?? '');
  if (!room) return null;
  const st = room.settings;
  const set = (patch: Partial<typeof st>) => void moderate({ action: 'settings', settings: patch });
  return (
    <section className="room-sec room-host">
      <h3 className="room-sec__title">
        <Crown size={14} /> Управление звонком
      </h3>
      {RULES.map((r) => (
        <label key={r.key} className="room-switch">
          <span>{r.label}</span>
          <input type="checkbox" checked={st[r.key]} onChange={(e) => set({ [r.key]: e.target.checked })} />
        </label>
      ))}
      <label className="room-switch">
        <span>Закрыть вход в звонок</span>
        <input type="checkbox" checked={st.locked} onChange={(e) => set({ locked: e.target.checked })} />
      </label>
      <div className="room-host__actions">
        <button type="button" className="room-btn" onClick={() => void moderate({ action: 'muteAll' })}>
          <MicOff size={15} /> Выключить микрофоны всем
        </button>
        <button type="button" className="room-btn" onClick={() => void moderate({ action: 'lowerAllHands' })}>
          <Hand size={15} /> Опустить все руки
        </button>
        {st.spotlight && (
          <button type="button" className="room-btn" onClick={() => void moderate({ action: 'spotlight', spotlight: null })}>
            <PinOff size={15} /> Снять закрепление у всех
          </button>
        )}
        {renaming ? (
          <form
            className="room-rename"
            onSubmit={(e) => {
              e.preventDefault();
              void moderate({ action: 'rename', title });
              setRenaming(false);
            }}
          >
            <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} placeholder="Название звонка" aria-label="Название звонка" autoFocus />
            <button type="submit" className="room-btn">
              Готово
            </button>
          </form>
        ) : (
          <button type="button" className="room-btn" onClick={() => setRenaming(true)}>
            <PencilLine size={15} /> Переименовать звонок
          </button>
        )}
        <button type="button" className="room-btn room-btn--danger" onClick={() => void moderate({ action: 'end' })}>
          <PhoneOff size={15} /> Завершить для всех
        </button>
      </div>
    </section>
  );
}

function PeoplePanel({ onInvite }: { onInvite: () => void }) {
  const room = useRoom((s) => s.room);
  const peers = useRoom((s) => s.peers);
  const myId = useSession((s) => s.me?.id);
  const [menu, setMenu] = useState<string | null>(null);
  if (!room) return null;
  const mod = isModerator(myMember(room));
  const order: Record<RoomMember['state'], number> = { joined: 0, invited: 1, declined: 2, left: 3, removed: 4 };
  const members = [...room.members].sort((a, b) => order[a.state] - order[b.state] || (a.role === 'owner' ? -1 : b.role === 'owner' ? 1 : 0));
  const joined = members.filter((m) => m.state === 'joined').length;
  const hands = members.filter((m) => m.state === 'joined' && m.hand).sort((a, b) => a.hand!.localeCompare(b.hand!));
  return (
    <div className="room-panel__body">
      {can('invite', room) && (
        <button type="button" className="room-panel__invite" onClick={onInvite}>
          <UserPlus size={17} /> Пригласить
        </button>
      )}
      {hands.length > 0 && (
        <section className="room-sec">
          <h3 className="room-sec__title">
            <Hand size={14} /> Подняли руку · {hands.length}
          </h3>
          {hands.map((m, i) => (
            <div key={m.user.id} className="room-person room-person--hand">
              <span className="room-person__queue">{i + 1}</span>
              <Avatar src={m.user.avatarUrl} name={m.user.displayName} id={m.user.id} size={30} />
              <span className="room-person__text">
                <b>{m.user.id === myId ? 'Вы' : m.user.displayName}</b>
              </span>
              {mod && m.user.id !== myId && (
                <>
                  <button type="button" className="room-btn room-btn--sm" onClick={() => void moderate({ action: 'allowSpeak', userId: m.user.id })}>
                    Дать слово
                  </button>
                  <button type="button" className="room-icon" onClick={() => void moderate({ action: 'lowerHand', userId: m.user.id })} aria-label="Опустить руку">
                    <X size={15} />
                  </button>
                </>
              )}
            </div>
          ))}
        </section>
      )}
      <section className="room-sec">
        <h3 className="room-sec__title">В звонке · {joined}</h3>
        {members.map((m) => {
          const p = peers[m.user.id];
          const me = m.user.id === myId;
          const state =
            m.state === 'joined'
              ? me || p?.conn === 'connected'
                ? m.role === 'owner'
                  ? 'Организатор'
                  : m.role === 'cohost'
                    ? 'Соорганизатор'
                    : m.canSpeak
                      ? 'Слово дано'
                      : 'В звонке'
                : 'Подключается…'
              : m.state === 'invited'
                ? 'Звоним…'
                : m.state === 'declined'
                  ? 'Отклонил(а)'
                  : m.state === 'removed'
                    ? 'Удалён(а)'
                    : 'Вышел(ла)';
          return (
            <div key={m.user.id} className={cn('room-person', m.state !== 'joined' && 'is-away')}>
              <Avatar src={m.user.avatarUrl} name={m.user.displayName} id={m.user.id} size={36} />
              <span className="room-person__text">
                <b>
                  {me ? 'Вы' : m.user.displayName} <RoleBadge member={m} />
                </b>
                <span>{state}</span>
              </span>
              {m.hand && <Hand size={15} className="room-person__icon room-person__icon--hand" />}
              {p && !p.media.audio && <MicOff size={15} className="room-person__icon" />}
              {mod && !me && m.state === 'joined' && m.role !== 'owner' && (
                <span className="room-win__anchor">
                  <button type="button" className="room-icon" onClick={() => setMenu(menu === m.user.id ? null : m.user.id)} aria-label={`Управление: ${m.user.displayName}`}>
                    <MoreVertical size={16} />
                  </button>
                  {menu === m.user.id && <MemberMenu m={m} onClose={() => setMenu(null)} />}
                </span>
              )}
            </div>
          );
        })}
      </section>
      {mod && <HostControls />}
    </div>
  );
}

function ChatPanel() {
  const chat = useRoom((s) => s.chat);
  const room = useRoom((s) => s.room);
  const myId = useSession((s) => s.me?.id);
  const [text, setText] = useState('');
  const list = useRef<HTMLDivElement>(null);
  const allowed = can('chat', room);
  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight });
  }, [chat.length]);
  const submit = () => {
    if (!text.trim()) return;
    void sendRoomChat(text);
    setText('');
  };
  return (
    <>
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
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={allowed ? 'Сообщение' : 'Организатор выключил чат'}
          aria-label="Сообщение в чат звонка"
          maxLength={1000}
          disabled={!allowed}
        />
        <button type="submit" className="room-chat__send" disabled={!text.trim() || !allowed} aria-label="Отправить">
          <Send size={17} />
        </button>
      </form>
    </>
  );
}

type Tab = 'media' | 'people' | 'chat';

function SidePanel({ tab, setTab, onInvite, onStudio, onClose }: { tab: Tab; setTab: (t: Tab) => void; onInvite: () => void; onStudio: () => void; onClose?: () => void }) {
  const unread = useRoom((s) => s.unread);
  const room = useRoom((s) => s.room);
  const joined = room?.members.filter((m) => m.state === 'joined').length ?? 0;
  const hands = room?.members.filter((m) => m.state === 'joined' && m.hand).length ?? 0;
  useEffect(() => {
    if (tab === 'chat') setRoomChatOpen(true);
    return () => setRoomChatOpen(false);
  }, [tab]);
  return (
    <aside className="room-panel" aria-label="Панель звонка">
      <header className="room-panel__tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'media'} className={cn(tab === 'media' && 'is-on')} onClick={() => setTab('media')}>
          <MonitorUp size={15} /> Показ
        </button>
        <button type="button" role="tab" aria-selected={tab === 'people'} className={cn(tab === 'people' && 'is-on')} onClick={() => setTab('people')}>
          <Users size={15} /> {joined}
          {hands > 0 && (
            <span className="room-tab-hand">
              <Hand size={11} />
              {hands}
            </span>
          )}
        </button>
        <button type="button" role="tab" aria-selected={tab === 'chat'} className={cn(tab === 'chat' && 'is-on')} onClick={() => setTab('chat')}>
          <MessageSquare size={15} /> Чат
          {unread > 0 && tab !== 'chat' && <span className="room-icon__dot room-icon__dot--inline" />}
        </button>
        {onClose && (
          <button type="button" className="room-icon room-panel__close" onClick={onClose} aria-label="Скрыть панель">
            <X size={16} />
          </button>
        )}
      </header>
      {tab === 'media' && <MediaPanel onStudio={onStudio} />}
      {tab === 'people' && <PeoplePanel onInvite={onInvite} />}
      {tab === 'chat' && <ChatPanel />}
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

function Ctrl({
  label,
  onClick,
  on,
  off,
  danger,
  locked,
  children,
  badge,
}: {
  label: string;
  onClick: () => void;
  on?: boolean;
  off?: boolean;
  danger?: boolean;
  locked?: boolean;
  children: ReactNode;
  badge?: number;
}) {
  return (
    <button
      type="button"
      className={cn('room-ctrl', danger && 'room-ctrl--danger', on && 'is-on', off && 'is-off', locked && 'is-locked')}
      onClick={onClick}
      aria-label={label}
      aria-pressed={on || off ? true : undefined}
    >
      <span className="room-ctrl__btn">
        {children}
        {locked && (
          <span className="room-ctrl__lock">
            <Lock size={10} />
          </span>
        )}
        {!!badge && <span className="room-ctrl__badge">{badge > 9 ? '9+' : badge}</span>}
      </span>
      <span className="room-ctrl__label">{label}</span>
    </button>
  );
}

function useOutside(open: boolean, close: () => void) {
  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => window.addEventListener('pointerdown', close, { once: true }), 0);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener('pointerdown', close);
    };
  }, [open, close]);
}

function EndButton({ big }: { big?: boolean }) {
  const room = useRoom((s) => s.room);
  const [open, setOpen] = useState(false);
  const close = useMemo(() => () => setOpen(false), []);
  useOutside(open, close);
  const mod = isModerator(myMember(room));
  const joined = room?.members.filter((m) => m.state === 'joined').length ?? 0;
  if (!mod || joined < 3)
    return (
      <Ctrl label={big ? 'Выйти' : 'Завершить'} onClick={() => void leaveRoom()} danger>
        <PhoneOff size={big ? 22 : 20} />
      </Ctrl>
    );
  return (
    <span className="room-win__anchor">
      <Ctrl label="Завершить" onClick={() => setOpen(!open)} danger>
        <PhoneOff size={big ? 22 : 20} />
      </Ctrl>
      {open && (
        <div className="room-menu" role="menu" onPointerDown={(e) => e.stopPropagation()}>
          <button type="button" role="menuitem" onClick={() => void leaveRoom()}>
            <PhoneOff size={16} /> Выйти из звонка
          </button>
          <button type="button" role="menuitem" className="is-danger" onClick={() => void moderate({ action: 'end' })}>
            <X size={16} /> Завершить для всех
          </button>
        </div>
      )}
    </span>
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
  const w = Math.min(1320, window.innerWidth - 48);
  const h = Math.min(800, window.innerHeight - 64);
  return { x: Math.round((window.innerWidth - w) / 2), y: Math.round((window.innerHeight - h) / 2), w, h };
}

function RoomWindow() {
  const room = useRoom((s) => s.room);
  const phase = useRoom((s) => s.phase);
  const muted = useRoom((s) => s.muted);
  const cameraOff = useRoom((s) => s.cameraOff);
  const screen = useRoom((s) => s.screen);
  const volume = useRoom((s) => s.volume);
  const hand = useRoom((s) => s.hand);
  const startedAt = useRoom((s) => s.startedAt);
  const studioOpen = useStudio((s) => s.open);
  const live = useStudio((s) => s.live);
  const [rect, setRect] = useState<Rect>(initialRect);
  const [max, setMax] = useState(false);
  const [layout, setLayout] = useState<LayoutMode>('auto');
  const [pinned, setPinned] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab | null>(() => (window.innerWidth >= 1100 ? 'media' : null));
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
  const openTab = (t: Tab) => setTab(tab === t ? null : t);

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
    } else setRect({ ...d.start, w: Math.max(720, d.start.w + dx), h: Math.max(460, d.start.h + dy) });
  };
  const end = () => (drag.current = null);

  if (!room) return null;
  const joined = room.members.filter((m) => m.state === 'joined').length;
  const title = room.title || (joined > 2 ? 'Групповой звонок' : (room.members.find((m) => m.user.id !== myMember(room)?.user.id)?.user.displayName ?? 'Звонок'));
  const style = max ? undefined : { left: rect.x, top: rect.y, width: rect.w, height: rect.h };
  const micLocked = muted && !can('mic', room);
  const camLocked = cameraOff && !can('camera', room);
  const screenLocked = !screen && !can('screen', room);

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
                      setPinned(null);
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
          <button type="button" className={cn('room-icon', tab === 'people' && 'is-on')} onClick={() => openTab('people')} aria-label="Участники" title="Участники">
            <Users size={18} />
            <span className="room-icon__count">{joined}</span>
          </button>
          <button type="button" className={cn('room-icon', tab === 'chat' && 'is-on')} onClick={() => openTab('chat')} aria-label="Чат" title="Чат">
            <MessageSquare size={18} />
          </button>
          <button type="button" className={cn('room-icon', tab === 'media' && 'is-on')} onClick={() => openTab('media')} aria-label="Показ и музыка" title="Показ и музыка">
            <PanelRight size={18} />
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
              <Ctrl label="Камера" onClick={() => void toggleRoomCamera()} off={cameraOff} locked={camLocked}>
                {cameraOff ? <VideoOff size={20} /> : <Video size={20} />}
              </Ctrl>
              <Ctrl label="Микрофон" onClick={toggleRoomMute} off={muted} locked={micLocked}>
                {muted ? <MicOff size={20} /> : <Mic size={20} />}
              </Ctrl>
              <Ctrl label={screen ? 'Остановить' : 'Экран'} onClick={() => void toggleScreen()} on={!!screen} locked={screenLocked}>
                <MonitorUp size={20} />
              </Ctrl>
              <Ctrl label={hand ? 'Опустить' : 'Рука'} onClick={() => void toggleHand()} on={hand}>
                <Hand size={20} />
              </Ctrl>
              <span className="room-win__anchor">
                <Ctrl label="Ещё" onClick={() => setMenu(menu === 'more' ? null : 'more')} on={menu === 'more'}>
                  <MoreHorizontal size={20} />
                </Ctrl>
                {menu === 'more' && (
                  <div className="room-menu" role="menu" onPointerDown={(e) => e.stopPropagation()}>
                    {can('invite', room) && (
                      <button type="button" role="menuitem" onClick={() => (setInviting(true), setMenu(null))}>
                        <UserPlus size={16} /> Пригласить участников
                      </button>
                    )}
                    <button type="button" role="menuitem" onClick={() => (setTab('media'), setMenu(null))}>
                      <Music size={16} /> Показ и музыка на фон
                    </button>
                    <button type="button" role="menuitem" onClick={() => (toggleStudio(), setMenu(null))}>
                      <PencilLine size={16} /> Студия трансляции
                    </button>
                    <button type="button" role="menuitem" onClick={() => (setMax((m) => !m), setMenu(null))}>
                      <Maximize2 size={16} /> {max ? 'Обычный размер окна' : 'Окно на весь экран'}
                    </button>
                  </div>
                )}
              </span>
              <EndButton />
            </div>
          </div>
          {studioOpen && <Studio />}
        </div>
        {tab && (
          <div className="room-win__side">
            <SidePanel tab={tab} setTab={setTab} onInvite={() => setInviting(true)} onStudio={toggleStudio} onClose={() => setTab(null)} />
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
  const hand = useRoom((s) => s.hand);
  const unread = useRoom((s) => s.unread);
  const startedAt = useRoom((s) => s.startedAt);
  const [sheet, setSheet] = useState<Tab | null>(null);
  const [inviting, setInviting] = useState(false);
  const [pinned, setPinned] = useState<string | null>(null);
  useTicker(phase === 'active');
  if (!room) return null;
  const joined = room.members.filter((m) => m.state === 'joined').length;
  const title = room.title || (joined > 2 ? 'Групповой звонок' : (room.members.find((m) => m.user.id !== myMember(room)?.user.id)?.user.displayName ?? 'Звонок'));
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
        <Stage layout={pinned ? 'side' : 'grid2'} pinned={pinned} setPinned={setPinned} mobile />
      </div>
      <footer className="room-mobile__controls">
        <Ctrl label="Динамик" onClick={() => setRoomVolume(volume ? 0 : 1)} off={!volume}>
          {volume ? <Volume2 size={22} /> : <VolumeX size={22} />}
        </Ctrl>
        <Ctrl label="Камера" onClick={() => void toggleRoomCamera()} off={cameraOff} locked={cameraOff && !can('camera', room)}>
          {cameraOff ? <VideoOff size={22} /> : <Video size={22} />}
        </Ctrl>
        <Ctrl label="Микрофон" onClick={toggleRoomMute} off={muted} locked={muted && !can('mic', room)}>
          {muted ? <MicOff size={22} /> : <Mic size={22} />}
        </Ctrl>
        <Ctrl label="Рука" onClick={() => void toggleHand()} on={hand}>
          <Hand size={22} />
        </Ctrl>
        <Ctrl label="Чат" onClick={() => setSheet('chat')} badge={unread}>
          <MessageSquare size={22} />
        </Ctrl>
        <EndButton big />
      </footer>
      {sheet && (
        <div className="room-sheet" onPointerDown={(e) => e.target === e.currentTarget && setSheet(null)}>
          <div className="room-sheet__card">
            <SidePanel tab={sheet} setTab={setSheet} onInvite={() => setInviting(true)} onStudio={() => undefined} onClose={() => setSheet(null)} />
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
  const group = others.length > 1;
  const text = rejoin ? 'Звонок ещё идёт' : group ? `${from.displayName} приглашает в ${room.video ? 'видеозвонок' : 'звонок'}` : room.video ? 'Входящий видеозвонок' : 'Входящий звонок';
  return (
    <div className={cn('room-incoming', wide && 'room-incoming--card')} role="alertdialog" aria-label={text}>
      <div className="room-incoming__faces">
        {others.slice(0, 4).map((m) => (
          <Avatar key={m.user.id} src={m.user.avatarUrl} name={m.user.displayName} id={m.user.id} size={wide ? 44 : 72} />
        ))}
      </div>
      <b className="room-incoming__title">{room.title || (group ? 'Групповой звонок' : (from?.displayName ?? others[0]?.user.displayName))}</b>
      <span className="room-incoming__text">
        {text}
        {group ? ` · ${joined} в звонке` : ''}
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
        <b>{room.title || (joined > 2 ? 'Групповой звонок' : 'Звонок')}</b>
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
