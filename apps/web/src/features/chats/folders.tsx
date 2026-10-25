/** Свои папки чатов: редактор, страница управления и «Добавить в папку». */
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Check, FolderPlus, Inbox, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { LIMITS, type ChatFolderInfo, type ChatSummary } from '@omni/shared';
import { api, errorMessage } from '../../shared/api/client';
import { flatPages, qk, queryClient, useCursorList } from '../../shared/api/query';
import { toast } from '../../shared/stores/ui';
import { cn } from '../../shared/lib/format';
import { Avatar, Button, confirm, EmptyState, IconButton, Input, ListSkeleton, Modal, PageHeader, SettingRow, Switch } from '../../shared/ui';
import { DetailHead } from './DetailHead';

type FolderType = ChatFolderInfo['includeTypes'][number];
type FolderDraft = Omit<ChatFolderInfo, 'id' | 'unreadCount'>;

export const foldersKey = ['chat-folders'] as const;

export function useFolders() {
  return useQuery({
    queryKey: foldersKey,
    queryFn: () => api.get<{ items: ChatFolderInfo[] }>('/chat-folders'),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}

const refresh = () => {
  void queryClient.invalidateQueries({ queryKey: foldersKey });
  void queryClient.invalidateQueries({ queryKey: qk.chatsAll });
};

const TYPES: { id: FolderType; label: string }[] = [
  { id: 'direct', label: 'Личные' },
  { id: 'groups', label: 'Группы' },
  { id: 'channels', label: 'Каналы' },
  { id: 'saved', label: 'Избранное' },
];

const EMOJI = ['📁', '💼', '🏠', '❤️', '⭐', '🎮', '🎓', '✈️', '🛒', '💬', '📢', '🤖', '🎵', '📚', '⚽', '🍕', '💡', '🔥', '🧑‍💻', '👨‍👩‍👧', '🐱', '🌿', '💰', '🎉'];

const PRESETS: { label: string; draft: Partial<FolderDraft> }[] = [
  { label: '💬 Непрочитанные личные', draft: { name: 'Новое', emoji: '💬', includeTypes: ['direct'], excludeRead: true } },
  { label: '👥 Только группы без звука', draft: { name: 'Тихие группы', emoji: '🌿', includeTypes: ['groups'], excludeMuted: false } },
  { label: '📢 Каналы', draft: { name: 'Новости', emoji: '📢', includeTypes: ['channels'] } },
  { label: '💼 Работа', draft: { name: 'Работа', emoji: '💼', includeTypes: [] } },
];

const empty: FolderDraft = { name: '', emoji: '📁', includeTypes: [], includeChatIds: [], excludeMuted: false, excludeRead: false, excludeArchived: true };

/** Список всех чатов для выбора (без архива — его можно включить отдельно) */
function useAllChats() {
  const list = useCursorList<ChatSummary>(qk.chats('all'), '/chats?folder=all', { limit: 100 });
  return flatPages(list.data);
}

export function FolderEditor({ folder, initial, onClose }: { folder?: ChatFolderInfo; initial?: Partial<FolderDraft>; onClose: () => void }) {
  const [draft, setDraft] = useState<FolderDraft>(() => ({ ...empty, ...(folder ?? {}), ...(initial ?? {}) }));
  const [q, setQ] = useState('');
  const chats = useAllChats();
  const set = <K extends keyof FolderDraft>(k: K, v: FolderDraft[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const toggleType = (t: FolderType) => set('includeTypes', draft.includeTypes.includes(t) ? draft.includeTypes.filter((x) => x !== t) : [...draft.includeTypes, t]);
  const toggleChat = (id: string) => set('includeChatIds', draft.includeChatIds.includes(id) ? draft.includeChatIds.filter((x) => x !== id) : [...draft.includeChatIds, id]);
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    const list = s ? chats.filter((c) => c.title.toLowerCase().includes(s)) : chats;
    // Выбранные — наверху
    return [...list].sort((a, b) => Number(draft.includeChatIds.includes(b.id)) - Number(draft.includeChatIds.includes(a.id)));
  }, [chats, q, draft.includeChatIds]);
  const valid = draft.name.trim() && (draft.includeTypes.length > 0 || draft.includeChatIds.length > 0);

  const save = useMutation({
    mutationFn: () => (folder ? api.put<ChatFolderInfo>(`/chat-folders/${folder.id}`, draft) : api.post<ChatFolderInfo>('/chat-folders', draft)),
    onSuccess: () => {
      refresh();
      toast({ text: folder ? 'Папка сохранена' : `Папка «${draft.name}» создана`, kind: 'success' });
      onClose();
    },
    onError: (e) => toast({ text: errorMessage(e), kind: 'error' }),
  });

  return (
    <Modal
      open
      wide
      onClose={onClose}
      title={folder ? 'Изменить папку' : 'Новая папка'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button disabled={!valid} loading={save.isPending} onClick={() => save.mutate()}>
            {folder ? 'Сохранить' : 'Создать'}
          </Button>
        </>
      }
    >
      <div className="folder-editor">
        <div className="col gap-3">
          <Input label="Название" value={draft.name} maxLength={LIMITS.folderNameMax} onChange={(e) => set('name', e.target.value)} placeholder="Например, Работа" autoFocus />
          <div className="field">
            <span className="field__label">Значок</span>
            <div className="folder-emoji">
              {EMOJI.map((e) => (
                <button
                  key={e}
                  type="button"
                  className={cn('folder-emoji__cell', draft.emoji === e && 'folder-emoji__cell--active')}
                  onClick={() => set('emoji', e)}
                  aria-label={`Значок ${e}`}
                >
                  {e}
                </button>
              ))}
            </div>
          </div>
          <div className="field">
            <span className="field__label">Типы чатов</span>
            <div className="row wrap gap-2">
              {TYPES.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className={cn('chip', draft.includeTypes.includes(t.id) && 'chip--active')}
                  onClick={() => toggleType(t.id)}
                  aria-pressed={draft.includeTypes.includes(t.id)}
                >
                  {draft.includeTypes.includes(t.id) && <Check size={14} />} {t.label}
                </button>
              ))}
            </div>
          </div>
          <div className="card">
            <SettingRow
              title="Скрывать без звука"
              description="Чаты с выключенными уведомлениями"
              control={<Switch checked={draft.excludeMuted} onChange={(v) => set('excludeMuted', v)} label="Скрывать без звука" />}
            />
            <SettingRow
              title="Только непрочитанные"
              description="Прочитанные чаты исчезают из папки"
              control={<Switch checked={draft.excludeRead} onChange={(v) => set('excludeRead', v)} label="Только непрочитанные" />}
            />
            <SettingRow title="Скрывать архив" control={<Switch checked={draft.excludeArchived} onChange={(v) => set('excludeArchived', v)} label="Скрывать архив" />} />
          </div>
        </div>
        <div className="col gap-2" style={{ minWidth: 0 }}>
          <span className="field__label">Отдельные чаты {draft.includeChatIds.length > 0 && <span className="badge">{draft.includeChatIds.length}</span>}</span>
          <div className="input-group">
            <Search size={16} className="input-group__icon" />
            <input className="input" placeholder="Найти чат" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div className="folder-chats">
            {shown.map((c) => {
              const on = draft.includeChatIds.includes(c.id);
              return (
                <button key={c.id} type="button" className={cn('pick-row', on && 'pick-row--on')} onClick={() => toggleChat(c.id)} aria-pressed={on}>
                  <Avatar src={c.avatarUrl} name={c.title} id={c.peer?.id ?? c.id} size={36} />
                  <span className="grow ellipsis">{c.title}</span>
                  <span className="pick-row__check">{on && <Check size={14} />}</span>
                </button>
              );
            })}
            {shown.length === 0 && (
              <p className="small muted" style={{ padding: 12 }}>
                Ничего не найдено
              </p>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}

export function FoldersPage() {
  const q = useFolders();
  const navigate = useNavigate();
  const [editing, setEditing] = useState<{ folder?: ChatFolderInfo; initial?: Partial<FolderDraft> } | null>(null);
  const items = q.data?.items ?? [];
  const reorder = useMutation({
    mutationFn: (ids: string[]) => api.post<{ items: ChatFolderInfo[] }>('/chat-folders/reorder', { ids }),
    onSuccess: (r) => queryClient.setQueryData(foldersKey, r),
    onError: (e) => toast({ text: errorMessage(e), kind: 'error' }),
  });
  const move = (i: number, d: -1 | 1) => {
    const ids = items.map((f) => f.id);
    const j = i + d;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j]!, ids[i]!];
    reorder.mutate(ids);
  };
  const remove = async (f: ChatFolderInfo) => {
    if (!(await confirm({ title: `Удалить папку «${f.name}»?`, text: 'Чаты останутся на месте — пропадёт только папка.', danger: true, confirmLabel: 'Удалить' }))) return;
    try {
      await api.del(`/chat-folders/${f.id}`);
      refresh();
    } catch (e) {
      toast({ text: errorMessage(e), kind: 'error' });
    }
  };

  return (
    <div className="chat-page">
      <DetailHead title={'Папки'} />
      <div className="scroll">
        <div className="page">
          <PageHeader
            title="Папки с чатами"
            subtitle="Соберите переписки по темам — папки появятся вкладками над списком чатов"
            icon={<Inbox size={22} />}
            actions={
              <Button icon={<FolderPlus size={18} />} onClick={() => setEditing({})} disabled={items.length >= LIMITS.foldersMax}>
                Создать
              </Button>
            }
          />
          {q.isLoading ? (
            <ListSkeleton rows={3} />
          ) : items.length === 0 ? (
            <div className="card">
              <EmptyState icon={<Inbox size={28} />} title="Своих папок пока нет" text="Например, «Работа» — только рабочие группы, или «Новое» — непрочитанные личные." />
            </div>
          ) : (
            <div className="card" style={{ overflow: 'hidden' }}>
              {items.map((f, i) => (
                <div key={f.id} className="list-item">
                  <span className="folder-row__emoji">{f.emoji}</span>
                  <button
                    type="button"
                    className="list-item__body"
                    style={{ textAlign: 'left', display: 'flex', flexDirection: 'column', minWidth: 0 }}
                    onClick={() => navigate(`/chats/folder/${f.id}`)}
                  >
                    <span className="list-item__title ellipsis">{f.name}</span>
                    <span className="list-item__sub clamp-2">
                      {[...f.includeTypes.map((t) => TYPES.find((x) => x.id === t)?.label), f.includeChatIds.length ? `чатов: ${f.includeChatIds.length}` : null]
                        .filter(Boolean)
                        .join(', ') || 'Пусто'}
                      {f.unreadCount > 0 && ` · непрочитанных: ${f.unreadCount}`}
                    </span>
                  </button>
                  <IconButton label="Выше" size="sm" onClick={() => move(i, -1)} disabled={i === 0}>
                    <ArrowUp size={16} />
                  </IconButton>
                  <IconButton label="Ниже" size="sm" onClick={() => move(i, 1)} disabled={i === items.length - 1}>
                    <ArrowDown size={16} />
                  </IconButton>
                  <IconButton label="Изменить" size="sm" onClick={() => setEditing({ folder: f })}>
                    <Pencil size={16} />
                  </IconButton>
                  <IconButton label="Удалить" size="sm" onClick={() => void remove(f)}>
                    <Trash2 size={16} />
                  </IconButton>
                </div>
              ))}
            </div>
          )}
          <div className="panel__title" style={{ padding: '24px 0 10px' }}>
            Рекомендуемые
          </div>
          <div className="row wrap gap-2">
            {PRESETS.map((p) => (
              <button key={p.label} type="button" className="chip" onClick={() => setEditing({ initial: p.draft })}>
                <Plus size={14} /> {p.label}
              </button>
            ))}
          </div>
          <p className="small muted" style={{ marginTop: 16 }}>
            Встроенные вкладки «Все», «Непрочитанные», «Личные», «Группы», «Каналы», «Секретные» и «Архив» есть всегда. Папки хранятся на сервере и одинаковы на всех ваших
            устройствах.
          </p>
        </div>
        {editing && <FolderEditor folder={editing.folder} initial={editing.initial} onClose={() => setEditing(null)} />}
      </div>
    </div>
  );
}

/** Быстро добавить чат в одну из папок или убрать из неё. */
export function AddToFolderDialog({ chat, onClose }: { chat: ChatSummary; onClose: () => void }) {
  const q = useFolders();
  const [creating, setCreating] = useState(false);
  const toggle = useMutation({
    mutationFn: (f: ChatFolderInfo) => {
      const has = f.includeChatIds.includes(chat.id);
      const body: FolderDraft = {
        name: f.name,
        emoji: f.emoji,
        includeTypes: f.includeTypes,
        includeChatIds: has ? f.includeChatIds.filter((x) => x !== chat.id) : [...f.includeChatIds, chat.id],
        excludeMuted: f.excludeMuted,
        excludeRead: f.excludeRead,
        excludeArchived: f.excludeArchived,
      };
      return api.put<ChatFolderInfo>(`/chat-folders/${f.id}`, body);
    },
    onSuccess: refresh,
    onError: (e) => toast({ text: errorMessage(e), kind: 'error' }),
  });
  if (creating) return <FolderEditor initial={{ includeChatIds: [chat.id] }} onClose={onClose} />;
  const items = q.data?.items ?? [];
  return (
    <Modal open onClose={onClose} title={`«${chat.title}» в папку`}>
      <div className="col gap-2">
        {items.map((f) => {
          const on = f.includeChatIds.includes(chat.id);
          return (
            <button key={f.id} type="button" className={cn('pick-row', on && 'pick-row--on')} onClick={() => toggle.mutate(f)} disabled={toggle.isPending}>
              <span className="folder-row__emoji">{f.emoji}</span>
              <span className="grow">{f.name}</span>
              <span className="pick-row__check">{on && <Check size={14} />}</span>
            </button>
          );
        })}
        {items.length === 0 && !q.isLoading && <p className="small muted">Своих папок пока нет — создайте первую.</p>}
        <Button variant="secondary" icon={<FolderPlus size={18} />} onClick={() => setCreating(true)}>
          Новая папка с этим чатом
        </Button>
      </div>
    </Modal>
  );
}
