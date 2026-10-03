import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { config } from '../config.js';
import { logger } from '../logger.js';
import * as schema from './schema.js';

export type DB = ReturnType<typeof createDb>['db'];

/** Opens the SQLite file with the pragmas from plan.md Phase 0. */
export function createDb(dbPath: string = config.dbPath) {
  if (dbPath !== ':memory:') fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const sqlite = new Database(dbPath);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('busy_timeout = 5000');
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('synchronous = NORMAL');
  const db = drizzle(sqlite, { schema });
  return { db, sqlite };
}

function migrationsDir() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  // dist/index.js -> ../drizzle ; src/db/index.ts -> ../../drizzle
  const candidates = [path.resolve(here, '../drizzle'), path.resolve(here, '../../drizzle')];
  const dir = candidates.find((d) => fs.existsSync(path.join(d, 'meta', '_journal.json')));
  if (!dir) throw new Error(`Drizzle migrations not found (looked in ${candidates.join(', ')})`);
  return dir;
}

export function runMigrations(db: DB) {
  const dir = migrationsDir();
  migrate(db, { migrationsFolder: dir });
  logger.info({ dir }, 'database migrations applied');
}

export { schema };
