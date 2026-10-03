// Render queue. A render is a row in render_jobs; the tool inserts it and waits. A poller picks up
// queued jobs (oldest first), each waits for a CPU-budget slot, then runs the pristine render.mjs as
// the project's unix user. Progress lines become render.* events and DB progress.
import path from 'node:path';
import { and, asc, eq, gte, inArray, lt } from 'drizzle-orm';
import type { DB } from '../db/index.js';
import { projects, renderJobs, renders, renderWorkers } from '../db/schema.js';
import { RunBus } from '../agent/events.js';
import { runPristineScript } from '../agent/tools/scripts.js';
import { fail, ok, type RenderService, type ToolResult } from '../agent/tools/types.js';
import { config } from '../config.js';
import { conflict } from '../http/errors.js';
import { assertRenderAllowed, chargeBoost } from '../quota/service.js';
import { logger } from '../logger.js';
import { inc, observe } from '../observability/metrics.js';
import type { CpuBudget } from '../cpu/budget.js';
import { toRef } from '../projects/service.js';
import { newId } from '../util/id.js';

export type Preset = 'draft' | 'final';

export interface RenderResult {
  out: string;
  sheet: string;
  preset: Preset;
  fps: number;
  width: number;
  height: number;
  duration: number;
  size: number;
  frames: number;
  workers: number;
  seconds: number;
  checks: Array<{ name: string; ok: boolean; detail: string }>;
  ok: boolean;
}

interface Waiter {
  bus?: RunBus;
  resolve: (r: { ok: true; render: typeof renders.$inferSelect; result: RenderResult } | { ok: false; error: string }) => void;
}

const ACTIVE = ['queued', 'running'] as const;

export class RenderQueue implements RenderService {
  private timer: NodeJS.Timeout | null = null;
  private handling = new Map<string, AbortController>();
  private waiters = new Map<string, Waiter>();
  private stopped = false;

  constructor(private readonly db: DB, private readonly cpu: CpuBudget, private readonly opts: { pollMs?: number } = {}) {}

  /** Jobs left 'running' by a previous process go back to the queue. */
  resetStale() {
    const n = this.db.update(renderJobs).set({ status: 'queued', startedAt: null, progress: 0 }).where(eq(renderJobs.status, 'running')).run().changes;
    if (n) logger.warn({ count: n }, 'requeued renders interrupted by a restart');
  }

  start() {
    this.resetStale();
    this.timer = setInterval(() => this.tick(), this.opts.pollMs ?? 2000);
    this.timer.unref();
    this.tick();
  }

  async stop() {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    for (const c of this.handling.values()) c.abort();
  }

  /**
   * Inserts a queued job: one active render per PROJECT (students work on several projects at once). Paid
   * render hours route it to the fast remote workers, otherwise it renders here within the daily allowance.
   */
  enqueue(args: { projectId: string; userId: string; runId?: string | null; preset: Preset }): string {
    const route = assertRenderAllowed(this.db, args.userId);
    const busy = this.db
      .select({ id: renderJobs.id })
      .from(renderJobs)
      .where(and(eq(renderJobs.projectId, args.projectId), inArray(renderJobs.status, [...ACTIVE])))
      .get();
    if (busy) throw conflict('This project already has a render in progress. Wait for it to finish first.');
    const id = newId();
    this.db.insert(renderJobs).values({ id, projectId: args.projectId, userId: args.userId, runId: args.runId ?? null, preset: args.preset, pool: route.pool, boostId: route.boostId }).run();
    this.tick();
    return id;
  }

  /** Is any remote render worker online (called in recently)? Without one, paid renders run here. */
  workersOnline(now = Date.now()): boolean {
    return !!this.db.select({ id: renderWorkers.id }).from(renderWorkers)
      .where(and(eq(renderWorkers.disabled, false), gte(renderWorkers.lastSeenAt, now - config.workerOnlineS * 1000))).get();
  }

  // ---------------- remote workers (see render/workers.ts for the HTTP side) ----------------

