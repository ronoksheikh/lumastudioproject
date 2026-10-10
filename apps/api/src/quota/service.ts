// Per-user limits: disk (all of a student's projects, including node_modules and renders) and render time per day.
import { and, asc, eq, gte, inArray } from 'drizzle-orm';
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

// ---------------- render time: two quotas ----------------
// FREE: RENDER_MINUTES_PER_DAY (default 5 h) of rendering on this server in any rolling 24 hours.
// FAST: paid hours on the fast remote render workers (RENDER_HOUR_PRICE_BDT per hour, bought online),
// kept until used. When a student has both, the agent asks which one to use (render_video `mode`).

/** Paid packs with time left, oldest first (time is used from the oldest pack). */
export function paidPacks(db: DB, userId: string) {
  return db.select().from(renderBoosts)
    .where(and(eq(renderBoosts.userId, userId), eq(renderBoosts.status, 'paid')))
    .orderBy(asc(renderBoosts.paidAt)).all()
    .filter((b) => b.usedSeconds < b.seconds);
}

/** Seconds of fast (remote) render time the student has left across all paid packs. */
export const fastSecondsLeft = (db: DB, userId: string) => paidPacks(db, userId).reduce((sum, b) => sum + (b.seconds - b.usedSeconds), 0);

/** Seconds of FREE (local) render time used in the last 24 hours. Running jobs count up to now. */
export function renderSecondsToday(db: DB, userId: string, now = Date.now()): number {
  const rows = db
    .select({ startedAt: renderJobs.startedAt, finishedAt: renderJobs.finishedAt })
    .from(renderJobs)
    .where(and(eq(renderJobs.userId, userId), eq(renderJobs.pool, 'local'), gte(renderJobs.startedAt, now - 86_400_000), inArray(renderJobs.status, ['running', 'done', 'error'])))
    .all();
  return rows.reduce((sum, r) => sum + Math.max(0, ((r.finishedAt ?? now) - (r.startedAt ?? now)) / 1000), 0);
}

/** Free seconds left today (Infinity when the free quota is unlimited). */
export function freeSecondsLeft(db: DB, userId: string): number {
  if (!config.renderSecondsPerDay) return Infinity;
  return Math.max(0, config.renderSecondsPerDay - renderSecondsToday(db, userId));
}

export type RenderMode = 'free' | 'fast';

export interface RenderRoute {
  pool: 'local' | 'remote';
  boostId: string | null;
}

const fmtTime = (s: number) => (s === Infinity ? 'unlimited' : s >= 3600 ? `${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min` : `${Math.max(1, Math.round(s / 60))} min`);

/**
 * Where the next render runs. `mode` is the student's choice; without one: the only quota they have, or — when
 * they have both — a `choose_render_mode` error so the agent asks them. Both empty → `render_limit`.
 */
export function assertRenderAllowed(db: DB, userId: string, mode?: RenderMode): RenderRoute {
  assertDiskAvailable(db, userId);
  const free = freeSecondsLeft(db, userId);
  const fast = fastSecondsLeft(db, userId);
  const fastRoute = (): RenderRoute => ({ pool: 'remote', boostId: paidPacks(db, userId)[0]!.id });
  const buy = `Fast render hours cost ${config.renderHourPriceBdt} BDT per hour (Settings → Account → Fast render hours).`;
  if (mode === 'fast') {
    if (fast > 0) return fastRoute();
    throw new QuotaError(`No fast render hours left. ${buy}${free > 0 ? ` Free render time left today: ${fmtTime(free)}.` : ''}`, 'no_fast_hours');
  }
  if (mode === 'free') {
    if (free > 0) return { pool: 'local', boostId: null };
    throw new QuotaError(`Today's free render time (${fmtTime(config.renderSecondsPerDay)} per 24 hours) is used up; it refills over 24 hours.${fast > 0 ? ` Fast render hours left: ${fmtTime(fast)}.` : ` ${buy}`}`, 'render_limit');
  }
  if (free > 0 && fast > 0) {
    throw new QuotaError(`Choose a render type: free (on our server, slower — ${fmtTime(free)} left today) or fast (fast render servers — ${fmtTime(fast)} of fast hours left).`, 'choose_render_mode');
  }
  if (free > 0) return { pool: 'local', boostId: null };
  if (fast > 0) return fastRoute();
  throw new QuotaError(`Today's free render time is used up (it refills over 24 hours) and there are no fast render hours left. ${buy}`, 'render_limit');
}

/** Bill a finished fast render: from its pack first, any overflow from the next packs. */
export function chargeBoost(db: DB, boostId: string | null, seconds: number) {
  if (!boostId || seconds <= 0) return;
  const first = db.select().from(renderBoosts).where(eq(renderBoosts.id, boostId)).get();
  if (!first) return;
  let left = Math.ceil(seconds);
  const packs = [first, ...paidPacks(db, first.userId).filter((p) => p.id !== first.id)];
  for (const p of packs) {
    if (left <= 0) break;
    const take = Math.min(left, p.seconds - p.usedSeconds);
    if (take <= 0) continue;
    db.update(renderBoosts).set({ usedSeconds: p.usedSeconds + take }).where(eq(renderBoosts.id, p.id)).run();
    left -= take;
  }
}

export function usageFor(db: DB, userId: string) {
  const free = freeSecondsLeft(db, userId);
  return {
    diskBytes: userDiskBytes(db, userId),
    diskLimitBytes: config.userQuotaBytes || null,
    freeRender: {
      secondsPerDay: config.renderSecondsPerDay || null,
      secondsLeft: free === Infinity ? null : Math.round(free),
    },
    fastRender: {
      pricePerHourBdt: config.renderHourPriceBdt,
      maxHours: config.renderHoursMaxPerOrder,
      secondsLeft: fastSecondsLeft(db, userId),
      paymentsEnabled: !!config.payments,
    },
  };
}

/** Plain-language account usage for the agent (system prompt + the account_usage tool). */
export function describeUsage(db: DB, userId: string): string {
  const u = usageFor(db, userId);
  const usedFree = renderSecondsToday(db, userId);
  const free = u.freeRender.secondsPerDay
    ? `Free render time: ${fmtTime(usedFree)} used of ${fmtTime(u.freeRender.secondsPerDay)} in the last 24 hours, ${fmtTime(u.freeRender.secondsLeft ?? 0)} left (it refills continuously as old renders pass 24 hours).`
    : 'Free render time: unlimited.';
  const packs = db.select().from(renderBoosts).where(and(eq(renderBoosts.userId, userId), eq(renderBoosts.status, 'paid'))).all();
  const bought = packs.reduce((s, p) => s + p.seconds, 0);
  const fast = bought
    ? `Fast render hours: ${fmtTime(u.fastRender.secondsLeft)} left of ${fmtTime(bought)} bought (never expire).`
    : `Fast render hours: none bought yet (${u.fastRender.pricePerHourBdt} BDT per hour${u.fastRender.paymentsEnabled ? ', offer_render_hours shows a buy card' : ''}).`;
  const disk = u.diskLimitBytes ? `Storage: ${fmtGb(u.diskBytes)} of ${fmtGb(u.diskLimitBytes)} used.` : `Storage: ${fmtGb(u.diskBytes)} used.`;
  return `${free}\n${fast}\n${disk}`;
}
