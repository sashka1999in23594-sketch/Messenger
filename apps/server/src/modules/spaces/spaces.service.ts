/**
 * Компании и сообщества — «пространства» в духе Discord.
 *
 * Компания: только по приглашению руководителя (приходит в уведомления, можно
 * принять или отклонить). Руководитель создаёт роли с правами и цветом,
 * категории, чаты и каналы-объявления; чат можно открыть только для
 * некоторых ролей. Сотрудники попадают во все доступные им чаты автоматически.
 *
 * Сообщество: открытое (вступает кто хочет) или закрытое (по приглашению или
 * ссылке). Внутри много групп и каналов — в каждую вступают по желанию.
 *
 * Чаты внутри — обычные чаты (ChatsService): переписка, реакции, голосовые,
 * звонки и модерация работают как везде. Здесь только состав и права:
 * роль человека в каждом чате вычисляется из его ролей в пространстве.
 * Сами решения «можно ли» принимает Policy.
 */
import type { ChatRole, SpaceCategory, SpaceDetails, SpaceInvite, SpaceKind, SpaceMember, SpaceRole, SpaceRoom, SpaceSummary } from '@omni/shared';
import { SPACE_PERMS } from '@omni/shared';
import type { Db } from '../../db/index.js';
import { bool, iso } from '../../db/index.js';
import { randomToken } from '../../lib/crypto.js';
import { badRequest, blocked, conflict, forbidden, notFound } from '../../lib/errors.js';
import { newId } from '../../lib/ids.js';
import type { ChatRow } from '../chats/chats.repo.js';
import type { ChatsService } from '../chats/chats.service.js';
import type { MediaService } from '../media/media.service.js';
import type { NotificationService } from '../notifications/notifications.service.js';
import type { Policy } from '../policy/policy.service.js';
import type { RealtimeHub } from '../realtime/hub.js';
import type { UsersRepo } from '../users/users.repo.js';

interface SpaceRow {
  id: string;
  kind: SpaceKind;
  name: string;
  slug: string | null;
  description: string;
  avatar_media_id: string | null;
  owner_id: string;
  is_public: number;
  invite_token: string | null;
  member_count: number;
  created_at: number;
  deleted_at: number | null;
}

interface RoleRow {
  id: string;
  space_id: string;
  name: string;
  color: string;
  permissions: number;
  position: number;
  is_default: number;
}

const P = SPACE_PERMS;
const KIND_LABEL: Record<SpaceKind, string> = { company: 'компанию', community: 'сообщество' };
const likeEscape = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

export class SpacesService {
  constructor(
    private readonly db: Db,
    private readonly users: UsersRepo,
    private readonly media: MediaService,
    private readonly chats: ChatsService,
    private readonly policy: Policy,
    private readonly notifications: NotificationService,
    private readonly hub: RealtimeHub,
    private readonly origin: string,
  ) {
    // Чаты пространства видят только его участники (и только доступные их ролям)
    chats.setSpaceGate((userId, chat) => !!chat.space_id && this.policy.canSeeSpaceRoom(chat.space_id, chat.id, userId));
  }

  // ─── Доступ ───────────────────────────────────────────────────────────────

  private row(id: string): SpaceRow {
    const sp = this.db.get<SpaceRow>('SELECT * FROM spaces WHERE id = :id AND deleted_at IS NULL', { id });
    if (!sp) throw notFound('Не найдено');
    return sp;
  }

  /** Участник видит всё; открытое сообщество можно посмотреть до вступления. */
  private visible(id: string, userId: string): SpaceRow {
    const sp = this.row(id);
    if (!this.policy.isSpaceMember(id, userId) && !(sp.kind === 'community' && bool(sp.is_public))) throw notFound('Не найдено');
    return sp;
  }

  private need(id: string, userId: string, perm: number, message = 'Недостаточно прав'): SpaceRow {
    const sp = this.row(id);
    if (!this.policy.hasSpacePerm(id, userId, perm)) throw forbidden(message);
    return sp;
  }

  /** Нельзя выдать права, которых нет у вас самих; «Администратор» выдаёт только владелец. */
  private assertGrantable(sp: SpaceRow, userId: string, permissions: number): void {
    if (sp.owner_id === userId) return;
    const mine = this.policy.spacePermissions(sp.id, userId);
    if (permissions & P.admin || permissions & ~mine) throw forbidden('Нельзя выдать права, которых нет у вас');
  }

