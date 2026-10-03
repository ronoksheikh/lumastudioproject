// Operator CLI. In the container: `docker compose exec luma-studio node dist/admin.js <command>`.
//   users                      list accounts with project count and disk use
//   ban <email> | unban <email>
//   purge [--days N]           remove projects deleted more than N days ago (default PURGE_AFTER_DAYS)
//   backup                     write a database backup now
//   rotate-key                 re-encrypt all stored API keys: OLD_MASTER_KEY=<old> MASTER_KEY=<new> … rotate-key
//   worker-add <name>          register a remote render worker; prints its token ONCE
//   workers                    list render workers (last seen, disabled)
//   worker-disable|worker-enable|worker-remove <id|name>
//   boosts [pending|paid]      list fast-render-hour purchases
//   boost-paid <id> [ref]      mark a pending purchase paid (until the payment gateway does it)
//   boost-grant <email> [min]  give someone fast render minutes (default RENDER_BOOST_MINUTES)
import { createDb, runMigrations } from '../db/index.js';
import { config } from '../config.js';
import { backupDatabase } from '../maintenance/backup.js';
import { purgeDeletedProjects } from '../maintenance/purge.js';
import { addWorker, grantBoost, listBoosts, listUsers, listWorkers, markBoostPaid, removeWorker, rotateMasterKey, setBanned, setWorkerDisabled } from './commands.js';

const [cmd, arg, arg2] = process.argv.slice(2);
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
    case 'worker-add': {
      if (!arg) throw new Error('usage: worker-add <name>');
      const w = addWorker(db, arg);
      console.log(`worker ${arg} (${w.id}) registered. Its token (shown only now):\n\n  ${w.token}\n\nRun on the worker machine: LUMA_URL=${config.appOrigin} LUMA_WORKER_TOKEN=<token> node worker/luma-worker.mjs`);
      break;
    }
    case 'workers': {
      const online = Date.now() - config.workerOnlineS * 1000;
      for (const w of listWorkers(db)) console.log(`${w.id}  ${w.name}  ${w.disabled ? 'disabled' : (w.lastSeenAt ?? 0) > online ? 'online' : 'offline'}  last seen ${w.lastSeenAt ? new Date(w.lastSeenAt).toISOString() : 'never'}`);
      break;
    }
    case 'worker-disable':
    case 'worker-enable':
    case 'worker-remove': {
      if (!arg) throw new Error(`usage: ${cmd} <id|name>`);
      const found = cmd === 'worker-remove' ? removeWorker(db, arg) : setWorkerDisabled(db, arg, cmd === 'worker-disable');
      if (!found) throw new Error(`no such worker: ${arg}`);
      console.log(`${arg}: ${cmd.slice(7)}d`);
      break;
    }
    case 'boosts':
      for (const { b, email } of listBoosts(db, arg)) console.log(`${b.id}  ${email}  ${b.status}  ${b.priceBdt} BDT  ${Math.round(b.usedSeconds / 60)}/${Math.round(b.seconds / 60)} min  ${new Date(b.createdAt).toISOString().slice(0, 16)}`);
      break;
    case 'boost-paid':
      if (!arg) throw new Error('usage: boost-paid <id> [payment-ref]');
      if (!markBoostPaid(db, arg, arg2)) throw new Error(`no pending purchase ${arg}`);
      console.log(`${arg} is paid: the student's renders now go to the fast render workers and their daily allowance is reset`);
      break;
    case 'boost-grant': {
      if (!arg) throw new Error('usage: boost-grant <email> [minutes]');
      const id = grantBoost(db, arg, arg2 ? Number(arg2) : config.renderBoostSeconds / 60);
      if (!id) throw new Error(`no such user: ${arg}`);
      console.log(`granted (${id})`);
      break;
    }
    default:
      console.log('commands: users | ban <email> | unban <email> | purge [--days N] | backup | rotate-key | worker-add <name> | workers | worker-disable|worker-enable|worker-remove <id|name> | boosts [status] | boost-paid <id> [ref] | boost-grant <email> [min]');
      process.exitCode = cmd ? 2 : 0;
  }
} catch (e) {
  console.error((e as Error).message);
  process.exitCode = 1;
} finally {
  sqlite.close();
}
