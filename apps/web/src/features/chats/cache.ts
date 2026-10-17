/**
 * Работа с кэшем сообщений и списков чатов: оптимистичная отправка,
 * слияние событий реального времени, дедупликация по clientId.
 */
import type { InfiniteData } from '@tanstack/react-query';
import type { ChatSummary, Message, Paginated } from '@omni/shared';
import { qk, queryClient } from '../../shared/api/query';

export type LocalMessage = Message & { local?: { status: 'sending' | 'failed'; error?: string } };
export interface MessagesPage {
  items: LocalMessage[];
  hasMore: boolean;
}
type MessagesData = InfiniteData<MessagesPage, number | undefined>;

/** Открытый сейчас чат (для счётчиков непрочитанного и отметки «прочитано»). */
export const activeChat = { id: null as string | null };

function sameMessage(a: LocalMessage, b: LocalMessage): boolean {
  return a.id === b.id || (!!a.clientId && a.clientId === b.clientId);
}

export function upsertMessage(chatId: string, msg: LocalMessage): void {
  queryClient.setQueryData<MessagesData>(qk.messages(chatId), (old) => {
    if (!old) return old;
    let replaced = false;
    const pages = old.pages.map((p) => {
      const idx = p.items.findIndex((m) => sameMessage(m, msg));
      if (idx === -1) return p;
      replaced = true;
      const items = [...p.items];
      items[idx] = msg;
      return { ...p, items };
    });
    if (!replaced && pages[0]) {
      const items = [...pages[0].items, msg].sort((a, b) => a.seq - b.seq);
      pages[0] = { ...pages[0], items };
    }
    return { ...old, pages };
  });
}

export function patchMessage(chatId: string, match: (m: LocalMessage) => boolean, patch: (m: LocalMessage) => LocalMessage): void {
  queryClient.setQueryData<MessagesData>(qk.messages(chatId), (old) =>
    old ? { ...old, pages: old.pages.map((p) => ({ ...p, items: p.items.map((m) => (match(m) ? patch(m) : m)) })) } : old,
  );
}

export function removeMessage(chatId: string, messageId: string): void {
  queryClient.setQueryData<MessagesData>(qk.messages(chatId), (old) =>
    old ? { ...old, pages: old.pages.map((p) => ({ ...p, items: p.items.filter((m) => m.id !== messageId) })) } : old,
  );
}

type ChatLists = InfiniteData<Paginated<ChatSummary>>;

/** Обновляет чат во всех списках и в карточке; если чата в списке нет — перезапрашивает. */
export function patchChat(chatId: string, patch: (c: ChatSummary) => ChatSummary, moveToTop = false): void {
  let found = false;
  queryClient.setQueriesData<ChatLists>({ queryKey: qk.chatsAll }, (old) => {
    if (!old) return old;
    const pages = old.pages.map((p) => ({ ...p, items: [...p.items] }));
    for (const page of pages) {
      const idx = page.items.findIndex((c) => c.id === chatId);
      if (idx === -1) continue;
      found = true;
      const updated = patch(page.items[idx]!);
      page.items.splice(idx, 1);
      if (moveToTop && pages[0]) {
        const insertAt = updated.pinned ? 0 : pages[0].items.findIndex((c) => !c.pinned);
        pages[0].items.splice(insertAt === -1 ? pages[0].items.length : insertAt, 0, updated);
      } else {
        page.items.splice(idx, 0, updated);
      }
      break;
    }
    return { ...old, pages };
  });
  queryClient.setQueryData<ChatSummary>(qk.chat(chatId), (old) => (old ? patch(old) : old));
  if (!found) void queryClient.invalidateQueries({ queryKey: qk.chatsAll });
}

export function onIncomingMessage(msg: Message, myId: string): void {
  upsertMessage(msg.chatId, msg);
  const mine = msg.sender?.id === myId;
  const isActive = activeChat.id === msg.chatId && document.visibilityState === 'visible';
  patchChat(
    msg.chatId,
    (c) => ({
      ...c,
      lastMessage: {
        id: msg.id,
        senderId: msg.sender?.id ?? null,
        senderName: msg.sender?.displayName ?? null,
        kind: msg.kind,
        text: msg.kind === 'encrypted' ? null : msg.text,
        createdAt: msg.createdAt,
      },
      unreadCount: mine || isActive ? c.unreadCount : c.unreadCount + 1,
      lastReadSeq: mine ? msg.seq : c.lastReadSeq,
      updatedAt: msg.createdAt,
    }),
    true,
  );
}

export function forgetChat(chatId: string): void {
  queryClient.setQueriesData<ChatLists>({ queryKey: qk.chatsAll }, (old) =>
    old ? { ...old, pages: old.pages.map((p) => ({ ...p, items: p.items.filter((c) => c.id !== chatId) })) } : old,
  );
  queryClient.removeQueries({ queryKey: qk.chat(chatId) });
  queryClient.removeQueries({ queryKey: qk.messages(chatId) });
}
