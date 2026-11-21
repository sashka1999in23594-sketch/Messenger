/**
 * Сеансы: случайный 256-битный токен в httpOnly-cookie. В базе хранится только
 * SHA-256 от токена — утечка базы не даёт войти в чужие аккаунты.
 */
import type { SessionInfo } from '@omni/shared';
import type { Db } from '../../db/index.js';
import { iso } from '../../db/index.js';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { randomToken, sha256 } from '../../lib/crypto.js';
import { newId } from '../../lib/ids.js';
import type { RequestMeta } from '../../http/types.js';

interface SessionRow {
  id: string;
  user_id: string;
  device_name: string;
  user_agent: string;
  ip: string;
  created_at: number;
  last_seen_at: number;
  expires_at: number;
  revoked_at: number | null;
  device_id: string | null;
}

export interface ResolvedSession {
  sessionId: string;
  userId: string;
  role: 'user' | 'moderator' | 'admin';
  expiresAt: number;
}

/** Как часто обновлять last_seen (чтобы не писать в базу на каждый запрос). */
const TOUCH_INTERVAL_MS = 60_000;

/**
 * Формат токена v2: «s2.<id сеанса>.<id пользователя>.<случайная часть>.<подпись>».
 * Подпись — HMAC(APP_SECRET) от всего остального и «отпечатка» пароля пользователя.
 * Зачем: на бесплатном Render диск временный, и при засыпании/перезапуске сервера база
 * могла откатиться к резервной копии без свежих сеансов — людей выкидывало из аккаунта
 * после короткого простоя. Теперь живой подписанный токен восстанавливает строку сеанса.
 * Безопасность: подделать подпись без APP_SECRET нельзя; смена пароля меняет отпечаток
 * и обнуляет все старые токены; удалённый аккаунт не восстанавливается.
 */
const V2 = 's2';

export class SessionService {
  constructor(
    private readonly db: Db,
    private readonly ttlMs: number,
    private readonly secret: string = '',
  ) {}

  private pwPrint(userId: string): string | null {
    const u = this.db.get<{ password_hash: string; deleted_at: number | null }>('SELECT password_hash, deleted_at FROM users WHERE id = :id', { id: userId });
    if (!u || u.deleted_at) return null;
    return sha256(u.password_hash ?? '').slice(0, 16);
  }

  private sign(body: string, print: string): string {
    return createHmac('sha256', this.secret).update(`${body}|${print}`).digest('base64url');
  }

  private issueToken(sessionId: string, userId: string): string {
    const print = this.secret ? this.pwPrint(userId) : null;
    const rnd = randomToken(24);
    if (print === null) return randomToken(32);
    const body = `${V2}.${sessionId}.${userId}.${rnd}`;
    return `${body}.${this.sign(body, print)}`;
  }

  /** Восстанавливает сеанс по подписанному токену, если строки в базе нет (база откатилась). */
  private revive(token: string, ip: string): ResolvedSession | null {
    if (!this.secret || !token.startsWith(`${V2}.`)) return null;
    const parts = token.split('.');
    if (parts.length !== 5) return null;
    const [, sid, uid, , sig] = parts;
    if (!sid || !uid || !sig) return null;
    const print = this.pwPrint(uid);
    if (print === null) return null;
    const want = Buffer.from(this.sign(parts.slice(0, 4).join('.'), print));
    const got = Buffer.from(sig);
    if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
    // Сеанс с таким id уже есть, но с другим токеном или отозван — не воскрешаем
    if (this.db.get('SELECT 1 FROM sessions WHERE id = :id', { id: sid })) return null;
    const now = Date.now();
    const expiresAt = now + this.ttlMs;
    this.db.run(
      `INSERT INTO sessions (id, user_id, token_hash, device_name, user_agent, ip, created_at, last_seen_at, expires_at, device_id)
       VALUES (:id, :userId, :hash, :device, '', :ip, :now, :now, :exp, NULL)`,
      { id: sid, userId: uid, hash: sha256(token), device: 'Восстановленный сеанс', ip, now, exp: expiresAt },
    );
    const role = this.db.get<{ role: ResolvedSession['role'] }>('SELECT role FROM users WHERE id = :id', { id: uid })?.role ?? 'user';
    return { sessionId: sid, userId: uid, role, expiresAt };
  }

  create(userId: string, meta: RequestMeta): { token: string; sessionId: string; expiresAt: number } {
    const now = Date.now();
    const id = newId(now);
    const token = this.issueToken(id, userId);
    const expiresAt = now + this.ttlMs;
    this.db.run(
      `INSERT INTO sessions (id, user_id, token_hash, device_name, user_agent, ip, created_at, last_seen_at, expires_at, device_id)
       VALUES (:id, :userId, :hash, :device, :ua, :ip, :now, :now, :exp, :did)`,
      { id, userId, hash: sha256(token), device: meta.deviceName, ua: meta.userAgent, ip: meta.ip, now, exp: expiresAt, did: meta.deviceId || null },
    );
    return { token, sessionId: id, expiresAt };
  }

