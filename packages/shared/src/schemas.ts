/**
 * Схемы входных данных API (zod). Сервер валидирует ими КАЖДЫЙ запрос,
 * клиент — формы до отправки. Неизвестные поля отбрасываются (защита от
 * mass-assignment), строки нормализуются (trim, NFC).
 */
import { z } from 'zod';
import {
  LIMITS,
  REACTIONS,
  REPORT_REASONS,
  SECRET_TTL_OPTIONS,
  SLOW_MODE_OPTIONS,
  SLUG_RE,
  USERNAME_RE,
} from './constants.js';
import { checkPasswordPolicy } from './password.js';
import { normalizePhone } from './text.js';

// ─── Базовые примитивы ──────────────────────────────────────────────────────

/** Удаляет управляющие символы (кроме \n и \t) и нормализует Unicode. */
export function cleanText(value: string): string {
  return value
    .normalize('NFC')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B\u200E\u200F\u202A-\u202E\u2066-\u2069]/g, '')
    .replace(/\r\n?/g, '\n');
}

export const text = (max: number) =>
  z
    .string()
    .transform(cleanText)
    .pipe(z.string().trim().max(max, `Не более ${max} символов`));

export const requiredText = (max: number) =>
  z
    .string()
    .transform(cleanText)
    .pipe(z.string().trim().min(1, 'Обязательное поле').max(max, `Не более ${max} символов`));

export const id = z.string().regex(/^[0-9A-Za-z_-]{8,64}$/, 'Некорректный идентификатор');

export const username = z
  .string()
  .trim()
  .toLowerCase()
  .regex(USERNAME_RE, 'От 3 до 32 символов: латинские буквы, цифры и _');

export const slug = z
  .string()
  .trim()
  .toLowerCase()
  .regex(SLUG_RE, 'От 3 до 40 символов: латинские буквы, цифры и _');

export const displayName = requiredText(LIMITS.displayNameMax);

export const password = z
  .string()
  .min(LIMITS.passwordMin, `Минимум ${LIMITS.passwordMin} символов`)
  .max(LIMITS.passwordMax, `Не более ${LIMITS.passwordMax} символов`);

/** Адрес почты: нормализуется (trim, нижний регистр). */
export const email = z
  .string()
  .trim()
  .toLowerCase()
  .max(LIMITS.emailMax, 'Слишком длинный адрес')
  .pipe(z.email('Проверьте адрес почты'));

/** Номер телефона: нормализуется в E.164 (+79991234567). */
export const phone = z
  .string()
  .max(32, 'Слишком длинный номер')
  .transform((v, ctx) => {
    const n = normalizePhone(v);
    if (!n) {
      ctx.addIssue({ code: 'custom', message: 'Укажите номер в международном формате, например +7 999 123-45-67' });
      return z.NEVER;
    }
    return n;
  });

/** 6-значный код из письма (пробелы и дефисы игнорируются). */
export const emailCode = z
  .string()
  .trim()
  .transform((v) => v.replace(/[\s-]/g, ''))
  .pipe(z.string().regex(/^\d{6}$/, 'Введите 6 цифр из письма'));

export const totpCode = z
  .string()
  .trim()
  .transform((v) => v.replace(/[\s-]/g, ''))
  .pipe(z.string().regex(/^(\d{6}|[a-z0-9]{10})$/i, 'Введите 6 цифр из приложения или резервный код'));

const httpUrl = z
  .string()
  .trim()
  .max(LIMITS.websiteMax)
  .refine((v) => {
    if (v === '') return true;
    try {
      const u = new URL(v);
      return u.protocol === 'https:' || u.protocol === 'http:';
    } catch {
      return false;
    }
  }, 'Укажите ссылку, начинающуюся с https://');

export const pagination = z.object({
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(LIMITS.pageSizeMax).default(LIMITS.pageSizeDefault),
});
export type PaginationInput = z.infer<typeof pagination>;

const audience = z.enum(['everyone', 'following', 'nobody']);

// ─── Аутентификация ─────────────────────────────────────────────────────────

