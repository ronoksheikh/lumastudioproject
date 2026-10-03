import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../app.js';

const startedAt = Date.now();

export async function healthRoutes(app: FastifyInstance, ctx: AppContext) {
  app.get('/health', async (_req, reply) => {
    try {
      const row = ctx.sqlite.prepare('select count(*) as n from __drizzle_migrations').get() as { n: number };
      return {
        ok: true,
        uptimeS: Math.round((Date.now() - startedAt) / 1000),
        migrations: row.n,
        ...(ctx.cpu ? { cpu: { source: ctx.cpu.sampler.name, ...ctx.cpu.budget.status() } } : {}),
      };
    } catch (err) {
      return reply.code(503).send({ ok: false, error: (err as Error).message });
    }
  });
}
