/** Жалобы пользователей и очередь модерации. */
import type { Db } from '../../db/index.js';
import { iso } from '../../db/index.js';
import { conflict, notFound } from '../../lib/errors.js';
import { newId } from '../../lib/ids.js';

interface ReportRow {
  id: string;
  reporter_id: string | null;
  entity_type: string;
  entity_id: string;
  reason: string;
  details: string;
  status: 'open' | 'resolved' | 'rejected';
  created_at: number;
}

export class ReportsService {
  constructor(private readonly db: Db) {}

  create(userId: string, input: { entityType: string; entityId: string; reason: string; details: string }) {
    const dup = this.db.get(
      "SELECT 1 FROM reports WHERE reporter_id = :u AND entity_type = :t AND entity_id = :e AND status = 'open'",
      { u: userId, t: input.entityType, e: input.entityId },
    );
    if (dup) throw conflict('Вы уже отправили жалобу, она на рассмотрении');
    const id = newId();
    this.db.run(
      `INSERT INTO reports (id, reporter_id, entity_type, entity_id, reason, details, created_at)
       VALUES (:id, :u, :t, :e, :r, :d, :now)`,
      { id, u: userId, t: input.entityType, e: input.entityId, r: input.reason, d: input.details, now: Date.now() },
    );
    return { id, status: 'open' as const };
  }

  list(status: ReportRow['status'], cursor: string | undefined, limit: number) {
    const rows = this.db.all<ReportRow>(
      'SELECT * FROM reports WHERE status = :s AND (:cursor IS NULL OR id < :cursor) ORDER BY id DESC LIMIT :l',
      { s: status, cursor: cursor ?? null, l: limit + 1 },
    );
    return {
      items: rows.slice(0, limit).map((r) => ({
        id: r.id,
        reporterId: r.reporter_id,
        entityType: r.entity_type,
        entityId: r.entity_id,
        reason: r.reason,
        details: r.details,
        status: r.status,
        createdAt: iso(r.created_at),
      })),
      nextCursor: rows.length > limit ? (rows[limit - 1]?.id ?? null) : null,
    };
  }

  resolve(moderatorId: string, id: string, status: 'resolved' | 'rejected', removeContent: boolean): void {
    const r = this.db.get<ReportRow>('SELECT * FROM reports WHERE id = :id', { id });
    if (!r) throw notFound('Жалоба не найдена');
    const now = Date.now();
    this.db.tx(() => {
      if (removeContent && status === 'resolved') {
        if (r.entity_type === 'post') this.db.run('UPDATE posts SET deleted_at = :now WHERE id = :e', { now, e: r.entity_id });
        if (r.entity_type === 'comment') this.db.run("UPDATE comments SET deleted_at = :now, text = '' WHERE id = :e", { now, e: r.entity_id });
        if (r.entity_type === 'story') this.db.run('UPDATE stories SET deleted_at = :now WHERE id = :e', { now, e: r.entity_id });
      }
      // Закрываем все открытые жалобы на этот же объект
      this.db.run(
        `UPDATE reports SET status = :s, resolved_at = :now, resolved_by = :m
         WHERE entity_type = :t AND entity_id = :e AND status = 'open'`,
        { s: status, now, m: moderatorId, t: r.entity_type, e: r.entity_id },
      );
    });
  }
}
