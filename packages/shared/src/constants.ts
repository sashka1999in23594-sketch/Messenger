/**
 * Общие ограничения и константы. Сервер — источник истины: всё, что здесь
 * объявлено, проверяется на сервере, а клиент использует те же значения для
 * подсказок и ранней валидации форм.
 */

export const APP_NAME = 'Sunnet';
export const API_PREFIX = '/api/v1';

/** Служебный аккаунт Sunnet: системный чат с кодами входа и новостями. */
export const SYSTEM_USER_ID = '00000000000000000000000SYS';
/** Почта поддержки */
export const SUPPORT_EMAIL = 'spaceup.support@gmail.com';

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
  passwordHintMax: 100,
  /** Регистрация — с 14 лет */
  minAge: 14,
  emailMax: 254,
  pollQuestionMax: 300,
  pollOptionMax: 100,
  pollOptionsMax: 10,
  folderNameMax: 32,
  foldersMax: 20,
  /** Максимальная длительность голосового и кружка, секунды */
  voiceMaxSec: 600,
  roundMaxSec: 60,
  scheduledMax: 100,
  statusTextMax: 70,
  profileLinksMax: 5,
  linkTitleMax: 40,
  highlightsMax: 50,
  highlightTitleMax: 32,
  draftsMax: 100,
  listsMax: 50,
  listMembersMax: 500,
  listNameMax: 40,
  collectionsMax: 100,
  mutedWordsMax: 200,
  mutedWordMax: 60,
  closeFriendsMax: 1000,
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

/** Медленный режим в группах: пауза между сообщениями участника (секунды, 0 — выключен). */
export const SLOW_MODE_OPTIONS = [0, 10, 30, 60, 300, 900, 3600] as const;

export const STORY_TTL_HOURS = 24;

/** Быстрые реакции на истории */
export const STORY_REACTIONS = ['❤️', '🔥', '😂', '😮', '😢', '👏'] as const;

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

/**
 * Права в компаниях и сообществах (битовая маска, как роли в Discord).
 * Владелец имеет все права; «Администратор» — тоже все, кроме передачи владения.
 */
export const SPACE_PERMS = {
  /** Название, описание, аватар */
  manageSpace: 1,
  /** Создавать роли и выдавать их участникам */
  manageRoles: 2,
  /** Категории, чаты и каналы */
  manageRooms: 4,
  /** Приглашать людей */
  invite: 8,
  /** Исключать участников */
  kick: 16,
  /** Удалять чужие сообщения, блокировать в чатах */
  moderate: 32,
  /** Публиковать в каналах-объявлениях */
  announce: 64,
  /** Все права сразу */
  admin: 128,
} as const;
export const SPACE_PERMS_ALL = 255;
export type SpacePerm = keyof typeof SPACE_PERMS;
export const ROLE_COLORS = ['#99aab5', '#5865f2', '#57f287', '#fee75c', '#eb459e', '#ed4245', '#f0b232', '#1fb6e6', '#7c5cff', '#2ecc71'] as const;
