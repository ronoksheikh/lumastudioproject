// Per-user limits: disk (all of a student's projects, including node_modules and renders) and render time per day.
import { and, eq, gte, inArray } from 'drizzle-orm';
import { config } from '../config.js';
import type { DB } from '../db/index.js';
import { projects, renderJobs } from '../db/schema.js';
import { HttpError } from '../http/errors.js';
import { projectDir } from '../projects/dirs.js';
import { dirSize } from '../runner/files.js';

const fmtGb = (b: number) => (b / 1024 ** 3 >= 1 ? `${(b / 1024 ** 3).toFixed(1)} GB` : `${Math.round(b / 1024 ** 2)} MB`);

const cache = new Map<string, { at: number; bytes: number }>();
const CACHE_MS = 30_000;

/** Bytes used by every project the user still has on disk (deleted ones count until they are purged). */
export function userDiskBytes(db: DB, userId: string, { fresh = false } = {}): number {
  const hit = cache.get(userId);
  if (!fresh && hit && Date.now() - hit.at < CACHE_MS) return hit.bytes;
  let total = 0;
  for (const p of db.select({ id: projects.id }).from(projects).where(eq(projects.userId, userId)).all()) total += dirSize(projectDir(p.id));
  cache.set(userId, { at: Date.now(), bytes: total });
  return total;
}

export const forgetUsage = (userId?: string) => (userId ? cache.delete(userId) : cache.clear());

export class QuotaError extends HttpError {
  constructor(message: string, code = 'quota_exceeded') {
    super(413, code, message);
  }
}

/** Throws when the user is over their disk quota. */
export function assertDiskAvailable(db: DB, userId: string) {
  if (!config.userQuotaBytes) return;
  const used = userDiskBytes(db, userId);
  if (used >= config.userQuotaBytes) {
    throw new QuotaError(`You are using ${fmtGb(used)} of your ${fmtGb(config.userQuotaBytes)} storage. Delete old projects or renders to make room.`, 'storage_full');
  }
}

/** Seconds of render time the user started in the last 24 hours (running jobs count up to now). */
export function renderSecondsToday(db: DB, userId: string, now = Date.now()): number {
  const rows = db
    .select({ startedAt: renderJobs.startedAt, finishedAt: renderJobs.finishedAt })
    .from(renderJobs)
    .where(and(eq(renderJobs.userId, userId), gte(renderJobs.startedAt, now - 86_400_000), inArray(renderJobs.status, ['running', 'done', 'error'])))
    .all();
  return rows.reduce((sum, r) => sum + Math.max(0, ((r.finishedAt ?? now) - (r.startedAt ?? now)) / 1000), 0);
}

export function assertRenderAllowed(db: DB, userId: string) {
  assertDiskAvailable(db, userId);
  if (!config.renderSecondsPerDay) return;
  const used = renderSecondsToday(db, userId);
  if (used >= config.renderSecondsPerDay) {
    throw new QuotaError(`You have used your ${Math.round(config.renderSecondsPerDay / 60)} render minutes for today. The allowance refills over the next 24 hours — keep editing in the preview meanwhile.`, 'render_limit');
  }
}

export function usageFor(db: DB, userId: string) {
  return {
    diskBytes: userDiskBytes(db, userId),
    diskLimitBytes: config.userQuotaBytes || null,
    renderSecondsToday: Math.round(renderSecondsToday(db, userId)),
    renderSecondsLimit: config.renderSecondsPerDay || null,
  };
}
