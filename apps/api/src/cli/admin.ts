// Operator CLI. In the container: `docker compose exec luma-studio node dist/admin.js <command>`.
//   users                      list accounts with project count and disk use
//   ban <email> | unban <email>
//   purge [--days N]           remove projects deleted more than N days ago (default PURGE_AFTER_DAYS)
//   backup                     write a database backup now
//   rotate-key                 re-encrypt all stored API keys: OLD_MASTER_KEY=<old> MASTER_KEY=<new> … rotate-key
import { createDb, runMigrations } from '../db/index.js';
import { config } from '../config.js';
import { backupDatabase } from '../maintenance/backup.js';
import { purgeDeletedProjects } from '../maintenance/purge.js';
import { listUsers, rotateMasterKey, setBanned } from './commands.js';

const [cmd, arg] = process.argv.slice(2);
const { db, sqlite } = createDb();
runMigrations(db);

const mb = (b: number) => `${Math.round(b / 1024 / 1024)} MB`;
try {
  switch (cmd) {
    case 'users':
      for (const u of listUsers(db)) console.log(`${u.banned ? '[banned] ' : ''}${u.email}  ${u.projects} project(s)  ${mb(u.diskBytes)}  since ${new Date(u.createdAt).toISOString().slice(0, 10)}`);
      break;
    case 'ban':
    case 'unban':
      if (!arg) throw new Error(`usage: ${cmd} <email>`);
      if (!setBanned(db, arg, cmd === 'ban')) throw new Error(`no such user: ${arg}`);
      console.log(`${arg} ${cmd === 'ban' ? 'is suspended (their sessions were ended)' : 'can sign in again'}`);
      break;
    case 'purge': {
      const days = process.argv.includes('--days') ? Number(process.argv[process.argv.indexOf('--days') + 1]) : config.purgeAfterDays;
      console.log(`purged ${purgeDeletedProjects(db, Date.now(), days).length} project(s)`);
      break;
    }
    case 'backup':
      console.log(await backupDatabase(sqlite));
      break;
    case 'rotate-key': {
      const oldB64 = process.env.OLD_MASTER_KEY;
      if (!oldB64 || !config.masterKey) throw new Error('set OLD_MASTER_KEY (current key) and MASTER_KEY (new key), then run rotate-key; afterwards run the app with only the new MASTER_KEY');
      const r = rotateMasterKey(db, Buffer.from(oldB64, 'base64'), Buffer.from(config.masterKey, 'base64'));
      console.log(`re-encrypted ${r.providers} model key(s) and ${r.secrets} voice key(s). Start the app with MASTER_KEY=<new key> from now on.`);
      break;
    }
    default:
      console.log('commands: users | ban <email> | unban <email> | purge [--days N] | backup | rotate-key');
      process.exitCode = cmd ? 2 : 0;
  }
} catch (e) {
  console.error((e as Error).message);
  process.exitCode = 1;
} finally {
  sqlite.close();
}
