import fs from 'node:fs';
import http from 'node:http';
import { buildApp } from './app.js';
import { config } from './config.js';
import { RunRegistry } from './agent/registry.js';
import { createCpuBudget } from './cpu/index.js';
import { createDb, runMigrations } from './db/index.js';
import { logger } from './logger.js';
import { effectiveSandbox } from './runner/sandbox.js';

/**
 * Local development: when the preview origin is the same host on another port (http://localhost:8081),
 * accept it on a second listener that feeds the same Fastify instance. In production a reverse proxy
 * routes studio.<domain> and preview.<domain> to the one port, and Fastify tells them apart by Host.
 */
async function listenPreviewPort(app: Awaited<ReturnType<typeof buildApp>>) {
  const a = new URL(config.appOrigin);
  const p = new URL(config.previewOrigin);
  if (a.hostname !== p.hostname || a.port === p.port || !p.port) return null;
  await app.ready();
  const server = http.createServer((req, res) => app.routing(req, res));
  await new Promise<void>((resolve) => server.listen(Number(p.port), '0.0.0.0', resolve));
  logger.info({ port: p.port }, 'preview origin listening');
  return server;
}

async function main() {
  fs.mkdirSync(config.projectsDir, { recursive: true });
  const { db, sqlite } = createDb();
  runMigrations(db);

  logger.info({ isolation: effectiveSandbox().description }, 'agent command isolation');
  const cpu = createCpuBudget();
  const agent = new RunRegistry({ db, sqlite, cpu: cpu.budget }, sqlite);
  agent.resetStaleRuns();
  const app = await buildApp({ db, sqlite, cpu, agent });
  await app.listen({ port: config.port, host: '0.0.0.0' });
  const previewServer = await listenPreviewPort(app);

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'shutting down');
    previewServer?.close();
    await agent.stopAll();
    await app.close();
    cpu.stop();
    sqlite.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err) => {
  logger.error(err, 'fatal');
  process.exit(1);
});
