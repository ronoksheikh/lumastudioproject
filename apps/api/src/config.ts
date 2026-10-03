import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';

const num = (def: number) => z.coerce.number().default(def);

const schema = z.object({
  NODE_ENV: z.string().default('development'),
  PORT: num(8080),
  DATA_DIR: z.string().default(path.resolve(process.cwd(), '../../data')),
  DB_PATH: z.string().optional(),
  MASTER_KEY: z.string().optional(),
  SESSION_SECRET: z.string().optional(),
  APP_ORIGIN: z.string().default('http://localhost:8080'),
  PREVIEW_ORIGIN: z.string().default('http://localhost:8081'),
  CPU_BUDGET: num(0.9),
  MAX_RENDER_WORKERS: z.coerce.number().optional(),
  CMD_TIMEOUT_S: num(120),
  LOG_LEVEL: z.string().default('info'),
  /** Where the built SPA lives (apps/web/dist). */
  WEB_DIST: z.string().optional(),
});

const env = schema.parse(process.env);
const cores = os.availableParallelism();

export const config = {
  env: env.NODE_ENV,
  isProd: env.NODE_ENV === 'production',
  port: env.PORT,
  dataDir: env.DATA_DIR,
  dbPath: env.DB_PATH ?? path.join(env.DATA_DIR, 'luma.db'),
  projectsDir: path.join(env.DATA_DIR, 'projects'),
  masterKey: env.MASTER_KEY,
  sessionSecret: env.SESSION_SECRET,
  appOrigin: env.APP_ORIGIN,
  previewOrigin: env.PREVIEW_ORIGIN,
  cpuBudget: env.CPU_BUDGET,
  maxRenderWorkers: env.MAX_RENDER_WORKERS ?? Math.max(1, cores - 1),
  cmdTimeoutS: env.CMD_TIMEOUT_S,
  logLevel: env.LOG_LEVEL,
  webDist: env.WEB_DIST ?? path.resolve(process.cwd(), '../web/dist'),
  cores,
};
export type Config = typeof config;
