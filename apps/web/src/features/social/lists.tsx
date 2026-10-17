/** Списки авторов: свои списки и лента выбранных людей. */
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Lock, Pencil, Plus, ScrollText, Trash2, UserMinus, UserPlus, Users } from 'lucide-react';
import type { UserList, UserSummary } from '@omni/shared';
import { api, errorMessage } from '../../shared/api/client';
import { queryClient } from '../../shared/api/query';
import { useMe } from '../../shared/stores/session';
import { toast, useCrumb } from '../../shared/stores/ui';
import { plural } from '../../shared/lib/format';
import { Button, confirm, EmptyState, ErrorState, IconButton, ListSkeleton, Loading, Modal, PageHeader, Segmented, UserPicker, UserRow } from '../../shared/ui';
import { PostList } from '../feed';
import { ListForm, listsKey } from './dialogs';
import './social.css';

export function ListsPage() {
  const q = useQuery({ queryKey: listsKey, queryFn: () => api.get<{ items: UserList[] }>('/me/lists') });
  const [creating, setCreating] = useState(false);
  const items = q.data?.items ?? [];
  return (
    <div className="scroll">
      <div className="page">
        <PageHeader
          title="Списки"
          subtitle="Отдельная лента из выбранных людей — без алгоритмов и в хронологическом порядке"
          icon={<ScrollText size={22} />}
          actions={
            <Button size="sm" icon={<Plus size={16} />} onClick={() => setCreating(true)}>
              Новый список
            </Button>
          }
        />
        {q.isLoading ? (
          <ListSkeleton rows={3} />
        ) : items.length === 0 ? (
          <div className="card">
            <EmptyState icon={<ScrollText size={28} />} title="Списков пока нет" text="Например, «Разработчики» или «Новости» — добавляйте людей из их профилей" />
          </div>
        ) : (
          <div className="col gap-2">
            {items.map((l) => (
              <Link key={l.id} to={`/feed/lists/${l.id}`} className="list-card">
                <span className="list-card__emoji">{l.emoji}</span>
                <span className="grow" style={{ minWidth: 0 }}>
                  <b className="row gap-1">
                    {l.name} {l.isPrivate && <Lock size={13} className="faint" />}
                  </b>
                  {l.description && <span className="small muted ellipsis" style={{ display: 'block' }}>{l.description}</span>}
                  <span className="xs faint">
                    {l.memberCount} {plural(l.memberCount, 'автор', 'автора', 'авторов')}
                  </span>
                </span>
              </Link>
            ))}
          </div>
        )}
      </div>
      {creating && <ListForm onClose={() => setCreating(false)} />}
    </div>
  );
}

export function ListPage() {
  const { id = '' } = useParams();
  const me = useMe();
  const navigate = useNavigate();
  const [tab, setTab] = useState<'feed' | 'members'>('feed');
  const [dialog, setDialog] = useState<'edit' | 'add' | null>(null);
  const q = useQuery({ queryKey: ['list', id], queryFn: () => api.get<UserList>(`/lists/${id}`) });
  const members = useQuery({ queryKey: ['list', id, 'members'], queryFn: () => api.get<{ items: UserSummary[] }>(`/lists/${id}/members`), enabled: !!q.data });
  useCrumb(q.data?.name);
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['list', id] });
    void queryClient.invalidateQueries({ queryKey: listsKey });
  };
  const toggle = useMutation({
    mutationFn: (u: UserSummary) => (members.data?.items.some((m) => m.id === u.id) ? api.del(`/lists/${id}/members/${u.id}`) : api.post(`/lists/${id}/members`, { userIds: [u.id] })),
    onSuccess: refresh,
    onError: (e) => toast({ text: errorMessage(e), kind: 'error' }),
  });
  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <ErrorState error={q.error} />;
  const l = q.data;
  const own = l.owner.id === me.id;
  const remove = async () => {
    if (!(await confirm({ title: `Удалить список «${l.name}»?`, danger: true, confirmLabel: 'Удалить' }))) return;
    await api.del(`/lists/${l.id}`);
    void queryClient.invalidateQueries({ queryKey: listsKey });
    navigate('/feed/lists');
  };
  return (
    <div className="scroll">
      <div className="feed-col page" style={{ maxWidth: 700 }}>
        <div className="list-hero">
          <span className="list-hero__emoji">{l.emoji}</span>
          <div className="grow" style={{ minWidth: 0 }}>
            <h1 className="row gap-2" style={{ margin: 0, fontSize: 'var(--fs-2xl)' }}>
              {l.name} {l.isPrivate && <Lock size={18} className="faint" />}
            </h1>
            {l.description && <p className="muted" style={{ margin: '4px 0' }}>{l.description}</p>}
            <span className="small faint">
              {l.memberCount} {plural(l.memberCount, 'автор', 'автора', 'авторов')} · {own ? 'ваш список' : `список @${l.owner.username}`}
            </span>
          </div>
          {own && (
            <div className="row" style={{ gap: 2 }}>
              <IconButton label="Добавить людей" onClick={() => setDialog('add')}>
                <UserPlus size={20} />
              </IconButton>
              <IconButton label="Изменить" onClick={() => setDialog('edit')}>
                <Pencil size={20} />
              </IconButton>
              <IconButton label="Удалить список" onClick={() => void remove()}>
                <Trash2 size={20} />
              </IconButton>
            </div>
          )}
        </div>
        <div style={{ marginBottom: 12 }}>
          <Segmented
            value={tab}
            onChange={setTab}
            options={[
              { value: 'feed', label: 'Лента' },
              { value: 'members', label: `Участники · ${l.memberCount}` },
            ]}
          />
        </div>
        {tab === 'feed' ? (
          <PostList
            queryKey={['list', id, 'feed']}
            path={`/lists/${id}/feed`}
            empty={<EmptyState icon={<Users size={28} />} title="Здесь пока тихо" text={own ? 'Добавьте в список людей — их публикации появятся здесь' : 'Участники списка ещё ничего не опубликовали'} />}
          />
        ) : (
          <div className="card" style={{ overflow: 'hidden' }}>
            {members.isLoading ? (
              <ListSkeleton rows={3} />
            ) : members.data?.items.length ? (
              members.data.items.map((u) => (
                <UserRow
                  key={u.id}
                  user={u}
                  action={
                    own ? (
                      <IconButton label="Убрать из списка" onClick={() => toggle.mutate(u)}>
                        <UserMinus size={18} />
                      </IconButton>
                    ) : undefined
                  }
                />
              ))
            ) : (
              <EmptyState icon={<Users size={26} />} title="В списке никого" />
            )}
          </div>
        )}
      </div>
      {dialog === 'edit' && <ListForm initial={l} onClose={() => setDialog(null)} />}
      {dialog === 'add' && (
        <Modal open onClose={() => setDialog(null)} title={`Добавить в «${l.name}»`}>
          <UserPicker multiple picked={members.data?.items.map((m) => m.id) ?? []} exclude={[me.id]} onPick={(u) => toggle.mutate(u)} />
        </Modal>
      )}
    </div>
  );
}
