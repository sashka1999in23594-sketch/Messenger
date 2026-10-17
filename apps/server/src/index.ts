import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { startJobs } from './jobs.js';

const config = loadConfig();
const app = await buildApp(config);
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
