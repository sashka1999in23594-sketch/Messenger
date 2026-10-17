import type { EmailPrefs, NotificationSettings, PrivacySettings, UserSummary } from '@omni/shared';
import type { Db } from '../../db/index.js';
import { bool, json } from '../../db/index.js';
import type { MediaService } from '../media/media.service.js';

export interface UserRow {
  id: string;
  username: string;
  display_name: string;
  password_hash: string;
  bio: string;
  website: string | null;
  location: string | null;
  avatar_media_id: string | null;
  banner_media_id: string | null;
  verified: number;
  role: 'user' | 'moderator' | 'admin';
  is_private: number;
  searchable: number;
  privacy: string;
  notification_prefs: string;
  totp_secret_enc: string | null;
  totp_enabled: number;
  totp_last_step: number | null;
  failed_logins: number;
  locked_until: number | null;
  last_seen_at: number | null;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
  email: string | null;
  email_verified_at: number | null;
  email_2fa: number;
  email_prefs: string;
  onboarded_at: number | null;
}

export const DEFAULT_PRIVACY: Omit<PrivacySettings, 'isPrivate' | 'showInSearch'> = {
  whoCanMessage: 'everyone',
  whoCanComment: 'everyone',
  lastSeenVisibility: 'everyone',
  readReceipts: true,
  allowTagging: true,
};

export const DEFAULT_NOTIFICATIONS: NotificationSettings = {
  messages: true,
  mentions: true,
  replies: true,
  likes: true,
  follows: true,
  reposts: true,
  communities: true,
  security: true,
  showPreviews: true,
};

export function privacyOf(row: UserRow): PrivacySettings {
  return {
    ...json(row.privacy, DEFAULT_PRIVACY),
    isPrivate: bool(row.is_private),
    showInSearch: bool(row.searchable),
  };
}

export function notificationPrefsOf(row: UserRow): NotificationSettings {
  return json(row.notification_prefs, DEFAULT_NOTIFICATIONS);
}

export const DEFAULT_EMAIL_PREFS: EmailPrefs = {
  loginAlerts: true,
  securityAlerts: true,
  mentions: false,
  digest: false,
};

export function emailPrefsOf(row: UserRow): EmailPrefs {
  return json(row.email_prefs, DEFAULT_EMAIL_PREFS);
}

const SUMMARY_COLS = 'id, username, display_name, avatar_media_id, verified, deleted_at';

/** Доступ к пользователям + пакетная загрузка карточек (без N+1 запросов). */
export class UsersRepo {
  constructor(
    private readonly db: Db,
    private readonly media: MediaService,
  ) {}

  byId(id: string): UserRow | undefined {
    return this.db.get<UserRow>('SELECT * FROM users WHERE id = :id AND deleted_at IS NULL', { id });
  }

  /** Аккаунт с подтверждённой почтой (вход и восстановление по адресу). */
  byVerifiedEmail(email: string): UserRow | undefined {
    return this.db.get<UserRow>('SELECT * FROM users WHERE email = :email AND email_verified_at IS NOT NULL AND deleted_at IS NULL', { email });
  }

  /** По имени пользователя или подтверждённой почте. */
  byLogin(login: string): UserRow | undefined {
    return login.includes('@') ? this.byVerifiedEmail(login) : this.byUsername(login);
  }

  byUsername(username: string): UserRow | undefined {
    return this.db.get<UserRow>('SELECT * FROM users WHERE username = :username AND deleted_at IS NULL', {
      username: username.toLowerCase(),
    });
  }

  toSummary(row: Pick<UserRow, 'id' | 'username' | 'display_name' | 'avatar_media_id' | 'verified' | 'deleted_at'>): UserSummary {
    if (row.deleted_at) {
      return { id: row.id, username: 'deleted', displayName: 'Удалённый аккаунт', avatarUrl: null, verified: false };
    }
    return {
      id: row.id,
      username: row.username,
      displayName: row.display_name,
      avatarUrl: this.media.url(row.avatar_media_id),
      verified: bool(row.verified),
    };
  }

  summaries(ids: readonly (string | null | undefined)[]): Map<string, UserSummary> {
    const unique = [...new Set(ids.filter((v): v is string => !!v))];
    const out = new Map<string, UserSummary>();
    if (unique.length === 0) return out;
    for (let i = 0; i < unique.length; i += 500) {
      const chunk = unique.slice(i, i + 500);
      const placeholders = chunk.map((_, j) => `:u${j}`).join(',');
      const params = Object.fromEntries(chunk.map((v, j) => [`u${j}`, v]));
      for (const row of this.db.all<UserRow>(`SELECT ${SUMMARY_COLS} FROM users WHERE id IN (${placeholders})`, params)) {
        out.set(row.id, this.toSummary(row));
      }
    }
    return out;
  }

  summary(id: string): UserSummary | null {
    return this.summaries([id]).get(id) ?? null;
  }
}
