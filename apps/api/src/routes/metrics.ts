import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../app.js';
import { config } from '../config.js';
import { renderJobs } from '../db/schema.js';
import { renderMetrics } from '../observability/metrics.js';
import { safeEqual } from '../security/crypto.js';

/** Prometheus text, behind a bearer token. Without METRICS_TOKEN the route does not exist. */
export async function metricsRoutes(app: FastifyInstance, ctx: AppContext) {
  if (!config.metricsToken) return;
  app.get('/metrics', async (req, reply) => {
    const header = String(req.headers.authorization ?? '');
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!token || !safeEqual(token, config.metricsToken!)) return reply.code(401).send({ error: { code: 'unauthorized', message: 'Bad metrics token' } });
    const cpu = ctx.cpu?.budget.status();
    const count = (status: string) => ctx.db.select({ id: renderJobs.id }).from(renderJobs).where(eq(renderJobs.status, status)).all().length;
    const text = renderMetrics({
      luma_cpu_usage_ratio: cpu?.usage ?? 0,
      luma_heavy_jobs_running: cpu?.running ?? 0,
      luma_heavy_jobs_queued: cpu?.queued ?? 0,
      luma_render_jobs_queued: count('queued'),
      luma_render_jobs_running: count('running'),
      luma_process_uptime_seconds: Math.round(process.uptime()),
    });
    return reply.header('Content-Type', 'text/plain; version=0.0.4').send(text);
  });
}
