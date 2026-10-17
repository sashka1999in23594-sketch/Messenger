/** Счётчики по дням для статистики: просмотры, новые подписчики, посещения. */
import type { Db } from '../../db/index.js';

export type StatMetric =
  | 'channel_views'
  | 'channel_joins'
  | 'channel_leaves'
  | 'profile_views'
  | 'post_views'
  | 'followers_gained'
  | 'followers_lost';

/** День в UTC: «2026-10-17» */
export const dayKey = (t = Date.now()) => new Date(t).toISOString().slice(0, 10);

export function bumpStat(db: Db, metric: StatMetric, entityId: string, by = 1): void {
  db.run(
    `INSERT INTO stat_daily (metric, entity_id, day, value) VALUES (:m, :e, :d, :v)
     ON CONFLICT (metric, entity_id, day) DO UPDATE SET value = value + excluded.value`,
    { m: metric, e: entityId, d: dayKey(), v: by },
  );
}
