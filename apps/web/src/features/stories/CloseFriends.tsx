/** Список «Близкие друзья»: кто видит истории с зелёным кольцом. */
import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Star, UserMinus, UserPlus } from 'lucide-react';
import type { UserSummary } from '@omni/shared';
import { api, errorMessage } from '../../shared/api/client';
import { queryClient } from '../../shared/api/query';
import { toast } from '../../shared/stores/ui';
import { Button, EmptyState, IconButton, ListSkeleton, Modal, PageHeader, UserPicker, UserRow } from '../../shared/ui';
import './stories.css';

const key = ['close-friends'] as const;

export function CloseFriendsPage() {
  const q = useQuery({ queryKey: key, queryFn: () => api.get<{ items: UserSummary[] }>('/me/close-friends') });
  const [adding, setAdding] = useState(false);
  const items = q.data?.items ?? [];
  const add = useMutation({
    mutationFn: (u: UserSummary) => api.post<{ items: UserSummary[] }>('/me/close-friends', { userIds: [u.id] }),
    onSuccess: (r) => queryClient.setQueryData(key, r),
    onError: (e) => toast({ text: errorMessage(e), kind: 'error' }),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/me/close-friends/${id}`),
    onSuccess: (_, id) => queryClient.setQueryData(key, { items: items.filter((u) => u.id !== id) }),
    onError: (e) => toast({ text: errorMessage(e), kind: 'error' }),
  });
  return (
    <div className="scroll">
      <div className="page">
        <PageHeader
          title="Близкие друзья"
          subtitle="Истории «для близких» видят только эти люди. Они не узнают, что попали в список"
          icon={<Star size={22} />}
          actions={
            <Button icon={<UserPlus size={18} />} onClick={() => setAdding(true)}>
              Добавить
            </Button>
          }
        />
        <div className="card" style={{ overflow: 'hidden' }}>
          {q.isLoading ? (
            <ListSkeleton rows={3} />
          ) : items.length === 0 ? (
            <EmptyState icon={<Star size={28} />} title="Список пуст" text="Добавьте тех, с кем хотите делиться личным" />
          ) : (
            items.map((u) => (
              <UserRow
                key={u.id}
                user={u}
                action={
                  <IconButton label="Убрать из близких" onClick={() => remove.mutate(u.id)}>
                    <UserMinus size={18} />
                  </IconButton>
                }
              />
            ))
          )}
        </div>
      </div>
      {adding && (
        <Modal open onClose={() => setAdding(false)} title="Добавить в близкие друзья">
          <UserPicker multiple picked={items.map((u) => u.id)} onPick={(u) => (items.some((x) => x.id === u.id) ? remove.mutate(u.id) : add.mutate(u))} />
        </Modal>
      )}
    </div>
  );
}
