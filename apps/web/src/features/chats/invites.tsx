/** Пригласительные ссылки в группы и каналы и страница вступления по ссылке. */
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Ban, Copy, Link2, Megaphone, Plus, Share2, Users } from 'lucide-react';
import type { ChatInvite, ChatSummary, InvitePreview } from '@omni/shared';
import { api, errorMessage } from '../../shared/api/client';
import { qk, queryClient } from '../../shared/api/query';
import { toast } from '../../shared/stores/ui';
import { cn, fullDate, members, plural } from '../../shared/lib/format';
import { Avatar, Button, confirm, ErrorState, Input, ListSkeleton, Loading, Modal } from '../../shared/ui';
import './chats.css';

const EXPIRES = [
  { h: 0, label: 'Бессрочно' },
  { h: 1, label: '1 час' },
  { h: 24, label: '1 день' },
  { h: 168, label: '7 дней' },
  { h: 720, label: '30 дней' },
];
const LIMITS_OPTIONS = [0, 1, 10, 50, 100];

async function copy(url: string) {
  try {
    await navigator.clipboard.writeText(url);
    toast({ text: 'Ссылка скопирована', kind: 'success' });
  } catch {
    toast({ text: url });
  }
}

async function share(invite: ChatInvite, title: string) {
  if (navigator.share) await navigator.share({ title, text: `Присоединяйтесь к «${title}» в Sunnet`, url: invite.url }).catch(() => undefined);
  else await copy(invite.url);
}

function inviteState(i: ChatInvite): { text: string; dead: boolean } {
  if (i.revoked) return { text: 'Отозвана', dead: true };
  if (i.expiresAt && new Date(i.expiresAt).getTime() < Date.now()) return { text: 'Срок истёк', dead: true };
  if (i.usageLimit && i.uses >= i.usageLimit) return { text: 'Лимит исчерпан', dead: true };
  const parts = [`${i.uses} ${plural(i.uses, 'вступил', 'вступили', 'вступили')}`];
  if (i.usageLimit) parts.push(`осталось ${i.usageLimit - i.uses}`);
  if (i.expiresAt) parts.push(`до ${fullDate(i.expiresAt)}`);
  return { text: parts.join(' · '), dead: false };
}

