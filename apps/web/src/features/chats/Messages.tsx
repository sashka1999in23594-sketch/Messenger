import { createContext, memo, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AlertCircle, BellOff, Check, CheckCheck, ChevronRight, Clock, Copy, Ellipsis, Eye, Flag, Forward, Lock, MessageSquare, Pencil, Pin, Plus, Reply, RotateCcw, SmilePlus, Trash2 } from 'lucide-react';
import { REACTIONS, type ChatSummary } from '@omni/shared';
import { Avatar, EmojiPicker, Menu, MediaGrid, RichText, useMenu, type MenuEntry } from '../../shared/ui';
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
}

const EDIT_WINDOW = 48 * 3600 * 1000;

/** Цвета имён авторов (в компаниях и сообществах — цвет главной роли). */
export const SenderColors = createContext<Map<string, string> | null>(null);

function Ticks({ msg, chat }: { msg: LocalMessage; chat: ChatSummary }) {
  if (msg.local?.status === 'sending') return <Clock size={13} />;
  if (msg.local?.status === 'failed') return <AlertCircle size={14} style={{ color: 'var(--danger)' }} />;
  if (chat.type === 'channel' || chat.type === 'saved') return <Check size={14} />;
  return msg.seq <= chat.peerReadSeq ? <CheckCheck size={15} className="bubble__ticks--read" /> : <Check size={15} />;
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

interface BubbleProps {
  msg: LocalMessage;
  chat: ChatSummary;
  myId: string;
  grouped: boolean;
  groupedNext: boolean;
  secret: SecretState;
  actions: MessageActions;
}

const Bubble = memo(function Bubble({ msg, chat, myId, grouped, groupedNext, secret, actions }: BubbleProps) {
  const menu = useMenu();
  const roleColors = useContext(SenderColors);
  const [picker, setPicker] = useState<{ x: number; y: number } | null>(null);
  const longPress = useRef<ReturnType<typeof setTimeout> | null>(null);
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

  const items: MenuEntry[] = msg.local?.status === 'failed'
    ? [
        { label: 'Отправить снова', icon: <RotateCcw size={18} />, onClick: () => actions.retry(msg) },
        { label: 'Удалить', icon: <Trash2 size={18} />, danger: true, onClick: () => actions.remove(msg) },
      ]
    : [
        { label: 'Ответить', icon: <Reply size={18} />, onClick: () => actions.reply(msg), hidden: !!msg.local || post },
        { label: 'Комментарии', icon: <MessageSquare size={18} />, onClick: () => actions.comments?.(msg), hidden: !post || !chat.commentsEnabled || !!msg.local },
        { label: 'Копировать текст', icon: <Copy size={18} />, onClick: () => actions.copy(plain ?? ''), hidden: !plain },
        { label: 'Изменить', icon: <Pencil size={18} />, onClick: () => actions.edit(msg, plain ?? ''), hidden: !canEdit },
        { label: 'Переслать', icon: <Forward size={18} />, onClick: () => actions.forward(msg), hidden: !canForward },
        { label: 'Прочитали', icon: <Eye size={18} />, onClick: () => actions.readers(msg), hidden: !out || chat.type !== 'group' || !!msg.local },
        { label: chat.pinnedMessage?.id === msg.id ? 'Открепить' : 'Закрепить', icon: <Pin size={18} />, onClick: () => actions.pin(msg), hidden: !canPin },
        { label: 'Пожаловаться', icon: <Flag size={18} />, onClick: () => actions.report(msg), hidden: mine || chat.type === 'saved' },
        'separator',
        { label: 'Удалить', icon: <Trash2 size={18} />, danger: true, onClick: () => actions.remove(msg), hidden: !!msg.local || (post && !isAdmin) },
      ];

  return (
    <div
      className={cn('msg', out && 'msg--out', post && 'msg--post', grouped && 'msg--grouped', groupedNext && 'msg--grouped-next')}
      onContextMenu={(e) => menu.openFromEvent(e)}
      onTouchStart={(e) => {
        const t = e.touches[0];
        longPress.current = setTimeout(() => t && menu.openAt(t.clientX, t.clientY), 450);
      }}
      onTouchEnd={() => longPress.current && clearTimeout(longPress.current)}
      onTouchMove={() => longPress.current && clearTimeout(longPress.current)}
      onDoubleClick={() => !msg.local && !post && actions.reply(msg)}
    >
      {showAvatar && (
        <span className="msg__avatar-slot">
          {!groupedNext && msg.sender && <Avatar src={msg.sender.avatarUrl} name={msg.sender.displayName} id={msg.sender.id} size={34} />}
        </span>
      )}
      <div
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
            <Avatar src={chat.avatarUrl} name={chat.title} id={chat.id} size={28} />
            <b className="ellipsis">{chat.title}</b>
          </div>
        )}
        {showSender && msg.sender && (
          <div className="bubble__sender" style={{ color: roleColors?.get(msg.sender.id) ?? `hsl(${(msg.sender.id.charCodeAt(12) * 37) % 360} 65% 55%)` }}>
            {msg.sender.displayName}
          </div>
        )}
        {msg.forwardedFrom && <div className="bubble__forward">↪ Переслано от {msg.forwardedFrom.senderName}</div>}
        {msg.replyTo && (
          <div className="bubble__reply">
            <span className="bubble__reply-name">{msg.replyTo.senderName ?? 'Сообщение'}</span>
            <span className="ellipsis">{msg.replyTo.kind === 'encrypted' ? '🔒 Зашифрованное сообщение' : msg.replyTo.text || 'Вложение'}</span>
          </div>
        )}
        {hasMedia && <MediaGrid media={msg.media} />}
        {msg.kind === 'voice' && msg.media[0] && <VoiceMessage media={msg.media[0]} out={out} />}
        {msg.kind === 'round' && msg.media[0] && <RoundMessage media={msg.media[0]} />}
        {msg.kind === 'poll' && msg.poll && <PollMessage message={msg} canClose={out || isAdmin} />}
        {msg.kind === 'call' && msg.call && <CallMessage call={msg.call} myId={myId} onCallBack={actions.callBack} />}
        {chat.system && msg.text && <SystemCode text={msg.text} />}
        {msg.kind === 'encrypted' ? (
          <SecretBody msg={msg} chat={chat} secret={secret} />
        ) : (
          !special && msg.text && <RichText text={msg.text} className="bubble__text" />
        )}
        {!post && (
          <span className="bubble__meta">
            {msg.silent && out && <BellOff size={11} aria-label="без звука" />}
            {msg.editedAt && <span>изм.</span>}
            {msg.expiresAt && <Clock size={11} />}
            <span>{clockTime(msg.createdAt)}</span>
            {out && <Ticks msg={msg} chat={chat} />}
          </span>
        )}
        {(msg.reactions.length > 0 || (post && !msg.local && !!chat.role)) && (
          <div className="reactions">
            {msg.reactions.map((r) => (
              <button key={r.emoji} className={cn('reaction', r.mine && 'reaction--mine')} onClick={() => actions.react(msg, r.emoji)}>
                {r.emoji} {(post || r.count > 1) && compactNumber(r.count)}
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
        )}
        {post && chat.commentsEnabled && !msg.local && (
          <button type="button" className="post-comments" onClick={() => actions.comments?.(msg)}>
            <MessageSquare size={16} />
            <span className="grow">{msg.commentCount ? `${compactNumber(msg.commentCount)} ${plural(msg.commentCount, 'комментарий', 'комментария', 'комментариев')}` : 'Прокомментировать'}</span>
            <ChevronRight size={16} />
          </button>
        )}
      </div>
      <button className="icon-btn icon-btn--sm msg__actions" aria-label="Действия с сообщением" onClick={(e) => menu.openFromEvent(e)}>
        <Ellipsis size={16} />
      </button>
      <Menu
        anchor={menu.anchor}
        onClose={menu.close}
        items={items}
        header={
          !msg.local && msg.kind !== 'system' ? (
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
      {/* В портале: у панели переписки есть backdrop-filter, и position: fixed внутри неё считался бы от панели */}
      {picker &&
        createPortal(
          <div className="reaction-picker-layer" onPointerDown={(e) => e.target === e.currentTarget && setPicker(null)}>
            <div className="reaction-picker" style={{ left: Math.max(8, Math.min(picker.x - 160, window.innerWidth - 348)), top: Math.max(8, Math.min(picker.y + 6, window.innerHeight - 370)) }}>
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
}

const GROUP_MS = 5 * 60_000;

export function MessageList({ messages, chat, myId, secret, actions, hasOlder, loadingOlder, onLoadOlder, scrollRef, onScroll }: ListProps) {
  const sentinel = useInfiniteScroll(onLoadOlder, hasOlder && !loadingOlder, '400px');
  const rendered: ReactNode[] = [];
  let lastDay = '';
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
      !!a && !!b && a.kind !== 'system' && b.kind !== 'system' && a.sender?.id === b.sender?.id && Math.abs(Date.parse(a.createdAt) - Date.parse(b.createdAt)) < GROUP_MS && new Date(a.createdAt).toDateString() === new Date(b.createdAt).toDateString();
    const flat = chat.type === 'channel';
    rendered.push(
      <Bubble key={m.clientId ?? m.id} msg={m} chat={chat} myId={myId} grouped={!flat && same(prev, m)} groupedNext={!flat && same(m, next)} secret={secret} actions={actions} />,
    );
  });

  // Прокрутка вниз при открытии чата
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [chat.id, scrollRef]);

  return (
    <div className="messages" ref={scrollRef} onScroll={onScroll} role="log" aria-live="polite" aria-label="Сообщения">
      <div className="messages__inner">
        {hasOlder && <div ref={sentinel} style={{ height: 1 }} />}
        {loadingOlder && <div className="center-fill" style={{ padding: 12 }}><span className="spinner" /></div>}
        {!hasOlder && chat.type === 'secret' && (
          <div className="sys-msg" style={{ maxWidth: 420 }}>
            🔒 Сообщения в этом чате защищены сквозным шифрованием. Ключи хранятся только на ваших устройствах — сервер не может их прочитать.
          </div>
        )}
        {rendered}
      </div>
    </div>
  );
}

/** Код из сообщения SpaceUp — крупно и с кнопкой «Скопировать». */
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
