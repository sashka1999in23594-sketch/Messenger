/**
 * Типы ответов API (DTO). Это публичный контракт между сервером и клиентами
 * (веб, будущие мобильные/десктоп-приложения). Меняйте его осторожно:
 * добавлять поля можно, удалять и переименовывать — только с версионированием API.
 */
import type {
  Audience,
  ChatRole,
  ChatType,
  MediaKind,
  PostKind,
  Visibility,
} from './constants.js';

export type ID = string;
/** ISO 8601 в UTC */
export type ISODate = string;

export interface Paginated<T> {
  items: T[];
  nextCursor: string | null;
}

// ─── Пользователи ───────────────────────────────────────────────────────────

export interface UserSummary {
  id: ID;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  verified: boolean;
}

export interface Relationship {
  following: boolean;
  followedBy: boolean;
  /** Отправлен запрос на подписку (закрытый профиль) */
  requested: boolean;
  blocked: boolean;
  blockedBy: boolean;
  muted: boolean;
}

export interface UserProfile extends UserSummary {
  bio: string;
  website: string | null;
  location: string | null;
  bannerUrl: string | null;
  isPrivate: boolean;
  createdAt: ISODate;
  stats: { followers: number; following: number; posts: number };
  /** null — это ваш собственный профиль */
  relationship: Relationship | null;
  /** Видимость зависит от настроек приватности владельца */
  presence: Presence | null;
  /** Можно ли смотреть посты (закрытый профиль без подписки — нельзя) */
  canViewContent: boolean;
  canMessage: boolean;
  status: UserStatus | null;
  links: ProfileLink[];
  pinnedPostId: ID | null;
  /** Номер телефона, если владелец разрешил его показывать */
  phone: string | null;
  /** Ваши подписки, которые тоже подписаны на этого человека */
  mutualFollowers: { count: number; sample: UserSummary[] };
  /** Вы получаете уведомления о его новых публикациях («колокольчик») */
  subscribed: boolean;
  /** Он в вашем списке «Близкие друзья» */
  closeFriend: boolean;
  /** Кольцо историй вокруг аватара: есть непросмотренные / все просмотрены / нет историй */
  storyRing: 'unseen' | 'seen' | null;
}

/** Статус рядом с именем: эмодзи + короткий текст, можно на время. */
export interface UserStatus {
  emoji: string;
  text: string;
  until: ISODate | null;
}

export interface ProfileLink {
  title: string;
  url: string;
}

export interface Presence {
  online: boolean;
  lastSeenAt: ISODate | null;
}

export interface PrivacySettings {
  isPrivate: boolean;
  whoCanMessage: Audience;
  whoCanComment: Audience;
  lastSeenVisibility: Audience;
  readReceipts: boolean;
  showInSearch: boolean;
  allowTagging: boolean;
  /** Кто может найти меня по номеру телефона */
  findByPhone: Audience;
  /** Кто видит мой номер в профиле */
  showPhone: Audience;
}

export interface NotificationSettings {
  messages: boolean;
  mentions: boolean;
  replies: boolean;
  likes: boolean;
  follows: boolean;
  reposts: boolean;
  communities: boolean;
  security: boolean;
  /** Новые публикации авторов с «колокольчиком» */
  subscriptions: boolean;
  /** Реакции на ваши истории */
  stories: boolean;
  showPreviews: boolean;
}

export interface Me extends UserSummary {
  role: 'user' | 'moderator' | 'admin';
  bio: string;
  website: string | null;
  location: string | null;
  bannerUrl: string | null;
  createdAt: ISODate;
  /** Включён хотя бы один второй фактор */
  twoFactorEnabled: boolean;
  twoFactor: { totp: boolean; email: boolean };
  email: string | null;
  emailVerified: boolean;
  phone: string | null;
  emailPrefs: EmailPrefs;
  /** Пройдено ли знакомство с приложением после регистрации */
  onboarded: boolean;
  privacy: PrivacySettings;
  notifications: NotificationSettings;
  counters: Counters;
  status: UserStatus | null;
  links: ProfileLink[];
  pinnedPostId: ID | null;
}