  private broadcast(spaceId: string): void {
    const ids = this.db.all<{ user_id: string }>('SELECT user_id FROM space_members WHERE space_id = :s', { s: spaceId }).map((r) => r.user_id);
    this.hub.sendToUsers(ids, { t: 'space.changed', spaceId });
  }

  // ─── Состав чатов ─────────────────────────────────────────────────────────

  /** Роль человека в чате пространства по его правам. */
  private roomRole(sp: SpaceRow, chat: ChatRow, userId: string, perms: number): ChatRole {
    if (sp.owner_id === userId) return 'owner';
    if (chat.type === 'channel') return perms & (P.announce | P.moderate) ? 'admin' : 'subscriber';
    return perms & P.moderate ? 'admin' : 'member';
  }

  /**
   * Приводит участие человека в чатах пространства к его правам: в компании —
   * во всех доступных чатах; в сообществе — только там, куда он вступил сам.
   */
  private sync(sp: SpaceRow, userId: string): void {
    const member = this.policy.isSpaceMember(sp.id, userId);
    const perms = member ? this.policy.spacePermissions(sp.id, userId) : 0;
    for (const chat of this.chats.spaceRooms(sp.id)) {
      const visible = member && this.policy.canSeeSpaceRoom(sp.id, chat.id, userId) && !this.chats.isBanned(chat.id, userId);
      let want: ChatRole | null = null;
      if (visible) {
        const joined = !!this.chats.member(chat.id, userId);
        want = sp.kind === 'company' || joined || sp.owner_id === userId ? this.roomRole(sp, chat, userId, perms) : null;
      }
      if (this.chats.setSpaceMembership(chat.id, userId, want) && want) this.hub.sendToUser(userId, { t: 'chat.changed', chatId: chat.id });
    }
  }

  private syncAll(sp: SpaceRow): void {
    const ids = this.db.all<{ user_id: string }>('SELECT user_id FROM space_members WHERE space_id = :s', { s: sp.id });
    this.db.tx(() => {
      for (const r of ids) this.sync(sp, r.user_id);
    });
  }

  private addMember(sp: SpaceRow, userId: string): void {
    this.db.tx(() => {
      const r = this.db.run('INSERT OR IGNORE INTO space_members (space_id, user_id, joined_at) VALUES (:s, :u, :now)', { s: sp.id, u: userId, now: Date.now() });
      if (r.changes) this.db.run('UPDATE spaces SET member_count = member_count + 1 WHERE id = :s', { s: sp.id });
      this.db.run('DELETE FROM space_invites WHERE space_id = :s AND user_id = :u', { s: sp.id, u: userId });
      this.sync(sp, userId);
    });
    this.broadcast(sp.id);
  }

  private dropMember(sp: SpaceRow, userId: string): void {
    this.db.tx(() => {
      const r = this.db.run('DELETE FROM space_members WHERE space_id = :s AND user_id = :u', { s: sp.id, u: userId });
      if (r.changes) this.db.run('UPDATE spaces SET member_count = member_count - 1 WHERE id = :s', { s: sp.id });
      this.db.run('DELETE FROM space_member_roles WHERE space_id = :s AND user_id = :u', { s: sp.id, u: userId });
      // Выходя из пространства, человек выходит и из всех его чатов
      for (const chat of this.chats.spaceRooms(sp.id)) this.chats.setSpaceMembership(chat.id, userId, null);
    });
    this.hub.sendToUser(userId, { t: 'space.removed', spaceId: sp.id });
    this.broadcast(sp.id);
  }

  // ─── Карточки ─────────────────────────────────────────────────────────────

  private summary(sp: SpaceRow, userId: string): SpaceSummary {
    const joined = this.policy.isSpaceMember(sp.id, userId);
    const unreadRooms = joined
      ? (this.db.value<number>(
          `SELECT COUNT(*) FROM chat_members m JOIN chats c ON c.id = m.chat_id
           WHERE m.user_id = :u AND c.space_id = :s AND c.deleted_at IS NULL
             AND (m.muted_until IS NULL OR m.muted_until < :now)
             AND EXISTS (SELECT 1 FROM messages x WHERE x.chat_id = c.id AND x.seq > max(m.last_read_seq, m.cleared_seq)
               AND x.thread_root_id IS NULL AND x.deleted_at IS NULL AND x.kind != 'system' AND (x.sender_id IS NULL OR x.sender_id != :u))`,
          { u: userId, s: sp.id, now: Date.now() },
        ) ?? 0)
      : 0;
    return {
      id: sp.id,
      kind: sp.kind,
      name: sp.name,
      slug: sp.slug,
      description: sp.description,
      avatarUrl: this.media.url(sp.avatar_media_id),
      isPublic: bool(sp.is_public),
      memberCount: sp.member_count,
      ownerId: sp.owner_id,
      joined,
      permissions: joined ? this.policy.spacePermissions(sp.id, userId) : 0,
      unreadRooms,
      createdAt: iso(sp.created_at),
    };
  }

