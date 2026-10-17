/**
 * Миграции схемы. Каждая миграция применяется ровно один раз, в транзакции.
 * Правило: опубликованные миграции НЕ редактируются — только добавляются новые.
 * Время хранится в миллисекундах UTC (INTEGER), идентификаторы — ULID (TEXT).
 */
export interface Migration {
  version: string;
  sql: string;
}

export const migrations: Migration[] = [
  {
    version: '001_init',
    sql: /* sql */ `
-- ── Пользователи и аутентификация ──────────────────────────────────────────
CREATE TABLE users (
  id               TEXT PRIMARY KEY,
  username         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name     TEXT NOT NULL,
  password_hash    TEXT NOT NULL,
  bio              TEXT NOT NULL DEFAULT '',
  website          TEXT,
  location         TEXT,
  avatar_media_id  TEXT,
  banner_media_id  TEXT,
  verified         INTEGER NOT NULL DEFAULT 0,
  role             TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'moderator', 'admin')),
  is_private       INTEGER NOT NULL DEFAULT 0,
  searchable       INTEGER NOT NULL DEFAULT 1,
  privacy          TEXT NOT NULL DEFAULT '{}',
  notification_prefs TEXT NOT NULL DEFAULT '{}',
  totp_secret_enc  TEXT,
  totp_enabled     INTEGER NOT NULL DEFAULT 0,
  totp_last_step   INTEGER,
  failed_logins    INTEGER NOT NULL DEFAULT 0,
  locked_until     INTEGER,
  last_seen_at     INTEGER,
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL,
  deleted_at       INTEGER
);

CREATE TABLE recovery_codes (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash   TEXT NOT NULL,
  used_at     INTEGER,
  created_at  INTEGER NOT NULL
);
CREATE INDEX recovery_codes_user ON recovery_codes(user_id);

CREATE TABLE sessions (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash    TEXT NOT NULL UNIQUE,
  device_name   TEXT NOT NULL,
  user_agent    TEXT NOT NULL,
  ip            TEXT NOT NULL,
  created_at    INTEGER NOT NULL,
  last_seen_at  INTEGER NOT NULL,
  expires_at    INTEGER NOT NULL,
  revoked_at    INTEGER
);
CREATE INDEX sessions_user ON sessions(user_id, revoked_at);

CREATE TABLE login_challenges (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_name  TEXT NOT NULL,
  ip           TEXT NOT NULL,
  user_agent   TEXT NOT NULL,
  attempts     INTEGER NOT NULL DEFAULT 0,
  expires_at   INTEGER NOT NULL,
  created_at   INTEGER NOT NULL
);

CREATE TABLE security_events (
  id          TEXT PRIMARY KEY,
  user_id     TEXT REFERENCES users(id) ON DELETE CASCADE,
  type        TEXT NOT NULL,
  ip          TEXT NOT NULL DEFAULT '',
  user_agent  TEXT NOT NULL DEFAULT '',
  details     TEXT,
  created_at  INTEGER NOT NULL
);
CREATE INDEX security_events_user ON security_events(user_id, created_at DESC);

-- Публичные ключи устройств для сквозного шифрования (E2E)
CREATE TABLE device_keys (
  device_id   TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  public_key  TEXT NOT NULL,
  algorithm   TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  revoked_at  INTEGER
);
CREATE INDEX device_keys_user ON device_keys(user_id, revoked_at, created_at DESC);

-- ── Медиа ──────────────────────────────────────────────────────────────────
CREATE TABLE media (
  id              TEXT PRIMARY KEY,
  owner_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind            TEXT NOT NULL CHECK (kind IN ('image', 'video', 'audio', 'file')),
  mime            TEXT NOT NULL,
  size            INTEGER NOT NULL,
  width           INTEGER,
  height          INTEGER,
  duration_sec    REAL,
  poster_media_id TEXT REFERENCES media(id) ON DELETE SET NULL,
  storage_key     TEXT NOT NULL,
  original_name   TEXT,
  sha256          TEXT NOT NULL,
  created_at      INTEGER NOT NULL,
  deleted_at      INTEGER
);
CREATE INDEX media_owner ON media(owner_id, created_at DESC);

-- ── Социальный граф ────────────────────────────────────────────────────────
CREATE TABLE follows (
  follower_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  followee_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status       TEXT NOT NULL DEFAULT 'accepted' CHECK (status IN ('accepted', 'pending')),
  created_at   INTEGER NOT NULL,
  PRIMARY KEY (follower_id, followee_id)
);
CREATE INDEX follows_followee ON follows(followee_id, status);

CREATE TABLE blocks (
  blocker_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (blocker_id, blocked_id)
);
CREATE INDEX blocks_blocked ON blocks(blocked_id);

CREATE TABLE mutes (
  muter_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  muted_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (muter_id, muted_id)
);

-- ── Чаты ───────────────────────────────────────────────────────────────────
CREATE TABLE chats (
  id                TEXT PRIMARY KEY,
  type              TEXT NOT NULL CHECK (type IN ('direct', 'group', 'channel', 'secret', 'saved')),
  title             TEXT NOT NULL DEFAULT '',
  description       TEXT NOT NULL DEFAULT '',
  avatar_media_id   TEXT REFERENCES media(id) ON DELETE SET NULL,
  owner_id          TEXT REFERENCES users(id) ON DELETE SET NULL,
  handle            TEXT UNIQUE COLLATE NOCASE,
  is_public         INTEGER NOT NULL DEFAULT 0,
  -- Уникальный ключ пары для личного чата / избранного (не даёт создать дубль)
  direct_key        TEXT UNIQUE,
  last_seq          INTEGER NOT NULL DEFAULT 0,
  last_message_id   TEXT,
  last_message_at   INTEGER,
  pinned_message_id TEXT,
  ttl_seconds       INTEGER NOT NULL DEFAULT 0,
  secret_devices    TEXT,
  member_count      INTEGER NOT NULL DEFAULT 0,
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL,
  deleted_at        INTEGER
);
CREATE INDEX chats_public ON chats(is_public, type, member_count DESC);

CREATE TABLE chat_members (
  chat_id        TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role           TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'member', 'subscriber')),
  joined_at      INTEGER NOT NULL,
  last_read_seq  INTEGER NOT NULL DEFAULT 0,
  cleared_seq    INTEGER NOT NULL DEFAULT 0,
  pinned         INTEGER NOT NULL DEFAULT 0,
  archived       INTEGER NOT NULL DEFAULT 0,
  muted_until    INTEGER,
  hidden         INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (chat_id, user_id)
);
CREATE INDEX chat_members_user ON chat_members(user_id, archived, hidden);

CREATE TABLE messages (
  id                    TEXT PRIMARY KEY,
  chat_id               TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  seq                   INTEGER NOT NULL,
  sender_id             TEXT REFERENCES users(id) ON DELETE SET NULL,
  client_id             TEXT,
  kind                  TEXT NOT NULL CHECK (kind IN ('text', 'media', 'system', 'encrypted')),
  text                  TEXT,
  reply_to_id           TEXT,
  forward_from_chat_id  TEXT,
  forward_sender_name   TEXT,
  ciphertext            TEXT,
  iv                    TEXT,
  sender_device_id      TEXT,
  edited_at             INTEGER,
  deleted_at            INTEGER,
  expires_at            INTEGER,
  created_at            INTEGER NOT NULL,
  UNIQUE (chat_id, seq),
  UNIQUE (sender_id, client_id)
);
CREATE INDEX messages_expiry ON messages(expires_at) WHERE expires_at IS NOT NULL;

CREATE TABLE message_media (
  message_id  TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  media_id    TEXT NOT NULL REFERENCES media(id) ON DELETE CASCADE,
  position    INTEGER NOT NULL,
  PRIMARY KEY (message_id, position)
);
CREATE INDEX message_media_media ON message_media(media_id);

CREATE TABLE message_reactions (
  message_id  TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  emoji       TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (message_id, user_id, emoji)
);

CREATE TABLE message_hidden (
  message_id  TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, message_id)
);

-- ── Сообщества ─────────────────────────────────────────────────────────────
CREATE TABLE communities (
  id               TEXT PRIMARY KEY,
  slug             TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name             TEXT NOT NULL,
  description      TEXT NOT NULL DEFAULT '',
  avatar_media_id  TEXT REFERENCES media(id) ON DELETE SET NULL,
  owner_id         TEXT REFERENCES users(id) ON DELETE SET NULL,
  visibility       TEXT NOT NULL DEFAULT 'public' CHECK (visibility IN ('public', 'private')),
  member_count     INTEGER NOT NULL DEFAULT 0,
  post_count       INTEGER NOT NULL DEFAULT 0,
  created_at       INTEGER NOT NULL,
  deleted_at       INTEGER
);

CREATE TABLE community_members (
  community_id  TEXT NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role          TEXT NOT NULL CHECK (role IN ('owner', 'moderator', 'member')),
  joined_at     INTEGER NOT NULL,
  PRIMARY KEY (community_id, user_id)
);
CREATE INDEX community_members_user ON community_members(user_id);

-- ── Контент: посты (заметки), фото, видео, клипы ───────────────────────────
CREATE TABLE posts (
  id                 TEXT PRIMARY KEY,
  author_id          TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind               TEXT NOT NULL CHECK (kind IN ('note', 'photo', 'video', 'short')),
  title              TEXT,
  text               TEXT NOT NULL DEFAULT '',
  visibility         TEXT NOT NULL DEFAULT 'public' CHECK (visibility IN ('public', 'followers', 'private')),
  community_id       TEXT REFERENCES communities(id) ON DELETE CASCADE,
  repost_of_id       TEXT REFERENCES posts(id) ON DELETE CASCADE,
  comments_disabled  INTEGER NOT NULL DEFAULT 0,
  like_count         INTEGER NOT NULL DEFAULT 0,
  comment_count      INTEGER NOT NULL DEFAULT 0,
  repost_count       INTEGER NOT NULL DEFAULT 0,
  view_count         INTEGER NOT NULL DEFAULT 0,
  created_at         INTEGER NOT NULL,
  edited_at          INTEGER,
  deleted_at         INTEGER
);
CREATE INDEX posts_author ON posts(author_id, id DESC);
CREATE INDEX posts_kind ON posts(kind, id DESC);
CREATE INDEX posts_community ON posts(community_id, id DESC);
CREATE INDEX posts_repost ON posts(repost_of_id);

CREATE TABLE post_media (
  post_id   TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  media_id  TEXT NOT NULL REFERENCES media(id) ON DELETE CASCADE,
  position  INTEGER NOT NULL,
  PRIMARY KEY (post_id, position)
);
CREATE INDEX post_media_media ON post_media(media_id);

CREATE TABLE post_hashtags (
  tag         TEXT NOT NULL,
  post_id     TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (tag, post_id)
);
CREATE INDEX post_hashtags_time ON post_hashtags(created_at);

CREATE TABLE post_likes (
  post_id     TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (post_id, user_id)
);
CREATE INDEX post_likes_user ON post_likes(user_id, created_at DESC);

CREATE TABLE bookmarks (
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  post_id     TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (user_id, post_id)
);

CREATE TABLE watch_later (
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  post_id     TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (user_id, post_id)
);

CREATE TABLE view_history (
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  post_id       TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  progress_sec  REAL NOT NULL DEFAULT 0,
  viewed_at     INTEGER NOT NULL,
  counted_at    INTEGER NOT NULL,
  PRIMARY KEY (user_id, post_id)
);
CREATE INDEX view_history_time ON view_history(user_id, viewed_at DESC);

CREATE TABLE playlists (
  id           TEXT PRIMARY KEY,
  owner_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title        TEXT NOT NULL,
  description  TEXT NOT NULL DEFAULT '',
  is_public    INTEGER NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);
CREATE INDEX playlists_owner ON playlists(owner_id);

CREATE TABLE playlist_items (
  playlist_id  TEXT NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
  post_id      TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  added_at     INTEGER NOT NULL,
  PRIMARY KEY (playlist_id, post_id)
);

CREATE TABLE comments (
  id           TEXT PRIMARY KEY,
  post_id      TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  author_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  parent_id    TEXT REFERENCES comments(id) ON DELETE CASCADE,
  text         TEXT NOT NULL,
  like_count   INTEGER NOT NULL DEFAULT 0,
  reply_count  INTEGER NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL,
  edited_at    INTEGER,
  deleted_at   INTEGER
);
CREATE INDEX comments_post ON comments(post_id, parent_id, id);

CREATE TABLE comment_likes (
  comment_id  TEXT NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (comment_id, user_id)
);

-- ── Истории (24 часа) ──────────────────────────────────────────────────────
CREATE TABLE stories (
  id          TEXT PRIMARY KEY,
  author_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  media_id    TEXT NOT NULL REFERENCES media(id) ON DELETE CASCADE,
  text        TEXT,
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL,
  deleted_at  INTEGER
);
CREATE INDEX stories_author ON stories(author_id, expires_at);

CREATE TABLE story_views (
  story_id   TEXT NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  viewed_at  INTEGER NOT NULL,
  PRIMARY KEY (story_id, user_id)
);

-- ── Уведомления и модерация ────────────────────────────────────────────────
CREATE TABLE notifications (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type         TEXT NOT NULL,
  actor_id     TEXT REFERENCES users(id) ON DELETE CASCADE,
  entity_type  TEXT,
  entity_id    TEXT,
  link         TEXT,
  preview      TEXT,
  read_at      INTEGER,
  created_at   INTEGER NOT NULL
);
CREATE INDEX notifications_user ON notifications(user_id, id DESC);

CREATE TABLE reports (
  id           TEXT PRIMARY KEY,
  reporter_id  TEXT REFERENCES users(id) ON DELETE SET NULL,
  entity_type  TEXT NOT NULL,
  entity_id    TEXT NOT NULL,
  reason       TEXT NOT NULL,
  details      TEXT NOT NULL DEFAULT '',
  status       TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'rejected')),
  created_at   INTEGER NOT NULL,
  resolved_at  INTEGER,
  resolved_by  TEXT REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX reports_status ON reports(status, created_at);

-- ── Полнотекстовый поиск ───────────────────────────────────────────────────
CREATE VIRTUAL TABLE posts_fts USING fts5(
  title, text, content='posts', content_rowid='rowid', tokenize='unicode61 remove_diacritics 2'
);
CREATE TRIGGER posts_fts_ai AFTER INSERT ON posts BEGIN
  INSERT INTO posts_fts(rowid, title, text) VALUES (new.rowid, coalesce(new.title, ''), new.text);
END;
CREATE TRIGGER posts_fts_ad AFTER DELETE ON posts BEGIN
  INSERT INTO posts_fts(posts_fts, rowid, title, text) VALUES ('delete', old.rowid, coalesce(old.title, ''), old.text);
END;
CREATE TRIGGER posts_fts_au AFTER UPDATE OF title, text ON posts BEGIN
  INSERT INTO posts_fts(posts_fts, rowid, title, text) VALUES ('delete', old.rowid, coalesce(old.title, ''), old.text);
  INSERT INTO posts_fts(rowid, title, text) VALUES (new.rowid, coalesce(new.title, ''), new.text);
END;
`,
  },
];
