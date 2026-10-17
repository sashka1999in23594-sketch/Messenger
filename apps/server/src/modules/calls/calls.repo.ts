import type { CallInfo, CallStatus } from '@omni/shared';
import type { Db } from '../../db/index.js';
import { Db as DbClass, bool, iso, isoOrNull } from '../../db/index.js';
import type { UsersRepo } from '../users/users.repo.js';

export interface CallRow {
  id: string;
  chat_id: string;
  caller_id: string;
  callee_id: string;
  video: number;
  status: CallStatus;
  caller_session: string | null;
  callee_session: string | null;
  created_at: number;
  answered_at: number | null;
  ended_at: number | null;
}

export class CallsRepo {
  constructor(
    private readonly db: Db,
    private readonly users: UsersRepo,
  ) {}

  byId(id: string): CallRow | undefined {
    return this.db.get<CallRow>('SELECT * FROM calls WHERE id = :id', { id });
  }

  toDtos(rows: CallRow[]): CallInfo[] {
    const users = this.users.summaries(rows.flatMap((r) => [r.caller_id, r.callee_id]));
    const deleted = { id: '', username: 'deleted', displayName: 'Удалённый аккаунт', avatarUrl: null, verified: false };
    return rows.map((r) => ({
      id: r.id,
      chatId: r.chat_id,
      caller: users.get(r.caller_id) ?? { ...deleted, id: r.caller_id },
      callee: users.get(r.callee_id) ?? { ...deleted, id: r.callee_id },
      video: bool(r.video),
      status: r.status,
      durationSec: r.answered_at ? Math.round(((r.ended_at ?? Date.now()) - r.answered_at) / 1000) : 0,
      createdAt: iso(r.created_at),
      answeredAt: isoOrNull(r.answered_at),
      endedAt: isoOrNull(r.ended_at),
    }));
  }

  dtos(ids: readonly string[]): Map<string, CallInfo> {
    if (!ids.length) return new Map();
    const list = DbClass.inList([...new Set(ids)], 'c');
    const rows = this.db.all<CallRow>(`SELECT * FROM calls WHERE id IN (${list.sql})`, list.params);
    return new Map(this.toDtos(rows).map((c) => [c.id, c]));
  }
}
