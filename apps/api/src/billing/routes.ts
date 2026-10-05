// Fast render hours, paid through PayStation (docs/payments.md).
//   GET  /api/billing/render-hours              quotas + recent purchases
//   POST /api/billing/render-hours              { hours, phone, returnTo? } → { paymentUrl }  (browser goes there)
//   GET  /api/billing/paystation/callback       PayStation sends the browser back here → verify → redirect into the app
//   POST /api/billing/paystation/ipn            PayStation's server-to-server notification (successes) → verify → credit
// Crediting is idempotent (pending → paid happens once) and always re-checked with PayStation's status API.
import crypto from 'node:crypto';
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
import { initiatePayment, PayStationError, transactionStatus } from './paystation.js';
import { ADDONS, addonsFor, hasAddon, type AddonId } from './addons.js';

/** BD mobile number → 01XXXXXXXXX, or null. */
export function normalizeBdPhone(input: string): string | null {
  const digits = input.replace(/[^\d]/g, '').replace(/^880/, '').replace(/^(?=1)/, '0');
  return /^01[3-9]\d{8}$/.test(digits) ? digits : null;
}

/** Only paths inside the app (never another site). */
const safeReturn = (p?: string | null) => (p && /^\/(projects\/[A-Za-z0-9_-]+|settings(\/[a-z]+)?)$/.test(p) ? p : '/settings/account');

/** Unique, numeric-looking invoice number (PayStation rejects duplicates with 1008). */
const newInvoice = () => `${Date.now()}${crypto.randomInt(100, 999)}`;

type Settled = 'paid' | 'pending' | 'failed';

/** Re-checks an invoice with PayStation and credits it once (render hours or an add-on). Safe to call any number of times. */
export async function settleInvoice(db: DB, invoiceNumber: string): Promise<{ status: Settled; returnTo: string | null; kind: 'hours' | 'addon' } | null> {
  const boost = db.select().from(renderBoosts).where(eq(renderBoosts.invoiceNumber, invoiceNumber)).get();
  const addon = boost ? null : db.select().from(addonPurchases).where(eq(addonPurchases.invoiceNumber, invoiceNumber)).get();
  const row = boost ?? addon;
  if (!row) return null;
  const done = (status: Settled) => ({ status, returnTo: row.returnTo, kind: boost ? 'hours' as const : 'addon' as const });
  if (row.status === 'paid') return done('paid');
  if (row.status !== 'pending') return done('failed');
  const trx = await transactionStatus(invoiceNumber);
  if (trx.status === 'success') {
    if (trx.amount == null || Math.round(trx.amount) < row.priceBdt) {
      logger.error({ invoiceNumber, expected: row.priceBdt, got: trx.amount }, 'paystation amount mismatch — not credited');
      return done('failed');
    }
    // pending → paid exactly once, even if the callback and the IPN arrive together
    const set = { status: 'paid', paidAt: Date.now(), paymentRef: trx.trxId, paymentMethod: trx.method };
    if (boost) db.update(renderBoosts).set(set).where(and(eq(renderBoosts.id, boost.id), eq(renderBoosts.status, 'pending'))).run();
    else db.update(addonPurchases).set(set).where(and(eq(addonPurchases.id, addon!.id), eq(addonPurchases.status, 'pending'))).run();
    logger.info({ invoiceNumber, item: boost ? `${boost.seconds / 3600}h fast render` : `addon ${addon!.addon}`, method: trx.method }, 'paystation payment credited');
    return done('paid');
  }
  if (trx.status === 'failed' || trx.status === 'refund') {
    if (boost) db.update(renderBoosts).set({ status: 'failed' }).where(and(eq(renderBoosts.id, boost.id), eq(renderBoosts.status, 'pending'))).run();
    else db.update(addonPurchases).set({ status: 'failed' }).where(and(eq(addonPurchases.id, addon!.id), eq(addonPurchases.status, 'pending'))).run();
    return done('failed');
  }
  return done('pending'); // processing / not visible yet
}

