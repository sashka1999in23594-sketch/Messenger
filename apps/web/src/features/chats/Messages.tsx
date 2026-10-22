import { createContext, memo, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  AlertCircle,
  BellOff,
  Check,
  CheckCheck,
  CheckCircle2,
  ChevronRight,
  Clock,
  Copy,
  Ellipsis,
  Eye,
  Flag,
  Forward,
  Lock,
  MessageSquare,
  Pencil,
  Pin,
  PinOff,
  Plus,
  Reply,
  RotateCcw,
  SmilePlus,
  Trash2,
} from 'lucide-react';
import { REACTIONS, type ChatSummary } from '@omni/shared';
import { Avatar, EmojiPicker, Menu, MediaGrid, RichText, useMenu, type MenuEntry, type MenuItem } from '../../shared/ui';
import { CallMessage, PollMessage, RoundMessage, VoiceMessage } from './bubbles';
import { clockTime, cn, compactNumber, dayLabel, isJumboEmoji, plural } from '../../shared/lib/format';
import { usePrefs } from '../../shared/stores/prefs';
import { useInfiniteScroll } from '../../shared/hooks';
import type { LocalMessage } from './cache';
import { useDecrypted, type SecretState } from './secret';

export interface MessageActions {
  reply: (m: LocalMessage) => void;
  edit: (m: LocalMessage, plaintext: string) => void;
  remove: (m: LocalMessage) => void;
  forward: (m: LocalMessage) => void;
  react: (m: LocalMessage, emoji: string) => void;
  pin: (m: LocalMessage) => void;
  report: (m: LocalMessage) => void;
  retry: (m: LocalMessage) => void;
  copy: (text: string) => void;
  readers: (m: LocalMessage) => void;
  callBack?: (video: boolean) => void;
  /** Открыть комментарии к посту канала */
  comments?: (m: LocalMessage) => void;
  /** Выбрать сообщение (режим выделения: переслать, удалить, скопировать несколько) */
  select?: (m: LocalMessage) => void;
  /** Перейти к сообщению (цитата ответа, закреплённое) */
  jumpTo?: (messageId: string) => void;
}

const EDIT_WINDOW = 48 * 3600 * 1000;
/** Быстрая реакция двойным касанием */
const QUICK_REACTION = '❤️';
/** Сдвиг пузыря вправо, после которого срабатывает «Ответить» */
const SWIPE_REPLY = 64;

/** Цвета имён авторов (в компаниях и сообществах — цвет главной роли). */
export const SenderColors = createContext<Map<string, string> | null>(null);

function Ticks({ msg, chat }: { msg: LocalMessage; chat: ChatSummary }) {
  if (msg.local?.status === 'sending') return <Clock size={12} aria-label="отправляется" />;
  if (msg.local?.status === 'failed') return <AlertCircle size={14} style={{ color: 'var(--danger)' }} aria-label="не отправлено" />;
  if (chat.type === 'channel' || chat.type === 'saved') return <Check size={15} />;
  return msg.seq <= chat.peerReadSeq ? <CheckCheck size={16} className="bubble__ticks--read" aria-label="прочитано" /> : <Check size={16} aria-label="доставлено" />;
}

function SecretBody({ msg, chat, secret }: { msg: LocalMessage; chat: ChatSummary; secret: SecretState }) {
  const { text, error } = useDecrypted(chat.id, msg.id, msg.clientId, msg.encrypted, secret);
  if (text !== null) return <RichText text={text} className="bubble__text" />;
  return (
    <span className="secret-text--locked row gap-1" style={{ display: 'inline-flex' }}>
      <Lock size={13} />
      {error ? 'Не удалось расшифровать' : secret.status === 'wrong-device' ? 'Доступно только на устройстве чата' : 'Расшифровка…'}
    </span>
  );
}

/** Прокрутить ленту так, чтобы элемент оказался в нужном месте (без прокрутки внешних панелей). */
export function scrollToEl(container: HTMLElement | null, el: Element | null, where: 'center' | 'top' = 'center', smooth = true) {
  if (!container || !el) return;
  const c = container.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  const delta = where === 'center' ? r.top + r.height / 2 - (c.top + c.height / 2) : r.top - c.top - 56;
  container.scrollBy({ top: delta, behavior: smooth ? 'smooth' : 'auto' });
}