  private roles(spaceId: string): SpaceRole[] {
    const sp = this.row(spaceId);
    return this.db
      .all<RoleRow & { cnt: number }>(
        `SELECT r.*, (SELECT COUNT(*) FROM space_member_roles mr WHERE mr.role_id = r.id) AS cnt
         FROM space_roles r WHERE r.space_id = :s ORDER BY r.is_default ASC, r.position DESC, r.created_at`,
        { s: spaceId },
      )
      .map((r) => ({
        id: r.id,
        name: r.name,
        color: r.color,
        permissions: r.permissions,
        position: r.position,
        isDefault: bool(r.is_default),
        memberCount: bool(r.is_default) ? sp.member_count : r.cnt,
      }));
  }

  private roomRoleIds(chatId: string): string[] {
    return this.db.all<{ role_id: string }>('SELECT role_id FROM space_room_roles WHERE chat_id = :c', { c: chatId }).map((r) => r.role_id);
  }

  private room(sp: SpaceRow, chat: ChatRow, userId: string): SpaceRoom {
    return {
      chat: this.chats.roomSummary(userId, chat),
      categoryId: chat.space_category_id,
      position: chat.space_position,
      roleIds: this.roomRoleIds(chat.id),
      joined: !!this.chats.member(chat.id, userId),
    };
  }

  list(userId: string, kind: SpaceKind): SpaceSummary[] {
    const rows = this.db.all<SpaceRow>(
      `SELECT s.* FROM spaces s JOIN space_members m ON m.space_id = s.id AND m.user_id = :u
       WHERE s.kind = :k AND s.deleted_at IS NULL ORDER BY m.joined_at DESC`,
      { u: userId, k: kind },
    );
    return rows.map((r) => this.summary(r, userId));
  }

  /** Открытые сообщества: поиск по названию и описанию. */
  discover(userId: string, q?: string, limit = 50): SpaceSummary[] {
    const rows = this.db.all<SpaceRow>(
      `SELECT * FROM spaces WHERE kind = 'community' AND is_public = 1 AND deleted_at IS NULL
         AND (:q IS NULL OR name LIKE :like ESCAPE '\\' OR description LIKE :like ESCAPE '\\' OR slug LIKE :like ESCAPE '\\')
       ORDER BY member_count DESC, created_at DESC LIMIT :limit`,
      { q: q ?? null, like: q ? `%${likeEscape(q)}%` : null, limit },
    );
    return rows.map((r) => this.summary(r, userId));
  }

  get(userId: string, id: string): SpaceDetails {
    const sp = this.visible(id, userId);
    const member = this.policy.isSpaceMember(id, userId);
    const rooms = this.chats
      .spaceRooms(id)
      // До вступления видны только чаты без ограничений по ролям
      .filter((c) => (member ? this.policy.canSeeSpaceRoom(id, c.id, userId) : !this.roomRoleIds(c.id).length))
      .map((c) => this.room(sp, c, userId));
    const canInvite = member && this.policy.hasSpacePerm(id, userId, P.invite);
    return {
      ...this.summary(sp, userId),
      roles: this.roles(id),
      categories: this.db
        .all<{ id: string; name: string; position: number }>('SELECT id, name, position FROM space_categories WHERE space_id = :s ORDER BY position, rowid', { s: id })
        .map((c): SpaceCategory => ({ id: c.id, name: c.name, position: c.position })),
      rooms,
      inviteLink: canInvite && sp.invite_token ? `${this.origin}/s/${sp.invite_token}` : null,
    };
  }

  // ─── Создание и настройки ─────────────────────────────────────────────────

