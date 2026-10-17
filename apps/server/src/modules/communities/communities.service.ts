/** Сообщества (как группы в Facebook / сабреддиты): участники публикуют посты в общую ленту. */
import type { Community, Paginated, UserSummary } from '@omni/shared';
import type { Db } from '../../db/index.js';
import { iso } from '../../db/index.js';
import { conflict, forbidden, notFound } from '../../lib/errors.js';
import { newId } from '../../lib/ids.js';
import type { MediaService } from '../media/media.service.js';
import type { NotificationService } from '../notifications/notifications.service.js';
import type { UsersRepo } from '../users/users.repo.js';
import { offsetCursor } from '../users/users.service.js';

interface CommunityRow {
  id: string;
  slug: string;
  name: string;
  description: string;
  avatar_media_id: string | null;
  owner_id: string | null;
  visibility: 'public' | 'private';
  member_count: number;
  post_count: number;
  created_at: number;
  deleted_at: number | null;
  role?: Community['role'];
}

const likeEscape = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

export class CommunitiesService {
  constructor(
    private readonly db: Db,
    private readonly users: UsersRepo,
    private readonly media: MediaService,
    private readonly notifications: NotificationService,
  ) {}

  private toDto(r: CommunityRow): Community {
    return {
      id: r.id,
      slug: r.slug,
      name: r.name,
      description: r.description,
      avatarUrl: this.media.url(r.avatar_media_id),
      visibility: r.visibility,
      memberCount: r.member_count,
      postCount: r.post_count,
      role: r.role ?? null,
      createdAt: iso(r.created_at),
    };
  }

  private static SELECT = `SELECT c.*, (SELECT role FROM community_members m WHERE m.community_id = c.id AND m.user_id = :v) AS role FROM communities c`;

  discover(viewerId: string, q: string | undefined, cursor: string | undefined, limit: number): Paginated<Community> {
    const offset = offsetCursor.decode(cursor);
    const rows = this.db.all<CommunityRow>(
      `${CommunitiesService.SELECT}
       WHERE c.deleted_at IS NULL AND (c.visibility = 'public' OR EXISTS (SELECT 1 FROM community_members m WHERE m.community_id = c.id AND m.user_id = :v))
         AND (:q IS NULL OR c.name LIKE :like ESCAPE '\\' OR c.slug LIKE :like ESCAPE '\\')
       ORDER BY c.member_count DESC, c.created_at DESC LIMIT :l OFFSET :o`,
      { v: viewerId, q: q ?? null, like: q ? `%${likeEscape(q)}%` : null, l: limit + 1, o: offset },
    );
    return { items: rows.slice(0, limit).map((r) => this.toDto(r)), nextCursor: offsetCursor.next(offset, rows.length, limit) };
  }

  mine(viewerId: string): Community[] {
    return this.db
      .all<CommunityRow>(
        `${CommunitiesService.SELECT} JOIN community_members mm ON mm.community_id = c.id AND mm.user_id = :v
         WHERE c.deleted_at IS NULL ORDER BY mm.joined_at DESC`,
        { v: viewerId },
      )
      .map((r) => this.toDto(r));
  }

  get(viewerId: string, slugOrId: string): Community {
    const r = this.db.get<CommunityRow>(`${CommunitiesService.SELECT} WHERE (c.slug = :s OR c.id = :s) AND c.deleted_at IS NULL`, {
      v: viewerId,
      s: slugOrId,
    });
    if (!r || (r.visibility === 'private' && !r.role)) throw notFound('Сообщество не найдено');
    return this.toDto(r);
  }

