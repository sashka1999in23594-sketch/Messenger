import path from 'node:path';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { checkWrite, DbBackup, restoreDb, type RestoreResult } from './db/backup.js';
import { DEMO_PASSWORD, seedDemo } from './db/demo.js';
import { startJobs } from './jobs.js';
import { S3Storage } from './lib/s3.js';

const config = loadConfig();
// Внешнее хранилище: база восстанавливается до того, как её откроет приложение
const storage = config.storage ? new S3Storage(config.storage) : null;
let restored: RestoreResult = { from: 'local' };
if (storage) {
  try {
    restored = await restoreDb(storage, config.dbFile);
    await checkWrite(storage);
  } catch (err) {
    console.error(`Хранилище ${storage.label} недоступно: ${String(err)}`);
    console.error('Запуск остановлен, чтобы не начать с пустой базой и не затереть копию. Проверьте S3_* переменные.');
    process.exit(1);
  }
}
const app = await buildApp(config, { storage });
if (storage) {
  const how =
    restored.from === 'backup'
      ? `база восстановлена из копии (${(restored.bytes / 1048576).toFixed(1)} МБ за ${restored.ms} мс)`
      : restored.from === 'empty'
        ? 'копии ещё нет — начинаем с новой базы'
        : 'база на локальном диске, копия будет обновляться';
  app.log.info(`Хранилище ${storage.label}: ${how}`);
} else if (config.isProd) {
  app.log.warn('Внешнее хранилище не подключено: на хостинге с временным диском (бесплатный Render) данные пропадут при перезапуске. См. README → «Данные не пропадают».');
}

// Публичное демо: при пустой базе загружаем демо-данные до начала приёма запросов
if (config.demoSeed) {
  const started = Date.now();
  if (await seedDemo(app.ctx.db, config)) {
    app.log.info(`Демо-данные загружены за ${Date.now() - started} мс (вход: sasha / ${DEMO_PASSWORD})`);
  }
}
const stopJobs = startJobs(app);
const backup = storage ? new DbBackup(app.ctx.db, storage, path.join(config.dataDir, 'backup'), app.log, restored.from === 'backup') : null;
backup?.start(config.backupIntervalMs);

let stopping = false;
const shutdown = async (signal: string) => {
  if (stopping) return;
  stopping = true;
  app.log.info(`${signal}: shutting down`);
  stopJobs();
  // Дослать файлы и последнюю копию базы — не дольше 20 секунд (хостинг ждёт остановки ~30 с)
  if (backup) {
    const final = app.ctx.services.media.flush().then(() => backup.stop());
    await Promise.race([final, new Promise((r) => setTimeout(r, 20_000))]);
  }
  await app.close();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

await app.listen({ host: config.host, port: config.port });
app.log.info(`SpaceUp API: http://${config.host}:${config.port}/api/v1 (web origin ${config.publicOrigin})`);
const mailModes = {
  brevo: 'Brevo API',
  resend: 'Resend API',
  smtp: 'SMTP',
  dev: 'тестовый ящик (режим разработки)',
  disabled: 'выключены — задайте BREVO_API_KEY, RESEND_API_KEY или SMTP_URL',
} as const;
app.log.info(`Письма: ${mailModes[config.mail.provider]}`);