  create(
    userId: string,
    input: { kind: SpaceKind; name: string; description: string; isPublic: boolean; slug?: string | null; avatarMediaId?: string | null },
  ): SpaceDetails {
    if (input.avatarMediaId) this.media.assertOwned(userId, [input.avatarMediaId], ['image']);
    if (input.slug && this.db.get('SELECT 1 FROM spaces WHERE slug = :s', { s: input.slug })) throw conflict('Этот адрес уже занят', { slug: 'Адрес занят' });
    const owned = this.db.value<number>('SELECT COUNT(*) FROM spaces WHERE owner_id = :u AND deleted_at IS NULL', { u: userId }) ?? 0;
    if (owned >= 50) throw badRequest('Можно владеть не более чем 50 компаниями и сообществами');
    const now = Date.now();
    const id = newId(now);
    const company = input.kind === 'company';
    this.db.tx(() => {
      this.db.run(
        `INSERT INTO spaces (id, kind, name, slug, description, avatar_media_id, owner_id, is_public, member_count, created_at)
         VALUES (:id, :kind, :name, :slug, :d, :avatar, :owner, :pub, 1, :now)`,
        {
          id,
          kind: input.kind,
          name: input.name,
          slug: input.slug ?? null,
          d: input.description,
          avatar: input.avatarMediaId ?? null,
          owner: userId,
          // Компания всегда закрыта: попасть можно только по приглашению
          pub: !company && input.isPublic ? 1 : 0,
          now,
        },
      );
      this.db.run('INSERT INTO space_members (space_id, user_id, joined_at) VALUES (:s, :u, :now)', { s: id, u: userId, now });
      const role = (name: string, color: string, permissions: number, position: number, isDefault = false) =>
        this.db.run(
          `INSERT INTO space_roles (id, space_id, name, color, permissions, position, is_default, created_at)
           VALUES (:id, :s, :name, :color, :p, :pos, :def, :now)`,
          { id: newId(), s: id, name, color, p: permissions, pos: position, def: isDefault ? 1 : 0, now },
        );
      role('Все участники', '#99aab5', 0, 0, true);
      role('Администратор', '#ed4245', P.admin, 3);
      if (company) {
        role('Руководитель отдела', '#f0b232', P.invite | P.moderate | P.announce | P.manageRooms, 2);
        role('Сотрудник', '#1fb6e6', 0, 1);
      } else {
        role('Модератор', '#57f287', P.moderate | P.kick, 2);
      }
      const cat = newId();
      this.db.run('INSERT INTO space_categories (id, space_id, name, position) VALUES (:id, :s, :n, 0)', { id: cat, s: id, n: company ? 'Общее' : 'Группы' });
      const rooms: { title: string; type: 'group' | 'channel'; description: string }[] = company
        ? [
            { title: 'объявления', type: 'channel', description: 'Важное от руководства' },
            { title: 'общий', type: 'group', description: 'Общий чат компании' },
          ]
        : [{ title: 'Общий чат', type: 'group', description: 'Знакомимся и общаемся' }];
      rooms.forEach((r, i) =>
        this.chats.createSpaceRoom(userId, id, { title: r.title, description: r.description, type: r.type, isPublic: !company, categoryId: cat, position: i }),
      );
      this.sync(this.row(id), userId);
    });
    return this.get(userId, id);
  }

  update(userId: string, id: string, input: Partial<{ name: string; description: string; isPublic: boolean; avatarMediaId: string | null }>): SpaceDetails {
    const sp = this.need(id, userId, P.manageSpace);
    if (input.avatarMediaId) this.media.assertOwned(userId, [input.avatarMediaId], ['image']);
    if (input.isPublic !== undefined && sp.kind === 'company') throw badRequest('Компания всегда закрыта: в неё попадают только по приглашению');
    this.db.run(
      `UPDATE spaces SET name = coalesce(:name, name), description = coalesce(:d, description), is_public = coalesce(:pub, is_public),
         avatar_media_id = CASE WHEN :setAvatar = 1 THEN :avatar ELSE avatar_media_id END WHERE id = :id`,
      {
        name: input.name ?? null,
        d: input.description ?? null,
        pub: input.isPublic === undefined ? null : input.isPublic ? 1 : 0,
        setAvatar: input.avatarMediaId !== undefined ? 1 : 0,
        avatar: input.avatarMediaId ?? null,
        id,
      },
    );
    this.broadcast(id);
    return this.get(userId, id);
  }

  remove(userId: string, id: string): void {
    const sp = this.row(id);
    if (sp.owner_id !== userId) throw forbidden('Удалить может только владелец');
    const ids = this.db.all<{ user_id: string }>('SELECT user_id FROM space_members WHERE space_id = :s', { s: id }).map((r) => r.user_id);
    this.db.tx(() => {
      this.db.run('UPDATE spaces SET deleted_at = :now, invite_token = NULL WHERE id = :id', { now: Date.now(), id });
      for (const chat of this.chats.spaceRooms(id)) this.chats.deleteSpaceRoom(chat.id);
    });
    this.hub.sendToUsers(ids, { t: 'space.removed', spaceId: id });
  }