export const registerSchema = z
  .object({
    username,
    displayName,
    email,
    phone,
    password,
    deviceName: text(LIMITS.deviceNameMax).optional(),
  })
  .superRefine((v, ctx) => {
    const problem = checkPasswordPolicy(v.password, [v.username, v.displayName]);
    if (problem) ctx.addIssue({ code: 'custom', path: ['password'], message: problem });
  });
export type RegisterInput = z.infer<typeof registerSchema>;

/** Вход по имени пользователя или подтверждённой почте. */
export const loginSchema = z.object({
  username: z.string().trim().toLowerCase().min(1).max(LIMITS.emailMax),
  password: z.string().min(1).max(LIMITS.passwordMax),
  deviceName: text(LIMITS.deviceNameMax).optional(),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const twoFactorLoginSchema = z.object({
  challengeId: z.string().min(16).max(128),
  code: totpCode,
});

export const challengeSchema = z.object({ challengeId: z.string().min(16).max(128) });

export const forgotPasswordSchema = z.object({
  login: z.string().trim().toLowerCase().min(1, 'Укажите имя пользователя или почту').max(LIMITS.emailMax),
});

export const resetPasswordSchema = z.object({
  login: z.string().trim().toLowerCase().min(1).max(LIMITS.emailMax),
  code: emailCode,
  newPassword: password,
  deviceName: text(LIMITS.deviceNameMax).optional(),
});

export const emailCodeSchema = z.object({ code: emailCode });

export const changeEmailSchema = z.object({
  email,
  password: z.string().min(1).max(LIMITS.passwordMax),
});

export const emailTwoFactorSendSchema = z.object({
  action: z.enum(['enable', 'disable']),
  password: z.string().min(1).max(LIMITS.passwordMax),
});

export const emailTwoFactorConfirmSchema = z.object({
  action: z.enum(['enable', 'disable']),
  code: emailCode,
});

export const emailPrefsSchema = z
  .object({
    loginAlerts: z.boolean(),
    securityAlerts: z.boolean(),
    mentions: z.boolean(),
    digest: z.boolean(),
  })
  .partial();

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(LIMITS.passwordMax),
  newPassword: password,
});

export const totpConfirmSchema = z.object({ code: totpCode });
export const totpDisableSchema = z.object({ password: z.string().min(1).max(LIMITS.passwordMax), code: totpCode });
export const passwordConfirmSchema = z.object({ password: z.string().min(1).max(LIMITS.passwordMax) });

export const deleteAccountSchema = z.object({
  password: z.string().min(1).max(LIMITS.passwordMax),
  confirm: z.literal('УДАЛИТЬ', { message: 'Введите слово УДАЛИТЬ' }),
});

// ─── Профиль и настройки ────────────────────────────────────────────────────

export const updateProfileSchema = z
  .object({
    displayName,
    bio: text(LIMITS.bioMax),
    website: httpUrl,
    location: text(LIMITS.locationMax),
    avatarMediaId: id.nullable(),
    bannerMediaId: id.nullable(),
  })
  .partial();

export const changeUsernameSchema = z.object({ username, password: z.string().min(1).max(LIMITS.passwordMax) });

export const privacySettingsSchema = z
  .object({
    isPrivate: z.boolean(),
    whoCanMessage: audience,
    whoCanComment: audience,
    lastSeenVisibility: audience,
    readReceipts: z.boolean(),
    showInSearch: z.boolean(),
    allowTagging: z.boolean(),
    findByPhone: audience,
    showPhone: audience,
  })
  .partial();

export const changePhoneSchema = z.object({ phone, password: z.string().min(1).max(LIMITS.passwordMax) });

export const notificationSettingsSchema = z
  .object({
    messages: z.boolean(),
    mentions: z.boolean(),
    replies: z.boolean(),
    likes: z.boolean(),
    follows: z.boolean(),
    reposts: z.boolean(),
    communities: z.boolean(),
    security: z.boolean(),
    subscriptions: z.boolean(),
    stories: z.boolean(),
    showPreviews: z.boolean(),
  })
  .partial();

// ─── Ключи шифрования (E2E) ─────────────────────────────────────────────────

