import { QueryClient, useInfiniteQuery, type InfiniteData } from '@tanstack/react-query';
import type { Paginated } from '@omni/shared';
import { api, ApiError } from './client';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 10 * 60_000,
      refetchOnWindowFocus: false,
      retry: (count, err) => !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 2,
    },
    mutations: { retry: false },
  },
});

/** Ключи кэша в одном месте — инвалидация не «промахивается». */
export const qk = {
  me: ['me'] as const,
  chats: (folder: string) => ['chats', folder] as const,
  chatsAll: ['chats'] as const,
  chat: (id: string) => ['chat', id] as const,
  messages: (chatId: string) => ['messages', chatId] as const,
  members: (chatId: string) => ['chat-members', chatId] as const,
  feed: (mode: string, kind: string) => ['feed', mode, kind] as const,
  post: (id: string) => ['post', id] as const,
  comments: (postId: string, sort: string) => ['comments', postId, sort] as const,
  replies: (commentId: string) => ['replies', commentId] as const,
  user: (idOrName: string) => ['user', idOrName] as const,
  userPosts: (id: string, tab: string) => ['user-posts', id, tab] as const,
  stories: ['stories'] as const,
  notifications: (filter: string) => ['notifications', filter] as const,
  communities: (scope: string) => ['communities', scope] as const,
  community: (id: string) => ['community', id] as const,
  search: (q: string, type: string) => ['search', q, type] as const,
};

/** Бесконечная лента с курсорами для любого эндпоинта, отдающего Paginated<T>. */
export function useCursorList<T>(key: readonly unknown[], path: string, opts: { enabled?: boolean; limit?: number } = {}) {
  return useInfiniteQuery<Paginated<T>, Error, InfiniteData<Paginated<T>>, readonly unknown[], string | undefined>({
    queryKey: key,
    enabled: opts.enabled ?? true,
    initialPageParam: undefined,
    queryFn: ({ pageParam }) => {
      const sep = path.includes('?') ? '&' : '?';
      const params = new URLSearchParams();
      if (pageParam) params.set('cursor', pageParam);
      if (opts.limit) params.set('limit', String(opts.limit));
      const qs = params.toString();
      return api.get<Paginated<T>>(qs ? `${path}${sep}${qs}` : path);
    },
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

export function flatPages<T>(data: InfiniteData<Paginated<T>> | undefined): T[] {
  return data?.pages.flatMap((p) => p.items) ?? [];
}

/** Обновляет элемент во всех закэшированных лентах (например, лайк поста). */
export function patchEverywhere<T extends { id: string }>(predicateKey: string, id: string, patch: (item: T) => T) {
  queryClient.setQueriesData<InfiniteData<Paginated<T>> | T[] | T>({ predicate: (q) => q.queryKey[0] === predicateKey }, (old) => {
    if (!old) return old;
    if (Array.isArray(old)) return old.map((it) => (it.id === id ? patch(it) : it));
    if ('pages' in (old as object)) {
      const data = old as InfiniteData<Paginated<T>>;
      return { ...data, pages: data.pages.map((p) => ({ ...p, items: p.items.map((it) => (it.id === id ? patch(it) : it)) })) };
    }
    const single = old as T;
    return single.id === id ? patch(single) : single;
  });
}
