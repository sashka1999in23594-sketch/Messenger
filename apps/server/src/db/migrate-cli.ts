import { loadConfig } from '../config.js';
import { Db } from './index.js';
import { migrate } from './migrate.js';

const config = loadConfig();
const db = new Db(config.dbFile);
const done = migrate(db, console.log);
console.log(done.length ? `Применено миграций: ${done.length}` : 'База данных в актуальном состоянии');
db.close();
