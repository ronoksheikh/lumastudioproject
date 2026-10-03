// Deleted projects stay on disk for PURGE_AFTER_DAYS (so an accidental delete can be undone by an admin),
// then their files and rows are removed for good.
import fs from 'node:fs';
import { and, isNotNull, lt, eq } from 'drizzle-orm';
import { config } from '../config.js';
import type { DB } from '../db/index.js';
import { projects, sessions } from '../db/schema.js';
import { logger } from '../logger.js';
import { projectDir } from '../projects/dirs.js';
import { forgetUsage } from '../quota/service.js';
import { killUidProcesses } from '../runner/exec.js';

export function purgeDeletedProjects(db: DB, now = Date.now(), days = config.purgeAfterDays): string[] {
  const cutoff = now - days * 86_400_000;
  const old = db.select().from(projects).where(and(isNotNull(projects.deletedAt), lt(projects.deletedAt, cutoff))).all();
  const purged: string[] = [];
  for (const p of old) {
    try {
      if (p.uid != null) killUidProcesses(p.uid);
      fs.rmSync(projectDir(p.id), { recursive: true, force: true });
      db.delete(projects).where(eq(projects.id, p.id)).run(); // messages, runs, renders… cascade
      forgetUsage(p.userId);
      purged.push(p.id);
    } catch (e) {
      logger.error({ err: e, project: p.id }, 'could not purge project');
    }
  }
  if (purged.length) logger.info({ count: purged.length }, 'purged deleted projects');
  return purged;
}

export function deleteExpiredSessions(db: DB, now = Date.now()): number {
  return db.delete(sessions).where(lt(sessions.expiresAt, now)).run().changes;
}