  /** Аккаунты (их userId), привязанные к этому устройству, — для переключения. */
  linkedUserIds(deviceId: string): string[] {
    if (!deviceId) return [];
    return this.db
      .all<{ user_id: string }>(
        `SELECT user_id, MAX(last_seen_at) AS seen FROM sessions
         WHERE device_id = :did AND revoked_at IS NULL AND expires_at > :now
         GROUP BY user_id ORDER BY seen DESC`,
        { did: deviceId, now: Date.now() },
      )
      .map((r) => r.user_id);
  }

  /** Есть ли живой сеанс этого аккаунта на этом устройстве (право на переключение). */
  canSwitch(deviceId: string, userId: string): boolean {
    if (!deviceId) return false;
    return !!this.db.get('SELECT 1 FROM sessions WHERE device_id = :did AND user_id = :userId AND revoked_at IS NULL AND expires_at > :now LIMIT 1', {
      did: deviceId,
      userId,
      now: Date.now(),
    });
  }

  /** Переключение: закрываем прежние сеансы этого аккаунта на устройстве и выдаём новый. */
  switchTo(userId: string, meta: RequestMeta): { token: string; sessionId: string; expiresAt: number } {
    if (meta.deviceId) {
      this.db.run('UPDATE sessions SET revoked_at = :now WHERE user_id = :userId AND device_id = :did AND revoked_at IS NULL', {
        now: Date.now(),
        userId,
        did: meta.deviceId,
      });
    }
    return this.create(userId, meta);
  }

  /** Проверяет токен; продлевает сеанс (скользящее окно). */
  resolve(token: string, ip: string): ResolvedSession | null {
    if (!token || token.length > 256) return null;
    const row = this.db.get<SessionRow & { role: ResolvedSession['role']; deleted_at: number | null }>(
      `SELECT s.*, u.role, u.deleted_at FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = :hash`,
      { hash: sha256(token) },
    );
    const now = Date.now();
    if (!row) return this.revive(token, ip);
    if (row.revoked_at || row.expires_at < now || row.deleted_at) return null;
    if (now - row.last_seen_at > TOUCH_INTERVAL_MS) {
      const expiresAt = now + this.ttlMs;
      this.db.run('UPDATE sessions SET last_seen_at = :now, ip = :ip, expires_at = :exp WHERE id = :id', {
        now,
        ip,
        exp: expiresAt,
        id: row.id,
      });
      this.db.run('UPDATE users SET last_seen_at = :now WHERE id = :id', { now, id: row.user_id });
      return { sessionId: row.id, userId: row.user_id, role: row.role, expiresAt };
    }
    return { sessionId: row.id, userId: row.user_id, role: row.role, expiresAt: row.expires_at };
  }

  list(userId: string, currentId: string): SessionInfo[] {
    return this.db
      .all<SessionRow>(
        `SELECT * FROM sessions WHERE user_id = :userId AND revoked_at IS NULL AND expires_at > :now
         ORDER BY last_seen_at DESC`,
        { userId, now: Date.now() },
      )
      .map((r) => ({
        id: r.id,
        deviceName: r.device_name,
        userAgent: r.user_agent,
        ip: maskIp(r.ip),
        createdAt: iso(r.created_at),
        lastSeenAt: iso(r.last_seen_at),
        current: r.id === currentId,
      }));
  }

  revoke(userId: string, sessionId: string): boolean {
    return (
      this.db.run('UPDATE sessions SET revoked_at = :now WHERE id = :id AND user_id = :userId AND revoked_at IS NULL', {
        now: Date.now(),
        id: sessionId,
        userId,
      }).changes > 0
    );
  }

  /** Завершает все сеансы, кроме указанного. Возвращает id завершённых. */
  revokeAllExcept(userId: string, keepId: string | null): string[] {
    const ids = this.db
      .all<{ id: string }>(
        'SELECT id FROM sessions WHERE user_id = :userId AND revoked_at IS NULL AND id IS NOT :keep',
        { userId, keep: keepId },
      )
      .map((r) => r.id);
    this.db.run('UPDATE sessions SET revoked_at = :now WHERE user_id = :userId AND revoked_at IS NULL AND id IS NOT :keep', {
      now: Date.now(),
      userId,
      keep: keepId,
    });
    return ids;
  }

  /** Есть ли у пользователя активный сеанс с таким же устройством (для оповещения о новом входе). */
  isKnownDevice(userId: string, userAgent: string): boolean {
    return !!this.db.get('SELECT 1 FROM sessions WHERE user_id = :userId AND user_agent = :ua LIMIT 1', {
      userId,
      ua: userAgent,
    });
  }

  purgeExpired(): number {
    const cutoff = Date.now() - 30 * 24 * 3600 * 1000;
    return this.db.run('DELETE FROM sessions WHERE expires_at < :cutoff OR revoked_at < :cutoff', { cutoff }).changes;
  }
}

/** Маскирует IP в интерфейсе: 203.0.113.42 → 203.0.113.*, IPv6 — первые 3 группы. */
export function maskIp(ip: string): string {
  const v4 = ip.replace(/^::ffff:/, '');
  if (/^\d+\.\d+\.\d+\.\d+$/.test(v4)) return v4.replace(/\.\d+$/, '.*');
  const parts = ip.split(':');
  return parts.length > 3 ? `${parts.slice(0, 3).join(':')}:…` : ip;
}