  // ─── Участники ────────────────────────────────────────────────────────────

  join(userId: string, id: string): SpaceDetails {
    const sp = this.row(id);
    if (sp.kind !== 'community' || !bool(sp.is_public)) throw forbidden('Вступить можно только по приглашению');
    this.addMember(sp, userId);
    return this.get(userId, id);
  }

  /** Вход по ссылке-приглашению: для закрытых сообществ. */
  joinByLink(userId: string, token: string): SpaceDetails {
    const sp = this.db.get<SpaceRow>('SELECT * FROM spaces WHERE invite_token = :t AND deleted_at IS NULL', { t: token });
    if (!sp) throw notFound('Ссылка недействительна или отозвана');
    this.addMember(sp, userId);
    return this.get(userId, sp.id);
  }

  /** Новая ссылка-приглашение (старая перестаёт работать). */
  resetLink(userId: string, id: string): { inviteLink: string } {
    this.need(id, userId, P.invite);
    const token = randomToken(12);
    this.db.run('UPDATE spaces SET invite_token = :t WHERE id = :id', { t: token, id });
    return { inviteLink: `${this.origin}/s/${token}` };
  }

  leave(userId: string, id: string): void {
    const sp = this.row(id);
    if (sp.owner_id === userId) throw badRequest('Владелец не может выйти — удалите или передайте владение');
    if (!this.policy.isSpaceMember(id, userId)) return;
    this.dropMember(sp, userId);
  }

  members(userId: string, id: string): SpaceMember[] {
    const sp = this.row(id);
    if (!this.policy.isSpaceMember(id, userId)) throw notFound('Не найдено');
    const rows = this.db.all<{ user_id: string; joined_at: number }>(
      'SELECT user_id, joined_at FROM space_members WHERE space_id = :s ORDER BY joined_at LIMIT 2000',
      { s: id },
    );
    const roles = this.db.all<{ user_id: string; role_id: string }>('SELECT user_id, role_id FROM space_member_roles WHERE space_id = :s', { s: id });
    const byUser = new Map<string, string[]>();
    for (const r of roles) byUser.set(r.user_id, [...(byUser.get(r.user_id) ?? []), r.role_id]);
    const users = this.users.summaries(rows.map((r) => r.user_id));
    return rows
      .filter((r) => users.has(r.user_id))
      .map((r) => ({ user: users.get(r.user_id)!, roleIds: byUser.get(r.user_id) ?? [], isOwner: r.user_id === sp.owner_id, joinedAt: iso(r.joined_at) }));
  }

  kick(userId: string, id: string, targetId: string): void {
    const sp = this.need(id, userId, P.kick);
    if (targetId === sp.owner_id) throw forbidden('Владельца исключить нельзя');
    if (targetId === userId) return this.leave(userId, id);
    if (!this.policy.isSpaceMember(id, targetId)) throw notFound('Участник не найден');
    if (sp.owner_id !== userId && this.policy.hasSpacePerm(id, targetId, P.admin)) throw forbidden('Администратора может исключить только владелец');
    this.dropMember(sp, targetId);
  }

  setMemberRoles(userId: string, id: string, targetId: string, roleIds: string[]): SpaceMember {
    const sp = this.need(id, userId, P.manageRoles);
    if (!this.policy.isSpaceMember(id, targetId)) throw notFound('Участник не найден');
    if (targetId === userId && sp.owner_id !== userId) throw forbidden('Свои роли меняет только владелец');
    const unique = [...new Set(roleIds)];
    const roles = unique.length
      ? this.db.all<RoleRow>(`SELECT * FROM space_roles WHERE space_id = :s AND is_default = 0 AND id IN (${unique.map((_, i) => `:r${i}`).join(',')})`, {
          s: id,
          ...Object.fromEntries(unique.map((r, i) => [`r${i}`, r])),
        })
      : [];
    if (roles.length !== unique.length) throw badRequest('Роль не найдена');
    // Выдать или снять можно только те роли, права которых у вас есть
    const current = this.db.all<RoleRow>(
      'SELECT r.* FROM space_roles r JOIN space_member_roles mr ON mr.role_id = r.id WHERE mr.space_id = :s AND mr.user_id = :u',
      { s: id, u: targetId },
    );
    for (const r of [...roles, ...current.filter((c) => !unique.includes(c.id))]) this.assertGrantable(sp, userId, r.permissions);
    this.db.tx(() => {
      this.db.run('DELETE FROM space_member_roles WHERE space_id = :s AND user_id = :u', { s: id, u: targetId });
      for (const r of roles) this.db.run('INSERT INTO space_member_roles (space_id, user_id, role_id) VALUES (:s, :u, :r)', { s: id, u: targetId, r: r.id });
      this.sync(sp, targetId);
    });
    this.broadcast(id);
    return this.members(userId, id).find((m) => m.user.id === targetId)!;
  }