export function InvitesDialog({ chat, onClose }: { chat: ChatSummary; onClose: () => void }) {
  const key = ['invites', chat.id];
  const q = useQuery({ queryKey: key, queryFn: () => api.get<{ items: ChatInvite[] }>(`/chats/${chat.id}/invites`) });
  const [form, setForm] = useState<{ title: string; expiresInHours: number; usageLimit: number } | null>(null);
  const create = useMutation({
    mutationFn: (body: { title: string; expiresInHours: number; usageLimit: number }) => api.post<ChatInvite>(`/chats/${chat.id}/invites`, body),
    onSuccess: (inv) => {
      void queryClient.invalidateQueries({ queryKey: key });
      setForm(null);
      void copy(inv.url);
    },
    onError: (e) => toast({ text: errorMessage(e), kind: 'error' }),
  });
  const revoke = useMutation({
    mutationFn: (token: string) => api.del(`/chats/${chat.id}/invites/${token}`),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: key }),
    onError: (e) => toast({ text: errorMessage(e), kind: 'error' }),
  });
  const items = q.data?.items ?? [];

  return (
    <Modal open onClose={onClose} title="Пригласительные ссылки">
      <div className="col gap-3">
        <p className="small muted">
          Любой, у кого есть ссылка, сможет {chat.type === 'channel' ? 'подписаться на канал' : 'вступить в группу'} — даже если она закрытая. Ссылку можно ограничить по сроку и числу вступлений и отозвать в любой момент.
        </p>
        {form ? (
          <div className="card col gap-3" style={{ padding: 16 }}>
            <Input label="Название (видно только админам)" value={form.title} maxLength={64} placeholder="Например, для коллег" onChange={(e) => setForm({ ...form, title: e.target.value })} autoFocus />
            <div className="field">
              <span className="field__label">Срок действия</span>
              <div className="row wrap gap-2">
                {EXPIRES.map((o) => (
                  <button key={o.h} type="button" className={cn('chip', form.expiresInHours === o.h && 'chip--active')} onClick={() => setForm({ ...form, expiresInHours: o.h })}>
                    {o.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="field">
              <span className="field__label">Сколько раз можно использовать</span>
              <div className="row wrap gap-2">
                {LIMITS_OPTIONS.map((n) => (
                  <button key={n} type="button" className={cn('chip', form.usageLimit === n && 'chip--active')} onClick={() => setForm({ ...form, usageLimit: n })}>
                    {n === 0 ? 'Без ограничений' : n}
                  </button>
                ))}
              </div>
            </div>
            <div className="row gap-2" style={{ justifyContent: 'flex-end' }}>
              <Button variant="ghost" onClick={() => setForm(null)}>
                Отмена
              </Button>
              <Button icon={<Link2 size={18} />} loading={create.isPending} onClick={() => create.mutate(form)}>
                Создать ссылку
              </Button>
            </div>
          </div>
        ) : (
          <Button icon={<Plus size={18} />} onClick={() => setForm({ title: '', expiresInHours: 0, usageLimit: 0 })}>
            Новая ссылка
          </Button>
        )}
        {q.isLoading ? (
          <ListSkeleton rows={2} />
        ) : (
          items.map((i) => {
            const st = inviteState(i);
            return (
              <div key={i.token} className={cn('invite-card', st.dead && 'invite-card--dead')}>
                <span className="invite-card__icon">
                  <Link2 size={18} />
                </span>
                <span className="grow" style={{ minWidth: 0 }}>
                  <span className="bold ellipsis" style={{ display: 'block' }}>
                    {i.title || i.url.replace(/^https?:\/\//, '')}
                  </span>
                  <span className="xs muted">{st.text}</span>
                </span>
                {!st.dead && (
                  <>
                    <button type="button" className="icon-btn icon-btn--sm" onClick={() => void copy(i.url)} aria-label="Скопировать" title="Скопировать">
                      <Copy size={16} />
                    </button>
                    <button type="button" className="icon-btn icon-btn--sm" onClick={() => void share(i, chat.title)} aria-label="Поделиться" title="Поделиться">
                      <Share2 size={16} />
                    </button>
                    <button
                      type="button"
                      className="icon-btn icon-btn--sm icon-btn--danger"
                      aria-label="Отозвать"
                      title="Отозвать"
                      onClick={async () => {
                        if (await confirm({ title: 'Отозвать ссылку?', text: 'По ней больше нельзя будет вступить. Уже вступившие останутся.', danger: true, confirmLabel: 'Отозвать' })) revoke.mutate(i.token);
                      }}
                    >
                      <Ban size={16} />
                    </button>
                  </>
                )}
              </div>
            );
          })
        )}
      </div>
    </Modal>
  );
}

/** /join/:token — предпросмотр чата и вступление. */
export function JoinPage() {
  const { token = '' } = useParams();
  const navigate = useNavigate();
  const q = useQuery({ queryKey: ['invite', token], queryFn: () => api.get<InvitePreview>(`/invites/${encodeURIComponent(token)}`), retry: false });
  const join = useMutation({
    mutationFn: () => api.post<ChatSummary>(`/invites/${encodeURIComponent(token)}/join`),
    onSuccess: (c) => {
      void queryClient.invalidateQueries({ queryKey: qk.chatsAll });
      navigate(`/chats/${c.id}`, { replace: true });
    },
    onError: (e) => toast({ text: errorMessage(e), kind: 'error' }),
  });
  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <ErrorState error={q.error} />;
  const { chat, isMember } = q.data;
  const isChannel = chat.type === 'channel';
  return (
    <div className="scroll">
      <div className="join-page">
        <div className="join-card">
          <Avatar src={chat.avatarUrl} name={chat.title} id={chat.id} size={112} />
          <span className="join-card__kind">
            {isChannel ? <Megaphone size={14} /> : <Users size={14} />} {isChannel ? 'Канал' : 'Группа'}
          </span>
          <h1 className="join-card__title">{chat.title}</h1>
          <div className="muted">{members(chat.memberCount, isChannel ? 'channel' : 'group')}</div>
          {chat.description && <p className="join-card__desc">{chat.description}</p>}
          {isMember ? (
            <Button size="lg" onClick={() => navigate(`/chats/${chat.id}`)}>
              Открыть {isChannel ? 'канал' : 'чат'}
            </Button>
          ) : (
            <Button size="lg" loading={join.isPending} onClick={() => join.mutate()}>
              {isChannel ? 'Подписаться' : 'Вступить в группу'}
            </Button>
          )}
          <p className="xs faint">Вас пригласили по ссылке. Покинуть {isChannel ? 'канал' : 'группу'} можно в любой момент.</p>
        </div>
      </div>
    </div>
  );
}
