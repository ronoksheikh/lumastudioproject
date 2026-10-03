// Database schema — plan.md Appendix D. Timestamps are unix ms.
import { sql } from 'drizzle-orm';
import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

const now = sql`(unixepoch() * 1000)`;
const createdAt = () => integer('created_at').notNull().default(now);

export const users = sqliteTable(
  'users',
  {
    id: text('id').primaryKey(),
    email: text('email').notNull(),
    passwordHash: text('password_hash').notNull(),
    banned: integer('banned', { mode: 'boolean' }).notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('users_email_idx').on(t.email)],
);

export const sessions = sqliteTable(
  'sessions',
  {
    id: text('id').primaryKey(), // sha256 of the cookie token
    userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    csrfToken: text('csrf_token').notNull(),
    expiresAt: integer('expires_at').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('sessions_user_idx').on(t.userId)],
);

export const providerConfigs = sqliteTable(
  'provider_configs',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    baseUrl: text('base_url').notNull(),
    apiKeyEnc: text('api_key_enc').notNull(),
    apiKeyHint: text('api_key_hint').notNull().default(''),
    model: text('model').notNull(),
    supportsTools: integer('supports_tools', { mode: 'boolean' }).notNull().default(false),
    supportsVision: integer('supports_vision', { mode: 'boolean' }).notNull().default(false),
    supportsReasoningStream: integer('supports_reasoning_stream', { mode: 'boolean' }).notNull().default(false),
    contextWindow: integer('context_window').notNull().default(128000),
    isDefault: integer('is_default', { mode: 'boolean' }).notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [index('provider_configs_user_idx').on(t.userId)],
);

export const userSecrets = sqliteTable(
  'user_secrets',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(), // 'elevenlabs'
    valueEnc: text('value_enc').notNull(),
    hint: text('hint').notNull().default(''),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('user_secrets_user_kind_idx').on(t.userId, t.kind)],
);

export const projects = sqliteTable(
  'projects',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    aspect: text('aspect').notNull().default('16:9'),
    status: text('status').notNull().default('active'),
    /** Unix uid the project's files belong to and its commands run as (unique per project: isolation between students). */
    uid: integer('uid'),
    createdAt: createdAt(),
    updatedAt: integer('updated_at').notNull().default(now),
    deletedAt: integer('deleted_at'),
  },
  (t) => [index('projects_user_idx').on(t.userId), uniqueIndex('projects_uid_idx').on(t.uid)],
);

export const messages = sqliteTable(
  'messages',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
    role: text('role').notNull(), // user | assistant
    contentJson: text('content_json').notNull(),
    attachmentsJson: text('attachments_json'),
    createdAt: createdAt(),
  },
  (t) => [index('messages_project_idx').on(t.projectId)],
);

export const runs = sqliteTable(
  'runs',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
    messageId: text('message_id'),
    providerConfigId: text('provider_config_id'),
    status: text('status').notNull().default('running'), // running | finished | stopped | error
    startedAt: integer('started_at').notNull().default(now),
    finishedAt: integer('finished_at'),
    usageJson: text('usage_json'),
  },
  (t) => [index('runs_project_idx').on(t.projectId)],
);

export const runEvents = sqliteTable(
  'run_events',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    runId: text('run_id').notNull().references(() => runs.id, { onDelete: 'cascade' }),
    ts: integer('ts').notNull().default(now),
    type: text('type').notNull(),
    dataJson: text('data_json').notNull(),
  },
  (t) => [index('run_events_run_idx').on(t.runId, t.id)],
);

export const renderJobs = sqliteTable(
  'render_jobs',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
    userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    runId: text('run_id'),
    preset: text('preset').notNull(), // draft | final
    status: text('status').notNull().default('queued'), // queued | running | done | error
    progress: integer('progress').notNull().default(0), // 0-1000 (tenths of a percent)
    error: text('error'),
    createdAt: createdAt(),
    startedAt: integer('started_at'),
    finishedAt: integer('finished_at'),
    /** 'local' = this server (daily allowance); 'remote' = a fast render worker (paid render hours) */
    pool: text('pool').notNull().default('local'),
    /** remote jobs: the worker that claimed it and until when its lease runs (renewed by progress reports) */
    workerId: text('worker_id'),
    leaseUntil: integer('lease_until'),
    /** the paid render-hours pack this job is billed to (remote jobs) */
    boostId: text('boost_id'),
  },
  (t) => [index('render_jobs_status_idx').on(t.status, t.createdAt)],
);

