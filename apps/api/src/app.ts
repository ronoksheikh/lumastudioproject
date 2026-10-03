import fs from 'node:fs';
import path from 'node:path';
import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import Fastify from 'fastify';
import { config } from './config.js';
import type { DB } from './db/index.js';
import { logger } from './logger.js';
import { healthRoutes } from './routes/health.js';

export interface AppContext {
  db: DB;
  sqlite: import('better-sqlite3').Database;
}

export async function buildApp(ctx: AppContext) {
  const app = Fastify({ loggerInstance: logger, trustProxy: true, bodyLimit: 5 * 1024 * 1024 });
  await app.register(cookie);

  await app.register(async (api) => {
    await healthRoutes(api, ctx);
  }, { prefix: '/api' });

  // Built React SPA (apps/web/dist). Unknown non-API paths fall back to index.html.
  if (fs.existsSync(path.join(config.webDist, 'index.html'))) {
    await app.register(fastifyStatic, { root: config.webDist, wildcard: false });
    app.setNotFoundHandler((req, reply) => {
      if (req.method === 'GET' && !req.url.startsWith('/api/')) return reply.sendFile('index.html');
      return reply.code(404).send({ error: 'not_found' });
    });
  } else {
    logger.warn({ webDist: config.webDist }, 'SPA build not found — serving API only');
  }
  return app;
}