export const deviceKeySchema = z.object({
  deviceId: z.string().regex(/^[A-Za-z0-9_-]{16,64}$/),
  /** base64 SPKI публичного ключа ECDH P-256 */
  publicKey: z.string().min(80).max(400).regex(/^[A-Za-z0-9+/=]+$/),
  algorithm: z.literal('ECDH-P256'),
});

// ─── Чаты и сообщения ───────────────────────────────────────────────────────

export const createDirectChatSchema = z.object({ userId: id });

export const createGroupSchema = z.object({
  title: requiredText(LIMITS.chatTitleMax),
  description: text(LIMITS.chatDescriptionMax).default(''),
  memberIds: z.array(id).max(LIMITS.groupMembersMax).default([]),
  avatarMediaId: id.nullable().optional(),
  /** Открытая группа: найти и вступить может любой; закрытая — только по приглашению */
  isPublic: z.boolean().default(false),
  handle: slug.nullable().optional(),
});

export const createChannelSchema = z.object({
  title: requiredText(LIMITS.chatTitleMax),
  description: text(LIMITS.chatDescriptionMax).default(''),
  handle: slug.nullable().optional(),
  isPublic: z.boolean().default(true),
  avatarMediaId: id.nullable().optional(),
});

export const createSecretChatSchema = z.object({
  userId: id,
  myDeviceId: deviceKeySchema.shape.deviceId,
  ttlSeconds: z
    .number()
    .int()
    .refine((v) => (SECRET_TTL_OPTIONS as readonly number[]).includes(v))
    .default(0),
});

export const updateChatSchema = z
  .object({
    title: requiredText(LIMITS.chatTitleMax),
    description: text(LIMITS.chatDescriptionMax),
    avatarMediaId: id.nullable(),
    /** Автоудаление: в секретных чатах — таймер, в остальных — удаление новых сообщений */
    ttlSeconds: z.number().int().refine((v) => (SECRET_TTL_OPTIONS as readonly number[]).includes(v)),
    slowModeSec: z.number().int().refine((v) => (SLOW_MODE_OPTIONS as readonly number[]).includes(v)),
    isPublic: z.boolean(),
    handle: slug.nullable(),
    commentsEnabled: z.boolean(),
  })
  .partial();

/** Комментарий к посту канала */
export const commentSchema = z
  .object({
    clientId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/),
    text: text(LIMITS.messageMax).optional(),
    mediaIds: z.array(id).max(4).default([]),
  })
  .refine((v) => (v.text && v.text.length > 0) || v.mediaIds.length > 0, { message: 'Пустой комментарий', path: ['text'] });

export const viewsSchema = z.object({ messageIds: z.array(id).min(1).max(100) });

export const banSchema = z.object({
  userId: id,
  /** Срок в днях (0 — навсегда) */
  days: z.number().int().min(0).max(3650).default(0),
});

export const chatPrefsSchema = z
  .object({
    pinned: z.boolean(),
    archived: z.boolean(),
    /** ISO-дата или null — выключить */
    mutedUntil: z.iso.datetime().nullable(),
  })
  .partial();

export const addMembersSchema = z.object({ userIds: z.array(id).min(1).max(100) });
export const memberRoleSchema = z.object({ role: z.enum(['admin', 'member']) });

export const encryptedPayloadSchema = z.object({
  ciphertext: z.string().min(1).max(LIMITS.ciphertextMax).regex(/^[A-Za-z0-9+/=]+$/),
  iv: z.string().regex(/^[A-Za-z0-9+/=]{16}$/),
  senderDeviceId: deviceKeySchema.shape.deviceId,
});

export const pollInputSchema = z
  .object({
    question: requiredText(LIMITS.pollQuestionMax),
    options: z.array(requiredText(LIMITS.pollOptionMax)).min(2, 'Нужно хотя бы 2 варианта').max(LIMITS.pollOptionsMax),
    multiple: z.boolean().default(false),
    anonymous: z.boolean().default(true),
    /** Индекс верного варианта — опрос становится викториной */
    correctOption: z.number().int().min(0).max(LIMITS.pollOptionsMax - 1).optional(),
  })
  .refine((p) => p.correctOption === undefined || (p.correctOption < p.options.length && !p.multiple), {
    message: 'В викторине один верный вариант',
    path: ['correctOption'],
  });