/** Какие письма присылать на почту. */
export interface EmailPrefs {
  /** Вход с нового устройства */
  loginAlerts: boolean;
  /** Смена пароля, почты, настроек 2FA */
  securityAlerts: boolean;
  /** Упоминания и ответы, пока вы не в сети */
  mentions: boolean;
  /** Еженедельная сводка */
  digest: boolean;
}

/** Публичные настройки сервера для экрана входа. */
export interface AuthConfig {
  mail: {
    /** Письма реально отправляются */
    enabled: boolean;
    /** Режим разработки: письма складываются в тестовый ящик */
    dev: boolean;
  };
  /** Публичное демо с готовыми аккаунтами */
  demo: boolean;
}

/** Письмо из тестового ящика (только в режиме разработки). */
export interface DevMail {
  id: string;
  to: string;
  subject: string;
  text: string;
  createdAt: ISODate;
}

export interface Counters {
  unreadChats: number;
  /** Каналы с новыми постами */
  unreadChannels: number;
  unreadNotifications: number;
  followRequests: number;
}

// ─── Безопасность ───────────────────────────────────────────────────────────

export interface SessionInfo {
  id: ID;
  deviceName: string;
  userAgent: string;
  ip: string;
  createdAt: ISODate;
  lastSeenAt: ISODate;
  current: boolean;
}

export interface SecurityEvent {
  id: ID;
  type: string;
  ip: string;
  userAgent: string;
  createdAt: ISODate;
  details: Record<string, unknown> | null;
}

export interface TotpSetup {
  secret: string;
  otpauthUrl: string;
}

export interface DeviceKey {
  deviceId: string;
  userId: ID;
  publicKey: string;
  algorithm: 'ECDH-P256';
  createdAt: ISODate;
}

export type TwoFactorMethod = 'totp' | 'email';

export type LoginResult =
  | { status: 'ok'; me: Me }
  | {
      status: 'two_factor_required';
      challengeId: string;
      methods: TwoFactorMethod[];
      /** Замаскированный адрес, куда отправлен код: s***a@gmail.com */
      emailHint: string | null;
      emailSent: boolean;
    };

// ─── Медиа ──────────────────────────────────────────────────────────────────

export interface MediaItem {
  id: ID;
  kind: MediaKind;
  url: string;
  mime: string;
  size: number;
  width: number | null;
  height: number | null;
  durationSec: number | null;
  posterUrl: string | null;
  name: string | null;
  /** Форма звуковой волны голосового сообщения: 0–255, до 100 значений */
  waveform: number[] | null;
}

// ─── Чаты ───────────────────────────────────────────────────────────────────

export interface MessagePreview {
  id: ID;
  senderId: ID | null;
  senderName: string | null;
  kind: Message['kind'];
  text: string | null;
  createdAt: ISODate;
}

export interface ChatSummary {
  id: ID;
  type: ChatType;
  /** Непрочитанные упоминания вас (@) */
  unreadMentions: number;
  /** Медленный режим: пауза между сообщениями участника, секунды */
  slowModeSec: number;
  /** Автоудаление новых сообщений, секунды (0 — выключено) */
  ttlSeconds: number;
  title: string;
  description: string;
  avatarUrl: string | null;
  /** Собеседник — для личных и секретных чатов */
  peer: UserSummary | null;
  handle: string | null;
  isPublic: boolean;
  /** В канале можно комментировать посты */
  commentsEnabled: boolean;
  /** Чат внутри компании или сообщества */
  spaceId: ID | null;
  memberCount: number;
  role: ChatRole | null;
  lastMessage: MessagePreview | null;
  unreadCount: number;
  /** seq последнего прочитанного вами сообщения */
  lastReadSeq: number;
  /** seq, до которого собеседник прочитал (для галочек «прочитано») */
  peerReadSeq: number;
  pinned: boolean;
  archived: boolean;
  mutedUntil: ISODate | null;
  pinnedMessage: MessagePreview | null;
  secret: SecretChatInfo | null;
  createdAt: ISODate;
  updatedAt: ISODate;
}

export interface SecretChatInfo {
  initiatorId: ID;
  /** Ключи устройств участников: userId → deviceId */
  devices: Record<ID, string>;
  ttlSeconds: number;
}

export interface ReactionSummary {
  emoji: string;
  count: number;
  mine: boolean;
}

