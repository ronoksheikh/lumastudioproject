// Starts, tracks and stops agent runs. One active run per project (and per user, by default).
import { and, eq } from 'drizzle-orm';
import type BetterSqlite3 from 'better-sqlite3';
import type { DB } from '../db/index.js';
import { runs } from '../db/schema.js';
import { conflict, HttpError } from '../http/errors.js';
import { providerApiKey, getProvider } from '../providers/service.js';
import { getSecret } from '../settings/service.js';
import { toRef, touchProject, type ProjectRow } from '../projects/service.js';
import { config } from '../config.js';
import { reportError } from '../observability/errors.js';
import { inc } from '../observability/metrics.js';
import { logger } from '../logger.js';
import { newId } from '../util/id.js';
import { buildUserContent } from './attachments.js';
import { ConvoStore } from './convo.js';
import { RunBus, loadEvents } from './events.js';
import { runAgent, type AgentDeps } from './loop.js';

interface ActiveRun {
  runId: string;
  projectId: string;
  userId: string;
  bus: RunBus;
  controller: AbortController;
  done: Promise<void>;
  pending: { resolve: (answer: string) => void; question: string } | null;
}

export class RunRegistry {
  private active = new Map<string, ActiveRun>(); // by projectId
  constructor(private readonly deps: AgentDeps, private readonly sqlite: BetterSqlite3.Database) {}

  get db(): DB {
    return this.deps.db;
  }

  /** Runs left in 'running' by a previous process can never finish: mark them failed. */
  resetStaleRuns() {
    const stale = this.db.select({ id: runs.id }).from(runs).where(eq(runs.status, 'running')).all();
    for (const r of stale) {
      new RunBus(this.db, r.id).emit('run.error', { message: 'The server restarted while this run was working. Ask me to continue.', retryable: true });
      new RunBus(this.db, r.id).emit('run.finished', { usage: { input: 0, output: 0 }, stopReason: 'error' });
      this.db.update(runs).set({ status: 'error', finishedAt: Date.now() }).where(eq(runs.id, r.id)).run();
    }
    if (stale.length) logger.warn({ count: stale.length }, 'reset stale runs');
  }

  activeFor(projectId: string): ActiveRun | undefined {
    return this.active.get(projectId);
  }

  getRun(runId: string): ActiveRun | undefined {
    for (const a of this.active.values()) if (a.runId === runId) return a;
    return undefined;
  }

