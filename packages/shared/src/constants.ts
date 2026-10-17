/**
 * Общие ограничения и константы. Сервер — источник истины: всё, что здесь
 * объявлено, проверяется на сервере, а клиент использует те же значения для
 * подсказок и ранней валидации форм.
 */

export const APP_NAME = 'Omni';
export const API_PREFIX = '/api/v1';

export const LIMITS = {
  usernameMin: 3,
  usernameMax: 32,
  displayNameMax: 64,
  passwordMin: 10,
  passwordMax: 256,
  bioMax: 300,
  websiteMax: 200,
  locationMax: 80,
  messageMax: 8000,
  postMax: 2000,
  commentMax: 2000,
  titleMax: 120,
  descriptionMax: 5000,
  chatTitleMax: 128,
  chatDescriptionMax: 1000,
  communityNameMax: 64,
  communitySlugMax: 40,
  mediaPerPost: 10,
  mediaPerMessage: 10,
  groupMembersMax: 1000,
  storyTextMax: 200,
  reportDetailsMax: 1000,
  pageSizeDefault: 30,
  pageSizeMax: 100,
  searchQueryMax: 100,
  deviceNameMax: 64,
  emailMax: 254,
  /** Длина кода из письма */
  emailCodeLength: 6,
  /** Максимальный размер зашифрованного сообщения (base64) */
  ciphertextMax: 64 * 1024,
} as const;

/** Имя пользователя: латиница в нижнем регистре, цифры и подчёркивание. */
export const USERNAME_RE = /^[a-z0-9_]{3,32}$/;
/** Короткое имя сообщества / публичного канала. */
export const SLUG_RE = /^[a-z0-9_]{3,40}$/;

/** Быстрые реакции на сообщения, посты и комментарии. */
export const REACTIONS = ['❤️', '👍', '😂', '😮', '😢', '🔥', '👏', '🎉'] as const;
export type Reaction = (typeof REACTIONS)[number];

/** Варианты таймера самоуничтожения для секретных чатов (секунды, 0 — выключен). */
export const SECRET_TTL_OPTIONS = [0, 5, 30, 60, 300, 3600, 86400, 604800] as const;

export const STORY_TTL_HOURS = 24;

/** Поддерживаемые типы загружаемых файлов (проверяются по сигнатуре содержимого). */
export const IMAGE_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const;
export const VIDEO_MIME = ['video/mp4', 'video/webm', 'video/quicktime'] as const;
export const AUDIO_MIME = ['audio/mpeg', 'audio/ogg', 'audio/webm', 'audio/wav'] as const;

export type ChatType = 'direct' | 'group' | 'channel' | 'secret' | 'saved';
export type ChatRole = 'owner' | 'admin' | 'member' | 'subscriber';
export type PostKind = 'note' | 'photo' | 'video' | 'short';
export type Visibility = 'public' | 'followers' | 'private';
export type MediaKind = 'image' | 'video' | 'audio' | 'file';
export type Audience = 'everyone' | 'following' | 'nobody';

export const POST_KINDS: readonly PostKind[] = ['note', 'photo', 'video', 'short'];

export const REPORT_REASONS = [
  'spam',
  'abuse',
  'harassment',
  'violence',
  'nudity',
  'misinformation',
  'impersonation',
  'copyright',
  'other',
] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

export const REPORT_REASON_LABELS: Record<ReportReason, string> = {
  spam: 'Спам',
  abuse: 'Оскорбления',
  harassment: 'Травля',
  violence: 'Насилие',
  nudity: 'Откровенный контент',
  misinformation: 'Дезинформация',
  impersonation: 'Выдаёт себя за другого',
  copyright: 'Нарушение авторских прав',
  other: 'Другое',
};

/** Человекочитаемые названия событий журнала безопасности. */
export const SECURITY_EVENT_LABELS: Record<string, string> = {
  register: 'Регистрация аккаунта',
  login_success: 'Успешный вход',
  login_failed: 'Неудачная попытка входа',
  login_locked: 'Вход временно заблокирован',
  login_2fa_failed: 'Неверный код 2FA',
  logout: 'Выход',
  password_changed: 'Пароль изменён',
  username_changed: 'Имя пользователя изменено',
  twofa_enabled: 'Двухфакторная защита включена',
  twofa_disabled: 'Двухфакторная защита выключена',
  recovery_code_used: 'Использован резервный код',
  recovery_codes_regenerated: 'Резервные коды обновлены',
  session_revoked: 'Сеанс завершён',
  sessions_revoked_all: 'Все другие сеансы завершены',
  device_key_registered: 'Зарегистрирован ключ шифрования устройства',
  account_deleted: 'Аккаунт удалён',
};
