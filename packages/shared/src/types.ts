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
  showPreviews: boolean;
}

export interface Me extends UserSummary {
  bio: string;
  website: string | null;
  location: string | null;
  bannerUrl: string | null;
  createdAt: ISODate;
  twoFactorEnabled: boolean;
  privacy: PrivacySettings;
  notifications: NotificationSettings;
  counters: Counters;
}

export interface Counters {
  unreadChats: number;
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

export type LoginResult =
  | { status: 'ok'; me: Me }
  | { status: 'two_factor_required'; challengeId: string };

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
  title: string;
  description: string;
  avatarUrl: string | null;
  /** Собеседник — для личных и секретных чатов */
  peer: UserSummary | null;
  handle: string | null;
  isPublic: boolean;
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
  kind: 'text' | 'media' | 'system' | 'encrypted';
  text: string | null;
  media: MediaItem[];
  replyTo: MessagePreview | null;
  forwardedFrom: { chatId: ID | null; senderName: string } | null;
  reactions: ReactionSummary[];
  encrypted: EncryptedPayload | null;
  editedAt: ISODate | null;
  deletedAt: ISODate | null;
  expiresAt: ISODate | null;
  createdAt: ISODate;
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

export interface Story {
  id: ID;
  author: UserSummary;
  media: MediaItem;
  text: string | null;
  createdAt: ISODate;
  expiresAt: ISODate;
  viewed: boolean;
  /** Только для своих историй */
  viewCount: number | null;
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
  | 'security';

export interface AppNotification {
  id: ID;
  type: NotificationType;
  actor: UserSummary | null;
  entityType: 'post' | 'comment' | 'user' | 'community' | 'session' | null;
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
  communities: Community[];
  hashtags: Hashtag[];
}
