/** Черновики и запланированные публикации. */
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { AlertTriangle, Calendar, CalendarClock, FileText, Pencil, Send, Trash2 } from 'lucide-react';
import type { Post, PostDraft } from '@omni/shared';
import { api, errorMessage } from '../../shared/api/client';
import { queryClient } from '../../shared/api/query';
import { toast } from '../../shared/stores/ui';
import { fullDate, timeAgo } from '../../shared/lib/format';
import { ButtonLink, confirm, EmptyState, IconButton, ListSkeleton, Modal, PageHeader, TabLinks } from '../../shared/ui';
import { draftsKey, PostComposer } from '../posts/PostComposer';
import '../posts/posts.css';
import './social.css';

const when = (iso: string) => new Date(iso).toLocaleString('ru-RU', { weekday: 'short', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });

export function DraftsPage({ filter }: { filter: 'drafts' | 'scheduled' }) {
  const navigate = useNavigate();
  const q = useQuery({ queryKey: [...draftsKey, filter], queryFn: () => api.get<{ items: PostDraft[] }>(`/me/drafts?filter=${filter}`) });
  const [editing, setEditing] = useState<PostDraft | null>(null);
  const refresh = () => void queryClient.invalidateQueries({ queryKey: draftsKey });
  const publish = useMutation({
    mutationFn: (id: string) => api.post<Post>(`/me/drafts/${id}/publish`),
    onSuccess: (p) => {
      refresh();
      void queryClient.invalidateQueries({ queryKey: ['feed'] });
      toast({ text: 'Опубликовано', kind: 'success', action: { label: 'Открыть', onClick: () => navigate(`/post/${p.id}`) } });
    },
    onError: (e) => toast({ text: errorMessage(e), kind: 'error' }),
  });
  const remove = async (d: PostDraft) => {
    if (!(await confirm({ title: d.publishAt ? 'Отменить публикацию?' : 'Удалить черновик?', danger: true, confirmLabel: 'Удалить' }))) return;
    try {
      await api.del(`/me/drafts/${d.id}`);
      refresh();
    } catch (e) {
      toast({ text: errorMessage(e), kind: 'error' });
    }
  };
  const items = q.data?.items ?? [];
  const scheduled = filter === 'scheduled';

  return (
    <div className="scroll">
      <div className="page">
        <PageHeader
          title={scheduled ? 'Запланированные' : 'Черновики'}
          subtitle={scheduled ? 'Выйдут автоматически в указанное время' : 'Видны только вам — допишите, когда будет время'}
          icon={scheduled ? <CalendarClock size={22} /> : <FileText size={22} />}
          actions={
            <ButtonLink to="/feed/compose" size="sm" icon={<Pencil size={16} />}>
              Написать
            </ButtonLink>
          }
        />
        <TabLinks
          tabs={[
            { to: '/feed/drafts', label: 'Черновики' },
            { to: '/feed/scheduled', label: 'Запланированные' },
          ]}
        />
        <div className="col gap-2" style={{ marginTop: 16 }}>
          {q.isLoading ? (
            <ListSkeleton rows={3} />
          ) : items.length === 0 ? (
            <div className="card">
              <EmptyState
                icon={scheduled ? <Calendar size={28} /> : <FileText size={28} />}
                title={scheduled ? 'Ничего не запланировано' : 'Черновиков нет'}
                text={scheduled ? 'В редакторе публикации нажмите на календарь, чтобы выбрать время выхода' : 'В редакторе публикации нажмите на значок документа — текст и фото сохранятся'}
              />
            </div>
          ) : (
            items.map((d) => (
              <div key={d.id} className="draft-card">
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="row wrap gap-2" style={{ marginBottom: 6 }}>
                    {d.publishAt ? (
                      <span className="draft-card__when">
                        <CalendarClock size={13} /> {when(d.publishAt)}
                      </span>
                    ) : (
                      <span className="xs faint" title={fullDate(d.updatedAt)}>
                        Изменён {timeAgo(d.updatedAt)}
                      </span>
                    )}
                    {d.error && (
                      <span className="draft-card__when draft-card__error">
                        <AlertTriangle size={13} /> Не опубликован: {d.error}
                      </span>
                    )}
                  </div>
                  <div className="clamp-3" style={{ whiteSpace: 'pre-wrap' }}>
                    {d.text || <span className="muted">Без текста</span>}
                  </div>
                  {d.media.length > 0 && (
                    <div className="draft-card__media">
                      {d.media.slice(0, 4).map((m) => (
                        <img key={m.id} src={m.kind === 'video' ? (m.posterUrl ?? undefined) : m.url} alt="" />
                      ))}
                    </div>
                  )}
                </div>
                <div className="col" style={{ gap: 2 }}>
                  <IconButton label="Опубликовать сейчас" onClick={() => publish.mutate(d.id)} disabled={publish.isPending}>
                    <Send size={18} />
                  </IconButton>
                  <IconButton label="Изменить" onClick={() => setEditing(d)}>
                    <Pencil size={18} />
                  </IconButton>
                  <IconButton label="Удалить" onClick={() => void remove(d)}>
                    <Trash2 size={18} />
                  </IconButton>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
      {editing && (
        <Modal open wide onClose={() => setEditing(null)} title={editing.publishAt ? 'Запланированная публикация' : 'Черновик'}>
          <PostComposer
            draft={editing}
            autoFocus
            onDraftSaved={() => setEditing(null)}
            onDone={(p) => {
              setEditing(null);
              navigate(`/post/${p.id}`);
            }}
          />
        </Modal>
      )}
    </div>
  );
}