export type PollInput = z.infer<typeof pollInputSchema>;

export const sendMessageSchema = z
  .object({
    /** Идентификатор от клиента: повторная отправка не создаст дубль */
    clientId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/),
    text: text(LIMITS.messageMax).optional(),
    mediaIds: z.array(id).max(LIMITS.mediaPerMessage).default([]),
    replyToId: id.optional(),
    encrypted: encryptedPayloadSchema.optional(),
    /** Голосовое сообщение или видео-кружок: ровно одно вложение нужного типа */
    kind: z.enum(['voice', 'round']).optional(),
    poll: pollInputSchema.optional(),
    /** Без звука у получателей */
    silent: z.boolean().default(false),
  })
  .refine((v) => (v.text && v.text.length > 0) || v.mediaIds.length > 0 || v.encrypted || v.poll, {
    message: 'Пустое сообщение',
    path: ['text'],
  });
export type SendMessageInput = z.infer<typeof sendMessageSchema>;

export const editMessageSchema = z.object({
  text: requiredText(LIMITS.messageMax).optional(),
  encrypted: encryptedPayloadSchema.optional(),
});

export const scheduleMessageSchema = z.object({
  text: text(LIMITS.messageMax).optional(),
  mediaIds: z.array(id).max(LIMITS.mediaPerMessage).default([]),
  replyToId: id.optional(),
  silent: z.boolean().default(false),
  sendAt: z.iso.datetime(),
});

export const pollVoteSchema = z.object({ optionIds: z.array(id).max(LIMITS.pollOptionsMax) });

export const chatFolderSchema = z.object({
  name: requiredText(LIMITS.folderNameMax),
  emoji: z.string().trim().max(16).default('📁'),
  includeTypes: z.array(z.enum(['direct', 'groups', 'channels', 'secret', 'saved'])).max(5).default([]),
  includeChatIds: z.array(id).max(200).default([]),
  excludeMuted: z.boolean().default(false),
  excludeRead: z.boolean().default(false),
  excludeArchived: z.boolean().default(true),
});

export const reorderFoldersSchema = z.object({ ids: z.array(id).max(LIMITS.foldersMax) });

export const createInviteSchema = z.object({
  title: text(64).default(''),
  /** Срок действия в часах (0 — бессрочно) */
  expiresInHours: z.number().int().min(0).max(24 * 365).default(0),
  /** Сколько раз можно использовать (0 — без ограничений) */
  usageLimit: z.number().int().min(0).max(100_000).default(0),
});

export const startCallSchema = z.object({ chatId: id, video: z.boolean().default(false) });

export const forwardMessageSchema = z.object({ toChatIds: z.array(id).min(1).max(20) });
/** Реакция — любой одиночный эмодзи (быстрые реакции + полный выбор) */
export const reactionSchema = z.object({
  emoji: z
    .string()
    .min(1)
    .max(32)
    .refine((v) => /^\p{Extended_Pictographic}/u.test(v) || (REACTIONS as readonly string[]).includes(v), 'Неподдерживаемая реакция'),
});
export const readSchema = z.object({ seq: z.number().int().min(0) });
export const deleteMessageSchema = z.object({ forEveryone: z.boolean().default(false) });

// ─── Посты, комментарии, истории ────────────────────────────────────────────

