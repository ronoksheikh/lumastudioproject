// The payment API sends no notification: a student who pays and then closes the tab never hits /billing/return.
// So pending purchases are re-checked here — every few minutes in the background, and whenever a student opens
// their purchases — for up to two days after they were started.
import { and, eq, gt, lt, not, like } from 'drizzle-orm';
import { config } from '../config.js';
import type { DB } from '../db/index.js';
import { addonPurchases, renderBoosts } from '../db/schema.js';
import { logger } from '../logger.js';
import { GATEWAY, settleInvoice } from './routes.js';

const WINDOW_MS = 48 * 3_600_000;
const MIN_AGE_MS = 60_000; // give the student a minute to reach the checkout first

function pendingInvoices(db: DB, userId?: string): string[] {
  const now = Date.now();
  const cond = (t: typeof renderBoosts | typeof addonPurchases) => and(
    eq(t.status, 'pending'),
    eq(t.provider, GATEWAY),
    gt(t.createdAt, now - WINDOW_MS),
    lt(t.createdAt, now - (userId ? 0 : MIN_AGE_MS)),
    not(like(t.invoiceNumber, 'tmp-%')),
    ...(userId ? [eq(t.userId, userId)] : []),
  );
  const a = db.select({ inv: renderBoosts.invoiceNumber }).from(renderBoosts).where(cond(renderBoosts)).limit(userId ? 3 : 50).all();
  const b = db.select({ inv: addonPurchases.invoiceNumber }).from(addonPurchases).where(cond(addonPurchases)).limit(userId ? 3 : 50).all();
  return [...a, ...b].map((r) => r.inv).filter((x): x is string => !!x);
}

async function settleAll(db: DB, invoices: string[]) {
  for (const inv of invoices) {
    try {
      await settleInvoice(db, inv);
    } catch (e) {
      logger.warn({ err: e, invoice: inv }, 'payment re-check failed');
    }
  }
}

/** A student's own recent pending purchases (called when they open their purchases). Never throws. */
export async function settlePendingFor(db: DB, userId: string) {
  if (!config.payments) return;
  await settleAll(db, pendingInvoices(db, userId));
}

/** Background re-check every 3 minutes. Returns a stop function. */
export function startPaymentReconcile(db: DB) {
  if (!config.payments) return () => {};
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      await settleAll(db, pendingInvoices(db));
    } finally {
      busy = false;
    }
  };
  const t = setInterval(() => void tick(), 3 * 60_000);
  t.unref();
  return () => clearInterval(t);
}

