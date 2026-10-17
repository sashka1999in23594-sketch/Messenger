/**
 * Действия с публикациями с оптимистичным обновлением: лайк/закладка
 * мгновенно отражаются во ВСЕХ местах, где пост закэширован (лента, профиль,
 * страница поста, поиск…), а при ошибке — откатываются.
 */
import { useMutation } from '@tanstack/react-query';
import type { Post } from '@omni/shared';
import { api, errorMessage } from '../../shared/api/client';
import { queryClient } from '../../shared/api/query';
import { toast } from '../../shared/stores/ui';

function isPost(v: unknown): v is Post {
  return !!v && typeof v === 'object' && 'stats' in v && 'kind' in v && 'author' in v && 'viewer' in v;
}

function deepPatch(value: unknown, id: string, patch: (p: Post) => Post): unknown {
  if (Array.isArray(value)) {
    let changed = false;
    const next = value.map((v) => {
      const n = deepPatch(v, id, patch);
      if (n !== v) changed = true;
      return n;
    });
    return changed ? next : value;
  }
  if (!value || typeof value !== 'object') return value;
  if (isPost(value)) {
    let p = value;
    if (p.id === id) p = patch(p);
    if (p.repostOf) {
      const inner = deepPatch(p.repostOf, id, patch) as Post;
      if (inner !== p.repostOf) p = { ...p, repostOf: inner };
    }
    return p;
  }
  let changed = false;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    const n = deepPatch(v, id, patch);
    if (n !== v) changed = true;
    out[k] = n;
  }
  return changed ? out : value;
}

export function patchPostEverywhere(id: string, patch: (p: Post) => Post): void {
  for (const q of queryClient.getQueryCache().getAll()) {
    const data = q.state.data;
    if (!data) continue;
    const next = deepPatch(data, id, patch);
    if (next !== data) queryClient.setQueryData(q.queryKey, next);
  }
}

export function removePostEverywhere(id: string): void {
  const strip = (value: unknown): unknown => {
    if (Array.isArray(value)) {
      const filtered = value.filter((v) => !(isPost(v) && v.id === id) && !(v && typeof v === 'object' && 'post' in v && isPost((v as { post: unknown }).post) && (v as { post: Post }).post.id === id));
      const mapped = filtered.map(strip);
      return mapped.length !== value.length || mapped.some((v, i) => v !== filtered[i]) ? mapped : value;
    }
    if (!value || typeof value !== 'object' || isPost(value)) return value;
    let changed = false;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      const n = strip(v);
      if (n !== v) changed = true;
      out[k] = n;
    }
    return changed ? out : value;
  };
  for (const q of queryClient.getQueryCache().getAll()) {
    const data = q.state.data;
    if (!data) continue;
    const next = strip(data);
    if (next !== data) queryClient.setQueryData(q.queryKey, next);
  }
}

function useToggle(post: Post, field: 'liked' | 'bookmarked' | 'watchLater', path: string, statKey?: 'likes') {
  const apply = (on: boolean) =>
    patchPostEverywhere(post.id, (p) => ({
      ...p,
      viewer: { ...p.viewer, [field]: on },
      stats: statKey ? { ...p.stats, [statKey]: Math.max(0, p.stats[statKey] + (on ? 1 : -1)) } : p.stats,
    }));
  return useMutation({
    mutationFn: (on: boolean) => (on ? api.post(`/posts/${post.id}/${path}`) : api.del(`/posts/${post.id}/${path}`)),
    onMutate: (on: boolean) => apply(on),
    onError: (e, on) => {
      apply(!on);
      toast({ text: errorMessage(e), kind: 'error' });
    },
  });
}

export function usePostActions(post: Post) {
  const like = useToggle(post, 'liked', 'like', 'likes');
  const bookmark = useToggle(post, 'bookmarked', 'bookmark');
  const watchLater = useToggle(post, 'watchLater', 'watch-later');

  const repost = useMutation({
    mutationFn: (on: boolean) => (on ? api.post(`/posts/${post.id}/repost`) : api.del(`/posts/${post.id}/repost`)),
    onMutate: (on) =>
      patchPostEverywhere(post.id, (p) => ({ ...p, viewer: { ...p.viewer, reposted: on }, stats: { ...p.stats, reposts: Math.max(0, p.stats.reposts + (on ? 1 : -1)) } })),
    onSuccess: (_d, on) => {
      toast(on ? 'Репост опубликован' : 'Репост удалён');
      void queryClient.invalidateQueries({ queryKey: ['feed'] });
    },
    onError: (e) => toast({ text: errorMessage(e), kind: 'error' }),
  });

  const remove = useMutation({
    mutationFn: () => api.del(`/posts/${post.id}`),
    onSuccess: () => {
      removePostEverywhere(post.id);
      toast('Публикация удалена');
    },
    onError: (e) => toast({ text: errorMessage(e), kind: 'error' }),
  });

  return { like, bookmark, watchLater, repost, remove };
}

export function shareLink(path: string): void {
  const url = `${location.origin}${path}`;
  if (navigator.share) {
    navigator.share({ url }).catch(() => undefined);
    return;
  }
  void navigator.clipboard.writeText(url).then(() => toast('Ссылка скопирована'));
}