export const createPostSchema = z
  .object({
    kind: z.enum(['note', 'photo', 'video', 'short']),
    text: text(LIMITS.postMax).default(''),
    title: text(LIMITS.titleMax).optional(),
    mediaIds: z.array(id).max(LIMITS.mediaPerPost).default([]),
    visibility: z.enum(['public', 'followers', 'private']).default('public'),
    communityId: id.optional(),
    repostOfId: id.optional(),
    commentsDisabled: z.boolean().default(false),
    /** Премьера видео: время, когда оно откроется всем одновременно (от 5 минут до 30 дней вперёд) */
    premiereAt: z.iso.datetime({ offset: true }).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.premiereAt) {
      const at = Date.parse(v.premiereAt);
      if (v.kind !== 'video') ctx.addIssue({ code: 'custom', path: ['premiereAt'], message: 'Премьера бывает только у видео' });
      else if (!(at > Date.now() + 4 * 60_000) || at > Date.now() + 30 * 86_400_000) {
        ctx.addIssue({ code: 'custom', path: ['premiereAt'], message: 'Премьеру можно назначить от 5 минут до 30 дней вперёд' });
      }
    }
    if (v.repostOfId) return;
    if (v.kind === 'note' && !v.text && v.mediaIds.length === 0) {
      ctx.addIssue({ code: 'custom', path: ['text'], message: 'Напишите что-нибудь' });
    }
    if ((v.kind === 'photo' || v.kind === 'video' || v.kind === 'short') && v.mediaIds.length === 0) {
      ctx.addIssue({ code: 'custom', path: ['mediaIds'], message: 'Добавьте файл' });
    }
    if (v.kind === 'video' && !v.title) {
      ctx.addIssue({ code: 'custom', path: ['title'], message: 'Укажите название видео' });
    }
  });
export type CreatePostInput = z.infer<typeof createPostSchema>;

export const updatePostSchema = z
  .object({
    text: text(LIMITS.postMax),
    title: text(LIMITS.titleMax),
    commentsDisabled: z.boolean(),
    visibility: z.enum(['public', 'followers', 'private']),
  })
  .partial();

export const createCommentSchema = z.object({
  text: requiredText(LIMITS.commentMax),
  parentId: id.optional(),
});

export const viewSchema = z.object({ progressSec: z.number().min(0).max(86400 * 10).default(0) });

export const createStorySchema = z.object({
  mediaId: id,
  text: text(LIMITS.storyTextMax).optional(),
  audience: z.enum(['all', 'close']).default('all'),
  allowReplies: z.boolean().default(true),
});

const emojiSchema = z
  .string()
  .min(1)
  .max(32)
  .refine((v) => /^\p{Extended_Pictographic}/u.test(v), 'Нужен эмодзи');

export const storyReactionSchema = z.object({ emoji: emojiSchema.nullable() });

export const highlightSchema = z.object({
  title: requiredText(LIMITS.highlightTitleMax),
  storyIds: z.array(id).min(1, 'Выберите хотя бы одну историю').max(100),
  coverStoryId: id.nullable().optional(),
});

export const closeFriendsSchema = z.object({ userIds: z.array(id).max(LIMITS.closeFriendsMax) });

// ─── Профиль: статус, ссылки, закреп ────────────────────────────────────────

export const statusSchema = z.object({
  emoji: emojiSchema,
  text: text(LIMITS.statusTextMax).default(''),
  /** Через сколько часов снять статус (0 — не снимать) */
  durationHours: z.number().int().min(0).max(24 * 30).default(0),
});

export const profileLinksSchema = z.object({
  links: z
    .array(
      z.object({
        title: text(LIMITS.linkTitleMax).default(''),
        url: httpUrl.refine((v) => v !== '', 'Укажите ссылку'),
      }),
    )
    .max(LIMITS.profileLinksMax, `Не более ${LIMITS.profileLinksMax} ссылок`),
});

export const pinPostSchema = z.object({ postId: id.nullable() });

// ─── Черновики, списки, коллекции, скрытые слова ────────────────────────────

export const draftSchema = z.object({
  kind: z.enum(['note', 'photo', 'video', 'short']).default('note'),
  text: text(LIMITS.postMax).default(''),
  title: text(LIMITS.titleMax).optional(),
  mediaIds: z.array(id).max(LIMITS.mediaPerPost).default([]),
  visibility: z.enum(['public', 'followers', 'private']).default('public'),
  commentsDisabled: z.boolean().default(false),
  /** Опубликовать в это время (ISO). null/не указано — просто черновик */
  publishAt: z.string().datetime({ offset: true }).nullable().optional(),
});
export type DraftInput = z.infer<typeof draftSchema>;

export const userListSchema = z.object({
  name: requiredText(LIMITS.listNameMax),
  description: text(300).default(''),
  emoji: z.string().trim().max(16).default('📋'),
  isPrivate: z.boolean().default(true),
});

export const listMembersSchema = z.object({ userIds: z.array(id).min(1).max(100) });