export interface EncryptedPayload {
  /** base64(AES-GCM ciphertext) */
  ciphertext: string;
  /** base64(12-байтный IV) */
  iv: string;
  senderDeviceId: string;
}

export interface Message {
  id: ID;
  chatId: ID;
  /** Монотонный номер сообщения внутри чата */
  seq: number;
  clientId: string | null;
  sender: UserSummary | null;
  kind: MessageKind;
  text: string | null;
  media: MediaItem[];
  /** Опрос (kind = 'poll') */
  poll: Poll | null;
  /** Звонок (kind = 'call') */
  call: CallInfo | null;
  /** Отправлено без звука — получатели не получают звук и всплывающее уведомление */
  silent: boolean;
  replyTo: MessagePreview | null;
  forwardedFrom: { chatId: ID | null; senderName: string } | null;
  reactions: ReactionSummary[];
  encrypted: EncryptedPayload | null;
  editedAt: ISODate | null;
  deletedAt: ISODate | null;
  expiresAt: ISODate | null;
  createdAt: ISODate;
  /** Комментарий к посту канала: id поста */
  threadRootId: ID | null;
  /** Просмотры поста канала (null — не канал) */
  viewCount: number | null;
  /** Комментарии к посту канала */
  commentCount: number;
}

/**
 * Вид сообщения: обычный текст, медиа, голосовое, видео-кружок, опрос,
 * звонок, системное, зашифрованное (секретный чат).
 */
export type MessageKind = 'text' | 'media' | 'voice' | 'round' | 'poll' | 'call' | 'system' | 'encrypted';

export interface PollOption {
  id: ID;
  text: string;
  votes: number;
  /** Вы выбрали этот вариант */
  mine: boolean;
}

export interface Poll {
  id: ID;
  question: string;
  options: PollOption[];
  totalVoters: number;
  multiple: boolean;
  anonymous: boolean;
  /** Викторина: верный вариант виден после ответа или закрытия */
  quiz: boolean;
  correctOptionId: ID | null;
  closed: boolean;
  /** Вы уже проголосовали */
  voted: boolean;
  /** Несколько последних проголосовавших (только в открытых опросах) */
  recentVoters: UserSummary[];
}

export type CallStatus = 'ringing' | 'active' | 'ended' | 'missed' | 'declined' | 'busy' | 'cancelled' | 'failed';

export interface CallInfo {
  id: ID;
  chatId: ID;
  caller: UserSummary;
  callee: UserSummary;
  video: boolean;
  status: CallStatus;
  /** Длительность разговора, секунды */
  durationSec: number;
  createdAt: ISODate;
  answeredAt: ISODate | null;
  endedAt: ISODate | null;
}

export interface ChatFolderInfo {
  id: ID;
  name: string;
  emoji: string;
  /** Какие типы чатов включать */
  includeTypes: ('direct' | 'groups' | 'channels' | 'secret' | 'saved')[];
  /** Отдельно выбранные чаты */
  includeChatIds: ID[];
  excludeMuted: boolean;
  excludeRead: boolean;
  excludeArchived: boolean;
  unreadCount: number;
}

export interface ChatInvite {
  token: string;
  url: string;
  title: string;
  creator: UserSummary | null;
  expiresAt: ISODate | null;
  usageLimit: number | null;
  uses: number;
  revoked: boolean;
  createdAt: ISODate;
}

export interface InvitePreview {
  token: string;
  chat: { id: ID; type: ChatType; title: string; description: string; avatarUrl: string | null; memberCount: number };
  /** Вы уже участник */
  isMember: boolean;
}

export interface ScheduledMessage {
  id: ID;
  chatId: ID;
  text: string | null;
  media: MediaItem[];
  kind: MessageKind;
  silent: boolean;
  sendAt: ISODate;
  createdAt: ISODate;
}

export interface MessageSearchHit {
  message: Message;
  chat: { id: ID; type: ChatType; title: string; avatarUrl: string | null };
}

export interface ChatMember {
  user: UserSummary;
  role: ChatRole;
  joinedAt: ISODate;
}

// ─── Контент: посты, видео, клипы, фото ─────────────────────────────────────

export interface PostStats {
  likes: number;
  comments: number;
  reposts: number;
  views: number;
}