  create(userId: string, input: { name: string; slug: string; description: string; visibility: 'public' | 'private' }): Community {
    if (this.db.get('SELECT 1 FROM communities WHERE slug = :s', { s: input.slug })) {
      throw conflict('Этот адрес уже занят', { slug: 'Этот адрес уже занят' });
    }
    const now = Date.now();
    const id = newId(now);
    this.db.tx(() => {
      this.db.run(
        `INSERT INTO communities (id, slug, name, description, owner_id, visibility, member_count, created_at)
         VALUES (:id, :slug, :name, :d, :u, :vis, 1, :now)`,
        { id, slug: input.slug, name: input.name, d: input.description, u: userId, vis: input.visibility, now },
      );
      this.db.run("INSERT INTO community_members (community_id, user_id, role, joined_at) VALUES (:c, :u, 'owner', :now)", { c: id, u: userId, now });
    });
    return this.get(userId, id);
  }

  update(userId: string, id: string, input: Partial<{ name: string; description: string; avatarMediaId: string | null }>): Community {
    const role = this.role(id, userId);
    if (role !== 'owner' && role !== 'moderator') throw forbidden();
    if (input.avatarMediaId) this.media.assertOwned(userId, [input.avatarMediaId], ['image']);
    this.db.run(
      `UPDATE communities SET name = coalesce(:n, name), description = coalesce(:d, description),
         avatar_media_id = CASE WHEN :setA = 1 THEN :a ELSE avatar_media_id END WHERE id = :id`,
      { n: input.name ?? null, d: input.description ?? null, setA: input.avatarMediaId !== undefined, a: input.avatarMediaId ?? null, id },
    );
    return this.get(userId, id);
  }

  private role(id: string, userId: string): Community['role'] {
    return (this.db.value<Community['role']>('SELECT role FROM community_members WHERE community_id = :c AND user_id = :u', { c: id, u: userId }) ??
      null) as Community['role'];
  }

  join(userId: string, id: string): Community {
    const c = this.db.get<CommunityRow>('SELECT * FROM communities WHERE id = :id AND deleted_at IS NULL', { id });
    if (!c) throw notFound('Сообщество не найдено');
    if (c.visibility === 'private') throw forbidden('В закрытое сообщество вступают по приглашению');
    const r = this.db.run("INSERT OR IGNORE INTO community_members (community_id, user_id, role, joined_at) VALUES (:c, :u, 'member', :now)", {
      c: id,
      u: userId,
      now: Date.now(),
    });
    if (r.changes) {
      this.db.run('UPDATE communities SET member_count = member_count + 1 WHERE id = :id', { id });
      if (c.owner_id) {
        this.notifications.notify({
          userId: c.owner_id,
          type: 'community_join',
          actorId: userId,
          entityType: 'community',
          entityId: id,
          link: `/communities/${c.slug}`,
          preview: c.name,
        });
      }
    }
    return this.get(userId, id);
  }

  leave(userId: string, id: string): void {
    if (this.role(id, userId) === 'owner') throw forbidden('Владелец не может покинуть сообщество — передайте права или удалите его');
    const r = this.db.run('DELETE FROM community_members WHERE community_id = :c AND user_id = :u', { c: id, u: userId });
    if (r.changes) this.db.run('UPDATE communities SET member_count = max(member_count - 1, 0) WHERE id = :id', { id });
  }

  members(viewerId: string, id: string, cursor: string | undefined, limit: number): Paginated<{ user: UserSummary; role: string }> {
    this.get(viewerId, id);
    const offset = offsetCursor.decode(cursor);
    const rows = this.db.all<{ user_id: string; role: string }>(
      `SELECT user_id, role FROM community_members WHERE community_id = :c
       ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'moderator' THEN 1 ELSE 2 END, joined_at LIMIT :l OFFSET :o`,
      { c: id, l: limit + 1, o: offset },
    );
    const users = this.users.summaries(rows.map((r) => r.user_id));
    return {
      items: rows.slice(0, limit).filter((r) => users.has(r.user_id)).map((r) => ({ user: users.get(r.user_id)!, role: r.role })),
      nextCursor: offsetCursor.next(offset, rows.length, limit),
    };
  }

  remove(userId: string, id: string): void {
    if (this.role(id, userId) !== 'owner') throw forbidden();
    this.db.run('UPDATE communities SET deleted_at = :now WHERE id = :id', { now: Date.now(), id });
  }
}
