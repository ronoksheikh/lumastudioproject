// Per-user limits: disk (all of a student's projects, including node_modules and renders) and render time per day.
import { and, desc, eq, gte, inArray } from 'drizzle-orm';
import { config } from '../config.js';
import type { DB } from '../db/index.js';
import { projects, renderBoosts, renderJobs } from '../db/schema.js';
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

/** The newest paid render-hours pack that still has time left, if any. */
export function activeBoost(db: DB, userId: string) {
  return db.select().from(renderBoosts)
    .where(and(eq(renderBoosts.userId, userId), eq(renderBoosts.status, 'paid')))
    .orderBy(desc(renderBoosts.paidAt)).all()
    .find((b) => b.usedSeconds < b.seconds) ?? null;
}

/**
 * Seconds of LOCAL render time used in the current window: the last 24 hours, or since the latest paid pack
 * (buying render hours resets the daily allowance). Running jobs count up to now.
 */
export function renderSecondsToday(db: DB, userId: string, now = Date.now()): number {
  const lastPaid = db.select({ paidAt: renderBoosts.paidAt }).from(renderBoosts)
    .where(and(eq(renderBoosts.userId, userId), eq(renderBoosts.status, 'paid'))).orderBy(desc(renderBoosts.paidAt)).get()?.paidAt ?? 0;
  const since = Math.max(now - 86_400_000, lastPaid);
  const rows = db
    .select({ startedAt: renderJobs.startedAt, finishedAt: renderJobs.finishedAt })
    .from(renderJobs)
    .where(and(eq(renderJobs.userId, userId), eq(renderJobs.pool, 'local'), gte(renderJobs.startedAt, since), inArray(renderJobs.status, ['running', 'done', 'error'])))
    .all();
  return rows.reduce((sum, r) => sum + Math.max(0, ((r.finishedAt ?? now) - (r.startedAt ?? now)) / 1000), 0);
}

export interface RenderRoute {
  pool: 'local' | 'remote';
  boostId: string | null;
}

/**
 * Where the next render runs. A student with paid render hours left renders on the fast remote workers
 * (billed to the pack); otherwise here, within the daily allowance. Over the allowance → an error that
 * offers the paid hours (payment processing is added later; see /api/billing).
 */
export function assertRenderAllowed(db: DB, userId: string): RenderRoute {
  assertDiskAvailable(db, userId);
  const boost = activeBoost(db, userId);
  if (boost) return { pool: 'remote', boostId: boost.id };
  if (!config.renderSecondsPerDay) return { pool: 'local', boostId: null };
  const used = renderSecondsToday(db, userId);
  if (used >= config.renderSecondsPerDay) {
    throw new QuotaError(
      `You have used today's free render time on this server. Keep editing in the preview — the allowance refills over 24 hours — or get 1 hour of rendering on our fast render servers for ${config.renderBoostPriceBdt} BDT (Settings → Account → Fast render hours).`,
      'render_limit',
    );
  }
  return { pool: 'local', boostId: null };
}

/** Bill a finished remote render to its pack. */
export function chargeBoost(db: DB, boostId: string | null, seconds: number) {
  if (!boostId || seconds <= 0) return;
  const b = db.select().from(renderBoosts).where(eq(renderBoosts.id, boostId)).get();
  if (!b) return;
  db.update(renderBoosts).set({ usedSeconds: Math.min(b.seconds, b.usedSeconds + Math.ceil(seconds)) }).where(eq(renderBoosts.id, boostId)).run();
}

export function usageFor(db: DB, userId: string) {
  const boost = activeBoost(db, userId);
  const pending = db.select({ id: renderBoosts.id }).from(renderBoosts).where(and(eq(renderBoosts.userId, userId), eq(renderBoosts.status, 'pending'))).get();
  return {
    diskBytes: userDiskBytes(db, userId),
    diskLimitBytes: config.userQuotaBytes || null,
    /** whether today's free render time on this server is used up (the minutes themselves are not shown) */
    renderLimitReached: !!config.renderSecondsPerDay && renderSecondsToday(db, userId) >= config.renderSecondsPerDay,
    fastRender: {
      priceBdt: config.renderBoostPriceBdt,
      packMinutes: Math.round(config.renderBoostSeconds / 60),
      secondsLeft: boost ? boost.seconds - boost.usedSeconds : 0,
      pendingPurchase: !!pending,
    },
  };
}
