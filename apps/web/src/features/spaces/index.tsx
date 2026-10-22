/**
 * Компании и сообщества: списки, создание, приглашения, обзор открытых
 * сообществ и вход по ссылке. Внутреннее устройство — в layout.tsx.
 */
import { useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Briefcase, Check, Compass, Globe, Lock, Plus, Search, Users, X } from 'lucide-react';
import type { SpaceDetails, SpaceInvite, SpaceKind, SpaceSummary } from '@omni/shared';
import { api, ApiError, errorMessage } from '../../shared/api/client';
import { queryClient } from '../../shared/api/query';
import { useDebounced } from '../../shared/hooks';
import { members as membersLabel } from '../../shared/lib/format';
import { toast } from '../../shared/stores/ui';
import { Avatar, Button, ButtonLink, EmptyState, Input, ListSkeleton, Loading, PageHeader, TabLinks, Textarea } from '../../shared/ui';
import { refreshSpace, spaceBase, spaceKeys, spacePath, useMyInvites, useSpaces } from './api';
import './spaces.css';

export { SpaceLayout, SpaceWelcome } from './layout';

const TEXT: Record<SpaceKind, { title: string; one: string; icon: React.ReactNode; empty: string; create: string }> = {
  company: {
    title: 'Компании',
    one: 'компания',
    icon: <Briefcase size={22} />,
    empty: 'Создайте компанию и пригласите сотрудников — у каждого будут свои роли и доступ к нужным чатам',
    create: 'Создать компанию',
  },
  community: {
    title: 'Сообщества',
    one: 'сообщество',
    icon: <Users size={22} />,
    empty: 'Вступите в открытое сообщество или создайте своё — внутри много групп, в которые заходит кто хочет',
    create: 'Создать сообщество',
  },
};

function SpaceCard({ s }: { s: SpaceSummary }) {
  return (
    <Link to={spacePath(s)} className="space-card">
      <span className="space-card__avatar">
        <Avatar src={s.avatarUrl} name={s.name} id={s.id} size={56} />
        {s.unreadRooms > 0 && <span className="badge space-card__badge">{s.unreadRooms}</span>}
      </span>
      <span className="space-card__body">
        <b className="ellipsis">{s.name}</b>
        <span className="xs muted row gap-1">
          {s.kind === 'community' && (s.isPublic ? <Globe size={12} /> : <Lock size={12} />)}
          {membersLabel(s.memberCount)}
        </span>
        {s.description && <span className="small muted clamp-2">{s.description}</span>}
      </span>
    </Link>
  );
}

/** Приглашение: принять или отклонить. Используется и в уведомлениях. */
export function InviteCard({ inv, compact }: { inv: SpaceInvite; compact?: boolean }) {
  const navigate = useNavigate();
  const respond = useMutation({
    mutationFn: (accept: boolean) => api.post<{ space: SpaceDetails | null }>(`/space-invites/${inv.id}/respond`, { accept }),
    onSuccess: (r) => {
      void queryClient.invalidateQueries({ queryKey: spaceKeys.invites });
      void queryClient.invalidateQueries({ queryKey: ['notifications'] });
      refreshSpace();
      if (r.space) {
        toast({ text: `Добро пожаловать в «${r.space.name}»`, kind: 'success' });
        navigate(spacePath(r.space));
      }
    },
    onError: (e) => toast({ text: errorMessage(e), kind: 'error' }),
  });
  const buttons = (
    <div className="row gap-2">
      <Button size="sm" variant="secondary" icon={<X size={16} />} disabled={respond.isPending} onClick={() => respond.mutate(false)}>
        Отклонить
      </Button>
      <Button size="sm" icon={<Check size={16} />} loading={respond.isPending && respond.variables} onClick={() => respond.mutate(true)}>
        Принять
      </Button>
    </div>
  );
  // В уведомлении текст уже есть — нужны только кнопки
  if (compact) return buttons;
  return (
    <div className="invite-card">
      <Avatar src={inv.space.avatarUrl} name={inv.space.name} id={inv.space.id} size={48} />
      <div className="col grow" style={{ gap: 2, minWidth: 0 }}>
        <span className="small">
          <b>{inv.inviter?.displayName ?? 'Кто-то'}</b> приглашает в {inv.space.kind === 'company' ? 'компанию' : 'сообщество'}
        </span>
        <b className="ellipsis">{inv.space.name}</b>
        <span className="xs muted">{membersLabel(inv.space.memberCount)}</span>
      </div>
      {buttons}
    </div>
  );
}