  /** A worker asks for work: the oldest queued remote job becomes its job (with a lease it renews by reporting progress). */
  claimRemote(workerId: string): typeof renderJobs.$inferSelect | null {
    const now = Date.now();
    const job = this.db.select().from(renderJobs).where(and(eq(renderJobs.status, 'queued'), eq(renderJobs.pool, 'remote')))
      .orderBy(asc(renderJobs.createdAt), asc(renderJobs.id)).get();
    if (!job || this.handling.has(job.id)) return null;
    const claimed = this.db.update(renderJobs)
      .set({ status: 'running', startedAt: now, workerId, leaseUntil: now + config.workerLeaseS * 1000 })
      .where(and(eq(renderJobs.id, job.id), eq(renderJobs.status, 'queued'))).run().changes;
    if (!claimed) return null;
    this.waiters.get(job.id)?.bus?.emit('render.progress', { jobId: job.id, frame: 0, total: 0, position: 0 });
    return this.db.select().from(renderJobs).where(eq(renderJobs.id, job.id)).get() ?? null;
  }

  /** The worker's job, if it still owns it (null = cancelled, expired or someone else's). */
  ownedRemote(jobId: string, workerId: string) {
    const job = this.db.select().from(renderJobs).where(and(eq(renderJobs.id, jobId), eq(renderJobs.workerId, workerId))).get();
    return job && job.status === 'running' ? job : null;
  }

  remoteProgress(jobId: string, workerId: string, frame: number, total: number, eta?: number): boolean {
    const job = this.ownedRemote(jobId, workerId);
    if (!job) return false;
    this.db.update(renderJobs).set({ leaseUntil: Date.now() + config.workerLeaseS * 1000, progress: Math.round((frame / Math.max(1, total)) * 1000) }).where(eq(renderJobs.id, jobId)).run();
    this.waiters.get(jobId)?.bus?.emit('render.progress', { jobId, frame, total, ...(eta != null ? { eta } : {}) });
    return true;
  }

  /** The worker uploaded the MP4 + contact sheet into the project's export/ (rel paths) and its result JSON. */
  remoteDone(jobId: string, workerId: string, rel: string, result: RenderResult): boolean {
    const job = this.ownedRemote(jobId, workerId);
    if (!job) return false;
    this.complete(job, rel, result);
    return true;
  }

  remoteFail(jobId: string, workerId: string, message: string): boolean {
    const job = this.ownedRemote(jobId, workerId);
    if (!job) return false;
    this.db.update(renderJobs).set({ status: 'error', error: message, finishedAt: Date.now() }).where(eq(renderJobs.id, jobId)).run();
    inc('luma_renders_total', { status: 'error', preset: job.preset }, 1, 'Renders by outcome');
    this.waiters.get(jobId)?.resolve({ ok: false, error: `The render failed on the render server: ${message}` });
    this.waiters.delete(jobId);
    return true;
  }

  /** Remote jobs whose worker went quiet go back to the queue (another worker — or this server — takes them). */
  private requeueExpired(now = Date.now()) {
    const n = this.db.update(renderJobs).set({ status: 'queued', workerId: null, leaseUntil: null, startedAt: null, progress: 0 })
      .where(and(eq(renderJobs.status, 'running'), eq(renderJobs.pool, 'remote'), lt(renderJobs.leaseUntil, now))).run().changes;
    if (n) logger.warn({ count: n }, 'requeued remote renders whose worker stopped reporting');
  }

  /** Shared ending of a successful render (here or on a worker): store it, bill it, tell the run. */
  private complete(job: typeof renderJobs.$inferSelect, rel: string, result: RenderResult) {
    const row = { id: newId(), projectId: job.projectId, jobId: job.id, preset: job.preset, path: rel, duration: Math.round(result.duration * 1000), size: result.size };
    this.db.insert(renders).values(row).run();
    const finishedAt = Date.now();
    this.db.update(renderJobs).set({ status: 'done', progress: 1000, finishedAt }).where(eq(renderJobs.id, job.id)).run();
    if (job.boostId) chargeBoost(this.db, job.boostId, (finishedAt - (job.startedAt ?? finishedAt)) / 1000);
    inc('luma_renders_total', { status: 'done', preset: job.preset }, 1, 'Renders by outcome');
    observe('luma_render_seconds', result.seconds, 'Wall-clock seconds of successful renders');
    const saved = this.db.select().from(renders).where(eq(renders.id, row.id)).get()!;
    const base = `/api/projects/${job.projectId}/renders/${row.id}`;
    const w = this.waiters.get(job.id);
    w?.bus?.emit('render.done', { jobId: job.id, url: `${base}/file`, contactSheetUrl: `${base}/sheet`, durationS: result.duration });
    w?.resolve({ ok: true, render: saved, result });
    this.waiters.delete(job.id);
  }

