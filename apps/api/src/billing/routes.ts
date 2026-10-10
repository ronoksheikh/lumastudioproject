// Fast render hours and add-ons, paid through Lumademy's payment API (billing/gateway.ts, docs/payments.md).
//   GET  /api/billing/render-hours              quotas + recent purchases
//   POST /api/billing/render-hours              { hours, phone, method, returnTo? } → { paymentUrl }  (browser goes there)
//   POST /api/billing/addons/:addon             { phone, method, returnTo? } → { paymentUrl }
//   GET  /api/billing/return                    the browser comes back here after paying → verify → redirect into the app
// There is no server-to-server notification: the return page, a background re-check (reconcile.ts) and the admin
// "re-check" all settle a purchase with settleInvoice, which asks the payment API for the verified status.
import { and, desc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../app.js';
import { authUser, requireAuth } from '../auth/plugin.js';
import { config } from '../config.js';
import type { DB } from '../db/index.js';
import { addonPurchases, renderBoosts } from '../db/schema.js';
import { HttpError, badRequest } from '../http/errors.js';
import { parse } from '../http/validate.js';
import { logger } from '../logger.js';
import { usageFor } from '../quota/service.js';
import { newId } from '../util/id.js';
import { createCheckout, methodLabel, PaymentError, paymentStatus, type PayMethod } from './gateway.js';
import { ADDONS, addonsFor, hasAddon, type AddonId } from './addons.js';
import { settlePendingFor } from './reconcile.js';

/** provider value of purchases made through the payment API */
export const GATEWAY = 'gateway';

/** BD mobile number → 01XXXXXXXXX, or null. */
export function normalizeBdPhone(input: string): string | null {
  const digits = input.replace(/[^\d]/g, '').replace(/^880/, '').replace(/^(?=1)/, '0');
  return /^01[3-9]\d{8}$/.test(digits) ? digits : null;
}

/** Only paths inside the app (never another site). */
const safeReturn = (p?: string | null) => (p && /^\/(projects\/[A-Za-z0-9_-]+|settings(\/[a-z]+)?)$/.test(p) ? p : '/settings/account');

/** A unique placeholder until the payment API gives us its transaction id. */
const tempInvoice = () => `tmp-${newId()}`;

type Settled = 'paid' | 'pending' | 'failed';

/**
 * Asks the payment API for the verified status of a purchase (by its merchantTransactionId, stored as invoiceNumber)
 * and credits it once (render hours or an add-on). Safe to call any number of times.
 */
export async function settleInvoice(db: DB, invoiceNumber: string): Promise<{ status: Settled; returnTo: string | null; kind: 'hours' | 'addon' } | null> {
  const boost = db.select().from(renderBoosts).where(eq(renderBoosts.invoiceNumber, invoiceNumber)).get();
  const addon = boost ? null : db.select().from(addonPurchases).where(eq(addonPurchases.invoiceNumber, invoiceNumber)).get();
  const row = boost ?? addon;
  if (!row) return null;
  const done = (status: Settled) => ({ status, returnTo: row.returnTo, kind: boost ? 'hours' as const : 'addon' as const });
  if (row.status === 'paid') return done('paid');
  if (row.status !== 'pending' || invoiceNumber.startsWith('tmp-')) return done(row.status === 'pending' ? 'pending' : 'failed');
  const pay = await paymentStatus(invoiceNumber);
  const markFailed = () => {
    if (boost) db.update(renderBoosts).set({ status: 'failed' }).where(and(eq(renderBoosts.id, boost.id), eq(renderBoosts.status, 'pending'))).run();
    else db.update(addonPurchases).set({ status: 'failed' }).where(and(eq(addonPurchases.id, addon!.id), eq(addonPurchases.status, 'pending'))).run();
  };
  if (pay.status === 'success') {
    if (pay.amount == null || Math.round(pay.amount) < row.priceBdt) {
      logger.error({ invoiceNumber, expected: row.priceBdt, got: pay.amount }, 'payment amount mismatch — not credited');
      markFailed();
      return done('failed');
    }
    // pending → paid exactly once, even if the return page and the background check arrive together
    const set = { status: 'paid', paidAt: Date.now(), paymentRef: pay.orderId ?? invoiceNumber };
    if (boost) db.update(renderBoosts).set(set).where(and(eq(renderBoosts.id, boost.id), eq(renderBoosts.status, 'pending'))).run();
    else db.update(addonPurchases).set(set).where(and(eq(addonPurchases.id, addon!.id), eq(addonPurchases.status, 'pending'))).run();
    logger.info({ invoiceNumber, item: boost ? `${boost.seconds / 3600}h fast render` : `addon ${addon!.addon}`, method: row.paymentMethod }, 'payment credited');
    return done('paid');
  }
  if (pay.status === 'failed' || pay.status === 'not_found') {
    logger.info({ invoiceNumber, status: pay.raw }, 'payment not completed');
    markFailed();
    return done('failed');
  }
  return done('pending'); // not finished yet, or the check is unavailable right now
}

const startBody = (extra: z.ZodRawShape = {}) => z.object({
  ...extra,
  phone: z.string().trim().min(6).max(20),
  method: z.enum(['bkash', 'other']).default('bkash'),
  returnTo: z.string().max(200).optional(),
});

export async function billingRoutes(app: FastifyInstance, ctx: AppContext) {
  const { db } = ctx;
  const auth = { preHandler: requireAuth };

  app.get('/billing/render-hours', auth, async (req) => {
    const user = authUser(req);
    await settlePendingFor(db, user.id);
    const packs = db.select().from(renderBoosts).where(eq(renderBoosts.userId, user.id)).orderBy(desc(renderBoosts.createdAt)).limit(10).all();
    return {
      ...usageFor(db, user.id),
      purchases: packs.map((p) => ({ id: p.id, status: p.status, hours: p.seconds / 3600, usedSeconds: p.usedSeconds, priceBdt: p.priceBdt, method: p.paymentMethod, createdAt: p.createdAt, paidAt: p.paidAt })),
    };
  });

  /** Creates the purchase row, starts the checkout and stores the payment API's transaction id on the row. */
  async function startPayment(req: import('fastify').FastifyRequest, opts: {
    table: typeof renderBoosts | typeof addonPurchases;
    id: string;
    priceBdt: number;
    method: PayMethod;
    phone: string;
  }) {
    const user = authUser(req);
    try {
      const c = await createCheckout({
        amountBdt: opts.priceBdt,
        method: opts.method,
        customer: { name: user.email.split('@')[0]!.slice(0, 60) || 'Luma Studio student', email: user.email, phone: opts.phone },
        returnUrl: `${config.appOrigin.replace(/\/+$/, '')}/api/billing/return`,
      });
      db.update(opts.table).set({ invoiceNumber: c.merchantTransactionId }).where(eq(opts.table.id, opts.id)).run();
      return { paymentUrl: c.redirectUrl, invoiceNumber: c.merchantTransactionId, priceBdt: opts.priceBdt };
    } catch (e) {
      db.update(opts.table).set({ status: 'cancelled' }).where(eq(opts.table.id, opts.id)).run();
      if (e instanceof PaymentError) throw new HttpError(502, 'payment_gateway', e.message);
      throw e;
    }
  }

  const checkPhone = (raw: string) => {
    const phone = normalizeBdPhone(raw);
    if (!phone) throw badRequest('Enter a Bangladeshi mobile number, e.g. 01712345678');
    if (!config.payments) throw new HttpError(503, 'payments_off', 'Online payment is not set up yet. Please contact Lumademy support.');
    return phone;
  };

  app.post('/billing/render-hours', { ...auth, config: config.rateLimitDisabled ? {} : { rateLimit: { max: 10, timeWindow: '10 minutes' } } }, async (req) => {
    const user = authUser(req);
    const body = parse(startBody({ hours: z.number().int().min(1).max(config.renderHoursMaxPerOrder) }), req.body) as { hours: number; phone: string; method: PayMethod; returnTo?: string };
    const phone = checkPhone(body.phone);
    const priceBdt = body.hours * config.renderHourPriceBdt;
    const id = newId();
    db.insert(renderBoosts).values({
      id, userId: user.id, seconds: body.hours * 3600, priceBdt, status: 'pending', provider: GATEWAY, invoiceNumber: tempInvoice(), paymentMethod: methodLabel(body.method), returnTo: safeReturn(body.returnTo),
    }).run();
    return startPayment(req, { table: renderBoosts, id, priceBdt, method: body.method, phone });
  });

  // ---------------- add-ons (one-time) ----------------
  app.get('/billing/addons', auth, async (req) => ({ addons: addonsFor(db, authUser(req).id) }));

  app.post('/billing/addons/:addon', { ...auth, config: config.rateLimitDisabled ? {} : { rateLimit: { max: 10, timeWindow: '10 minutes' } } }, async (req) => {
    const user = authUser(req);
    const { addon } = req.params as { addon: string };
    const info = ADDONS[addon as AddonId];
    if (!info) throw badRequest('Unknown add-on');
    if (hasAddon(db, user.id, addon as AddonId)) throw new HttpError(409, 'owned', 'You already have this add-on.');
    const body = parse(startBody(), req.body) as { phone: string; method: PayMethod; returnTo?: string };
    const phone = checkPhone(body.phone);
    const priceBdt = info.priceBdt();
    const id = newId();
    db.insert(addonPurchases).values({ id, userId: user.id, addon, priceBdt, provider: GATEWAY, invoiceNumber: tempInvoice(), paymentMethod: methodLabel(body.method), returnTo: safeReturn(body.returnTo) }).run();
    return startPayment(req, { table: addonPurchases, id, priceBdt, method: body.method, phone });
  });

  /**
   * The browser comes back after paying (?merchantTransactionId=…&paymentStatus=…). The query is editable, so it only
   * says WHICH purchase to check: the status comes from the payment API. Then back into the app.
   */
  app.get('/billing/return', async (req, reply) => {
    const q = req.query as Record<string, string | undefined>;
    const invoice = String(q.merchantTransactionId ?? '').slice(0, 80);
    let status: Settled = 'pending';
    let returnTo = '/settings/account';
    try {
      const r = invoice ? await settleInvoice(db, invoice) : null;
      if (r) {
        status = r.status;
        returnTo = safeReturn(r.returnTo);
      } else status = 'failed';
    } catch (e) {
      logger.warn({ err: e, invoice }, 'payment return check failed');
      status = 'pending'; // the background check settles it
    }
    return reply.redirect(`${returnTo}?payment=${status}`);
  });
}
