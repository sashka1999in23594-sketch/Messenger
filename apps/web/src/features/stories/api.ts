/** Запросы и ключи кэша историй. */
import { useQuery } from '@tanstack/react-query';
import type { StoryGroup, StoryHighlight } from '@omni/shared';
import { api } from '../../shared/api/client';
import { qk, queryClient } from '../../shared/api/query';

export const highlightsKey = (userId: string) => ['highlights', userId] as const;
export const archiveKey = ['stories-archive'] as const;

export function useStories() {
  return useQuery({ queryKey: qk.stories, queryFn: () => api.get<{ items: StoryGroup[] }>('/stories') });
}

export function useHighlights(userId: string) {
  return useQuery({ queryKey: highlightsKey(userId), queryFn: () => api.get<{ items: StoryHighlight[] }>(`/users/${userId}/highlights`) });
}

/** После любых изменений историй — обновляем всё, что их показывает */
export function refreshStories(userId?: string) {
  void queryClient.invalidateQueries({ queryKey: qk.stories });
  void queryClient.invalidateQueries({ queryKey: archiveKey });
  if (userId) void queryClient.invalidateQueries({ queryKey: highlightsKey(userId) });
}
