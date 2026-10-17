/** Списки авторов (как в X): своя лента из выбранных людей; список может быть открытым. */
import type { Paginated, Post, UserList, UserSummary } from '@omni/shared';
import { LIMITS } from '@omni/shared';
import type { Db } from '../../db/index.js';
import { bool, Db as DbClass, iso } from '../../db/index.js';
import { badRequest, notFound } from '../../lib/errors.js';
import { newId } from '../../lib/ids.js';
import { Policy } from '../policy/policy.service.js';
import { BASE_FROM, type PostRow, type PostsService } from '../posts/posts.service.js';
import type { UsersRepo } from '../users/users.repo.js';
import { mutedWordsFilter } from './muted-words.js';

interface ListRow {
  id: string;
  owner_id: string;
  name: string;
  description: string;
  emoji: string;
  is_private: number;
  created_at: number;
}

type ListInput = { name: string; description: string; emoji: string; isPrivate: boolean };

export class ListsService {
  constructor(
    private readonly db: Db,
    private readonly users: UsersRepo,
    private readonly posts: PostsService,
  ) {}

  private toDto(rows: ListRow[], memberOf?: string): (UserList & { hasMember?: boolean })[] {
    if (!rows.length) return [];
    const owners = this.users.summaries(rows.map((r) => r.owner_id));
    const list = DbClass.inList(rows.map((r) => r.id), 'l');
    const counts = new Map(
      this.db.all<{ list_id: string; c: number }>(`SELECT list_id, COUNT(*) AS c FROM user_list_members WHERE list_id IN (${list.sql}) GROUP BY list_id`, list.params).map((r) => [r.list_id, r.c]),
    );
    const has = memberOf
      ? new Set(this.db.all<{ list_id: string }>(`SELECT list_id FROM user_list_members WHERE user_id = :m AND list_id IN (${list.sql})`, { ...list.params, m: memberOf }).map((r) => r.list_id))
      : null;
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      emoji: r.emoji,
      isPrivate: bool(r.is_private),
      memberCount: counts.get(r.id) ?? 0,
      owner: owners.get(r.owner_id)!,
      createdAt: iso(r.created_at),
      ...(has ? { hasMember: has.has(r.id) } : {}),
    }));
  }

  /** Список, который можно смотреть: свой или открытый */
  private visible(viewerId: string, id: string): ListRow {
    const r = this.db.get<ListRow>('SELECT * FROM user_lists WHERE id = :id', { id });
    if (!r || (r.owner_id !== viewerId && bool(r.is_private))) throw notFound('Список не найден');
    return r;
  }

  private own(userId: string, id: string): ListRow {
    const r = this.db.get<ListRow>('SELECT * FROM user_lists WHERE id = :id AND owner_id = :u', { id, u: userId });
    if (!r) throw notFound('Список не найден');
    return r;
  }

  mine(userId: string, memberOf?: string) {
    return this.toDto(this.db.all<ListRow>('SELECT * FROM user_lists WHERE owner_id = :u ORDER BY created_at', { u: userId }), memberOf);
  }

  get(viewerId: string, id: string): UserList {
    return this.toDto([this.visible(viewerId, id)])[0]!;
  }

  create(userId: string, input: ListInput): UserList {
    const n = this.db.value<number>('SELECT COUNT(*) FROM user_lists WHERE owner_id = :u', { u: userId }) ?? 0;
    if (n >= LIMITS.listsMax) throw badRequest(`Не более ${LIMITS.listsMax} списков`);
    const now = Date.now();
    const id = newId(now);
    this.db.run(
      'INSERT INTO user_lists (id, owner_id, name, description, emoji, is_private, created_at) VALUES (:id, :u, :n, :d, :e, :p, :now)',
      { id, u: userId, n: input.name, d: input.description, e: input.emoji || '📋', p: input.isPrivate, now },
    );
    return this.get(userId, id);
  }

  update(userId: string, id: string, input: ListInput): UserList {
    this.own(userId, id);
    this.db.run('UPDATE user_lists SET name = :n, description = :d, emoji = :e, is_private = :p WHERE id = :id', {
      n: input.name,
      d: input.description,
      e: input.emoji || '📋',
      p: input.isPrivate,
      id,
    });
    return this.get(userId, id);
  }

  remove(userId: string, id: string): void {
    this.own(userId, id);
    this.db.run('DELETE FROM user_lists WHERE id = :id', { id });
  }

  members(viewerId: string, id: string): UserSummary[] {
    this.visible(viewerId, id);
    const ids = this.db.all<{ user_id: string }>('SELECT user_id FROM user_list_members WHERE list_id = :l ORDER BY added_at DESC', { l: id }).map((r) => r.user_id);
    const map = this.users.summaries(ids);
    return ids.map((i) => map.get(i)).filter((u): u is UserSummary => !!u);
  }

  addMembers(userId: string, id: string, userIds: string[]): void {
    this.own(userId, id);
    const n = this.db.value<number>('SELECT COUNT(*) FROM user_list_members WHERE list_id = :l', { l: id }) ?? 0;
    if (n + userIds.length > LIMITS.listMembersMax) throw badRequest(`В списке не более ${LIMITS.listMembersMax} человек`);
    const now = Date.now();
    for (const uid of new Set(userIds)) {
      if (!this.users.byId(uid)) throw notFound('Пользователь не найден');
      this.db.run('INSERT OR IGNORE INTO user_list_members (list_id, user_id, added_at) VALUES (:l, :u, :now)', { l: id, u: uid, now });
    }
  }

  removeMember(userId: string, id: string, memberId: string): void {
    this.own(userId, id);
    this.db.run('DELETE FROM user_list_members WHERE list_id = :l AND user_id = :u', { l: id, u: memberId });
  }

  /** Лента списка: публикации участников, видимые зрителю, без скрытых слов */
  feed(viewerId: string, id: string, cursor: string | undefined, limit: number): Paginated<Post> {
    this.visible(viewerId, id);
    const muted = mutedWordsFilter(this.db, viewerId);
    const rows = this.db.all<PostRow>(
      `SELECT p.* ${BASE_FROM}
       WHERE ${Policy.visiblePostsSql({ excludeMuted: false })} AND p.community_id IS NULL
         AND p.author_id IN (SELECT user_id FROM user_list_members WHERE list_id = :list) ${muted.sql}
         AND (:cursor IS NULL OR p.id < :cursor)
       ORDER BY p.id DESC LIMIT :limit`,
      { ...muted.params, viewer: viewerId, list: id, cursor: cursor ?? null, limit: limit + 1 },
    );
    return { items: this.posts.toDto(rows.slice(0, limit), viewerId), nextCursor: rows.length > limit ? (rows[limit - 1]?.id ?? null) : null };
  }
}
