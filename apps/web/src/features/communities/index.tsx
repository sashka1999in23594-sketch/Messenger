import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Compass, Lock, LogOut, Plus, Search, Trash2, Users } from 'lucide-react';
import type { Community, UserSummary } from '@omni/shared';
import { api, ApiError, errorMessage } from '../../shared/api/client';
import { flatPages, qk, queryClient, useCursorList } from '../../shared/api/query';
import { useDebounced } from '../../shared/hooks';
import { toast, useCrumb } from '../../shared/stores/ui';
import { compactNumber, hueFor, members, plural } from '../../shared/lib/format';
import { Avatar, Button, ButtonLink, confirm, EmptyState, ErrorState, Input, ListSkeleton, Loading, LoadMore, PageHeader, RichText, Segmented, Switch, Textarea, UserRow } from '../../shared/ui';
import { PostList } from '../feed';
import { PostComposer } from '../posts/PostComposer';
import '../posts/posts.css';
import './communities.css';

function CommunityCard({ c }: { c: Community }) {
  const navigate = useNavigate();
  const join = useMutation({
    mutationFn: () => api.post<Community>(`/communities/${c.id}/join`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['communities'] });
      toast({ text: `Вы вступили в «${c.name}»`, kind: 'success' });
    },
    onError: (e) => toast({ text: errorMessage(e), kind: 'error' }),
  });
  return (
    <div className="community-card card card--hover" role="link" tabIndex={0} onClick={() => navigate(`/c/${c.slug}`)} onKeyDown={(e) => e.key === 'Enter' && navigate(`/c/${c.slug}`)}>
      <div className="community-card__cover" style={{ '--hue': hueFor(c.id) } as React.CSSProperties} />
      <div className="community-card__body">
        <span className="community-card__avatar">
          <Avatar src={c.avatarUrl} name={c.name} id={c.id} size={56} />
        </span>
        <span className="community-card__title">
          <span className="ellipsis">{c.name}</span> {c.visibility === 'private' && <Lock size={14} className="faint" />}
        </span>
        <span className="small muted">
          {members(c.memberCount)} · {compactNumber(c.postCount)} {plural(c.postCount, 'пост', 'поста', 'постов')}
        </span>
        {c.description && <span className="small muted clamp-2">{c.description}</span>}
        <span className="community-card__action" onClick={(e) => e.stopPropagation()}>
          {c.role ? (
            <span className="tag tag--accent">{c.role === 'owner' ? 'Владелец' : c.role === 'moderator' ? 'Модератор' : 'Участник'}</span>
          ) : (
            <Button size="sm" pill loading={join.isPending} onClick={() => join.mutate()}>
              Вступить
            </Button>
          )}
        </span>
      </div>
    </div>
  );
}

