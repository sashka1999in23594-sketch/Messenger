import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { DEMO_PASSWORD, seedDemo } from './db/demo.js';
import { startJobs } from './jobs.js';

const config = loadConfig();
const app = await buildApp(config);

// Публичное демо: при пустой базе загружаем демо-данные до начала приёма запросов
if (config.demoSeed) {
  const started = Date.now();
  if (await seedDemo(app.ctx.db, config)) {
    app.log.info(`Демо-данные загружены за ${Date.now() - started} мс (вход: sasha / ${DEMO_PASSWORD})`);
  }
}
const stopJobs = startJobs(app);

const shutdown = async (signal: string) => {
  app.log.info(`${signal}: shutting down`);
  stopJobs();
  await app.close();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

await app.listen({ host: config.host, port: config.port });
app.log.info(`Omni API: http://${config.host}:${config.port}/api/v1 (web origin ${config.publicOrigin})`);
const mailModes = {
  brevo: 'Brevo API',
  resend: 'Resend API',
  smtp: 'SMTP',
  dev: 'тестовый ящик (режим разработки)',
  disabled: 'выключены — задайте BREVO_API_KEY, RESEND_API_KEY или SMTP_URL',
} as const;
app.log.info(`Письма: ${mailModes[config.mail.provider]}`);