export const collectionSchema = z.object({
  name: requiredText(LIMITS.listNameMax),
  emoji: z.string().trim().max(16).default('🔖'),
});

export const collectionItemSchema = z.object({ postId: id });

export const mutedWordSchema = z.object({
  word: requiredText(LIMITS.mutedWordMax).transform((v) => v.toLowerCase()),
  /** Срок в часах (0 — навсегда) */
  durationHours: z.number().int().min(0).max(24 * 365).default(0),
});

export const createPlaylistSchema = z.object({
  title: requiredText(LIMITS.titleMax),
  description: text(LIMITS.descriptionMax).default(''),
  isPublic: z.boolean().default(false),
});

// ─── Сообщества, жалобы, поиск ──────────────────────────────────────────────

export const createCommunitySchema = z.object({
  name: requiredText(LIMITS.communityNameMax),
  slug,
  description: text(LIMITS.descriptionMax).default(''),
  visibility: z.enum(['public', 'private']).default('public'),
});

// ─── Прямые эфиры ───────────────────────────────────────────────────────────

export const startLiveSchema = z.object({
  title: requiredText(LIMITS.titleMax),
  description: text(LIMITS.chatDescriptionMax).default(''),
});
export const liveChatSchema = z.object({ text: requiredText(500) });
export const endLiveSchema = z.object({ recordingPostId: id.nullable().optional() });

// ─── Компании и сообщества ──────────────────────────────────────────────────

const roleColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Цвет в формате #RRGGBB');

export const createSpaceSchema = z.object({
  kind: z.enum(['company', 'community']),
  name: requiredText(LIMITS.communityNameMax),
  description: text(LIMITS.chatDescriptionMax).default(''),
  /** Только для сообществ: компании всегда закрытые */
  isPublic: z.boolean().default(true),
  slug: slug.nullable().optional(),
  avatarMediaId: id.nullable().optional(),
});

export const updateSpaceSchema = z
  .object({
    name: requiredText(LIMITS.communityNameMax),
    description: text(LIMITS.chatDescriptionMax),
    isPublic: z.boolean(),
    avatarMediaId: id.nullable(),
  })
  .partial();

export const spaceRoleSchema = z.object({
  name: requiredText(40),
  color: roleColor.default('#99aab5'),
  permissions: z.number().int().min(0).max(255).default(0),
});
export const updateSpaceRoleSchema = spaceRoleSchema.partial().extend({ position: z.number().int().min(0).max(1000).optional() });

export const spaceCategorySchema = z.object({ name: requiredText(40), position: z.number().int().min(0).max(1000).optional() });

export const spaceRoomSchema = z.object({
  title: requiredText(LIMITS.chatTitleMax),
  description: text(LIMITS.chatDescriptionMax).default(''),
  /** Обычный чат или канал-объявления (пишут только те, у кого есть право) */
  kind: z.enum(['group', 'channel']).default('group'),
  categoryId: id.nullable().optional(),
  roleIds: z.array(id).max(50).default([]),
  /** В сообществе: открытая группа (вступает кто хочет) или по приглашению */
  isPublic: z.boolean().default(true),
});
export const updateSpaceRoomSchema = z
  .object({
    categoryId: id.nullable(),
    roleIds: z.array(id).max(50),
    position: z.number().int().min(0).max(1000),
  })
  .partial();

export const memberRolesSchema = z.object({ roleIds: z.array(id).max(50) });
export const spaceInviteSchema = z.object({ userId: id });

export const reportSchema = z.object({
  entityType: z.enum(['user', 'post', 'comment', 'message', 'chat', 'community', 'story']),
  entityId: id,
  reason: z.enum(REPORT_REASONS),
  details: text(LIMITS.reportDetailsMax).default(''),
});

export const searchSchema = z.object({
  q: z.string().trim().min(1).max(LIMITS.searchQueryMax),
  type: z.enum(['all', 'users', 'posts', 'chats', 'spaces', 'hashtags']).default('all'),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

export const feedQuerySchema = pagination.extend({
  kind: z.enum(['note', 'photo', 'video', 'short', 'all']).default('all'),
});
