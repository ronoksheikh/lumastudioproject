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
  RENDER_TIMEOUT_MIN: z.coerce.number().default(90),
  CMD_TIMEOUT_S: num(120),
  LOG_LEVEL: z.string().default('info'),
  /** Where the built SPA lives (apps/web/dist). */
  WEB_DIST: z.string().optional(),
  /** The Luma video template copied into every new project. */
  LUMA_TEMPLATE_DIR: z.string().optional(),
  /** Versioned prompts (packages/prompts). */
  LUMA_PROMPTS_DIR: z.string().optional(),
  /** Shared base packages every project can import (three, gsap, puppeteer-core…). */
  SHARED_MODULES: z.string().default('/opt/luma/node_modules'),
  CHROME_PATH: z.string().optional(),
  /** Agent command isolation: auto = per-project uid when root + bubblewrap when usable; uid | bwrap | none force a mode. */
  SANDBOX: z.enum(['auto', 'uid', 'bwrap', 'none']).default('auto'),
  /** First unix uid handed to projects (each project gets its own). */
  PROJECT_UID_BASE: num(100000),
  /** Per-project disk cap in MB (project folder incl. node_modules). */
  PROJECT_QUOTA_MB: num(2048),
  /** Allow model endpoints on private/loopback addresses (self-hosted setups). Off by default: SSRF protection. */
  ALLOW_PRIVATE_PROVIDER_URLS: z.enum(['0', '1']).default('0'),
  /** Max accepted upload, MB (per file / per project). */
  UPLOAD_MAX_MB: num(20),
  UPLOAD_PROJECT_MAX_MB: num(200),
  /** Lifetime of a signed preview URL, seconds. */
  PREVIEW_TOKEN_TTL_S: num(3600),
  /** Disable rate limits (tests only). */
  RATE_LIMIT_DISABLED: z.enum(['0', '1']).default('0'),
  /** ElevenLabs API base (override only for tests / proxies). */
  ELEVENLABS_API_BASE: z.string().default('https://api.elevenlabs.io'),
  /** Agent limits. */
  AGENT_MAX_STEPS: num(80),
  AGENT_MAX_OUTPUT_TOKENS: num(400_000),
  MAX_RUNS_PER_USER: num(1),
  /** Set to 1 to allow signup (closed beta switch). */
  SIGNUP_ENABLED: z.enum(['0', '1']).default('1'),
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
  renderTimeoutMin: env.RENDER_TIMEOUT_MIN,
  cmdTimeoutS: env.CMD_TIMEOUT_S,
  logLevel: env.LOG_LEVEL,
  webDist: env.WEB_DIST ?? path.resolve(process.cwd(), '../web/dist'),
  templateDir: env.LUMA_TEMPLATE_DIR ?? path.resolve(process.cwd(), '../../template'),
  promptsDir: env.LUMA_PROMPTS_DIR ?? path.resolve(process.cwd(), '../../packages/prompts'),
  sharedModules: env.SHARED_MODULES,
  chromePath: env.CHROME_PATH,
  sandbox: env.SANDBOX,
  projectUidBase: env.PROJECT_UID_BASE,
  projectQuotaMb: env.PROJECT_QUOTA_MB,
  allowPrivateProviderUrls: env.ALLOW_PRIVATE_PROVIDER_URLS === '1',
  uploadMaxBytes: env.UPLOAD_MAX_MB * 1024 * 1024,
  uploadProjectMaxBytes: env.UPLOAD_PROJECT_MAX_MB * 1024 * 1024,
  previewTokenTtlS: env.PREVIEW_TOKEN_TTL_S,
  rateLimitDisabled: env.RATE_LIMIT_DISABLED === '1' || env.NODE_ENV === 'test',
  signupEnabled: env.SIGNUP_ENABLED === '1',
  agentMaxSteps: env.AGENT_MAX_STEPS,
  agentMaxOutputTokens: env.AGENT_MAX_OUTPUT_TOKENS,
  maxRunsPerUser: env.MAX_RUNS_PER_USER,
  elevenBase: env.ELEVENLABS_API_BASE.replace(/\/$/, ''),
  cores,
};
export type Config = typeof config;
