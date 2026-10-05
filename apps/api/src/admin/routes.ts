// Admin panel API (/admin in the app). Admins = ADMIN_EMAILS. Read-mostly: live renders and agent runs, workers,
// sales (PayStation), users, and a few actions (grant fast hours, re-check a payment, suspend/restore a user).
import fs from 'node:fs';
import { and, desc, eq, gte, inArray, isNull, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../app.js';
import { authUser, requireAuth } from '../auth/plugin.js';
import { deleteUserSessions } from '../auth/service.js';
import { settleInvoice } from '../billing/routes.js';
import { grantAddon, hasAddon } from '../billing/addons.js';
import { newId } from '../util/id.js';
import { grantBoost } from '../cli/commands.js';
import { config } from '../config.js';
import { addonPurchases, projects, renderBoosts, renderJobs, renders, renderWorkers, runs, users } from '../db/schema.js';
import { forbidden, notFound } from '../http/errors.js';
import { parse } from '../http/validate.js';
import { fastSecondsLeft, renderSecondsToday } from '../quota/service.js';

const DAY = 86_400_000;

export const isAdmin = (email: string) => config.adminEmails.has(email.toLowerCase());

async function requireAdmin(req: FastifyRequest) {
  if (!isAdmin(authUser(req).email)) throw forbidden('Admins only');
}

export async function adminRoutes(app: FastifyInstance, ctx: AppContext) {
  const { db } = ctx;
  const admin = { preHandler: [requireAuth, requireAdmin] };

  app.get('/admin/overview', admin, async () => {
    const now = Date.now();
    const email = new Map(db.select({ id: users.id, email: users.email }).from(users).all().map((u) => [u.id, u.email]));
    const title = new Map(db.select({ id: projects.id, title: projects.title }).from(projects).all().map((p) => [p.id, p.title]));
    const onlineSince = now - config.workerOnlineS * 1000;
    const workers = db.select().from(renderWorkers).all();
    const workerName = new Map(workers.map((w) => [w.id, w.name]));

    // ---- renders ----
    const active = db.select().from(renderJobs).where(inArray(renderJobs.status, ['queued', 'running'])).orderBy(renderJobs.createdAt).all();
    const jobsToday = db.select({ status: renderJobs.status, pool: renderJobs.pool, startedAt: renderJobs.startedAt, finishedAt: renderJobs.finishedAt })
      .from(renderJobs).where(gte(renderJobs.createdAt, now - DAY)).all();
    const secs = (pool: string) => Math.round(jobsToday.filter((j) => j.pool === pool && j.startedAt).reduce((s, j) => s + ((j.finishedAt ?? now) - j.startedAt!) / 1000, 0));
    const failedRecent = db.select().from(renderJobs).where(and(eq(renderJobs.status, 'error'), gte(renderJobs.finishedAt, now - 7 * DAY))).orderBy(desc(renderJobs.finishedAt)).limit(10).all();

    // ---- sales ----
    const paidHours = db.select().from(renderBoosts).where(and(eq(renderBoosts.status, 'paid'), eq(renderBoosts.provider, 'paystation'))).all();
    const paidAddons = db.select().from(addonPurchases).where(and(eq(addonPurchases.status, 'paid'), eq(addonPurchases.provider, 'paystation'))).all();
    const paid = [
      ...paidHours.map((p) => ({ priceBdt: p.priceBdt, paidAt: p.paidAt, seconds: p.seconds })),
      ...paidAddons.map((p) => ({ priceBdt: p.priceBdt, paidAt: p.paidAt, seconds: 0 })),
    ];
    const sum = (since: number) => {
      const rows = paid.filter((p) => (p.paidAt ?? 0) >= since);
      return { amountBdt: rows.reduce((s, p) => s + p.priceBdt, 0), orders: rows.length, hours: rows.reduce((s, p) => s + p.seconds, 0) / 3600 };
    };
    const count = (status: string) => (db.select({ n: sql<number>`count(*)` }).from(renderBoosts).where(eq(renderBoosts.status, status)).get()?.n ?? 0)
      + (db.select({ n: sql<number>`count(*)` }).from(addonPurchases).where(eq(addonPurchases.status, status)).get()?.n ?? 0);
    const allPaid = db.select().from(renderBoosts).where(eq(renderBoosts.status, 'paid')).all();
    const recentPurchases = [
      ...db.select().from(renderBoosts).orderBy(desc(renderBoosts.createdAt)).limit(25).all().map((p) => ({ ...p, item: `${p.seconds / 3600} h fast render` })),
      ...db.select().from(addonPurchases).orderBy(desc(addonPurchases.createdAt)).limit(25).all().map((p) => ({ ...p, seconds: 0, item: p.addon === 'api' ? 'API add-on' : 'Source code add-on' })),
    ].sort((a, b) => b.createdAt - a.createdAt).slice(0, 30);
    const addonCounts = { api: paidAddons.filter((p) => p.addon === 'api').length, source: paidAddons.filter((p) => p.addon === 'source').length };

    // ---- users / usage ----
    const userRows = db.select({ id: users.id, banned: users.banned, createdAt: users.createdAt }).from(users).all();
    const runsToday = db.select({ projectId: runs.projectId }).from(runs).where(gte(runs.startedAt, now - DAY)).all();
    const projectOwner = new Map(db.select({ id: projects.id, userId: projects.userId }).from(projects).all().map((p) => [p.id, p.userId]));
    const activeUsers = new Set(runsToday.map((r) => projectOwner.get(r.projectId)).filter(Boolean));
    let disk: { totalBytes: number; freeBytes: number } | null = null;
    try {
      const st = fs.statfsSync(config.dataDir);
      disk = { totalBytes: st.blocks * st.bsize, freeBytes: st.bavail * st.bsize };
    } catch { /* not supported */ }

    return {
      now,
      renders: {
        running: active.filter((j) => j.status === 'running').length,
        queued: active.filter((j) => j.status === 'queued').length,
        active: active.map((j) => ({
          id: j.id, status: j.status, pool: j.pool, preset: j.preset, progress: j.progress / 10,
          user: email.get(j.userId) ?? '?', project: title.get(j.projectId) ?? '?', startedAt: j.startedAt, createdAt: j.createdAt,
          worker: j.workerId ? workerName.get(j.workerId) ?? j.workerId : null,
        })),
        last24h: {
          done: jobsToday.filter((j) => j.status === 'done').length,
          failed: jobsToday.filter((j) => j.status === 'error').length,
          freeHours: secs('local') / 3600,
          fastHours: secs('remote') / 3600,
        },
        totalDone: db.select({ n: sql<number>`count(*)` }).from(renders).get()?.n ?? 0,
        failedRecent: failedRecent.map((j) => ({ id: j.id, user: email.get(j.userId) ?? '?', project: title.get(j.projectId) ?? '?', error: (j.error ?? '').slice(0, 300), at: j.finishedAt })),
      },
      agents: { running: ctx.agent?.activeRuns().length ?? 0, runsLast24h: runsToday.length },
      cpu: ctx.cpu?.budget.status() ?? null,
      workers: workers.map((w) => ({ id: w.id, name: w.name, disabled: w.disabled, online: !w.disabled && (w.lastSeenAt ?? 0) >= onlineSince, lastSeenAt: w.lastSeenAt })),
      sales: {
        today: sum(now - DAY), last7d: sum(now - 7 * DAY), last30d: sum(now - 30 * DAY), allTime: sum(0),
        pending: count('pending'), failed: count('failed'),
        fastHoursOutstanding: allPaid.reduce((s, p) => s + (p.seconds - p.usedSeconds), 0) / 3600,
        paymentsEnabled: !!config.paystation,
        addonsSold: addonCounts,
        pricePerHourBdt: config.renderHourPriceBdt,
        recent: recentPurchases.map((p) => ({
          id: p.id, user: email.get(p.userId) ?? '?', item: p.item, hours: p.seconds / 3600, amountBdt: p.priceBdt, status: p.status, provider: p.provider,
          method: p.paymentMethod, invoice: p.invoiceNumber, trxId: p.paymentRef, createdAt: p.createdAt, paidAt: p.paidAt,
        })),
      },
      users: {
        total: userRows.length,
        banned: userRows.filter((u) => u.banned).length,
        new7d: userRows.filter((u) => u.createdAt >= now - 7 * DAY).length,
        active24h: activeUsers.size,
      },
      projects: { total: db.select({ n: sql<number>`count(*)` }).from(projects).where(isNull(projects.deletedAt)).get()?.n ?? 0 },
      disk,
    };
  });

  app.get('/admin/users', admin, async (req) => {
    const q = String((req.query as { q?: string }).q ?? '').trim().toLowerCase();
    const rows = db.select().from(users).orderBy(desc(users.createdAt)).all().filter((u) => !q || u.email.includes(q)).slice(0, 100);
    return {
      users: rows.map((u) => ({
        id: u.id, email: u.email, banned: u.banned, createdAt: u.createdAt,
        projects: db.select({ n: sql<number>`count(*)` }).from(projects).where(and(eq(projects.userId, u.id), isNull(projects.deletedAt))).get()?.n ?? 0,
        freeSecondsUsed24h: Math.round(renderSecondsToday(db, u.id)),
        fastSecondsLeft: fastSecondsLeft(db, u.id),
        addons: (['api', 'source'] as const).filter((a) => hasAddon(db, u.id, a)),
        spentBdt: (db.select({ s: sql<number>`coalesce(sum(${renderBoosts.priceBdt}), 0)` }).from(renderBoosts).where(and(eq(renderBoosts.userId, u.id), eq(renderBoosts.status, 'paid'))).get()?.s ?? 0)
          + (db.select({ s: sql<number>`coalesce(sum(${addonPurchases.priceBdt}), 0)` }).from(addonPurchases).where(and(eq(addonPurchases.userId, u.id), eq(addonPurchases.status, 'paid'))).get()?.s ?? 0),
      })),
    };
  });

  app.post('/admin/users/:id/grant-hours', admin, async (req) => {
    const { id } = req.params as { id: string };
    const { hours } = parse(z.object({ hours: z.number().positive().max(100) }), req.body);
    const u = db.select().from(users).where(eq(users.id, id)).get();
    if (!u) throw notFound('No such user');
    grantBoost(db, u.email, hours * 60);
    return { ok: true };
  });

  app.post('/admin/users/:id/grant-addon', admin, async (req) => {
    const { id } = req.params as { id: string };
    const { addon } = parse(z.object({ addon: z.enum(['api', 'source']) }), req.body);
    if (!db.select().from(users).where(eq(users.id, id)).get()) throw notFound('No such user');
    if (!hasAddon(db, id, addon)) grantAddon(db, id, addon, newId());
    return { ok: true };
  });

  app.post('/admin/users/:id/ban', admin, async (req) => {
    const { id } = req.params as { id: string };
    const { banned } = parse(z.object({ banned: z.boolean() }), req.body);
    const u = db.select().from(users).where(eq(users.id, id)).get();
    if (!u) throw notFound('No such user');
    db.update(users).set({ banned }).where(eq(users.id, id)).run();
    if (banned) deleteUserSessions(db, id);
    return { ok: true };
  });

  app.post('/admin/payments/:invoice/check', admin, async (req) => {
    const { invoice } = req.params as { invoice: string };
    const r = await settleInvoice(db, invoice);
    if (!r) throw notFound('No purchase with this invoice');
    return { status: r.status };
  });
}
