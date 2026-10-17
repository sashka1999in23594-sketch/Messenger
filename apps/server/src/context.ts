/**
 * Композиция приложения (composition root): здесь создаются все сервисы и
 * связываются зависимости. Модули не создают друг друга сами — поэтому их легко
 * тестировать по отдельности и заменять реализации (например, хранилище медиа на S3).
 */
import type { Config } from './config.js';
import type { Db } from './db/index.js';
import { AccountExporter } from './modules/account/exporter.js';
import { AuthService } from './modules/auth/auth.service.js';
import { EmailCodes } from './modules/auth/email-codes.js';
import { MailService } from './modules/mail/mail.service.js';
import { SecurityLog } from './modules/auth/security-log.js';
import { SessionService } from './modules/auth/sessions.js';
import { MessagesRepo } from './modules/chats/chats.repo.js';
import { PollsRepo } from './modules/chats/polls.repo.js';
import { CallsRepo } from './modules/calls/calls.repo.js';
import { CallsService } from './modules/calls/calls.service.js';
import { FoldersService } from './modules/chats/folders.service.js';
import { InvitesService } from './modules/chats/invites.service.js';
import { ScheduledService } from './modules/chats/scheduled.service.js';
import { ChatsService } from './modules/chats/chats.service.js';
import { CommunitiesService } from './modules/communities/communities.service.js';
import { KeysService } from './modules/keys/keys.service.js';
import { MediaService } from './modules/media/media.service.js';
import { NotificationService } from './modules/notifications/notifications.service.js';
import { Policy } from './modules/policy/policy.service.js';
import { CommentsService } from './modules/posts/comments.service.js';
import { PostsService } from './modules/posts/posts.service.js';
import { RealtimeHub } from './modules/realtime/hub.js';
import { ReportsService } from './modules/reports/reports.service.js';
import { SearchService } from './modules/search/search.service.js';
import { StoriesService } from './modules/stories/stories.service.js';
import { UsersRepo } from './modules/users/users.repo.js';
import { UsersService } from './modules/users/users.service.js';
import { CollectionsService } from './modules/social/collections.service.js';
import { DraftsService } from './modules/social/drafts.service.js';
import { ListsService } from './modules/social/lists.service.js';
import { MutedWordsService } from './modules/social/muted-words.js';

export function createServices(db: Db, config: Config, hub: RealtimeHub) {
  const media = new MediaService(db, config);
  const usersRepo = new UsersRepo(db, media);
  const policy = new Policy(db);
  const sessions = new SessionService(db, config.sessionTtlMs);
  const securityLog = new SecurityLog(db);
  const notifications = new NotificationService(db, usersRepo, hub);
  const users = new UsersService(db, usersRepo, policy, media, notifications, hub);
  const keys = new KeysService(db, securityLog);
  const mail = new MailService(config);
  const emailCodes = new EmailCodes(db, config.secret);
  const auth = new AuthService(db, config.secret, usersRepo, users, sessions, securityLog, notifications, hub, mail, emailCodes, config.publicOrigin);
  const polls = new PollsRepo(db, usersRepo);
  const callsRepo = new CallsRepo(db, usersRepo);
  const messagesRepo = new MessagesRepo(db, usersRepo, media, polls, callsRepo);
  const chats = new ChatsService(db, usersRepo, messagesRepo, policy, media, hub, notifications, keys, polls);
  const folders = new FoldersService(db);
  const invites = new InvitesService(db, chats, usersRepo, media, config.publicOrigin);
  const scheduled = new ScheduledService(db, chats, media);
  const calls = new CallsService(db, callsRepo, chats, usersRepo, policy, hub);
  const posts = new PostsService(db, usersRepo, policy, media, notifications);
  const comments = new CommentsService(db, usersRepo, policy, posts, notifications);
  const drafts = new DraftsService(db, media, posts);
  const lists = new ListsService(db, usersRepo, posts);
  const collections = new CollectionsService(db, media, posts);
  const mutedWords = new MutedWordsService(db);
  const stories = new StoriesService(db, usersRepo, policy, media, notifications);
  const communities = new CommunitiesService(db, usersRepo, media, notifications);
  const search = new SearchService(db, usersRepo, posts, chats, communities);
  const reports = new ReportsService(db);
  const exporter = new AccountExporter(db, users);

  // Присутствие: при уходе офлайн фиксируем время, подписчикам рассылаем событие
  hub.onPresence((userId, online) => {
    const now = Date.now();
    if (!online) db.run('UPDATE users SET last_seen_at = :now WHERE id = :id', { now, id: userId });
    for (const [watcherId, conns] of hub.presenceWatchersOf(userId)) {
      for (const c of conns) {
        hub.sendConn(c, { t: 'presence', userId, online, lastSeenAt: new Date(now).toISOString() });
      }
      void watcherId;
    }
  });

  return {
    mail,
    emailCodes,
    media,
    usersRepo,
    policy,
    sessions,
    securityLog,
    notifications,
    users,
    keys,
    auth,
    chats,
    callsRepo,
    calls,
    folders,
    invites,
    scheduled,
    posts,
    comments,
    drafts,
    lists,
    collections,
    mutedWords,
    stories,
    communities,
    search,
    reports,
    exporter,
  };
}

export type Services = ReturnType<typeof createServices>;

export interface Ctx {
  config: Config;
  db: Db;
  hub: RealtimeHub;
  services: Services;
}
