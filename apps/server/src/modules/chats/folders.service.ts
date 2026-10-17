/**
 * Свои папки чатов: набор правил (типы чатов + выбранные чаты − исключения).
 * Папка не хранит список сообщений — это фильтр, который превращается в SQL.
 */
import type { ChatFolderInfo } from '@omni/shared';
import { LIMITS } from '@omni/shared';
import type { Db } from '../../db/index.js';
import { bool } from '../../db/index.js';
import { badRequest, notFound } from '../../lib/errors.js';
import { newId } from '../../lib/ids.js';

export interface FolderRow {
  id: string;
  user_id: string;
  name: string;
  emoji: string;
  position: number;
  include_types: string;
  include_chat_ids: string;
  exclude_muted: number;
  exclude_read: number;
  exclude_archived: number;
  created_at: number;
}

type FolderInput = Omit<ChatFolderInfo, 'id' | 'unreadCount'>;

/** JSON-массив из колонки (повреждённое значение — пустой массив). */
function arr<T = string>(v: string): T[] {
  try {
    const parsed: unknown = JSON.parse(v);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

const TYPE_SQL: Record<ChatFolderInfo['includeTypes'][number], string> = {
  direct: 'direct',
  groups: 'group',
  channels: 'channel',
  secret: 'secret',
  saved: 'saved',
};

export class FoldersService {
  constructor(private readonly db: Db) {}

  row(userId: string, id: string): FolderRow {
    const r = this.db.get<FolderRow>('SELECT * FROM chat_folders WHERE id = :id AND user_id = :u', { id, u: userId });
    if (!r) throw notFound('Папка не найдена');
    return r;
  }

  /** Условие отбора чатов папки (таблицы: c — chats, m — chat_members). */
  where(f: FolderRow): { sql: string; params: Record<string, unknown> } {
    const types = arr(f.include_types).filter((t): t is keyof typeof TYPE_SQL => t in TYPE_SQL);
    const ids = arr(f.include_chat_ids);
    const params: Record<string, unknown> = { fnow: Date.now() };
    const include: string[] = [];
    if (types.length) {
      include.push(`c.type IN (${types.map((t, i) => ((params[`ft${i}`] = TYPE_SQL[t]), `:ft${i}`)).join(',')})`);
    }
    if (ids.length) {
      include.push(`c.id IN (${ids.map((id, i) => ((params[`fc${i}`] = id), `:fc${i}`)).join(',')})`);
    }
    const parts = [include.length ? `(${include.join(' OR ')})` : '0'];
    if (bool(f.exclude_archived)) parts.push('m.archived = 0');
    if (bool(f.exclude_muted)) parts.push('(m.muted_until IS NULL OR m.muted_until < :fnow)');
    if (bool(f.exclude_read)) parts.push('c.last_seq > max(m.last_read_seq, m.cleared_seq)');
    return { sql: parts.join(' AND '), params };
  }

  private toDto(f: FolderRow, userId: string): ChatFolderInfo {
    const w = this.where(f);
    const unread =
      this.db.value<number>(
        `SELECT COUNT(*) FROM chat_members m JOIN chats c ON c.id = m.chat_id
         WHERE m.user_id = :u AND m.hidden = 0 AND c.deleted_at IS NULL AND ${w.sql}
           AND c.last_seq > max(m.last_read_seq, m.cleared_seq)`,
        { u: userId, ...w.params },
      ) ?? 0;
    return {
      id: f.id,
      name: f.name,
      emoji: f.emoji,
      includeTypes: arr(f.include_types),
      includeChatIds: arr(f.include_chat_ids),
      excludeMuted: bool(f.exclude_muted),
      excludeRead: bool(f.exclude_read),
      excludeArchived: bool(f.exclude_archived),
      unreadCount: unread,
    };
  }

  list(userId: string): ChatFolderInfo[] {
    return this.db
      .all<FolderRow>('SELECT * FROM chat_folders WHERE user_id = :u ORDER BY position, created_at', { u: userId })
      .map((f) => this.toDto(f, userId));
  }

  private assertChats(userId: string, ids: string[]): void {
    for (const id of ids) {
      if (!this.db.get('SELECT 1 FROM chat_members WHERE chat_id = :c AND user_id = :u', { c: id, u: userId })) {
        throw badRequest('В папку можно добавить только свои чаты');
      }
    }
  }

  create(userId: string, input: FolderInput): ChatFolderInfo {
    const count = this.db.value<number>('SELECT COUNT(*) FROM chat_folders WHERE user_id = :u', { u: userId }) ?? 0;
    if (count >= LIMITS.foldersMax) throw badRequest(`Не больше ${LIMITS.foldersMax} папок`);
    if (!input.includeTypes.length && !input.includeChatIds.length) throw badRequest('Выберите типы чатов или конкретные чаты', { includeTypes: 'Пустая папка' });
    this.assertChats(userId, input.includeChatIds);
    const now = Date.now();
    const id = newId(now);
    this.db.run(
      `INSERT INTO chat_folders (id, user_id, name, emoji, position, include_types, include_chat_ids, exclude_muted, exclude_read, exclude_archived, created_at)
       VALUES (:id, :u, :name, :emoji, :pos, :types, :ids, :muted, :read, :archived, :now)`,
      {
        id,
        u: userId,
        name: input.name,
        emoji: input.emoji || '📁',
        pos: count,
        types: JSON.stringify([...new Set(input.includeTypes)]),
        ids: JSON.stringify([...new Set(input.includeChatIds)]),
        muted: input.excludeMuted,
        read: input.excludeRead,
        archived: input.excludeArchived,
        now,
      },
    );
    return this.toDto(this.row(userId, id), userId);
  }

  update(userId: string, id: string, input: FolderInput): ChatFolderInfo {
    this.row(userId, id);
    if (!input.includeTypes.length && !input.includeChatIds.length) throw badRequest('Выберите типы чатов или конкретные чаты', { includeTypes: 'Пустая папка' });
    this.assertChats(userId, input.includeChatIds);
    this.db.run(
      `UPDATE chat_folders SET name = :name, emoji = :emoji, include_types = :types, include_chat_ids = :ids,
         exclude_muted = :muted, exclude_read = :read, exclude_archived = :archived WHERE id = :id AND user_id = :u`,
      {
        id,
        u: userId,
        name: input.name,
        emoji: input.emoji || '📁',
        types: JSON.stringify([...new Set(input.includeTypes)]),
        ids: JSON.stringify([...new Set(input.includeChatIds)]),
        muted: input.excludeMuted,
        read: input.excludeRead,
        archived: input.excludeArchived,
      },
    );
    return this.toDto(this.row(userId, id), userId);
  }

  remove(userId: string, id: string): void {
    this.row(userId, id);
    this.db.run('DELETE FROM chat_folders WHERE id = :id AND user_id = :u', { id, u: userId });
  }

  reorder(userId: string, ids: string[]): ChatFolderInfo[] {
    this.db.tx(() => ids.forEach((id, position) => this.db.run('UPDATE chat_folders SET position = :p WHERE id = :id AND user_id = :u', { p: position, id, u: userId })));
    return this.list(userId);
  }
}
