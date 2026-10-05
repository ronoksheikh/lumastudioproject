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
  MAX_RUNS_PER_USER: num(4),
  /** shared agent lessons: auto = saved lessons are used at once, review = an operator approves them, off */
  AGENT_LESSONS: z.enum(['auto', 'review', 'off']).default('auto'),
  /** shared asset library (share_asset/use_asset): 1 = on, 0 = off */
  SHARED_LIBRARY: z.enum(['0', '1']).default('1'),
  /** Public sign-up. Off by default: accounts are created by lumademy.com through the provisioning API. */
  SIGNUP_ENABLED: z.enum(['0', '1']).default('0'),
  /** Secret for POST /api/provision/* (lumademy.com's backend creates student accounts with it). Unset = API off. */
  /** Comma-separated e-mails that can open the admin panel (/admin). */
  ADMIN_EMAILS: z.string().default(''),
  PROVISION_API_KEY: z.preprocess((v) => (v === '' ? undefined : v), z.string().min(24, 'PROVISION_API_KEY must be at least 24 characters').optional()),
  /** Quotas. 0 turns a limit off. */
  USER_QUOTA_MB: num(5120),
  /** free render time on this server per rolling 24 hours (default 5 h) */
  RENDER_MINUTES_PER_DAY: num(300),
  /** price of one fast render hour (BDT) and the most hours one order can buy */
  RENDER_HOUR_PRICE_BDT: num(100),
  RENDER_HOURS_MAX_PER_ORDER: num(20),
  /** one-time add-ons (BDT): API access and the source code; the WhatsApp number source-code buyers message */
  ADDON_API_PRICE_BDT: num(500),
  ADDON_SOURCE_PRICE_BDT: num(2000),
  SOURCE_CODE_WHATSAPP: z.string().default('+8801744136934'),
  /** PayStation (payment gateway): live/sandbox, merchant id + password; unset = buying is off */
  PAYSTATION_ENV: z.enum(['sandbox', 'live']).default('sandbox'),
  PAYSTATION_MERCHANT_ID: z.string().optional(),
  PAYSTATION_PASSWORD: z.string().optional(),
  /** A remote worker's claim on a job expires without a progress report for this long (it goes back to the queue). */
  WORKER_LEASE_S: num(120),
  /** A worker counts as online if it called in within this many seconds; with none online, paid renders run here. */
  WORKER_ONLINE_S: num(90),
  /** Deleted projects are removed from disk after this many days. */
  PURGE_AFTER_DAYS: num(7),
  /** Nightly SQLite backups (online .backup) kept in BACKUP_DIR; BACKUP_KEEP newest files are retained. */
  BACKUP_DIR: z.string().optional(),
  BACKUP_KEEP: num(7),
  BACKUP_HOUR: num(3),
  /** hCaptcha on signup: both must be set to turn it on. */
  HCAPTCHA_SITEKEY: z.string().optional(),
  HCAPTCHA_SECRET: z.string().optional(),
  HCAPTCHA_VERIFY_URL: z.string().default('https://api.hcaptcha.com/siteverify'),
  /** Requests per minute and IP on the preview origin. */
  PREVIEW_RATE_PER_MIN: num(1500),
  /** Bearer token for GET /api/metrics (Prometheus text). Unset = the endpoint does not exist. */
  METRICS_TOKEN: z.string().optional(),
  /** Sentry/GlitchTip DSN for unhandled errors. Unset = errors only go to the logs. */
  ERROR_TRACKING_DSN: z.string().optional(),
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
  maxRenderWorkers: env.MAX_RENDER_WORKERS || Math.max(1, cores - 1),
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
  provisionApiKey: env.PROVISION_API_KEY ?? null,
  adminEmails: new Set(env.ADMIN_EMAILS.split(',').map((e) => e.trim().toLowerCase()).filter(Boolean)),
  agentMaxSteps: env.AGENT_MAX_STEPS,
  agentMaxOutputTokens: env.AGENT_MAX_OUTPUT_TOKENS,
  maxRunsPerUser: env.MAX_RUNS_PER_USER,
  agentLessons: env.AGENT_LESSONS,
  sharedLibrary: env.SHARED_LIBRARY === '1',
  userQuotaBytes: env.USER_QUOTA_MB * 1024 * 1024,
  renderSecondsPerDay: env.RENDER_MINUTES_PER_DAY * 60,
  renderHourPriceBdt: env.RENDER_HOUR_PRICE_BDT,
  addonApiPriceBdt: env.ADDON_API_PRICE_BDT,
  addonSourcePriceBdt: env.ADDON_SOURCE_PRICE_BDT,
  sourceCodeWhatsapp: env.SOURCE_CODE_WHATSAPP,
  renderHoursMaxPerOrder: env.RENDER_HOURS_MAX_PER_ORDER,
  paystation: env.PAYSTATION_MERCHANT_ID && env.PAYSTATION_PASSWORD
    ? { merchantId: env.PAYSTATION_MERCHANT_ID, password: env.PAYSTATION_PASSWORD, base: env.PAYSTATION_ENV === 'live' ? 'https://api.paystation.com.bd' : 'https://sandbox.paystation.com.bd' }
    : null,
  workerLeaseS: env.WORKER_LEASE_S,
  workerOnlineS: env.WORKER_ONLINE_S,
  purgeAfterDays: env.PURGE_AFTER_DAYS,
  backupDir: env.BACKUP_DIR ?? path.join(env.DATA_DIR, 'backups'),
  backupKeep: env.BACKUP_KEEP,
  backupHour: env.BACKUP_HOUR,
  hcaptchaSitekey: env.HCAPTCHA_SITEKEY,
  hcaptchaSecret: env.HCAPTCHA_SECRET,
  hcaptchaVerifyUrl: env.HCAPTCHA_VERIFY_URL,
  previewRatePerMin: env.PREVIEW_RATE_PER_MIN,
  metricsToken: env.METRICS_TOKEN,
  errorTrackingDsn: env.ERROR_TRACKING_DSN,
  elevenBase: env.ELEVENLABS_API_BASE.replace(/\/$/, ''),
  cores,
};
export type Config = typeof config;
