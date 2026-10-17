import type { Paginated, SecurityEvent } from '@omni/shared';
import type { Db } from '../../db/index.js';
import { iso } from '../../db/index.js';
import { newId } from '../../lib/ids.js';
import type { RequestMeta } from '../../http/types.js';
import { maskIp } from './sessions.js';

/** Журнал безопасности: пользователь видит все входы и важные изменения аккаунта. */
export class SecurityLog {
  constructor(private readonly db: Db) {}

  record(userId: string | null, type: string, meta: Partial<RequestMeta>, details?: Record<string, unknown>): void {
    this.db.run(
      `INSERT INTO security_events (id, user_id, type, ip, user_agent, details, created_at)
       VALUES (:id, :userId, :type, :ip, :ua, :details, :now)`,
      {
        id: newId(),
        userId,
        type,
        ip: meta.ip ?? '',
        ua: meta.userAgent ?? '',
        details: details ? JSON.stringify(details) : null,
        now: Date.now(),
      },
    );
  }

  list(userId: string, cursor: string | undefined, limit: number): Paginated<SecurityEvent> {
    const rows = this.db.all<{
      id: string;
      type: string;
      ip: string;
      user_agent: string;
      details: string | null;
      created_at: number;
    }>(
      `SELECT * FROM security_events WHERE user_id = :userId AND (:cursor IS NULL OR id < :cursor)
       ORDER BY id DESC LIMIT :limit`,
      { userId, cursor: cursor ?? null, limit: limit + 1 },
    );
    const items = rows.slice(0, limit).map((r) => ({
      id: r.id,
      type: r.type,
      ip: maskIp(r.ip),
      userAgent: r.user_agent,
      createdAt: iso(r.created_at),
      details: r.details ? (JSON.parse(r.details) as Record<string, unknown>) : null,
    }));
    return { items, nextCursor: rows.length > limit ? (items[items.length - 1]?.id ?? null) : null };
  }
}
