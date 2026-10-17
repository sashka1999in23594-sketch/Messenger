import type { Db } from './index.js';
import { migrations } from './migrations.js';

export function migrate(db: Db, log: (msg: string) => void = () => {}): string[] {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version    TEXT PRIMARY KEY,
    applied_at INTEGER NOT NULL
  )`);
  const applied = new Set(db.all<{ version: string }>('SELECT version FROM schema_migrations').map((r) => r.version));
  const done: string[] = [];
  for (const m of migrations) {
    if (applied.has(m.version)) continue;
    db.tx(() => {
      db.exec(m.sql);
      db.run('INSERT INTO schema_migrations (version, applied_at) VALUES (:v, :t)', { v: m.version, t: Date.now() });
    });
    log(`migration applied: ${m.version}`);
    done.push(m.version);
  }
  return done;
}
