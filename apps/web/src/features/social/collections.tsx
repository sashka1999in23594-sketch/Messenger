/** Коллекции закладок: полоса на странице «Закладки» и страница коллекции. */
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Bookmark, Pencil, Trash2 } from 'lucide-react';
import type { Collection } from '@omni/shared';
import { api } from '../../shared/api/client';
import { queryClient } from '../../shared/api/query';
import { useCrumb } from '../../shared/stores/ui';
import { confirm, EmptyState, ErrorState, IconButton, Loading, PageHeader } from '../../shared/ui';
import { PostList } from '../feed';
import { CollectionForm, collectionsKey } from './dialogs';
export { CollectionsStrip } from './collections-strip';
import './social.css';

export function CollectionPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const q = useQuery({ queryKey: [...collectionsKey, 'one', id], queryFn: () => api.get<Collection>(`/me/collections/${id}`) });
  useCrumb(q.data?.name);
  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <ErrorState error={q.error} />;
  const c = q.data;
  return (
    <div className="scroll">
      <div className="feed-col page" style={{ maxWidth: 700 }}>
        <PageHeader
          title={`${c.emoji} ${c.name}`}
          subtitle={`Коллекция · ${c.count} сохранено · видна только вам`}
          icon={<Bookmark size={22} />}
          actions={
            <>
              <IconButton label="Изменить" onClick={() => setEditing(true)}>
                <Pencil size={18} />
              </IconButton>
              <IconButton
                label="Удалить коллекцию"
                onClick={async () => {
                  if (!(await confirm({ title: `Удалить «${c.name}»?`, text: 'Публикации останутся в закладках.', danger: true, confirmLabel: 'Удалить' }))) return;
                  await api.del(`/me/collections/${c.id}`);
                  void queryClient.invalidateQueries({ queryKey: collectionsKey });
                  navigate('/feed/bookmarks');
                }}
              >
                <Trash2 size={18} />
              </IconButton>
            </>
          }
        />
        <PostList
          queryKey={[...collectionsKey, 'posts', id]}
          path={`/me/collections/${id}/posts`}
          empty={<EmptyState icon={<Bookmark size={26} />} title="Коллекция пуста" text="В меню «⋯» у публикации выберите «В коллекцию»" />}
        />
      </div>
      {editing && <CollectionForm initial={c} onClose={() => setEditing(false)} onSaved={() => void q.refetch()} />}
    </div>
  );
}