// ─── Меню сообщения на сенсорном экране ─────────────────────────────────────

/**
 * Как в Telegram: фон размывается, пузырь «поднимается» (это копия пузыря),
 * сверху — реакции, снизу — действия. Всё укладывается в экран.
 */
function MessageFocus({
  source,
  rowClass,
  out,
  reactions,
  items,
  onReact,
  onMoreReactions,
  onClose,
}: {
  source: HTMLElement;
  rowClass: string;
  out: boolean;
  reactions: boolean;
  items: MenuItem[];
  onReact: (emoji: string) => void;
  onMoreReactions: (x: number, y: number) => void;
  onClose: () => void;
}) {
  const holder = useRef<HTMLDivElement>(null);
  const stack = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left?: number; right?: number; maxH?: number } | null>(null);

  useLayoutEffect(() => {
    const rect = source.getBoundingClientRect();
    const clone = source.cloneNode(true) as HTMLElement;
    clone.classList.remove('bubble--highlight');
    clone.style.width = `${rect.width}px`;
    clone.style.maxWidth = 'none';
    clone.querySelectorAll('video').forEach((v) => v.removeAttribute('autoplay'));
    holder.current?.replaceChildren(clone);
    const W = window.innerWidth;
    const H = window.visualViewport?.height ?? window.innerHeight;
    const pad = 10;
    const reactH = reactions ? 58 : 0;
    const menuH = (stack.current?.querySelector('.msg-focus__menu')?.getBoundingClientRect().height ?? 0) + 8;
    let bubbleH = rect.height;
    let maxH: number | undefined;
    const avail = H - pad * 2 - reactH - menuH;
    if (bubbleH > avail) {
      maxH = Math.max(72, avail);
      bubbleH = maxH;
    }
    let top = rect.top - reactH;
    if (top + reactH + bubbleH + menuH > H - pad) top = H - pad - (reactH + bubbleH + menuH);
    if (top < pad) top = pad;
    setPos(out ? { top, right: Math.max(8, W - rect.right), maxH } : { top, left: Math.max(8, Math.min(rect.left, W - 240)), maxH });
  }, [source, out, reactions]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return createPortal(
    <div
      className="msg-focus"
      onPointerDown={(e) => e.target === e.currentTarget && onClose()}
      onContextMenu={(e) => e.preventDefault()}
      role="dialog"
      aria-modal="true"
      aria-label="Действия с сообщением"
    >
      <div
        ref={stack}
        className={cn('msg-focus__stack', out && 'msg-focus__stack--out')}
        style={{ top: pos?.top ?? 0, left: pos?.left, right: pos?.right, visibility: pos ? 'visible' : 'hidden' }}
        onPointerDown={(e) => e.target === e.currentTarget && onClose()}
      >
        {reactions && (
          <div className="msg-focus__reactions">
            {REACTIONS.slice(0, 7).map((emoji) => (
              <button key={emoji} type="button" onClick={() => onReact(emoji)} aria-label={`Реакция ${emoji}`}>
                {emoji}
              </button>
            ))}
            <button
              type="button"
              className="msg-focus__more"
              aria-label="Другие реакции"
              onClick={(ev) => {
                const r = ev.currentTarget.getBoundingClientRect();
                onMoreReactions(r.left, r.bottom);
              }}
            >
              <Plus size={20} />
            </button>
          </div>
        )}
        <div className={rowClass}>
          <div ref={holder} className="msg-focus__bubble" style={pos?.maxH ? { maxHeight: pos.maxH, overflow: 'hidden', borderRadius: 18 } : undefined} />
        </div>
        <div className="msg-focus__menu" role="menu">
          {items.map((it) => (
            <button
              key={it.label}
              type="button"
              role="menuitem"
              className={cn('msg-focus__item', it.danger && 'msg-focus__item--danger')}
              onClick={() => {
                onClose();
                it.onClick();
              }}
            >
              {it.icon}
              <span className="grow">{it.label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ─── Пузырь ──────────────────────────────────────────────────────────────────

interface BubbleProps {
  msg: LocalMessage;
  chat: ChatSummary;
  myId: string;
  grouped: boolean;
  groupedNext: boolean;
  secret: SecretState;
  actions: MessageActions;
  selecting?: boolean;
  selected?: boolean;
}

interface Gesture {
  x: number;
  y: number;
  dx: number;
  mode: 'h' | 'v' | null;
  timer: ReturnType<typeof setTimeout> | null;
  long: boolean;
  armed: boolean;
  target: HTMLElement;
}

const Bubble = memo(function Bubble({ msg, chat, myId, grouped, groupedNext, secret, actions, selecting = false, selected = false }: BubbleProps) {
  const menu = useMenu();
  const roleColors = useContext(SenderColors);
  const [picker, setPicker] = useState<{ x: number; y: number } | null>(null);
  const [focus, setFocus] = useState<HTMLElement | null>(null);
  const [burst, setBurst] = useState<{ x: number; y: number; key: number } | null>(null);
  const row = useRef<HTMLDivElement>(null);
  const bubbleRef = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const lastTap = useRef<{ t: number; x: number; y: number } | null>(null);
  const lastTouch = useRef(0);
  // Пост канала — широкая карточка от имени канала, а не «пузырь» отправителя
  const post = chat.type === 'channel';
  const mine = msg.sender?.id === myId;
  const out = mine && !post;
  const showSender = !out && !grouped && chat.type === 'group';
  const showAvatar = !out && chat.type === 'group';
  const special = msg.kind === 'voice' || msg.kind === 'round' || msg.kind === 'poll' || msg.kind === 'call';
  const hasMedia = msg.media.length > 0 && !special;
  const secretPlain = useDecrypted(chat.id, msg.id, msg.clientId, msg.encrypted, secret).text;
  const plain = msg.kind === 'encrypted' ? secretPlain : msg.text;
  const isAdmin = chat.role === 'owner' || chat.role === 'admin';
  const jumboOn = usePrefs((s) => s.jumboEmoji ?? true);
  const jumbo = jumboOn && !hasMedia && !msg.replyTo && !msg.forwardedFrom && isJumboEmoji(plain);
  const mediaOnly = hasMedia && !plain && !msg.replyTo && !msg.forwardedFrom;
  const canEdit = mine && !msg.local && Date.now() - Date.parse(msg.createdAt) < EDIT_WINDOW && (msg.kind === 'text' || (msg.kind === 'encrypted' && secretPlain !== null));
  const canPin = !msg.local && msg.kind !== 'call' && (chat.type === 'direct' || chat.type === 'saved' || chat.type === 'secret' || isAdmin);
  const canForward = chat.type !== 'secret' && !msg.local && msg.kind !== 'poll' && msg.kind !== 'call';
  const canReact = !msg.local && !!chat.role && msg.kind !== 'system';
  const canSwipeReply = !msg.local && !post && !selecting && !!chat.role && msg.kind !== 'system' && !chat.system;
  const pinned = chat.pinnedMessage?.id === msg.id;

  const entries: MenuEntry[] =
    msg.local?.status === 'failed'
      ? [
          { label: 'Отправить снова', icon: <RotateCcw size={18} />, onClick: () => actions.retry(msg) },
          { label: 'Удалить', icon: <Trash2 size={18} />, danger: true, onClick: () => actions.remove(msg) },
        ]
      : [
          { label: 'Ответить', icon: <Reply size={18} />, onClick: () => actions.reply(msg), hidden: !!msg.local || post || !chat.role || chat.system },
          { label: 'Комментарии', icon: <MessageSquare size={18} />, onClick: () => actions.comments?.(msg), hidden: !post || !chat.commentsEnabled || !!msg.local },
          { label: 'Копировать текст', icon: <Copy size={18} />, onClick: () => actions.copy(plain ?? ''), hidden: !plain },
          { label: 'Изменить', icon: <Pencil size={18} />, onClick: () => actions.edit(msg, plain ?? ''), hidden: !canEdit },
          { label: pinned ? 'Открепить' : 'Закрепить', icon: pinned ? <PinOff size={18} /> : <Pin size={18} />, onClick: () => actions.pin(msg), hidden: !canPin },
          { label: 'Переслать', icon: <Forward size={18} />, onClick: () => actions.forward(msg), hidden: !canForward },
          { label: 'Прочитали', icon: <Eye size={18} />, onClick: () => actions.readers(msg), hidden: !out || chat.type !== 'group' || !!msg.local },
          { label: 'Выбрать', icon: <CheckCircle2 size={18} />, onClick: () => actions.select?.(msg), hidden: !actions.select || !!msg.local },
          { label: 'Пожаловаться', icon: <Flag size={18} />, onClick: () => actions.report(msg), hidden: mine || chat.type === 'saved' },
          'separator',
          { label: 'Удалить', icon: <Trash2 size={18} />, danger: true, onClick: () => actions.remove(msg), hidden: !!msg.local || (post && !isAdmin) || chat.system },
        ];
  const flatItems = entries.filter((i): i is MenuItem => i !== 'separator' && !i.hidden);

  const openFocus = () => {
    if (bubbleRef.current) setFocus(bubbleRef.current);
  };
  const setShift = (x: number, settle: boolean) => {
    const el = row.current;
    if (!el) return;
    el.classList.toggle('msg--swiping', !settle);
    el.classList.toggle('msg--settling', settle);
    const content = el.querySelector<HTMLElement>('.msg__content');
    const hint = el.querySelector<HTMLElement>('.msg__reply-hint');
    if (content) content.style.transform = x ? `translateX(${x}px)` : '';
    if (hint) {
      const p = Math.min(1, x / SWIPE_REPLY);
      hint.style.opacity = String(p);
      hint.style.transform = `scale(${0.6 + p * 0.4})`;
    }
  };

  const quickReact = (x: number, y: number) => {
    const r = row.current?.getBoundingClientRect();
    if (r) setBurst({ x: x - r.left, y: y - r.top, key: Date.now() });
    actions.react(msg, QUICK_REACTION);
    navigator.vibrate?.(6);
  };

  const touchProps = {
    onTouchStart: (e: React.TouchEvent) => {
      lastTouch.current = Date.now();
      if (e.touches.length > 1) return;
      const t = e.touches[0]!;
      const timer = selecting
        ? null
        : setTimeout(() => {
            const g = gesture.current;
            if (!g || g.mode) return;
            g.long = true;
            navigator.vibrate?.(10);
            openFocus();
          }, 420);
      gesture.current = { x: t.clientX, y: t.clientY, dx: 0, mode: null, timer, long: false, armed: false, target: e.target as HTMLElement };
    },
    onTouchMove: (e: React.TouchEvent) => {
      const g = gesture.current;
      if (!g || g.long) return;
      const t = e.touches[0]!;
      const dx = t.clientX - g.x;
      const dy = t.clientY - g.y;
      if (!g.mode) {
        // Свайп вправо — ответить; от самого края не перехватываем системный жест «назад»
        if (canSwipeReply && dx > 10 && Math.abs(dx) > Math.abs(dy) * 1.3 && g.x > 24) g.mode = 'h';
        else if (Math.abs(dy) > 8 || Math.abs(dx) > 10) g.mode = 'v';
        if (g.mode && g.timer) clearTimeout(g.timer);
      }
      if (g.mode !== 'h') return;
      const x = Math.max(0, dx);
      g.dx = x;
      setShift(x < 72 ? x : 72 + (x - 72) * 0.3, false);
      if (x >= SWIPE_REPLY && !g.armed) {
        g.armed = true;
        navigator.vibrate?.(8);
      } else if (x < SWIPE_REPLY) g.armed = false;
    },
    onTouchEnd: (e: React.TouchEvent) => {
      const g = gesture.current;
      gesture.current = null;
      if (!g) return;
      if (g.timer) clearTimeout(g.timer);
      if (g.mode === 'h') {
        setShift(0, true);
        if (g.dx >= SWIPE_REPLY) actions.reply(msg);
        return;
      }
      if (g.long || g.mode || selecting) return;
      // Двойное касание по тексту — быстрая реакция
      const t = e.changedTouches[0]!;
      const now = Date.now();
      const interactive = g.target.closest('a, button, video, audio, input, .media-grid, .poll, .voice, .round, .system-code');
      const prev = lastTap.current;
      if (!interactive && canReact && !post && prev && now - prev.t < 300 && Math.hypot(t.clientX - prev.x, t.clientY - prev.y) < 30) {
        e.preventDefault();
        lastTap.current = null;
        quickReact(t.clientX, t.clientY);
      } else lastTap.current = { t: now, x: t.clientX, y: t.clientY };
    },
    onTouchCancel: () => {
      const g = gesture.current;
      gesture.current = null;
      if (g?.timer) clearTimeout(g.timer);
      if (g?.mode === 'h') setShift(0, true);
    },
  };

  const tail = !groupedNext && !post;
  const rowClass = cn('msg', out && 'msg--out', post && 'msg--post', grouped && 'msg--grouped', groupedNext && 'msg--grouped-next', tail && 'msg--tail');

  return (
    <div
      ref={row}
      className={cn(rowClass, selected && 'msg--selected')}
      onContextMenu={(e) => {
        e.preventDefault();
        // На сенсорном экране меню открывает долгое касание — системное не нужно
        if (Date.now() - lastTouch.current < 1000 || selecting) return;
        menu.openFromEvent(e);
      }}
      onClickCapture={
        selecting
          ? (e) => {
              e.preventDefault();
              e.stopPropagation();
              if (!msg.local) actions.select?.(msg);
            }
          : undefined
      }
      onDoubleClick={() => Date.now() - lastTouch.current > 1000 && !msg.local && !post && chat.role && !chat.system && !selecting && actions.reply(msg)}
      {...touchProps}
    >
      {selecting && (
        <span className="msg__check" aria-hidden>
          {selected && <Check size={14} strokeWidth={3} />}
        </span>
      )}
      {canSwipeReply && (
        <span className="msg__reply-hint" aria-hidden>
          <Reply size={18} />
        </span>
      )}
      <div className="msg__content">
        {showAvatar && (
          <span className="msg__avatar-slot">{!groupedNext && msg.sender && <Avatar src={msg.sender.avatarUrl} name={msg.sender.displayName} id={msg.sender.id} size={34} />}</span>
        )}
        <div
          ref={bubbleRef}
          className={cn(
            'bubble',
            hasMedia && 'bubble--media',
            mediaOnly && !showSender && 'bubble--media-only',
            jumbo && 'bubble--jumbo',
            msg.kind === 'round' && 'bubble--round',
            msg.kind === 'poll' && 'bubble--poll',
            msg.kind === 'voice' && 'bubble--voice',
            msg.local?.status === 'failed' && 'bubble--failed',
            post && 'bubble--post',
          )}
          data-mid={msg.id}
          data-seq={msg.seq}
          data-view={post && !msg.local ? msg.id : undefined}
        >
          {post && (
            <div className="post-head">
              <Avatar src={chat.avatarUrl} name={chat.title} id={chat.id} size={26} />
              <b className="ellipsis">{chat.title}</b>
            </div>
          )}
          {showSender && msg.sender && (
            <div className="bubble__sender" style={{ color: roleColors?.get(msg.sender.id) ?? `hsl(${(msg.sender.id.charCodeAt(12) * 37) % 360} 62% 58%)` }}>
              {msg.sender.displayName}
            </div>
          )}
          {msg.forwardedFrom && (
            <div className="bubble__forward">
              <Forward size={13} /> <span className="ellipsis">Переслано от {msg.forwardedFrom.senderName}</span>
            </div>
          )}
          {msg.replyTo && (
            <button type="button" className="bubble__reply" onClick={() => !selecting && actions.jumpTo?.(msg.replyTo!.id)}>
              <span className="bubble__reply-name">{msg.replyTo.senderName ?? 'Сообщение'}</span>
              <span className="bubble__reply-text ellipsis">
                {msg.replyTo.kind === 'encrypted'
                  ? 'Зашифрованное сообщение'
                  : msg.replyTo.text || (msg.replyTo.kind === 'voice' ? 'Голосовое сообщение' : msg.replyTo.kind === 'round' ? 'Видеосообщение' : 'Вложение')}
              </span>
            </button>
          )}
          {hasMedia && <MediaGrid media={msg.media} />}
          {msg.kind === 'voice' && msg.media[0] && <VoiceMessage media={msg.media[0]} out={out} />}
          {msg.kind === 'round' && msg.media[0] && <RoundMessage media={msg.media[0]} />}
          {msg.kind === 'poll' && msg.poll && <PollMessage message={msg} canClose={out || isAdmin} />}
          {msg.kind === 'call' && msg.call && <CallMessage call={msg.call} myId={myId} onCallBack={actions.callBack} />}
          {chat.system && msg.text && <SystemCode text={msg.text} />}
          {msg.kind === 'encrypted' ? <SecretBody msg={msg} chat={chat} secret={secret} /> : !special && msg.text && <RichText text={msg.text} className="bubble__text" />}
          {!post && (
            <span className="bubble__meta">
              {msg.silent && out && <BellOff size={11} aria-label="без звука" />}
              {pinned && <Pin size={11} aria-label="закреплено" />}
              {msg.editedAt && <span className="bubble__edited">изм.</span>}
              {msg.expiresAt && <Clock size={11} />}
              <span>{clockTime(msg.createdAt)}</span>
              {out && <Ticks msg={msg} chat={chat} />}
            </span>
          )}
          {!post && msg.reactions.length > 0 && (
            <div className="reactions">
              {msg.reactions.map((r) => (
                <button
                  key={r.emoji}
                  className={cn('reaction', r.mine && 'reaction--mine')}
                  onClick={() => !selecting && actions.react(msg, r.emoji)}
                  aria-label={`${r.emoji} ${r.count}`}
                  aria-pressed={r.mine}
                >
                  {r.emoji}
                  {(post || r.count > 1) && <span>{compactNumber(r.count)}</span>}
                </button>
              ))}
              {post && !msg.local && !!chat.role && (
                <button
                  className="reaction reaction--add"
                  aria-label="Поставить реакцию"
                  title="Поставить реакцию"
                  onClick={(ev) => {
                    const rect = (ev.currentTarget as HTMLElement).getBoundingClientRect();
                    setPicker({ x: rect.left + 160, y: rect.bottom });
                  }}
                >
                  <SmilePlus size={15} />
                </button>
              )}
            </div>
          )}
          {post && (
            <div className="post-foot">
              {!msg.local && (msg.reactions.length > 0 || !!chat.role) ? (
                <div className="reactions">
                  {msg.reactions.map((r) => (
                    <button
                      key={r.emoji}
                      className={cn('reaction', r.mine && 'reaction--mine')}
                      onClick={() => !selecting && actions.react(msg, r.emoji)}
                      aria-label={`${r.emoji} ${r.count}`}
                      aria-pressed={r.mine}
                    >
                      {r.emoji}
                      {(post || r.count > 1) && <span>{compactNumber(r.count)}</span>}
                    </button>
                  ))}
                  {post && !msg.local && !!chat.role && (
                    <button
                      className="reaction reaction--add"
                      aria-label="Поставить реакцию"
                      title="Поставить реакцию"
                      onClick={(ev) => {
                        const rect = (ev.currentTarget as HTMLElement).getBoundingClientRect();
                        setPicker({ x: rect.left + 160, y: rect.bottom });
                      }}
                    >
                      <SmilePlus size={15} />
                    </button>
                  )}
                </div>
              ) : (
                <span />
              )}
              <span className="post-meta">
                {msg.local?.status === 'sending' && <Clock size={12} />}
                {msg.local?.status === 'failed' && <AlertCircle size={13} style={{ color: 'var(--danger)' }} />}
                {msg.viewCount !== null && !msg.local && (
                  <span className="row gap-1" title="Просмотры">
                    <Eye size={13} /> {compactNumber(msg.viewCount)}
                  </span>
                )}
                {msg.editedAt && <span>изм.</span>}
                <span>{clockTime(msg.createdAt)}</span>
              </span>
            </div>
          )}
          {post && chat.commentsEnabled && !msg.local && (
            <button type="button" className="post-comments" onClick={() => actions.comments?.(msg)}>
              <MessageSquare size={16} />
              <span className="grow">
                {msg.commentCount ? `${compactNumber(msg.commentCount)} ${plural(msg.commentCount, 'комментарий', 'комментария', 'комментариев')}` : 'Прокомментировать'}
              </span>
              <ChevronRight size={16} />
            </button>
          )}
        </div>
        {!selecting && (
          <button className="icon-btn icon-btn--sm msg__actions" aria-label="Действия с сообщением" onClick={(e) => menu.openFromEvent(e)}>
            <Ellipsis size={16} />
          </button>
        )}
      </div>
      {burst && (
        <span key={burst.key} className="msg__burst" style={{ left: burst.x, top: burst.y }} onAnimationEnd={() => setBurst(null)} aria-hidden>
          {QUICK_REACTION}
        </span>
      )}
      <Menu
        anchor={menu.anchor}
        onClose={menu.close}
        items={entries}
        header={
          canReact ? (
            <div className="menu__reactions">
              {REACTIONS.slice(0, 7).map((e) => (
                <button
                  key={e}
                  onClick={() => {
                    menu.close();
                    actions.react(msg, e);
                  }}
                  aria-label={`Реакция ${e}`}
                >
                  {e}
                </button>
              ))}
              <button
                className="menu__reactions-more"
                aria-label="Другие реакции"
                onClick={(ev) => {
                  const rect = (ev.currentTarget as HTMLElement).getBoundingClientRect();
                  menu.close();
                  setPicker({ x: rect.left, y: rect.bottom });
                }}
              >
                <Plus size={18} />
              </button>
            </div>
          ) : null
        }
      />
      {focus && (
        <MessageFocus
          source={focus}
          rowClass={rowClass}
          out={out}
          reactions={canReact}
          items={flatItems}
          onClose={() => setFocus(null)}
          onReact={(emoji) => {
            setFocus(null);
            actions.react(msg, emoji);
          }}
          onMoreReactions={(x, y) => {
            setFocus(null);
            setPicker({ x: x + 160, y });
          }}
        />
      )}
      {/* В портале: у панели переписки есть backdrop-filter, и position: fixed внутри неё считался бы от панели */}
      {picker &&
        createPortal(
          <div className="reaction-picker-layer" onPointerDown={(e) => e.target === e.currentTarget && setPicker(null)}>
            <div
              className="reaction-picker"
              style={{ left: Math.max(8, Math.min(picker.x - 160, window.innerWidth - 348)), top: Math.max(8, Math.min(picker.y + 6, window.innerHeight - 370)) }}
            >
              <EmojiPicker
                autoFocus
                onClose={() => setPicker(null)}
                onPick={(e) => {
                  setPicker(null);
                  actions.react(msg, e);
                }}
              />
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
});

// ─── Лента ───────────────────────────────────────────────────────────────────

interface ListProps {
  messages: LocalMessage[];
  chat: ChatSummary;
  myId: string;
  secret: SecretState;
  actions: MessageActions;
  hasOlder: boolean;
  loadingOlder: boolean;
  onLoadOlder: () => void;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  onScroll: () => void;
  footer?: ReactNode;
  /** Выбранные сообщения (режим выделения) */
  selection?: ReadonlySet<string>;
}

const GROUP_MS = 5 * 60_000;

export function MessageList({ messages, chat, myId, secret, actions, hasOlder, loadingOlder, onLoadOlder, scrollRef, onScroll, selection }: ListProps) {
  const sentinel = useInfiniteScroll(onLoadOlder, hasOlder && !loadingOlder, '400px');
  const selecting = !!selection && selection.size > 0;
  // Граница «Непрочитанные сообщения» запоминается при открытии чата и не прыгает, пока его читают
  const unread = useRef<{ chatId: string; seq: number } | null>(null);
  if (unread.current?.chatId !== chat.id) unread.current = { chatId: chat.id, seq: chat.unreadCount > 0 ? chat.lastReadSeq : Infinity };
  const unreadSeq = unread.current.seq;

  const rendered: ReactNode[] = [];
  let lastDay = '';
  let unreadShown = false;
  messages.forEach((m, i) => {
    const day = new Date(m.createdAt).toDateString();
    if (day !== lastDay) {
      rendered.push(
        <div key={`day-${day}`} className="day-sep">
          {dayLabel(m.createdAt)}
        </div>,
      );
      lastDay = day;
    }
    if (!unreadShown && m.seq > unreadSeq && !m.local && m.sender?.id !== myId) {
      unreadShown = true;
      rendered.push(
        <div key="unread-sep" className="unread-sep">
          Непрочитанные сообщения
        </div>,
      );
    }
    if (m.kind === 'system') {
      rendered.push(
        <div key={m.id} className="sys-msg">
          <b>{m.sender?.id === myId ? 'Вы' : m.sender?.displayName}</b> {m.text}
        </div>,
      );
      return;
    }
    const prev = messages[i - 1];
    const next = messages[i + 1];
    const same = (a?: LocalMessage, b?: LocalMessage) =>
      !!a &&
      !!b &&
      a.kind !== 'system' &&
      b.kind !== 'system' &&
      a.sender?.id === b.sender?.id &&
      Math.abs(Date.parse(a.createdAt) - Date.parse(b.createdAt)) < GROUP_MS &&
      new Date(a.createdAt).toDateString() === new Date(b.createdAt).toDateString() &&
      // Граница непрочитанного разрывает группу
      !(a.seq <= unreadSeq && b.seq > unreadSeq && b.sender?.id !== myId);
    const flat = chat.type === 'channel';
    rendered.push(
      <Bubble
        key={m.clientId ?? m.id}
        msg={m}
        chat={chat}
        myId={myId}
        grouped={!flat && same(prev, m)}
        groupedNext={!flat && same(m, next)}
        secret={secret}
        actions={actions}
        selecting={selecting}
        selected={!!selection?.has(m.id)}
      />,
    );
  });

  // При открытии чата: к первому непрочитанному, иначе — в самый низ
  const positioned = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (positioned.current === chat.id || !messages.length) return;
    positioned.current = chat.id;
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: 0 });
    const sep = el.querySelector('.unread-sep');
    if (sep) scrollToEl(el, sep, 'top', false);
  }, [chat.id, messages.length, scrollRef]);

  return (
    <div className={cn('messages', selecting && 'messages--selecting')} ref={scrollRef} onScroll={onScroll} role="log" aria-live="polite" aria-label="Сообщения">
      <div className="messages__inner">
        {hasOlder && <div ref={sentinel} style={{ height: 1 }} />}
        {loadingOlder && (
          <div className="center-fill" style={{ padding: 12 }}>
            <span className="spinner" />
          </div>
        )}
        {!hasOlder && chat.type === 'secret' && (
          <div className="sys-msg sys-msg--card">
            <Lock size={13} style={{ verticalAlign: -2 }} /> Сообщения в этом чате защищены сквозным шифрованием. Ключи хранятся только на ваших устройствах — сервер не может их
            прочитать.
          </div>
        )}
        {rendered}
      </div>
    </div>
  );
}

/** Код из сообщения Sunnet — крупно и с кнопкой «Скопировать». */
function SystemCode({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const code = /^Код[^:\n]*:\s*(\d{6})/.exec(text)?.[1];
  if (!code) return null;
  return (
    <div className="system-code">
      <span className="system-code__value" aria-label={`Код ${code.split('').join(' ')}`}>
        {code.slice(0, 3)} {code.slice(3)}
      </span>
      <button
        type="button"
        className="system-code__copy"
        onClick={async () => {
          await navigator.clipboard.writeText(code).catch(() => undefined);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
      >
        {copied ? <Check size={15} /> : <Copy size={15} />}
        {copied ? 'Скопировано' : 'Скопировать'}
      </button>
    </div>
  );
}