  /** The render_video tool: queue, stream progress to the run, and wait for the result. */
  async render(a: { projectId: string; userId: string; runId: string; preset: Preset; signal: AbortSignal; bus: RunBus }): Promise<ToolResult> {
    let jobId: string;
    try {
      jobId = this.enqueue(a);
    } catch (e) {
      return fail((e as Error).message);
    }
    a.bus.emit('render.queued', { jobId, position: this.position(jobId) });
    const finished = new Promise<Parameters<Waiter['resolve']>[0]>((resolve) => this.waiters.set(jobId, { bus: a.bus, resolve }));
    const onAbort = () => this.cancel(jobId, 'Stopped by the student.');
    a.signal.addEventListener('abort', onAbort, { once: true });
    const r = await finished;
    a.signal.removeEventListener('abort', onAbort);
    if (!r.ok) return fail(r.error);
    const { result, render } = r;
    const url = `/api/projects/${a.projectId}/renders/${render.id}/file`;
    const bad = result.checks.filter((c) => !c.ok);
    const lines = [
      `Render finished: ${result.preset} ${result.width}x${result.height} @ ${result.fps}fps, ${result.duration.toFixed(1)}s, ${(result.size / 1e6).toFixed(1)} MB, took ${result.seconds}s with ${result.workers} worker(s).`,
      `The student can watch and download it in the Renders tab (${url}).`,
      bad.length ? `Problems found by the automatic checks:\n- ${bad.map((c) => `${c.name}: ${c.detail}`).join('\n- ')}` : 'All automatic checks passed (resolution, fps, duration, audio present, peak below 0 dBFS).',
    ];
    return ok(lines.join('\n'), `${result.preset} render ready (${result.duration.toFixed(0)}s)`);
  }

  cancel(jobId: string, reason = 'Cancelled.') {
    const c = this.handling.get(jobId);
    if (c) {
      c.abort(new Error(reason));
      return;
    }
    // not picked up yet
    const n = this.db
      .update(renderJobs)
      .set({ status: 'error', error: reason, finishedAt: Date.now() })
      .where(and(eq(renderJobs.id, jobId), eq(renderJobs.status, 'queued')))
      .run().changes;
    // a job running on a remote worker: mark it, the worker learns at its next report and stops
    const r = n ? 0 : this.db.update(renderJobs).set({ status: 'error', error: reason, finishedAt: Date.now() })
      .where(and(eq(renderJobs.id, jobId), eq(renderJobs.status, 'running'), eq(renderJobs.pool, 'remote'))).run().changes;
    if (n || r) this.waiters.get(jobId)?.resolve({ ok: false, error: reason });
    this.waiters.delete(jobId);
  }

  /** 1 = next up. */
  position(jobId: string): number {
    const queued = this.db.select({ id: renderJobs.id }).from(renderJobs).where(eq(renderJobs.status, 'queued')).orderBy(asc(renderJobs.createdAt), asc(renderJobs.id)).all();
    return Math.max(1, queued.findIndex((j) => j.id === jobId) + 1);
  }

  tick() {
    if (this.stopped) return;
    this.requeueExpired();
    const queued = this.db.select().from(renderJobs).where(eq(renderJobs.status, 'queued')).orderBy(asc(renderJobs.createdAt), asc(renderJobs.id)).all();
    const remoteOnline = queued.some((j) => j.pool === 'remote') && this.workersOnline();
    for (const job of queued) {
      if (this.handling.has(job.id)) continue;
      if (job.pool === 'remote' && remoteOnline) continue; // a fast worker will claim it
      const ctl = new AbortController();
      this.handling.set(job.id, ctl);
      void this.handle(job, ctl).finally(() => this.handling.delete(job.id));
    }
  }