export interface PostViewerState {
  liked: boolean;
  bookmarked: boolean;
  reposted: boolean;
  watchLater: boolean;
}

export interface Post {
  id: ID;
  kind: PostKind;
  author: UserSummary;
  title: string | null;
  text: string;
  media: MediaItem[];
  hashtags: string[];
  visibility: Visibility;
  community: { id: ID; slug: string; name: string } | null;
  /** Репост или цитата (если text не пустой) */
  repostOf: Post | null;
  commentsDisabled: boolean;
  stats: PostStats;
  viewer: PostViewerState;
  /** Закреплён в профиле автора (только во вкладке профиля) */
  pinned?: boolean;
  createdAt: ISODate;
  editedAt: ISODate | null;
}

export interface Comment {
  id: ID;
  postId: ID;
  parentId: ID | null;
  author: UserSummary;
  text: string;
  likes: number;
  liked: boolean;
  replyCount: number;
  createdAt: ISODate;
  editedAt: ISODate | null;
  deleted: boolean;
}

export type StoryAudience = 'all' | 'close';

export interface Story {
  id: ID;
  author: UserSummary;
  media: MediaItem;
  text: string | null;
  createdAt: ISODate;
  expiresAt: ISODate;
  /** Срок истёк — история видна только в архиве и «Актуальном» */
  expired: boolean;
  viewed: boolean;
  /** «Все подписчики» или только «Близкие друзья» */
  audience: StoryAudience;
  allowReplies: boolean;
  /** Ваша реакция на чужую историю */
  myReaction: string | null;
  /** Только для своих историй */
  viewCount: number | null;
  reactionCount: number | null;
}

export interface StoryViewerInfo {
  user: UserSummary;
  reaction: string | null;
  viewedAt: ISODate;
}

/** «Актуальное» в профиле — подборка историй, которая не исчезает. */
export interface StoryHighlight {
  id: ID;
  title: string;
  cover: MediaItem | null;
  count: number;
  createdAt: ISODate;
}

export interface PostDraft {
  id: ID;
  kind: PostKind;
  title: string | null;
  text: string;
  media: MediaItem[];
  visibility: Visibility;
  commentsDisabled: boolean;
  /** Запланированная публикация; null — обычный черновик */
  publishAt: ISODate | null;
  /** Почему не удалось опубликовать по расписанию */
  error: string | null;
  createdAt: ISODate;
  updatedAt: ISODate;
}

/** Список авторов со своей лентой (как списки в X). */
export interface UserList {
  id: ID;
  name: string;
  description: string;
  emoji: string;
  isPrivate: boolean;
  memberCount: number;
  owner: UserSummary;
  /** Есть ли в списке человек, о котором спрашивали (?memberOf=) */
  hasMember?: boolean;
  createdAt: ISODate;
}

/** Коллекция сохранённых публикаций. */
export interface Collection {
  id: ID;
  name: string;
  emoji: string;
  count: number;
  cover: MediaItem | null;
  /** Есть ли в коллекции публикация, о которой спрашивали (?postId=) */
  hasPost?: boolean;
  createdAt: ISODate;
}

export interface MutedWord {
  id: ID;
  word: string;
  until: ISODate | null;
  createdAt: ISODate;
}

export interface StoryGroup {
  author: UserSummary;
  stories: Story[];
  hasUnseen: boolean;
}

export interface Playlist {
  id: ID;
  title: string;
  description: string;
  isPublic: boolean;
  itemCount: number;
  cover: MediaItem | null;
  createdAt: ISODate;
}

export interface HistoryEntry {
  post: Post;
  viewedAt: ISODate;
  progressSec: number;
}

export interface Hashtag {
  tag: string;
  count: number;
}

// ─── Сообщества ─────────────────────────────────────────────────────────────

export interface Community {
  id: ID;
  slug: string;
  name: string;
  description: string;
  avatarUrl: string | null;
  visibility: 'public' | 'private';
  memberCount: number;
  postCount: number;
  role: 'owner' | 'moderator' | 'member' | null;
  createdAt: ISODate;
}

// ─── Уведомления ────────────────────────────────────────────────────────────

export type NotificationType =
  | 'follow'
  | 'follow_request'
  | 'follow_accepted'
  | 'like'
  | 'comment'
  | 'reply'
  | 'mention'
  | 'repost'
  | 'community_join'
  | 'new_post'
  | 'story_reaction'
  | 'space_invite'
  | 'security';