  // ─── Роли ─────────────────────────────────────────────────────────────────

  createRole(userId: string, id: string, input: { name: string; color: string; permissions: number }): SpaceRole {
    const sp = this.need(id, userId, P.manageRoles);
    this.assertGrantable(sp, userId, input.permissions);
    const count = this.db.value<number>('SELECT COUNT(*) FROM space_roles WHERE space_id = :s', { s: id }) ?? 0;
    if (count >= 100) throw badRequest('Не более 100 ролей');
    const pos = (this.db.value<number>('SELECT max(position) FROM space_roles WHERE space_id = :s', { s: id }) ?? 0) + 1;
    const roleId = newId();
    this.db.run(
      `INSERT INTO space_roles (id, space_id, name, color, permissions, position, is_default, created_at)
       VALUES (:id, :s, :name, :color, :p, :pos, 0, :now)`,
      { id: roleId, s: id, name: input.name, color: input.color, p: input.permissions, pos, now: Date.now() },
    );
    this.broadcast(id);
    return this.roles(id).find((r) => r.id === roleId)!;
  }

  updateRole(userId: string, id: string, roleId: string, input: Partial<{ name: string; color: string; permissions: number; position: number }>): SpaceRole {
    const sp = this.need(id, userId, P.manageRoles);
    const role = this.db.get<RoleRow>('SELECT * FROM space_roles WHERE id = :r AND space_id = :s', { r: roleId, s: id });
    if (!role) throw notFound('Роль не найдена');
    this.assertGrantable(sp, userId, role.permissions);
    if (input.permissions !== undefined) this.assertGrantable(sp, userId, input.permissions);
    this.db.run(
      `UPDATE space_roles SET name = coalesce(:name, name), color = coalesce(:color, color),
         permissions = coalesce(:p, permissions), position = coalesce(:pos, position) WHERE id = :r`,
      { name: role.is_default ? null : (input.name ?? null), color: input.color ?? null, p: input.permissions ?? null, pos: input.position ?? null, r: roleId },
    );
    if (input.permissions !== undefined && input.permissions !== role.permissions) this.syncAll(sp);
    this.broadcast(id);
    return this.roles(id).find((r) => r.id === roleId)!;
  }

  deleteRole(userId: string, id: string, roleId: string): void {
    const sp = this.need(id, userId, P.manageRoles);
    const role = this.db.get<RoleRow>('SELECT * FROM space_roles WHERE id = :r AND space_id = :s', { r: roleId, s: id });
    if (!role) throw notFound('Роль не найдена');
    if (role.is_default) throw badRequest('Роль «Все участники» удалить нельзя');
    this.assertGrantable(sp, userId, role.permissions);
    this.db.run('DELETE FROM space_roles WHERE id = :r', { r: roleId });
    this.syncAll(sp);
    this.broadcast(id);
  }

  // ─── Категории и чаты ─────────────────────────────────────────────────────

  createCategory(userId: string, id: string, input: { name: string; position?: number }): SpaceCategory {
    this.need(id, userId, P.manageRooms);
    const pos = input.position ?? (this.db.value<number>('SELECT coalesce(max(position), -1) FROM space_categories WHERE space_id = :s', { s: id }) ?? -1) + 1;
    const catId = newId();
    this.db.run('INSERT INTO space_categories (id, space_id, name, position) VALUES (:id, :s, :n, :p)', { id: catId, s: id, n: input.name, p: pos });
    this.broadcast(id);
    return { id: catId, name: input.name, position: pos };
  }

  updateCategory(userId: string, id: string, catId: string, input: { name?: string; position?: number }): void {
    this.need(id, userId, P.manageRooms);
    const r = this.db.run('UPDATE space_categories SET name = coalesce(:n, name), position = coalesce(:p, position) WHERE id = :c AND space_id = :s', {
      n: input.name ?? null,
      p: input.position ?? null,
      c: catId,
      s: id,
    });
    if (!r.changes) throw notFound('Категория не найдена');
    this.broadcast(id);
  }

