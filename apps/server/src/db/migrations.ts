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
  {
    version: '002_email',
    sql: /* sql */ `
-- ── Почта: адрес, подтверждение, вход по коду из письма, настройки писем ─────
ALTER TABLE users ADD COLUMN email TEXT;
ALTER TABLE users ADD COLUMN email_verified_at INTEGER;
ALTER TABLE users ADD COLUMN email_2fa INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN email_prefs TEXT NOT NULL DEFAULT '{}';
ALTER TABLE users ADD COLUMN onboarded_at INTEGER;
-- Уже существующие аккаунты знакомство с приложением не проходят
UPDATE users SET onboarded_at = created_at;
-- Подтверждённый адрес может принадлежать только одному аккаунту
CREATE UNIQUE INDEX users_email_verified ON users(email) WHERE email_verified_at IS NOT NULL;

-- Одноразовые коды из писем: в базе только HMAC кода
CREATE TABLE email_codes (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose     TEXT NOT NULL,
  email       TEXT NOT NULL,
  code_hash   TEXT NOT NULL,
  ref         TEXT,
  attempts    INTEGER NOT NULL DEFAULT 0,
  expires_at  INTEGER NOT NULL,
  created_at  INTEGER NOT NULL,
  consumed_at INTEGER
);
CREATE INDEX email_codes_user ON email_codes(user_id, purpose, created_at);

ALTER TABLE login_challenges ADD COLUMN email_sent INTEGER NOT NULL DEFAULT 0;
`,
  },
  {
    version: '003_messenger',
    sql: /* sql */ `
-- ── Мессенджер: голосовые, кружки, опросы, звонки, упоминания ──────────────
-- Вид сообщения (voice | round | poll | call) — отдельной колонкой: CHECK у kind не меняем
ALTER TABLE messages ADD COLUMN subtype TEXT;
ALTER TABLE messages ADD COLUMN poll_id TEXT;
ALTER TABLE messages ADD COLUMN call_id TEXT;
ALTER TABLE messages ADD COLUMN silent INTEGER NOT NULL DEFAULT 0;
ALTER TABLE media ADD COLUMN waveform TEXT;
ALTER TABLE chats ADD COLUMN slow_mode_sec INTEGER NOT NULL DEFAULT 0;
ALTER TABLE chat_members ADD COLUMN last_sent_at INTEGER;

CREATE TABLE message_mentions (
  message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  chat_id    TEXT NOT NULL,
  seq        INTEGER NOT NULL,
  PRIMARY KEY (message_id, user_id)
);
CREATE INDEX message_mentions_user ON message_mentions(user_id, chat_id, seq);

CREATE TABLE polls (
  id                TEXT PRIMARY KEY,
  chat_id           TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  creator_id        TEXT REFERENCES users(id) ON DELETE SET NULL,
  question          TEXT NOT NULL,
  multiple          INTEGER NOT NULL DEFAULT 0,
  anonymous         INTEGER NOT NULL DEFAULT 1,
  correct_option_id TEXT,
  closed_at         INTEGER,
  created_at        INTEGER NOT NULL
);
CREATE TABLE poll_options (
  id        TEXT PRIMARY KEY,
  poll_id   TEXT NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
  position  INTEGER NOT NULL,
  text      TEXT NOT NULL
);
CREATE INDEX poll_options_poll ON poll_options(poll_id, position);
CREATE TABLE poll_votes (
  poll_id    TEXT NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
  option_id  TEXT NOT NULL REFERENCES poll_options(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (poll_id, option_id, user_id)
);
CREATE INDEX poll_votes_user ON poll_votes(poll_id, user_id);

-- ── Свои папки чатов ─────────────────────────────────────────────────────────
CREATE TABLE chat_folders (
  id               TEXT PRIMARY KEY,
  user_id          TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name             TEXT NOT NULL,
  emoji            TEXT NOT NULL DEFAULT '📁',
  position         INTEGER NOT NULL DEFAULT 0,
  include_types    TEXT NOT NULL DEFAULT '[]',
  include_chat_ids TEXT NOT NULL DEFAULT '[]',
  exclude_muted    INTEGER NOT NULL DEFAULT 0,
  exclude_read     INTEGER NOT NULL DEFAULT 0,
  exclude_archived INTEGER NOT NULL DEFAULT 1,
  created_at       INTEGER NOT NULL
);
CREATE INDEX chat_folders_user ON chat_folders(user_id, position);

-- ── Ссылки-приглашения ───────────────────────────────────────────────────────
CREATE TABLE chat_invites (
  token       TEXT PRIMARY KEY,
  chat_id     TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  creator_id  TEXT REFERENCES users(id) ON DELETE SET NULL,
  title       TEXT NOT NULL DEFAULT '',
  expires_at  INTEGER,
  usage_limit INTEGER,
  uses        INTEGER NOT NULL DEFAULT 0,
  revoked_at  INTEGER,
  created_at  INTEGER NOT NULL
);
CREATE INDEX chat_invites_chat ON chat_invites(chat_id, created_at);

-- ── Отложенные сообщения ─────────────────────────────────────────────────────
CREATE TABLE scheduled_messages (
  id          TEXT PRIMARY KEY,
  chat_id     TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  sender_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  text        TEXT,
  media_ids   TEXT NOT NULL DEFAULT '[]',
  reply_to_id TEXT,
  silent      INTEGER NOT NULL DEFAULT 0,
  send_at     INTEGER NOT NULL,
  created_at  INTEGER NOT NULL
);
CREATE INDEX scheduled_due ON scheduled_messages(send_at);
CREATE INDEX scheduled_chat ON scheduled_messages(chat_id, sender_id, send_at);

-- ── Звонки ───────────────────────────────────────────────────────────────────
CREATE TABLE calls (
  id              TEXT PRIMARY KEY,
  chat_id         TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  caller_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  callee_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  video           INTEGER NOT NULL DEFAULT 0,
  status          TEXT NOT NULL,
  caller_session  TEXT,
  callee_session  TEXT,
  created_at      INTEGER NOT NULL,
  answered_at     INTEGER,
  ended_at        INTEGER
);
CREATE INDEX calls_caller ON calls(caller_id, created_at DESC);
CREATE INDEX calls_callee ON calls(callee_id, created_at DESC);

-- ── Поиск по сообщениям (кроме секретных чатов — их текста у сервера нет) ───
CREATE VIRTUAL TABLE messages_fts USING fts5(
  text, content='messages', content_rowid='rowid', tokenize='unicode61 remove_diacritics 2'
);
CREATE TRIGGER messages_fts_ai AFTER INSERT ON messages BEGIN
  INSERT INTO messages_fts(rowid, text) VALUES (new.rowid, coalesce(new.text, ''));
END;
CREATE TRIGGER messages_fts_ad AFTER DELETE ON messages BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, text) VALUES ('delete', old.rowid, coalesce(old.text, ''));
END;
CREATE TRIGGER messages_fts_au AFTER UPDATE OF text ON messages BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, text) VALUES ('delete', old.rowid, coalesce(old.text, ''));
  INSERT INTO messages_fts(rowid, text) VALUES (new.rowid, coalesce(new.text, ''));
END;
INSERT INTO messages_fts(messages_fts) VALUES ('rebuild');
`,
  },
  {
    version: '004_social',
    sql: /* sql */ `
-- ── Истории: аудитория, реакции, «Близкие друзья», «Актуальное» ────────────
ALTER TABLE stories ADD COLUMN audience TEXT NOT NULL DEFAULT 'all';
ALTER TABLE stories ADD COLUMN allow_replies INTEGER NOT NULL DEFAULT 1;

CREATE TABLE story_reactions (
  story_id   TEXT NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  emoji      TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (story_id, user_id)
);

CREATE TABLE close_friends (
  owner_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  friend_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (owner_id, friend_id)
);

CREATE TABLE story_highlights (
  id          TEXT PRIMARY KEY,
  owner_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  cover_story_id TEXT REFERENCES stories(id) ON DELETE SET NULL,
  position    INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL
);
CREATE INDEX story_highlights_owner ON story_highlights(owner_id, position);

CREATE TABLE story_highlight_items (
  highlight_id TEXT NOT NULL REFERENCES story_highlights(id) ON DELETE CASCADE,
  story_id     TEXT NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
  added_at     INTEGER NOT NULL,
  PRIMARY KEY (highlight_id, story_id)
);

-- ── Профиль: статус, ссылки, закреплённая публикация ────────────────────────
ALTER TABLE users ADD COLUMN status_emoji TEXT;
ALTER TABLE users ADD COLUMN status_text TEXT;
ALTER TABLE users ADD COLUMN status_until INTEGER;
ALTER TABLE users ADD COLUMN links TEXT NOT NULL DEFAULT '[]';
ALTER TABLE users ADD COLUMN pinned_post_id TEXT;

-- ── Черновики и отложенные публикации ───────────────────────────────────────
CREATE TABLE post_drafts (
  id          TEXT PRIMARY KEY,
  author_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  payload     TEXT NOT NULL,
  publish_at  INTEGER,
  error       TEXT,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE INDEX post_drafts_author ON post_drafts(author_id, updated_at DESC);
CREATE INDEX post_drafts_due ON post_drafts(publish_at) WHERE publish_at IS NOT NULL;

-- ── Списки авторов ──────────────────────────────────────────────────────────
CREATE TABLE user_lists (
  id          TEXT PRIMARY KEY,
  owner_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  emoji       TEXT NOT NULL DEFAULT '📋',
  is_private  INTEGER NOT NULL DEFAULT 1,
  created_at  INTEGER NOT NULL
);
CREATE INDEX user_lists_owner ON user_lists(owner_id, created_at);
CREATE TABLE user_list_members (
  list_id  TEXT NOT NULL REFERENCES user_lists(id) ON DELETE CASCADE,
  user_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  added_at INTEGER NOT NULL,
  PRIMARY KEY (list_id, user_id)
);

-- ── Коллекции закладок ──────────────────────────────────────────────────────
CREATE TABLE collections (
  id          TEXT PRIMARY KEY,
  owner_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  emoji       TEXT NOT NULL DEFAULT '🔖',
  created_at  INTEGER NOT NULL
);
CREATE INDEX collections_owner ON collections(owner_id, created_at);
CREATE TABLE collection_items (
  collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  post_id       TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  added_at      INTEGER NOT NULL,
  PRIMARY KEY (collection_id, post_id)
);

-- ── Скрытые слова и «колокольчик» (уведомлять о новых публикациях) ──────────
CREATE TABLE muted_words (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  word        TEXT NOT NULL,
  until       INTEGER,
  created_at  INTEGER NOT NULL,
  UNIQUE (user_id, word)
);
CREATE TABLE post_subscriptions (
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  author_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, author_id)
);
CREATE INDEX post_subscriptions_author ON post_subscriptions(author_id);
`,
  },
  {
    version: '005_phone',
    sql: /* sql */ `
-- ── Номер телефона: вход и поиск по номеру (E.164, уникальный) ─────────────
ALTER TABLE users ADD COLUMN phone TEXT;
CREATE UNIQUE INDEX users_phone ON users(phone) WHERE phone IS NOT NULL;
`,
  },
  {
    version: '006_channels',
    sql: /* sql */ `
-- ── Каналы как в Telegram: комментарии к постам, просмотры, баны ───────────
ALTER TABLE messages ADD COLUMN thread_root_id TEXT;
ALTER TABLE messages ADD COLUMN view_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE messages ADD COLUMN comment_count INTEGER NOT NULL DEFAULT 0;
CREATE INDEX messages_thread ON messages(thread_root_id, seq) WHERE thread_root_id IS NOT NULL;
ALTER TABLE chats ADD COLUMN comments_enabled INTEGER NOT NULL DEFAULT 1;

CREATE TABLE message_views (
  message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  viewed_at  INTEGER NOT NULL,
  PRIMARY KEY (message_id, user_id)
);

CREATE TABLE chat_bans (
  chat_id    TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  banned_by  TEXT REFERENCES users(id) ON DELETE SET NULL,
  until      INTEGER,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (chat_id, user_id)
);

-- ── Статистика по дням: просмотры, подписки, посещения профиля ─────────────
CREATE TABLE stat_daily (
  metric    TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  day       TEXT NOT NULL,
  value     INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (metric, entity_id, day)
);
`,
  },
  {
    version: '007_spaces',
    sql: /* sql */ `
-- ── Компании и сообщества: роли с правами, категории, чаты внутри ─────────
CREATE TABLE spaces (
  id              TEXT PRIMARY KEY,
  kind            TEXT NOT NULL CHECK (kind IN ('company', 'community')),
  name            TEXT NOT NULL,
  slug            TEXT UNIQUE,
  description     TEXT NOT NULL DEFAULT '',
  avatar_media_id TEXT REFERENCES media(id) ON DELETE SET NULL,
  owner_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  is_public       INTEGER NOT NULL DEFAULT 0,
  invite_token    TEXT UNIQUE,
  member_count    INTEGER NOT NULL DEFAULT 0,
  created_at      INTEGER NOT NULL,
  deleted_at      INTEGER
);
CREATE INDEX spaces_public ON spaces(kind, is_public, member_count) WHERE deleted_at IS NULL;

CREATE TABLE space_members (
  space_id  TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  user_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at INTEGER NOT NULL,
  PRIMARY KEY (space_id, user_id)
);
CREATE INDEX space_members_user ON space_members(user_id);

CREATE TABLE space_roles (
  id          TEXT PRIMARY KEY,
  space_id    TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  color       TEXT NOT NULL,
  permissions INTEGER NOT NULL DEFAULT 0,
  position    INTEGER NOT NULL DEFAULT 0,
  is_default  INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL
);
CREATE INDEX space_roles_space ON space_roles(space_id, position);

CREATE TABLE space_member_roles (
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  user_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id  TEXT NOT NULL REFERENCES space_roles(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, role_id)
);
CREATE INDEX space_member_roles_space ON space_member_roles(space_id, user_id);

CREATE TABLE space_categories (
  id       TEXT PRIMARY KEY,
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  name     TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE space_room_roles (
  chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  role_id TEXT NOT NULL REFERENCES space_roles(id) ON DELETE CASCADE,
  PRIMARY KEY (chat_id, role_id)
);

CREATE TABLE space_invites (
  id         TEXT PRIMARY KEY,
  space_id   TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  inviter_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (space_id, user_id)
);
CREATE INDEX space_invites_user ON space_invites(user_id);

ALTER TABLE chats ADD COLUMN space_id TEXT REFERENCES spaces(id) ON DELETE CASCADE;
ALTER TABLE chats ADD COLUMN space_category_id TEXT;
ALTER TABLE chats ADD COLUMN space_position INTEGER NOT NULL DEFAULT 0;
CREATE INDEX chats_space ON chats(space_id, space_position) WHERE space_id IS NOT NULL;
`,
  },
  {
    version: '008_live',
    sql: /* sql */ `
-- ── Прямые эфиры, чат эфиров и премьер, премьеры видео ─────────────────────
CREATE TABLE live_streams (
  id                TEXT PRIMARY KEY,
  owner_id          TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title             TEXT NOT NULL,
  description       TEXT NOT NULL DEFAULT '',
  status            TEXT NOT NULL CHECK (status IN ('live', 'ended')),
  peak_viewers      INTEGER NOT NULL DEFAULT 0,
  total_viewers     INTEGER NOT NULL DEFAULT 0,
  recording_post_id TEXT REFERENCES posts(id) ON DELETE SET NULL,
  started_at        INTEGER NOT NULL,
  ended_at          INTEGER
);
CREATE INDEX live_streams_status ON live_streams(status, started_at DESC);
CREATE INDEX live_streams_owner ON live_streams(owner_id, started_at DESC);

-- Комната: «stream:<id>» или «premiere:<postId>»
CREATE TABLE live_chat (
  id         TEXT PRIMARY KEY,
  room       TEXT NOT NULL,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  text       TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX live_chat_room ON live_chat(room, created_at);

ALTER TABLE posts ADD COLUMN premiere_at INTEGER;
CREATE INDEX posts_premiere ON posts(premiere_at) WHERE premiere_at IS NOT NULL;

CREATE TABLE premiere_reminders (
  post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (post_id, user_id)
);
`,
  },
];