export interface AppNotification {
  id: ID;
  type: NotificationType;
  actor: UserSummary | null;
  entityType: 'post' | 'comment' | 'user' | 'community' | 'session' | 'message' | 'call' | 'story' | 'space' | null;
  entityId: ID | null;
  /** Ссылка внутри приложения, куда ведёт уведомление */
  link: string | null;
  preview: string | null;
  readAt: ISODate | null;
  createdAt: ISODate;
}

// ─── Поиск ──────────────────────────────────────────────────────────────────

export interface SearchResults {
  users: UserSummary[];
  posts: Post[];
  chats: ChatSummary[];
  /** Открытые сообщества */
  spaces: SpaceSummary[];
  hashtags: Hashtag[];
}

export interface ChatBan {
  user: UserSummary;
  until: ISODate | null;
  createdAt: ISODate;
}

// ─── Компании и сообщества ──────────────────────────────────────────────────

/** company — по приглашению руководителя, роли и права; community — открытое или закрытое, много групп внутри */
export type SpaceKind = 'company' | 'community';

export interface SpaceSummary {
  id: ID;
  kind: SpaceKind;
  name: string;
  slug: string | null;
  description: string;
  avatarUrl: string | null;
  /** Открытое: найти и вступить может любой */
  isPublic: boolean;
  memberCount: number;
  ownerId: ID;
  /** Вы участник */
  joined: boolean;
  /** Ваши права (битовая маска SPACE_PERMS) */
  permissions: number;
  /** Чатов с непрочитанным */
  unreadRooms: number;
  createdAt: ISODate;
}

export interface SpaceRole {
  id: ID;
  name: string;
  color: string;
  permissions: number;
  position: number;
  /** Роль «Все участники»: есть у каждого, удалить нельзя */
  isDefault: boolean;
  memberCount: number;
}

export interface SpaceCategory {
  id: ID;
  name: string;
  position: number;
}

export interface SpaceRoom {
  chat: ChatSummary;
  categoryId: ID | null;
  position: number;
  /** Видят только эти роли (пусто — все участники) */
  roleIds: ID[];
  /** Вы в этом чате (в сообществах в группы вступают по желанию) */
  joined: boolean;
}

export interface SpaceDetails extends SpaceSummary {
  roles: SpaceRole[];
  categories: SpaceCategory[];
  rooms: SpaceRoom[];
  /** Ссылка-приглашение (видна тем, кто может приглашать) */
  inviteLink: string | null;
}

export interface SpaceMember {
  user: UserSummary;
  roleIds: ID[];
  isOwner: boolean;
  joinedAt: ISODate;
}

export interface SpaceInvite {
  id: ID;
  space: Pick<SpaceSummary, 'id' | 'kind' | 'name' | 'avatarUrl' | 'memberCount'>;
  inviter: UserSummary | null;
  user: UserSummary | null;
  createdAt: ISODate;
}

// ─── Статистика ─────────────────────────────────────────────────────────────

/** Ряды по дням: значения выровнены по массиву days (UTC, «2026-10-17»). */
export interface ChannelStats {
  chat: Pick<ChatSummary, 'id' | 'title' | 'avatarUrl' | 'handle' | 'memberCount' | 'role'>;
  /** Подписчиков на конец каждого дня */
  subscribers: number[];
  joins: number[];
  leaves: number[];
  /** Просмотры постов за день (каждый человек — один раз на пост) */
  views: number[];
  /** Постов за период */
  posts: number;
}

export interface ChannelPostStat {
  id: ID;
  text: string | null;
  kind: Message['kind'];
  viewCount: number;
  commentCount: number;
  reactions: number;
  createdAt: ISODate;
}

export interface StatsOverview {
  days: string[];
  followers: { total: number; series: number[]; gained: number[]; lost: number[] };
  profileViews: { series: number[]; total: number; previousTotal: number };
  channels: ChannelStats[];
  calls: { total: number; missed: number; minutes: number; perDay: number[] };
}

export interface ChannelStatsDetails extends ChannelStats {
  days: string[];
  topPosts: ChannelPostStat[];
}