/**
 * Paid render hours ("boosts"): 1 hour on the fast render workers for 100 BDT. Created 'pending' when the
 * student asks to buy; marked 'paid' by the payment provider (to be added) or an admin. A paid boost also resets
 * the daily allowance on this server.
 */
export const renderBoosts = sqliteTable(
  'render_boosts',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    seconds: integer('seconds').notNull(),
    usedSeconds: integer('used_seconds').notNull().default(0),
    priceBdt: integer('price_bdt').notNull(),
    status: text('status').notNull().default('pending'), // pending | paid | cancelled
    paymentRef: text('payment_ref'),
    createdAt: createdAt(),
    paidAt: integer('paid_at'),
  },
  (t) => [index('render_boosts_user_idx').on(t.userId, t.status)],
);

/** Machines (a VPS, any computer) that render "remote" jobs; they authenticate with a bearer token. */
export const renderWorkers = sqliteTable('render_workers', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  tokenHash: text('token_hash').notNull().unique(),
  maxJobs: integer('max_jobs').notNull().default(1),
  disabled: integer('disabled', { mode: 'boolean' }).notNull().default(false),
  createdAt: createdAt(),
  lastSeenAt: integer('last_seen_at'),
});

export const uploads = sqliteTable(
  'uploads',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
    path: text('path').notNull(),
    mime: text('mime').notNull(),
    size: integer('size').notNull(),
    createdAt: createdAt(),
    /** set once the file went out with a chat message: from then on the composer's X can no longer delete it */
    sentAt: integer('sent_at'),
  },
  (t) => [index('uploads_project_idx').on(t.projectId)],
);

export const renders = sqliteTable(
  'renders',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
    jobId: text('job_id'),
    preset: text('preset').notNull(),
    path: text('path').notNull(),
    duration: integer('duration'), // ms
    size: integer('size'),
    createdAt: createdAt(),
  },
  (t) => [index('renders_project_idx').on(t.projectId)],
);

export const memories = sqliteTable('memories', {
  projectId: text('project_id').primaryKey().references(() => projects.id, { onDelete: 'cascade' }),
  summary: text('summary').notNull(),
  /** rowid of the last message folded into the summary (messages after it are sent verbatim) */
  uptoRowid: integer('upto_rowid').notNull().default(0),
  updatedAt: integer('updated_at').notNull().default(now),
});

/**
 * Shared agent knowledge: facts the agent learned in one student's run that help every run (e.g. "ElevenLabs free
 * plan: only premade voices work via the API"). Injected into every system prompt. Never personal data or keys.
 */
export const agentLessons = sqliteTable(
  'agent_lessons',
  {
    id: text('id').primaryKey(),
    topic: text('topic').notNull(), // voice | render | engine | model | tools | other
    text: text('text').notNull(),
    status: text('status').notNull().default('active'), // active | pending (awaits admin review) | archived
    sourceUserId: text('source_user_id'),
    sourceProjectId: text('source_project_id'),
    confirmations: integer('confirmations').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: integer('updated_at'),
  },
  (t) => [index('agent_lessons_status_idx').on(t.status)],
);

/**
 * Shared library: reusable files one run downloaded or made (a font, a sound, a map json, a snippet) that any
 * later project copies in with use_asset instead of downloading or building it again. Files live in
 * DATA_DIR/library/<kind>/.
 */
export const sharedAssets = sqliteTable(
  'shared_assets',
  {
    id: text('id').primaryKey(),
    kind: text('kind').notNull(), // font | image | audio | data | snippet | other
    name: text('name').notNull(),
    file: text('file').notNull(), // path inside the library dir
    sha256: text('sha256').notNull(),
    size: integer('size').notNull(),
    description: text('description'),
    status: text('status').notNull().default('active'), // active | removed
    sourceUserId: text('source_user_id'),
    uses: integer('uses').notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [index('shared_assets_status_idx').on(t.status), index('shared_assets_sha_idx').on(t.sha256)],
);
