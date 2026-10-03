// Fast render hours: when today's free render time on this server is used up, a student can buy an hour on
// the fast remote render workers (RENDER_BOOST_PRICE_BDT, default 100 BDT). Payment processing is not built
// yet: POST creates a 'pending' purchase, and an operator marks it paid (`admin boost-paid <id>`) — the
// payment gateway's callback will do the same later. A paid pack also resets the daily allowance.
import { and, desc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../app.js';
import { authUser, requireAuth } from '../auth/plugin.js';
import { config } from '../config.js';
import { renderBoosts } from '../db/schema.js';
import { usageFor } from '../quota/service.js';
import { newId } from '../util/id.js';

export async function billingRoutes(app: FastifyInstance, ctx: AppContext) {
  const { db } = ctx;
  const auth = { preHandler: requireAuth };

  app.get('/billing/render-boost', auth, async (req) => {
    const user = authUser(req);
    const packs = db.select().from(renderBoosts).where(eq(renderBoosts.userId, user.id)).orderBy(desc(renderBoosts.createdAt)).limit(10).all();
    return { ...usageFor(db, user.id).fastRender, packs: packs.map((p) => ({ id: p.id, status: p.status, seconds: p.seconds, usedSeconds: p.usedSeconds, priceBdt: p.priceBdt, createdAt: p.createdAt, paidAt: p.paidAt })) };
  });

  app.post('/billing/render-boost', auth, async (req) => {
    const user = authUser(req);
    const pending = db.select().from(renderBoosts).where(and(eq(renderBoosts.userId, user.id), eq(renderBoosts.status, 'pending'))).get();
    const id = pending?.id ?? newId();
    if (!pending) db.insert(renderBoosts).values({ id, userId: user.id, seconds: config.renderBoostSeconds, priceBdt: config.renderBoostPriceBdt }).run();
    return {
      id,
      status: 'pending',
      priceBdt: config.renderBoostPriceBdt,
      message: 'Online payment is coming soon. Your request is saved — the Lumademy team will activate your fast render hour once you have paid.',
    };
  });
}
