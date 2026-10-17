/** Глобальный поиск: люди, публикации (FTS5), публичные каналы, сообщества, хэштеги — с учётом приватности. */
import type { SearchResults } from '@omni/shared';
import { looksLikePhone, normalizePhone } from '@omni/shared';
import type { Db } from '../../db/index.js';
import type { ChatsService } from '../chats/chats.service.js';
import type { CommunitiesService } from '../communities/communities.service.js';
import { Policy } from '../policy/policy.service.js';
import type { PostRow, PostsService } from '../posts/posts.service.js';
import { privacyOf, type UsersRepo, type UserRow } from '../users/users.repo.js';

const likeEscape = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/** Превращает пользовательский ввод в безопасный запрос FTS5 (каждое слово — в кавычках, префиксный поиск). */
export function ftsQuery(q: string): string | null {
  const words = q
    .replace(/["*^():{}[\]]/g, ' ')
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length > 0)
    .slice(0, 8);
  if (!words.length) return null;
  return words.map((w) => `"${w}"*`).join(' ');
}

export class SearchService {
  constructor(
    private readonly db: Db,
    private readonly users: UsersRepo,
    private readonly posts: PostsService,
    private readonly chats: ChatsService,
    private readonly communities: CommunitiesService,
    private readonly policy: Policy,
  ) {}

  search(viewerId: string, rawQ: string, type: string, limit: number): SearchResults {
    const q = rawQ.trim();
    const isTag = q.startsWith('#');
    const isMention = q.startsWith('@');
    const term = q.replace(/^[#@]/, '');
    const want = (t: string) => type === 'all' || type === t;
    const res: SearchResults = { users: [], posts: [], chats: [], communities: [], hashtags: [] };
    if (!term) return res;

    // Поиск по номеру телефона — только точное совпадение и с учётом приватности
    if (want('users') && looksLikePhone(q)) {
      const phone = normalizePhone(q);
      const u = phone ? this.users.byPhone(phone) : undefined;
      if (u && (u.id === viewerId || this.policy.audienceAllows(privacyOf(u).findByPhone, u.id, viewerId)) && !this.policy.blockedEitherWay(viewerId, u.id)) {
        res.users = [this.users.toSummary(u)];
      }
      return res;
    }

    if (want('users') && !isTag) {
      const rows = this.db.all<UserRow>(
        `SELECT u.* FROM users u
         WHERE u.deleted_at IS NULL AND (u.searchable = 1 OR u.username = :exact)
           AND (u.username LIKE :prefix ESCAPE '\\' OR u.display_name LIKE :like ESCAPE '\\')
           AND NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker_id = :v AND b.blocked_id = u.id) OR (b.blocker_id = u.id AND b.blocked_id = :v))
         ORDER BY (u.username = :exact) DESC, (SELECT COUNT(*) FROM follows f WHERE f.followee_id = u.id) DESC
         LIMIT :limit`,
        { v: viewerId, exact: term.toLowerCase(), prefix: `${likeEscape(term.toLowerCase())}%`, like: `%${likeEscape(term)}%`, limit },
      );
      res.users = rows.map((r) => this.users.toSummary(r));
    }

    if (want('hashtags') && !isMention) {
      res.hashtags = this.db.all(
        `SELECT tag, COUNT(*) AS count FROM post_hashtags WHERE tag LIKE :prefix ESCAPE '\\'
         GROUP BY tag ORDER BY count DESC LIMIT :limit`,
        { prefix: `${likeEscape(term.toLowerCase())}%`, limit },
      );
    }

    if (want('posts') && !isMention) {
      if (isTag) {
        res.posts = this.posts.hashtagPosts(viewerId, term, undefined, limit).items;
      } else {
        const fts = ftsQuery(term);
        if (fts) {
          const rows = this.db.all<PostRow>(
            `SELECT p.* FROM posts_fts JOIN posts p ON p.rowid = posts_fts.rowid
             JOIN users u ON u.id = p.author_id LEFT JOIN communities c ON c.id = p.community_id
             WHERE posts_fts MATCH :fts AND ${Policy.visiblePostsSql()}
             ORDER BY bm25(posts_fts), p.id DESC LIMIT :limit`,
            { fts, viewer: viewerId, limit },
          );
          res.posts = this.posts.toDto(rows, viewerId);
        }
      }
    }

    if (want('chats') && !isTag) res.chats = this.chats.discover(viewerId, term, limit);
    if (want('communities') && !isTag && !isMention) res.communities = this.communities.discover(viewerId, term, undefined, limit).items;
    return res;
  }
}