  /** Удаление категории: её чаты остаются, но без категории. */
  deleteCategory(userId: string, id: string, catId: string): void {
    this.need(id, userId, P.manageRooms);
    this.db.tx(() => {
      this.db.run('UPDATE chats SET space_category_id = NULL WHERE space_id = :s AND space_category_id = :c', { s: id, c: catId });
      this.db.run('DELETE FROM space_categories WHERE id = :c AND space_id = :s', { c: catId, s: id });
    });
    this.broadcast(id);
  }

  private assertRoles(spaceId: string, roleIds: string[]): string[] {
    const unique = [...new Set(roleIds)];
    if (!unique.length) return [];
    const found = this.db.all<{ id: string }>(`SELECT id FROM space_roles WHERE space_id = :s AND id IN (${unique.map((_, i) => `:r${i}`).join(',')})`, {
      s: spaceId,
      ...Object.fromEntries(unique.map((r, i) => [`r${i}`, r])),
    });
    if (found.length !== unique.length) throw badRequest('Роль не найдена');
    return unique;
  }

  private assertCategory(spaceId: string, catId: string | null | undefined): void {
    if (catId && !this.db.get('SELECT 1 FROM space_categories WHERE id = :c AND space_id = :s', { c: catId, s: spaceId })) throw badRequest('Категория не найдена');
  }

  private spaceRoom(spaceId: string, chatId: string): ChatRow {
    const chat = this.chats.spaceRooms(spaceId).find((c) => c.id === chatId);
    if (!chat) throw notFound('Чат не найден');
    return chat;
  }

  createRoom(
    userId: string,
    id: string,
    input: { title: string; description: string; kind: 'group' | 'channel'; categoryId?: string | null; roleIds: string[]; isPublic: boolean },
  ): SpaceRoom {
    const sp = this.need(id, userId, P.manageRooms);
    this.assertCategory(id, input.categoryId);
    const roleIds = this.assertRoles(id, input.roleIds);
    if (this.chats.spaceRooms(id).length >= 200) throw badRequest('Не более 200 чатов');
    const pos =
      (this.db.value<number>('SELECT coalesce(max(space_position), -1) FROM chats WHERE space_id = :s AND space_category_id IS :c AND deleted_at IS NULL', {
        s: id,
        c: input.categoryId ?? null,
      }) ?? -1) + 1;
    const chatId = this.db.tx(() => {
      const cid = this.chats.createSpaceRoom(sp.owner_id, id, {
        title: input.title,
        description: input.description,
        type: input.kind,
        // В компании чаты закрыты (участники расставляются автоматически), в сообществе — на выбор
        isPublic: sp.kind === 'community' && input.isPublic,
        categoryId: input.categoryId ?? null,
        position: pos,
      });
      for (const r of roleIds) this.db.run('INSERT INTO space_room_roles (chat_id, role_id) VALUES (:c, :r)', { c: cid, r });
      return cid;
    });
    if (sp.kind === 'company') this.syncAll(sp);
    else {
      // В сообществе создатель и владелец сразу внутри, остальные вступают сами
      this.sync(sp, sp.owner_id);
      if (userId !== sp.owner_id) this.chats.setSpaceMembership(chatId, userId, 'admin');
    }
    this.broadcast(id);
    return this.room(sp, this.spaceRoom(id, chatId), userId);
  }

  updateRoom(userId: string, id: string, chatId: string, input: { categoryId?: string | null; roleIds?: string[]; position?: number }): SpaceRoom {
    const sp = this.need(id, userId, P.manageRooms);
    this.spaceRoom(id, chatId);
    this.assertCategory(id, input.categoryId);
    const roleIds = input.roleIds ? this.assertRoles(id, input.roleIds) : null;
    this.db.tx(() => {
      this.chats.updateSpaceRoom(chatId, { categoryId: input.categoryId, position: input.position });
      if (roleIds) {
        this.db.run('DELETE FROM space_room_roles WHERE chat_id = :c', { c: chatId });
        for (const r of roleIds) this.db.run('INSERT INTO space_room_roles (chat_id, role_id) VALUES (:c, :r)', { c: chatId, r });
      }
    });
    if (roleIds) this.syncAll(sp);
    this.broadcast(id);
    return this.room(sp, this.spaceRoom(id, chatId), userId);
  }

  deleteRoom(userId: string, id: string, chatId: string): void {
    this.need(id, userId, P.manageRooms);
    this.spaceRoom(id, chatId);
    this.chats.deleteSpaceRoom(chatId);
    this.broadcast(id);
  }

  // ─── Приглашения ──────────────────────────────────────────────────────────

