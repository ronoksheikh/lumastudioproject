import fs from 'node:fs';
import path from 'node:path';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyBaseLogger, type FastifyInstance, type FastifyRequest } from 'fastify';
import { agentRoutes } from './agent/routes.js';
import type { RunRegistry } from './agent/registry.js';
import { authRoutes } from './auth/routes.js';
import { provisionRoutes } from './auth/provision.js';
import { registerAuth } from './auth/plugin.js';
import { config } from './config.js';
import type { DB } from './db/index.js';
import { registerErrorHandler } from './http/error-handler.js';
import { logger } from './logger.js';
import { previewRoutes } from './preview/routes.js';
import { projectRoutes } from './projects/routes.js';
import { providerRoutes } from './providers/routes.js';
import { healthRoutes } from './routes/health.js';
import { metricsRoutes } from './routes/metrics.js';
import { settingsRoutes } from './settings/routes.js';
import { uploadRoutes } from './uploads/routes.js';
import { billingRoutes } from './billing/routes.js';
import { workerRoutes } from './render/workers.js';

export interface AppContext {
  db: DB;
  sqlite: import('better-sqlite3').Database;
  /** heavy-job gate; optional so tests can build the app without timers */
  cpu?: ReturnType<typeof import('./cpu/index.js').createCpuBudget>;
  /** agent runs; created in index.ts (tests inject their own) */
  agent?: RunRegistry;
  /** render queue; created in index.ts */
  render?: import('./render/service.js').RenderQueue;
}

const hostOf = (origin: string) => new URL(origin).host.toLowerCase();

/** The host the browser used (honours X-Forwarded-Host behind Caddy/Traefik). */
function requestHost(req: FastifyRequest): string {
  const fwd = req.headers['x-forwarded-host'];
  return (typeof fwd === 'string' ? fwd.split(',')[0]!.trim() : (req.headers.host ?? '')).toLowerCase();
}

export async function buildApp(ctx: AppContext) {
  const appHost = hostOf(config.appOrigin);
  const previewHost = hostOf(config.previewOrigin);
  if (appHost === previewHost && config.isProd) throw new Error('PREVIEW_ORIGIN must be a different origin from APP_ORIGIN (project code runs there)');

  const app: FastifyInstance = Fastify({ loggerInstance: logger as unknown as FastifyBaseLogger, trustProxy: true, bodyLimit: 5 * 1024 * 1024, routerOptions: { maxParamLength: 500 } });
  // a POST with `content-type: application/json` and no body (e.g. fetch(url, {method:'POST'})) is just {}
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
    if (!body || !String(body).trim()) return done(null, {});
    try {
      done(null, JSON.parse(String(body)));
    } catch {
      done(Object.assign(new Error('Request body is not valid JSON'), { statusCode: 400 }), undefined);
    }
  });
  await app.register(cookie);
  await app.register(rateLimit, { global: false, keyGenerator: (req) => req.ip });
  registerErrorHandler(app);

  // Two origins, one process: project code is only ever served from the preview origin, the app/API only from the app origin.
  app.addHook('onRequest', async (req, reply) => {
    const isPreviewPath = req.url.startsWith('/p/');
    const isPreviewHost = appHost !== previewHost && requestHost(req) === previewHost;
    if (req.url === '/api/health') return; // container healthcheck, any host
    if (isPreviewHost !== isPreviewPath) return reply.code(404).send({ error: { code: 'not_found', message: 'Not found' } });
  });
  registerAuth(app, ctx.db);

  await app.register(
    async (api) => {
      await healthRoutes(api, ctx);
      await metricsRoutes(api, ctx);
      await authRoutes(api, ctx);
      await provisionRoutes(api, ctx);
      await projectRoutes(api, ctx);
      await providerRoutes(api, ctx);
      await settingsRoutes(api, ctx);
      await uploadRoutes(api, ctx);
      await billingRoutes(api, ctx);
      await workerRoutes(api, ctx);
      if (ctx.agent) await agentRoutes(api, ctx);
    },
    { prefix: '/api' },
  );
  await previewRoutes(app, ctx);

  // Built React SPA (apps/web/dist). Unknown non-API GETs fall back to index.html.
  const hasSpa = fs.existsSync(path.join(config.webDist, 'index.html'));
  if (hasSpa) await app.register(fastifyStatic, { root: config.webDist, wildcard: false });
  else logger.warn({ webDist: config.webDist }, 'SPA build not found — serving API only');
  app.setNotFoundHandler((req, reply) => {
    if (hasSpa && req.method === 'GET' && !req.url.startsWith('/api/') && !req.url.startsWith('/p/')) return reply.sendFile('index.html');
    return reply.code(404).send({ error: { code: 'not_found', message: 'Not found' } });
  });
  return app;
}
