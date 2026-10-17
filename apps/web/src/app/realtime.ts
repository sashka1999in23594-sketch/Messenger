/** Обработка событий реального времени: обновление кэша, индикаторы, тосты. */
import type { ServerEvent } from '@omni/shared';
import { excerpt } from '@omni/shared';
import { messageLabel } from '../shared/lib/format';
import { qk, queryClient } from '../shared/api/query';
import { realtime } from '../shared/realtime/socket';
import { useRealtime } from '../shared/stores/realtime';
import { useSession } from '../shared/stores/session';
import { toast } from '../shared/stores/ui';
import { handleCallEvent, restoreIncomingCall } from '../shared/calls/engine';
import { desktopNotify, playSound } from '../shared/lib/sounds';
import { isQuietNow, usePrefs } from '../shared/stores/prefs';
import { activeChat, forgetChat, onIncomingMessage, patchChat, patchMessage, removeMessage } from '../features/chats/cache';
import { onCommentDeleted, onIncomingComment } from '../features/chats/channel';

type Navigate = (to: string) => void;
let navigateFn: Navigate = (to) => window.location.assign(to);
export function setRealtimeNavigate(fn: Navigate) {
  navigateFn = fn;
}

export const sessionEvents = new EventTarget();

function handle(event: ServerEvent): void {
  const me = useSession.getState().me;
  if (!me) return;
  switch (event.t) {
    case 'message.new': {
      // Комментарий к посту канала — в ветку, а не в ленту канала
      if (event.message.threadRootId) {
        onIncomingComment(event.message);
        break;
      }
      onIncomingMessage(event.message, me.id);
      useRealtime.getState().clearTyping(event.chatId, event.message.sender?.id ?? '');
      const fromOther = event.message.sender && event.message.sender.id !== me.id;
      // «Без звука»: сообщение приходит, но не всплывает
      const visibleChat = activeChat.id === event.chatId && !document.hidden;
      if (fromOther && !visibleChat && event.message.kind !== 'system' && !event.message.silent) {
        const chat = queryClient.getQueryData<{ mutedUntil: string | null; title: string }>(qk.chat(event.chatId));
        // «Не беспокоить» по расписанию: сообщения приходят, но без всплывашек и звука
        if (!chat?.mutedUntil && me.notifications.messages && !isQuietNow(usePrefs.getState().quietHours)) {
          const preview = me.notifications.showPreviews ? excerpt(messageLabel(event.message.kind, event.message.text), 80) || 'Медиа' : 'Новое сообщение';
          const isChannel = queryClient.getQueryData<{ type: string }>(qk.chat(event.chatId))?.type === 'channel';
          const open = () => navigateFn(`/${isChannel ? 'channels' : 'chats'}/${event.chatId}`);
          if (activeChat.id !== event.chatId) toast({ text: `${event.message.sender!.displayName}: ${preview}`, action: { label: 'Открыть', onClick: open } });
          playSound('message');
          desktopNotify(event.message.sender!.displayName, preview, open);
        }
      }
      break;
    }
    case 'message.updated':
      patchMessage(event.chatId, (m) => m.id === event.message.id, () => event.message);
      break;
    case 'message.deleted':
      removeMessage(event.chatId, event.messageId);
      onCommentDeleted(event.chatId, event.messageId);
      void queryClient.invalidateQueries({ queryKey: qk.chatsAll });
      break;
    case 'chat.changed':
      void queryClient.invalidateQueries({ queryKey: qk.chat(event.chatId) });
      void queryClient.invalidateQueries({ queryKey: qk.chatsAll });
      void queryClient.invalidateQueries({ queryKey: qk.members(event.chatId) });
      break;
    case 'chat.removed':
      forgetChat(event.chatId);
      if (activeChat.id === event.chatId) navigateFn(window.location.pathname.startsWith('/channels') ? '/channels' : '/chats');
      break;
    case 'typing':
      useRealtime.getState().addTyping(event.chatId, event.userId, event.displayName, event.activity);
      break;
    case 'read':
      patchChat(event.chatId, (c) => ({ ...c, peerReadSeq: Math.max(c.peerReadSeq, event.seq) }));
      break;
    case 'presence':
      useRealtime.getState().setPresence(event.userId, event.online, event.lastSeenAt);
      break;
    case 'notification.new':
      void queryClient.invalidateQueries({ queryKey: ['notifications'] });
      if (event.notification.type !== 'security') {
        playSound('notify');
        desktopNotify('SpaceUp', `${event.notification.actor?.displayName ?? ''} ${event.notification.preview ?? ''}`.trim() || 'Новое уведомление', () =>
          navigateFn(event.notification.link ?? '/notifications'),
        );
      }
      if (event.notification.type === 'security') {
        toast({ text: event.notification.preview ?? 'Событие безопасности', kind: 'error', action: { label: 'Проверить', onClick: () => navigateFn('/settings/security/sessions') } });
      }
      break;
    case 'counters':
      useSession.getState().setCounters(event.counters);
      break;
    case 'call.incoming':
    case 'call.updated':
    case 'call.signal':
      void handleCallEvent(event).catch(() => undefined);
      break;
    case 'session.revoked':
      sessionEvents.dispatchEvent(new Event('revoked'));
      break;
    default:
      break;
  }
}

let started = false;
export function startRealtime(): void {
  if (started) return;
  started = true;
  realtime.on(handle);
  // После обрыва связи догружаем пропущенное
  realtime.onReconnect(() => {
    void queryClient.invalidateQueries({ queryKey: qk.chatsAll });
    if (activeChat.id) void queryClient.invalidateQueries({ queryKey: qk.messages(activeChat.id) });
  });
  realtime.connect();
  void restoreIncomingCall();
}

export function stopRealtime(): void {
  realtime.disconnect();
}