  private inviteDto(r: { id: string; space_id: string; user_id: string; inviter_id: string | null; created_at: number }): SpaceInvite {
    const sp = this.db.get<SpaceRow>('SELECT * FROM spaces WHERE id = :s', { s: r.space_id })!;
    const users = this.users.summaries([r.inviter_id, r.user_id]);
    return {
      id: r.id,
      space: { id: sp.id, kind: sp.kind, name: sp.name, avatarUrl: this.media.url(sp.avatar_media_id), memberCount: sp.member_count },
      inviter: r.inviter_id ? (users.get(r.inviter_id) ?? null) : null,
      user: users.get(r.user_id) ?? null,
      createdAt: iso(r.created_at),
    };
  }

  /** Пригласить человека: приглашение придёт ему в уведомления. */
  invite(userId: string, id: string, targetId: string): SpaceInvite {
    const sp = this.need(id, userId, P.invite, 'Приглашать могут только те, кому это разрешено');
    const target = this.users.byId(targetId);
    if (!target) throw notFound('Пользователь не найден');
    if (this.policy.blockedEitherWay(userId, targetId)) throw blocked();
    if (this.policy.isSpaceMember(id, targetId)) throw conflict('Уже участник');
    if (this.db.get('SELECT 1 FROM space_invites WHERE space_id = :s AND user_id = :u', { s: id, u: targetId })) throw conflict('Приглашение уже отправлено');
    const pending = this.db.value<number>('SELECT COUNT(*) FROM space_invites WHERE space_id = :s', { s: id }) ?? 0;
    if (pending >= 500) throw badRequest('Слишком много неотвеченных приглашений');
    const inviteId = newId();
    this.db.run('INSERT INTO space_invites (id, space_id, user_id, inviter_id, created_at) VALUES (:id, :s, :u, :by, :now)', {
      id: inviteId,
      s: id,
      u: targetId,
      by: userId,
      now: Date.now(),
    });
    this.notifications.notify({
      userId: targetId,
      type: 'space_invite',
      actorId: userId,
      entityType: 'space',
      entityId: inviteId,
      link: sp.kind === 'company' ? '/companies' : '/communities',
      preview: `приглашает вас в ${KIND_LABEL[sp.kind]} «${sp.name}»`,
    });
    return this.inviteDto(this.db.get('SELECT * FROM space_invites WHERE id = :id', { id: inviteId })!);
  }

  /** Мои приглашения, на которые я ещё не ответил. */
  myInvites(userId: string): SpaceInvite[] {
    return this.db
      .all<{ id: string; space_id: string; user_id: string; inviter_id: string | null; created_at: number }>(
        `SELECT i.* FROM space_invites i JOIN spaces s ON s.id = i.space_id AND s.deleted_at IS NULL
         WHERE i.user_id = :u ORDER BY i.created_at DESC`,
        { u: userId },
      )
      .map((r) => this.inviteDto(r));
  }

  /** Отправленные приглашения пространства (для тех, кто может приглашать). */
  sentInvites(userId: string, id: string): SpaceInvite[] {
    this.need(id, userId, P.invite);
    return this.db
      .all<{ id: string; space_id: string; user_id: string; inviter_id: string | null; created_at: number }>(
        'SELECT * FROM space_invites WHERE space_id = :s ORDER BY created_at DESC',
        { s: id },
      )
      .map((r) => this.inviteDto(r));
  }

  respond(userId: string, inviteId: string, accept: boolean): SpaceDetails | null {
    const inv = this.db.get<{ space_id: string; user_id: string }>('SELECT space_id, user_id FROM space_invites WHERE id = :id', { id: inviteId });
    if (!inv || inv.user_id !== userId) throw notFound('Приглашение не найдено');
    this.db.run('DELETE FROM space_invites WHERE id = :id', { id: inviteId });
    // Ответ отражается в уведомлении: кнопки больше не нужны
    this.db.run("UPDATE notifications SET read_at = coalesce(read_at, :now) WHERE user_id = :u AND type = 'space_invite' AND entity_id = :id", {
      now: Date.now(),
      u: userId,
      id: inviteId,
    });
    this.notifications.pushCounters(userId);
    if (!accept) return null;
    const sp = this.row(inv.space_id);
    this.addMember(sp, userId);
    return this.get(userId, sp.id);
  }

  revokeInvite(userId: string, id: string, inviteId: string): void {
    this.need(id, userId, P.invite);
    this.db.run('DELETE FROM space_invites WHERE id = :i AND space_id = :s', { i: inviteId, s: id });
  }
}
