/**
 * Демо-данные: пользователи, подписки, посты всех видов, комментарии, чаты,
 * каналы, сообщества и истории. Запуск: `npm run seed` (или `npm run seed -- --reset`).
 * Все демо-аккаунты имеют пароль DEMO_PASSWORD.
 */
import { rmSync } from 'node:fs';
import { loadConfig } from '../config.js';
import { DEMO_PASSWORD, seedDemo } from './demo.js';
import { Db } from './index.js';
import { migrate } from './migrate.js';

const config = loadConfig();
if (process.argv.includes('--reset')) {
  rmSync(config.dbFile, { force: true });
  rmSync(`${config.dbFile}-wal`, { force: true });
  rmSync(`${config.dbFile}-shm`, { force: true });
  rmSync(config.uploadsDir, { recursive: true, force: true });
}
const db = new Db(config.dbFile);
migrate(db);
if (await seedDemo(db, config)) {
  console.log('\n✅ Демо-данные загружены.');
  console.log(`   Войдите как: sasha / ${DEMO_PASSWORD}  (или любой другой: alice, boris, maria, elena, kirill, nikita, olga…)\n`);
} else {
  console.log('Демо-данные уже загружены. Для пересоздания: npm run seed -- --reset');
}
db.close();
