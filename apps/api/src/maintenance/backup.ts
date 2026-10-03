// Online SQLite backup (safe while the app is writing) with simple rotation.
import fs from 'node:fs';
import path from 'node:path';
import type BetterSqlite3 from 'better-sqlite3';
import { config } from '../config.js';
import { logger } from '../logger.js';

const NAME = /^luma-\d{8}-\d{6}\.db$/;

export const backupName = (d = new Date()) => {
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `luma-${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}-${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}.db`;
};

export async function backupDatabase(sqlite: BetterSqlite3.Database, dir = config.backupDir, keep = config.backupKeep, now = new Date()): Promise<string> {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = path.join(dir, backupName(now));
  const tmp = `${file}.partial`;
  await sqlite.backup(tmp);
  fs.renameSync(tmp, file); // a half-written backup never carries the final name
  const all = fs.readdirSync(dir).filter((f) => NAME.test(f)).sort();
  for (const old of all.slice(0, Math.max(0, all.length - keep))) fs.rmSync(path.join(dir, old), { force: true });
  logger.info({ file, size: fs.statSync(file).size }, 'database backup written');
  return file;
}

export const latestBackup = (dir = config.backupDir): string | null => {
  try {
    return fs.readdirSync(dir).filter((f) => NAME.test(f)).sort().at(-1) ?? null;
  } catch {
    return null;
  }
};