  private async handle(job: typeof renderJobs.$inferSelect, ctl: AbortController) {
    const waiter = () => this.waiters.get(job.id);
    const bus = waiter()?.bus;
    const settle = (r: Parameters<Waiter['resolve']>[0]) => {
      waiter()?.resolve(r);
      this.waiters.delete(job.id);
    };
    const failJob = (message: string) => {
      this.db.update(renderJobs).set({ status: 'error', error: message, finishedAt: Date.now() }).where(eq(renderJobs.id, job.id)).run();
      inc('luma_renders_total', { status: 'error', preset: job.preset }, 1, 'Renders by outcome');
      settle({ ok: false, error: message });
    };
    let slot: Awaited<ReturnType<CpuBudget['acquire']>> | null = null;
    try {
      const project = this.db.select().from(projects).where(eq(projects.id, job.projectId)).get();
      if (!project || project.deletedAt) return failJob('The project no longer exists.');

      slot = await this.cpu.acquire({
        label: `render ${job.id}`,
        signal: ctl.signal,
        onPosition: (n) => {
          if (n > 1 || bus) bus?.emit('render.progress', { jobId: job.id, frame: 0, total: 0, position: n });
        },
      });
      // claim: another process (or a cancel) may have taken the row meanwhile
      const claimed = this.db
        .update(renderJobs)
        .set({ status: 'running', startedAt: Date.now() })
        .where(and(eq(renderJobs.id, job.id), eq(renderJobs.status, 'queued')))
        .run().changes;
      if (!claimed) return;

      const workers = Math.max(1, Math.min(config.maxRenderWorkers, 1 + this.cpu.freeSlots()));
      const rel = `export/${Date.now()}-${job.preset}.mp4`;
      const sheetRel = rel.replace(/\.mp4$/, '.jpg');
      const ref = toRef(project);
      let lastEmit = 0;
      const t0 = Date.now();
      let tail = '';
      const r = await runPristineScript(
        ref,
        'render.mjs',
        ['--preset', job.preset, '--workers', String(workers), '--out', path.join(ref.dir, rel), '--sheet', path.join(ref.dir, sheetRel)],
        {
          signal: ctl.signal,
          timeoutMs: config.renderTimeoutMin * 60_000,
          env: config.chromePath ? { CHROME_PATH: config.chromePath } : {},
          onOutput: (text) => {
            tail = (tail + text).slice(-4000);
            for (const m of text.matchAll(/\[luma\] frame (\d+)\/(\d+)/g)) {
              const frame = Number(m[1]);
              const total = Number(m[2]);
              const now = Date.now();
              if (now - lastEmit < 800 && frame < total) continue;
              lastEmit = now;
              const elapsed = (now - t0) / 1000;
              const eta = frame > 0 ? Math.round((elapsed / frame) * (total - frame)) : undefined;
              this.db.update(renderJobs).set({ progress: Math.round((frame / Math.max(1, total)) * 1000) }).where(eq(renderJobs.id, job.id)).run();
              waiter()?.bus?.emit('render.progress', { jobId: job.id, frame, total, eta });
            }
          },
        },
      );
      if (ctl.signal.aborted) return failJob(String((ctl.signal.reason as Error | undefined)?.message ?? 'Stopped.'));
      if (r.timedOut) return failJob(`The render took longer than ${config.renderTimeoutMin} minutes and was stopped.`);
      const line = r.output.split('\n').reverse().find((l) => l.startsWith('{"render"'));
      if (r.code !== 0 || !line) {
        const details = tail.replace(/\[luma\] frame [^\n]*\n?/g, '').trim().slice(-1500);
        // the card shows the first line: make it the reason, not just "failed"
        const reason = details.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('at ')).at(0) ?? `the render process stopped (${r.code === null ? 'killed' : `exit code ${r.code}`}) without saying why`;
        return failJob(`The render failed: ${reason}${details && details !== reason ? `\n${details}` : ''}`);
      }
      const result = (JSON.parse(line) as { render: RenderResult }).render;
      const fresh = this.db.select().from(renderJobs).where(eq(renderJobs.id, job.id)).get() ?? job;
      this.complete(fresh, rel, result);
    } catch (e) {
      if ((e as Error).name === 'AbortError') failJob(String((ctl.signal.reason as Error | undefined)?.message ?? 'Stopped.'));
      else {
        logger.error(e, 'render job crashed');
        failJob(`The render failed: ${(e as Error).message}`);
      }
    } finally {
      slot?.release();
    }
  }
}