export function SpacesHome({ kind }: { kind: SpaceKind }) {
  const t = TEXT[kind];
  const list = useSpaces(kind);
  const invites = (useMyInvites().data?.items ?? []).filter((i) => i.space.kind === kind);
  const items = list.data?.items ?? [];
  return (
    <div className="scroll">
      <div className="page page--wide">
        <PageHeader
          title={t.title}
          icon={t.icon}
          actions={
            <ButtonLink to={`${spaceBase(kind)}/new`} icon={<Plus size={18} />}>
              {t.create}
            </ButtonLink>
          }
        />
        {kind === 'community' && (
          <TabLinks
            className="mb"
            tabs={[
              { to: '/communities', label: 'Мои', end: true },
              { to: '/communities/discover', label: 'Обзор' },
            ]}
          />
        )}
        {invites.length > 0 && (
          <section className="col gap-2" style={{ marginBottom: 20 }}>
            <h2 className="section-title">Приглашения</h2>
            {invites.map((i) => (
              <InviteCard key={i.id} inv={i} />
            ))}
          </section>
        )}
        {list.isLoading ? (
          <ListSkeleton rows={4} avatar={56} />
        ) : items.length === 0 ? (
          <EmptyState
            icon={t.icon}
            title={kind === 'company' ? 'Вы пока не в компании' : 'Вы пока не в сообществе'}
            text={t.empty}
            action={
              <div className="row wrap center">
                <ButtonLink to={`${spaceBase(kind)}/new`} icon={<Plus size={18} />}>
                  {t.create}
                </ButtonLink>
                {kind === 'community' && (
                  <ButtonLink to="/communities/discover" variant="secondary" icon={<Compass size={18} />}>
                    Найти сообщество
                  </ButtonLink>
                )}
              </div>
            }
          />
        ) : (
          <div className="space-grid">
            {items.map((s) => (
              <SpaceCard key={s.id} s={s} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function DiscoverSpaces() {
  const [q, setQ] = useState('');
  const debounced = useDebounced(q.trim(), 250);
  const navigate = useNavigate();
  const list = useQuery({
    queryKey: spaceKeys.discover(debounced),
    queryFn: () => api.get<{ items: SpaceSummary[] }>(`/spaces/discover${debounced ? `?q=${encodeURIComponent(debounced)}` : ''}`),
  });
  const join = useMutation({
    mutationFn: (id: string) => api.post<SpaceDetails>(`/spaces/${id}/join`),
    onSuccess: (s) => {
      refreshSpace(s.id);
      navigate(spacePath(s));
    },
    onError: (e) => toast({ text: errorMessage(e), kind: 'error' }),
  });
  const items = list.data?.items ?? [];
  return (
    <div className="scroll">
      <div className="page page--wide">
        <PageHeader title="Сообщества" icon={<Users size={22} />} />
        <TabLinks
          className="mb"
          tabs={[
            { to: '/communities', label: 'Мои', end: true },
            { to: '/communities/discover', label: 'Обзор' },
          ]}
        />
        <div className="input-group" style={{ margin: '16px 0' }}>
          <Search size={16} className="input-group__icon" />
          <input className="input" placeholder="Название или тема" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        {list.isLoading ? (
          <ListSkeleton rows={4} avatar={56} />
        ) : items.length === 0 ? (
          <EmptyState icon={<Compass size={28} />} title="Ничего не найдено" text={q ? 'Попробуйте другое название' : 'Открытых сообществ пока нет — создайте первое'} />
        ) : (
          <div className="space-grid">
            {items.map((s) => (
              <div key={s.id} className="space-card space-card--action">
                <Link to={spacePath(s)} className="row grow" style={{ gap: 12, minWidth: 0, color: 'inherit' }}>
                  <Avatar src={s.avatarUrl} name={s.name} id={s.id} size={56} />
                  <span className="space-card__body">
                    <b className="ellipsis">{s.name}</b>
                    <span className="xs muted">{membersLabel(s.memberCount)}</span>
                    {s.description && <span className="small muted clamp-2">{s.description}</span>}
                  </span>
                </Link>
                {s.joined ? (
                  <ButtonLink to={spacePath(s)} size="sm" variant="secondary">
                    Открыть
                  </ButtonLink>
                ) : (
                  <Button size="sm" loading={join.isPending && join.variables === s.id} onClick={() => join.mutate(s.id)}>
                    Вступить
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function NewSpacePage({ kind }: { kind: SpaceKind }) {
  const t = TEXT[kind];
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [isPublic, setPublic] = useState(true);
  const [fields, setFields] = useState<Record<string, string>>({});
  const create = useMutation({
    mutationFn: () => api.post<SpaceDetails>('/spaces', { kind, name, description, isPublic }),
    onSuccess: (s) => {
      refreshSpace();
      navigate(spacePath(s), { replace: true });
    },
    onError: (e) => {
      if (e instanceof ApiError && e.fields) setFields(e.fields);
      toast({ text: errorMessage(e), kind: 'error' });
    },
  });
  return (
    <div className="scroll">
      <div className="page">
        <PageHeader
          title={t.create}
          icon={t.icon}
          subtitle={
            kind === 'company'
              ? 'Вы станете руководителем: приглашаете сотрудников, создаёте роли, отделы и чаты'
              : 'Вы станете владельцем: создаёте группы внутри и назначаете модераторов'
          }
        />
        <div className="col gap-4">
          <Input label="Название" value={name} onChange={(e) => setName(e.target.value)} maxLength={64} autoFocus error={fields.name} />
          <Textarea label="Описание" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={1000} rows={3} />
          {kind === 'community' ? (
            <div className="choice-grid choice-grid--2" role="radiogroup" aria-label="Тип доступа">
              <button type="button" role="radio" aria-checked={isPublic} className={`choice-card ${isPublic ? 'choice-card--on' : ''}`} onClick={() => setPublic(true)}>
                <Globe size={22} />
                <b>Открытое</b>
                <span className="xs muted">Любой найдёт в обзоре и вступит сам</span>
              </button>
              <button type="button" role="radio" aria-checked={!isPublic} className={`choice-card ${!isPublic ? 'choice-card--on' : ''}`} onClick={() => setPublic(false)}>
                <Lock size={22} />
                <b>Закрытое</b>
                <span className="xs muted">Только по приглашению или ссылке</span>
              </button>
            </div>
          ) : (
            <div className="notice">
              <Lock size={18} />
              <div>Компания всегда закрыта: сотрудники попадают в неё только по вашему приглашению — оно придёт им в уведомления.</div>
            </div>
          )}
          <Button size="lg" disabled={!name.trim()} loading={create.isPending} onClick={() => create.mutate()}>
            {t.create}
          </Button>
        </div>
      </div>
    </div>
  );
}

/** Вход по ссылке-приглашению /s/:token. */
export function JoinSpaceLink() {
  const { token = '' } = useParams();
  const q = useQuery({ queryKey: ['space-link', token], queryFn: () => api.post<SpaceDetails>(`/spaces/link/${token}`), retry: false });
  if (q.data) {
    refreshSpace(q.data.id);
    return <Navigate to={spacePath(q.data)} replace />;
  }
  if (q.error) return <EmptyState icon={<Lock size={28} />} title="Ссылка не работает" text={errorMessage(q.error)} action={<ButtonLink to="/communities">К сообществам</ButtonLink>} />;
  return <Loading />;
}
