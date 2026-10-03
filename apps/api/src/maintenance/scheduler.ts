import type BetterSqlite3 from 'better-sqlite3';
import { config } from '../config.js';
import type { DB } from '../db/index.js';
import { logger } from '../logger.js';
import { backupDatabase, latestBackup } from './backup.js';
import { deleteExpiredSessions, purgeDeletedProjects } from './purge.js';

/** Hourly: purge old deleted projects + expired sessions. Daily after BACKUP_HOUR (UTC): database backup. */
export function startMaintenance(db: DB, sqlite: BetterSqlite3.Database) {
  const hourly = () => {
    try {
      purgeDeletedProjects(db);
      deleteExpiredSessions(db);
    } catch (e) {
      logger.error({ err: e }, 'maintenance failed');
    }
  };
  const dailyBackup = async () => {
    const now = new Date();
    if (now.getUTCHours() < config.backupHour) return;
    const last = latestBackup();
    const today = `luma-${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, '0')}${String(now.getUTCDate()).padStart(2, '0')}`;
    if (last?.startsWith(today)) return;
    try {
      await backupDatabase(sqlite);
    } catch (e) {
      logger.error({ err: e }, 'database backup failed');
    }
  };
  const t1 = setInterval(hourly, 3_600_000);
  const t2 = setInterval(() => void dailyBackup(), 10 * 60_000);
  t1.unref();
  t2.unref();
  setTimeout(hourly, 30_000).unref();
  setTimeout(() => void dailyBackup(), 60_000).unref();
  return () => {
    clearInterval(t1);
    clearInterval(t2);
  };
}
