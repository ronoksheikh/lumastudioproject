import fs from 'node:fs';
import { buildApp } from './app.js';
import { config } from './config.js';
import { createCpuBudget } from './cpu/index.js';
import { createDb, runMigrations } from './db/index.js';
import { logger } from './logger.js';
import { effectiveSandbox } from './runner/sandbox.js';

async function main() {
  fs.mkdirSync(config.projectsDir, { recursive: true });
  const { db, sqlite } = createDb();
  runMigrations(db);

  logger.info({ isolation: effectiveSandbox().description }, 'agent command isolation');
  const cpu = createCpuBudget();
  const app = await buildApp({ db, sqlite, cpu });
  await app.listen({ port: config.port, host: '0.0.0.0' });

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'shutting down');
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