export function MyCommunities() {
  const q = useQuery({ queryKey: qk.communities('mine'), queryFn: () => api.get<{ items: Community[] }>('/me/communities') });
  return (
    <div className="scroll">
      <div className="page page--wide" style={{ maxWidth: 1100 }}>
        <PageHeader title="Мои сообщества" subtitle="Общие ленты по интересам" icon={<Users size={22} />} actions={<ButtonLink to="/communities/new" size="sm" icon={<Plus size={16} />}>Создать</ButtonLink>} />
        {q.isLoading ? (
          <ListSkeleton />
        ) : q.data?.items.length === 0 ? (
          <EmptyState icon={<Users size={28} />} title="Вы пока не состоите в сообществах" action={<ButtonLink to="/communities/discover" icon={<Compass size={18} />}>Найти сообщества</ButtonLink>} />
        ) : (
          <div className="bento">
            {q.data?.items.map((c) => (
              <CommunityCard key={c.id} c={c} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function DiscoverCommunities() {
  const [q, setQ] = useState('');
  const debounced = useDebounced(q.trim(), 250);
  const list = useCursorList<Community>(['communities', 'discover', debounced], `/communities${debounced ? `?q=${encodeURIComponent(debounced)}` : ''}`);
  const items = flatPages(list.data);
  return (
    <div className="scroll">
      <div className="page page--wide" style={{ maxWidth: 1100 }}>
        <PageHeader title="Обзор сообществ" icon={<Compass size={22} />} />
        <div className="input-group" style={{ marginBottom: 16 }}>
          <Search size={16} className="input-group__icon" />
          <input className="input" placeholder="Поиск сообществ" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        {list.isLoading ? <ListSkeleton /> : items.length === 0 ? <EmptyState title="Ничего не найдено" /> : null}
        <div className="bento">
          {items.map((c) => (
            <CommunityCard key={c.id} c={c} />
          ))}
        </div>
        <LoadMore hasMore={!!list.hasNextPage} loading={list.isFetchingNextPage} onLoad={() => void list.fetchNextPage()} />
      </div>
    </div>
  );
}

export function NewCommunity() {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [description, setDescription] = useState('');
  const [isPrivate, setPrivate] = useState(false);
  const [fields, setFields] = useState<Record<string, string>>({});
  const create = useMutation({
    mutationFn: () => api.post<Community>('/communities', { name, slug, description, visibility: isPrivate ? 'private' : 'public' }),
    onSuccess: (c) => {
      void queryClient.invalidateQueries({ queryKey: ['communities'] });
      navigate(`/c/${c.slug}`);
    },
    onError: (e) => {
      if (e instanceof ApiError && e.fields) setFields(e.fields);
      toast({ text: errorMessage(e), kind: 'error' });
    },
  });
  return (
    <div className="scroll">
      <div className="page">
        <PageHeader title="Новое сообщество" subtitle="Общая лента для людей с общими интересами" icon={<Plus size={22} />} />
        <div className="col gap-4">
          <Input label="Название" value={name} onChange={(e) => setName(e.target.value)} maxLength={64} error={fields.name} />
          <Input label="Адрес" value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase())} placeholder="photo_club" hint={`omni.app/c/${slug || 'адрес'}`} error={fields.slug} />
          <Textarea label="Описание" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={5000} />
          <label className="card list-item">
            <span className="list-item__body">
              <span className="list-item__title" style={{ display: 'block' }}>
                Закрытое сообщество
              </span>
              <span className="list-item__sub">Публикации видят только участники</span>
            </span>
            <Switch checked={isPrivate} onChange={setPrivate} label="Закрытое" />
          </label>
          <Button size="lg" disabled={!name.trim() || slug.length < 3} loading={create.isPending} onClick={() => create.mutate()}>
            Создать сообщество
          </Button>
        </div>
      </div>
    </div>
  );
}

export function CommunityPage() {
  const { slug = '' } = useParams();
  const navigate = useNavigate();
  const [tab, setTab] = useState<'posts' | 'members'>('posts');
  const q = useQuery({ queryKey: qk.community(slug), queryFn: () => api.get<Community>(`/communities/${slug}`) });
  const c = q.data;
  useCrumb(c?.name);
  const membersQ = useCursorList<{ user: UserSummary; role: string }>(['community-members', c?.id], `/communities/${c?.id}/members`, { enabled: !!c && tab === 'members' });
  const refresh = () => {
    void q.refetch();
    void queryClient.invalidateQueries({ queryKey: ['communities'] });
  };
  const join = useMutation({ mutationFn: () => api.post(`/communities/${c!.id}/join`), onSuccess: refresh, onError: (e) => toast({ text: errorMessage(e), kind: 'error' }) });
  const leave = useMutation({ mutationFn: () => api.post(`/communities/${c!.id}/leave`), onSuccess: refresh, onError: (e) => toast({ text: errorMessage(e), kind: 'error' }) });
  if (q.isLoading) return <Loading />;
  if (!c) return <ErrorState error={q.error} />;
  return (
    <div className="scroll">
      <div className="feed-col">
        <div className="profile__banner" style={{ height: 120 }} />
        <div style={{ padding: '0 16px 16px', marginTop: -36 }} className="col gap-3">
          <div className="row between" style={{ alignItems: 'flex-end' }}>
            <Avatar src={c.avatarUrl} name={c.name} id={c.id} size={88} className="profile__avatar" />
            <div className="row">
              {c.role === 'owner' ? (
                <Button
                  variant="danger-ghost"
                  size="sm"
                  icon={<Trash2 size={16} />}
                  onClick={async () => {
                    if (!(await confirm({ title: `Удалить «${c.name}»?`, danger: true, typeToConfirm: c.slug, confirmLabel: 'Удалить' }))) return;
                    await api.del(`/communities/${c.id}`);
                    void queryClient.invalidateQueries({ queryKey: ['communities'] });
                    navigate('/communities');
                  }}
                >
                  Удалить
                </Button>
              ) : c.role ? (
                <Button variant="secondary" size="sm" icon={<LogOut size={16} />} loading={leave.isPending} onClick={() => leave.mutate()}>
                  Покинуть
                </Button>
              ) : (
                <Button loading={join.isPending} onClick={() => join.mutate()}>
                  Вступить
                </Button>
              )}
            </div>
          </div>
          <h1 className="row gap-1">
            {c.name} {c.visibility === 'private' && <Lock size={18} className="faint" />}
          </h1>
          <div className="muted small">
            /c/{c.slug} · {members(c.memberCount)} · {compactNumber(c.postCount)} {plural(c.postCount, 'публикация', 'публикации', 'публикаций')}
          </div>
          {c.description && <RichText text={c.description} />}
          <Segmented
            value={tab}
            onChange={setTab}
            options={[
              { value: 'posts', label: 'Публикации' },
              { value: 'members', label: 'Участники' },
            ]}
          />
        </div>
        {tab === 'posts' ? (
          <>
            {c.role && <PostComposer communityId={c.id} placeholder={`Написать в «${c.name}»`} />}
            <PostList queryKey={['community-posts', c.id]} path={`/communities/${c.id}/posts`} empty={<EmptyState icon={<Users size={26} />} title="В сообществе пока нет публикаций" text={c.role ? 'Станьте первым!' : 'Вступите, чтобы публиковать'} />} />
          </>
        ) : (
          <>
            {flatPages(membersQ.data).map((m) => (
              <UserRow key={m.user.id} user={m.user} sub={m.role === 'owner' ? 'владелец' : m.role === 'moderator' ? 'модератор' : `@${m.user.username}`} />
            ))}
            <LoadMore hasMore={!!membersQ.hasNextPage} loading={membersQ.isFetchingNextPage} onLoad={() => void membersQ.fetchNextPage()} />
          </>
        )}
      </div>
    </div>
  );
}
