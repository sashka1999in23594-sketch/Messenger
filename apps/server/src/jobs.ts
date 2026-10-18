/** Фоновые задачи: таймеры самоуничтожения, очистка истёкших сеансов и историй. */
import type { FastifyInstance } from 'fastify';

export function startJobs(app: FastifyInstance): () => void {
  const { services, db } = app.ctx;
  const timers: NodeJS.Timeout[] = [];
  const every = (ms: number, name: string, fn: () => number | void) => {
    const t = setInterval(() => {
      try {
        const n = fn();
        if (typeof n === 'number' && n > 0) app.log.debug({ job: name, count: n }, 'job done');
      } catch (err) {
        app.log.error({ err, job: name }, 'job failed');
      }
    }, ms);
    t.unref();
    timers.push(t);
  };
  /** Асинхронная задача: следующий запуск — только после завершения предыдущего */
  const everyAsync = (ms: number, name: string, fn: () => Promise<number>) => {
    let busy = false;
    const t = setInterval(() => {
      if (busy) return;
      busy = true;
      fn()
        .then((n) => n > 0 && app.log.debug({ job: name, count: n }, 'job done'))
        .catch((err: unknown) => app.log.warn({ err: String(err), job: name }, 'job failed'))
        .finally(() => {
          busy = false;
        });
    }, ms);
    t.unref();
    timers.push(t);
  };

  every(5_000, 'expire-messages', () => services.chats.sweepExpired());
  every(10_000, 'scheduled-messages', () => services.scheduled.sendDue((err) => app.log.warn({ err }, 'scheduled message failed')));
  every(30_000, 'scheduled-posts', () => services.drafts.publishDue((err) => app.log.warn({ err }, 'scheduled post failed')));
  every(30_000, 'premiere-reminders', () => services.posts.firePremiereReminders());
  every(3600_000, 'purge-sessions', () => services.sessions.purgeExpired());
  every(3600_000, 'purge-stories', () => services.stories.purgeExpired());
  every(600_000, 'purge-login-challenges', () => db.run('DELETE FROM login_challenges WHERE expires_at < :now', { now: Date.now() }).changes);
  every(6 * 3600_000, 'purge-email-codes', () => services.emailCodes.cleanup());
  every(6 * 3600_000, 'optimize-db', () => db.exec('PRAGMA optimize'));
  if (app.ctx.storage) everyAsync(60_000, 'storage-sync', () => services.media.syncPending());

  return () => {
    timers.forEach(clearInterval);
    services.calls.stop();
  };
}