export async function billingRoutes(app: FastifyInstance, ctx: AppContext) {
  const { db } = ctx;
  const auth = { preHandler: requireAuth };

  app.get('/billing/render-hours', auth, async (req) => {
    const user = authUser(req);
    const packs = db.select().from(renderBoosts).where(eq(renderBoosts.userId, user.id)).orderBy(desc(renderBoosts.createdAt)).limit(10).all();
    return {
      ...usageFor(db, user.id),
      purchases: packs.map((p) => ({ id: p.id, status: p.status, hours: p.seconds / 3600, usedSeconds: p.usedSeconds, priceBdt: p.priceBdt, method: p.paymentMethod, createdAt: p.createdAt, paidAt: p.paidAt })),
    };
  });

  app.post('/billing/render-hours', { ...auth, config: config.rateLimitDisabled ? {} : { rateLimit: { max: 10, timeWindow: '10 minutes' } } }, async (req) => {
    const user = authUser(req);
    const body = parse(z.object({
      hours: z.number().int().min(1).max(config.renderHoursMaxPerOrder),
      phone: z.string().trim().min(6).max(20),
      returnTo: z.string().max(200).optional(),
    }), req.body);
    const phone = normalizeBdPhone(body.phone);
    if (!phone) throw badRequest('Enter a Bangladeshi mobile number, e.g. 01712345678');
    if (!config.paystation) throw new HttpError(503, 'payments_off', 'Online payment is not set up yet. Please contact Lumademy support.');
    const invoiceNumber = newInvoice();
    const priceBdt = body.hours * config.renderHourPriceBdt;
    const id = newId();
    db.insert(renderBoosts).values({
      id, userId: user.id, seconds: body.hours * 3600, priceBdt, status: 'pending', provider: 'paystation', invoiceNumber, returnTo: safeReturn(body.returnTo),
    }).run();
    try {
      const paymentUrl = await initiatePayment({
        invoiceNumber,
        amountBdt: priceBdt,
        customer: { name: user.email.split('@')[0]!.slice(0, 60), email: user.email, phone },
        callbackUrl: `${config.appOrigin}/api/billing/paystation/callback?invoice=${invoiceNumber}`,
        reference: `Luma Studio fast render ${body.hours}h`,
        items: [{ name: 'Fast render hour', quantity: body.hours, unitPriceBdt: config.renderHourPriceBdt }],
      });
      return { paymentUrl, invoiceNumber, priceBdt };
    } catch (e) {
      db.update(renderBoosts).set({ status: 'cancelled' }).where(eq(renderBoosts.id, id)).run();
      if (e instanceof PayStationError) throw new HttpError(502, 'payment_gateway', e.message);
      throw e;
    }
  });

  // ---------------- add-ons (one-time) ----------------
  app.get('/billing/addons', auth, async (req) => ({ addons: addonsFor(db, authUser(req).id) }));

  app.post('/billing/addons/:addon', { ...auth, config: config.rateLimitDisabled ? {} : { rateLimit: { max: 10, timeWindow: '10 minutes' } } }, async (req) => {
    const user = authUser(req);
    const { addon } = req.params as { addon: string };
    const info = ADDONS[addon as AddonId];
    if (!info) throw badRequest('Unknown add-on');
    if (hasAddon(db, user.id, addon as AddonId)) throw new HttpError(409, 'owned', 'You already have this add-on.');
    const body = parse(z.object({ phone: z.string().trim().min(6).max(20), returnTo: z.string().max(200).optional() }), req.body);
    const phone = normalizeBdPhone(body.phone);
    if (!phone) throw badRequest('Enter a Bangladeshi mobile number, e.g. 01712345678');
    if (!config.paystation) throw new HttpError(503, 'payments_off', 'Online payment is not set up yet. Please contact Lumademy support.');
    const invoiceNumber = newInvoice();
    const priceBdt = info.priceBdt();
    const id = newId();
    db.insert(addonPurchases).values({ id, userId: user.id, addon, priceBdt, invoiceNumber, returnTo: safeReturn(body.returnTo) }).run();
    try {
      const paymentUrl = await initiatePayment({
        invoiceNumber,
        amountBdt: priceBdt,
        customer: { name: user.email.split('@')[0]!.slice(0, 60), email: user.email, phone },
        callbackUrl: `${config.appOrigin}/api/billing/paystation/callback?invoice=${invoiceNumber}`,
        reference: `Luma Studio add-on: ${info.name}`,
        items: [{ name: info.name, quantity: 1, unitPriceBdt: priceBdt }],
      });
      return { paymentUrl, invoiceNumber, priceBdt };
    } catch (e) {
      db.update(addonPurchases).set({ status: 'cancelled' }).where(eq(addonPurchases.id, id)).run();
      if (e instanceof PayStationError) throw new HttpError(502, 'payment_gateway', e.message);
      throw e;
    }
  });

  /** The browser comes back from PayStation. Never trusted: the invoice is re-checked server to server. */
  app.get('/billing/paystation/callback', async (req, reply) => {
    const q = req.query as Record<string, string | undefined>;
    const invoice = q.invoice ?? q.invoice_number ?? '';
    let status: Settled = 'failed';
    let returnTo = '/settings/account';
    try {
      const r = invoice ? await settleInvoice(db, invoice) : null;
      if (r) {
        status = r.status;
        returnTo = safeReturn(r.returnTo);
      }
    } catch (e) {
      logger.warn({ err: e, invoice }, 'paystation callback check failed');
      status = 'pending'; // the IPN will settle it
    }
    return reply.redirect(`${returnTo}?payment=${status}`);
  });

  /** PayStation IPN (successes only, may be retried). 200 = acknowledged. */
  app.post('/billing/paystation/ipn', async (req, reply) => {
    const body = (req.body ?? {}) as { invoice_number?: string; trx_status?: string };
    const invoice = String(body.invoice_number ?? '');
    if (!invoice) return reply.code(400).send({ status: 'error' });
    const r = await settleInvoice(db, invoice);
    if (!r) return reply.code(404).send({ status: 'error' });
    if (r.status === 'pending') return reply.code(503).send({ status: 'retry' }); // not visible yet: let them retry
    return { status: 'success' };
  });
}