  start(opts: { project: ProjectRow; userId: string; text: string; attachmentIds?: string[]; providerId?: string }): { runId: string; messageId: string } {
    const { project, userId } = opts;
    if (this.active.has(project.id)) throw conflict('The agent is already working on this project. Stop it or wait for it to finish.');
    const userRuns = [...this.active.values()].filter((a) => a.userId === userId).length;
    if (userRuns >= config.maxRunsPerUser) throw conflict('Another one of your projects is being worked on. Stop it or wait for it to finish.');

    // which model? the one asked for, else the user's default
    const providers = this.db.query.providerConfigs.findMany({ where: (t, { eq }) => eq(t.userId, userId) }).sync();
    const provider = opts.providerId ? providers.find((p) => p.id === opts.providerId) : (providers.find((p) => p.isDefault) ?? providers[0]);
    if (!provider) throw new HttpError(409, 'no_model', 'Add a model in Settings → Models first.');
    if (!provider.supportsTools) throw new HttpError(409, 'model_untested', 'Test this model in Settings → Models first — Luma needs a model with tool calling.');
    getProvider(this.db, userId, provider.id); // ownership

    const ref = toRef(project);
    const content = buildUserContent(this.db, ref, opts.text, opts.attachmentIds ?? [], provider.supportsVision);
    const store = new ConvoStore(this.sqlite, project.id);
    const userRow = store.add({ role: 'user', content: content.text }, content.attachmentIds.length ? JSON.stringify(content.attachmentIds) : null);

    const runId = newId();
    this.db.insert(runs).values({ id: runId, projectId: project.id, messageId: userRow.id, providerConfigId: provider.id, status: 'running' }).run();
    const bus = new RunBus(this.db, runId);
    const controller = new AbortController();
    const entry: ActiveRun = { runId, projectId: project.id, userId, bus, controller, done: Promise.resolve(), pending: null };
    this.active.set(project.id, entry);

    const llmKey = providerApiKey(provider);
    const eleven = getSecret(this.db, userId, 'elevenlabs')?.value ?? null;
    const secrets = [llmKey, ...(eleven ? [eleven] : [])];

    bus.emit('run.started', { model: provider.model, userMessageId: userRow.id });
    entry.done = (async () => {
      let status: 'finished' | 'stopped' | 'error' = 'finished';
      let usage = { input: 0, output: 0 };
      let stopReason: import('@luma/shared').StopReason = 'error';
      try {
        const out = await runAgent(this.deps, {
          runId, projectId: project.id, userId, project: ref, aspect: project.aspect,
          provider: { baseUrl: provider.baseUrl, apiKey: llmKey, model: provider.model, contextWindow: provider.contextWindow, supportsVision: provider.supportsVision },
          userMessage: { rowid: userRow.rowid, text: opts.text, parts: content.parts },
          elevenKey: () => getSecret(this.db, userId, 'elevenlabs')?.value ?? null,
          secrets, signal: controller.signal, bus,
          askUser: (question, options) => this.ask(entry, question, options),
        });
        stopReason = out.stopReason;
        usage = out.usage;
        status = out.stopReason === 'stopped' ? 'stopped' : out.stopReason === 'error' ? 'error' : 'finished';
      } catch (e) {
        logger.error({ err: e, runId }, 'agent run crashed');
        void reportError(e, { runId, kind: 'agent run' });
        bus.emit('run.error', { message: 'Something went wrong on our side while running the agent.', retryable: true });
        status = 'error';
        stopReason = 'error';
      } finally {
        bus.flushDeltas();
        this.db.update(runs).set({ status, finishedAt: Date.now(), usageJson: JSON.stringify(usage) }).where(eq(runs.id, runId)).run();
        touchProject(this.db, project.id);
        this.active.delete(project.id);
        bus.emit('run.finished', { usage, stopReason });
        inc('luma_runs_total', { stop_reason: stopReason }, 1, 'Agent runs by how they ended');
        inc('luma_tokens_total', { direction: 'input' }, usage.input, 'Model tokens used by agent runs');
        inc('luma_tokens_total', { direction: 'output' }, usage.output);
      }
    })();
    return { runId, messageId: userRow.id };
  }

  private ask(entry: ActiveRun, question: string, options: string[]): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const onAbort = () => {
        entry.pending = null;
        reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
      };
      if (entry.controller.signal.aborted) return onAbort();
      entry.controller.signal.addEventListener('abort', onAbort, { once: true });
      entry.pending = {
        question,
        resolve: (answer) => {
          entry.controller.signal.removeEventListener('abort', onAbort);
          entry.pending = null;
          resolve(answer);
        },
      };
      entry.bus.emit('ask_user', { question, options });
    });
  }

  answer(runId: string, answer: string): boolean {
    const a = this.getRun(runId);
    if (!a?.pending) return false;
    a.pending.resolve(answer);
    return true;
  }

  stop(runId: string): boolean {
    const a = this.getRun(runId);
    if (!a) return false;
    a.controller.abort();
    return true;
  }

  /** For graceful shutdown. */
  async stopAll() {
    const all = [...this.active.values()];
    for (const a of all) a.controller.abort();
    await Promise.allSettled(all.map((a) => a.done));
  }

  isActive(projectId: string): boolean {
    return this.active.has(projectId);
  }

  events(runId: string, afterId = 0) {
    return loadEvents(this.db, runId, afterId);
  }

  runRow(runId: string, projectId: string) {
    return this.db.select().from(runs).where(and(eq(runs.id, runId), eq(runs.projectId, projectId))).get();
  }
}
