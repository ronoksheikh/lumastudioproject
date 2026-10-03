// Remote render workers: a machine (VPS, gaming PC, …) running worker/luma-worker.mjs polls this API with
// its bearer token, downloads the project as a tarball, renders it with its own copy of the engine and
// uploads the MP4 + contact sheet back. Only jobs in the 'remote' pool (paid fast-render hours) go here.
//
//   POST /api/worker/claim                      → { job: { id, projectId, preset, fps?, aspect } } | { job: null }
//   GET  /api/worker/jobs/:id/bundle            → tar.gz of the project (no export/, node_modules/, .git/, symlinks)
//   POST /api/worker/jobs/:id/progress          { frame, total, eta? }  → 409 when the job was cancelled
//   PUT  /api/worker/jobs/:id/file?kind=mp4|jpg raw bytes (application/octet-stream)
//   POST /api/worker/jobs/:id/done              { result }  (the RenderResult JSON line from render.mjs)
//   POST /api/worker/jobs/:id/fail              { message }
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { AppContext } from '../app.js';
import type { DB } from '../db/index.js';
import { projects, renderWorkers } from '../db/schema.js';
import { badRequest, conflict, HttpError, notFound, unauthorized } from '../http/errors.js';
import { toRef } from '../projects/service.js';
import { sha256 } from '../security/crypto.js';
import type { RenderResult } from './service.js';

const SKIP = new Set(['export', 'node_modules', '.git', '.home', '.luma']);
const MAX_FILE = 4 * 1024 * 1024 * 1024; // 4 GB

export function workerFromRequest(db: DB, req: FastifyRequest) {
  const h = req.headers.authorization ?? '';
  const token = h.startsWith('Bearer ') ? h.slice(7).trim() : '';
  if (!token) throw unauthorized('Missing worker token');
  const w = db.select().from(renderWorkers).where(eq(renderWorkers.tokenHash, sha256(token))).get();
  if (!w || w.disabled) throw unauthorized('Unknown or disabled worker token');
  db.update(renderWorkers).set({ lastSeenAt: Date.now() }).where(eq(renderWorkers.id, w.id)).run();
  return w;
}

/** Regular files under the project (relative paths), skipping symlinks and the heavy/private folders. */
function bundleFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (rel: string) => {
    for (const d of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
      const r = rel ? `${rel}/${d.name}` : d.name;
      if (!rel && SKIP.has(d.name)) continue;
      if (d.isDirectory()) walk(r);
      else if (d.isFile()) out.push(r);
    }
  };
  walk('');
  return out;
}

export async function workerRoutes(app: FastifyInstance, ctx: AppContext) {
  const { db } = ctx;
  const queue = () => {
    if (!ctx.render) throw new HttpError(503, 'unavailable', 'Rendering is not running on this server');
    return ctx.render;
  };

  await app.register(async (w) => {
    w.addContentTypeParser('application/octet-stream', (_req, _payload, done) => done(null));
    const ownJob = (req: FastifyRequest) => {
      const worker = workerFromRequest(db, req);
      const { id } = req.params as { id: string };
      const job = queue().ownedRemote(id, worker.id);
      if (!job) throw conflict('This render was cancelled or given to another worker. Stop working on it.');
      const project = db.select().from(projects).where(eq(projects.id, job.projectId)).get();
      if (!project || project.deletedAt) throw notFound('The project no longer exists');
      return { worker, job, project };
    };

    w.post('/worker/claim', async (req) => {
      const worker = workerFromRequest(db, req);
      const job = queue().claimRemote(worker.id);
      if (!job) return { job: null };
      const project = db.select().from(projects).where(eq(projects.id, job.projectId)).get();
      return { job: { id: job.id, projectId: job.projectId, preset: job.preset, aspect: project?.aspect ?? '16:9' } };
    });

    w.get('/worker/jobs/:id/bundle', async (req, reply) => {
      const { project } = ownJob(req);
      const dir = toRef(project).dir;
      const files = bundleFiles(dir);
      const tar = spawn('tar', ['-czf', '-', '-C', dir, '--null', '--no-recursion', '-T', '-'], { stdio: ['pipe', 'pipe', 'ignore'] });
      tar.stdin.end(files.map((f) => `${f}\0`).join(''));
      reply.header('content-type', 'application/gzip');
      return reply.send(tar.stdout);
    });

    w.post('/worker/jobs/:id/progress', async (req) => {
      const { worker } = ownJob(req);
      const b = (req.body ?? {}) as { frame?: number; total?: number; eta?: number };
      const { id } = req.params as { id: string };
      if (!queue().remoteProgress(id, worker.id, Number(b.frame) || 0, Number(b.total) || 0, b.eta != null ? Number(b.eta) : undefined)) throw conflict('cancelled');
      return { ok: true };
    });

    w.put('/worker/jobs/:id/file', async (req) => {
      const { job, project } = ownJob(req);
      const kind = (req.query as { kind?: string }).kind;
      if (kind !== 'mp4' && kind !== 'jpg') throw badRequest('kind must be mp4 or jpg');
      const len = Number(req.headers['content-length'] ?? 0);
      if (len > MAX_FILE) throw badRequest('File too large');
      const ref = toRef(project);
      const exportDir = path.join(ref.dir, 'export');
      fs.mkdirSync(exportDir, { recursive: true });
      if (ref.uid != null) fs.chownSync(exportDir, ref.uid, ref.uid);
      const file = path.join(exportDir, `${job.id}-remote.${kind}`);
      // O_NOFOLLOW: never write through a symlink the project might have planted
      const fd = fs.openSync(file, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_TRUNC | fs.constants.O_NOFOLLOW, 0o644);
      await pipeline(req.raw, fs.createWriteStream('', { fd }));
      if (ref.uid != null) fs.chownSync(file, ref.uid, ref.uid);
      return { ok: true, size: fs.statSync(file).size };
    });

    w.post('/worker/jobs/:id/done', async (req) => {
      const { worker, job, project } = ownJob(req);
      const result = ((req.body ?? {}) as { result?: RenderResult }).result;
      if (!result || typeof result.duration !== 'number') throw badRequest('result is required');
      const rel = `export/${job.id}-remote.mp4`;
      const abs = path.join(toRef(project).dir, rel);
      if (!fs.existsSync(abs)) throw badRequest('Upload the mp4 first');
      result.size = fs.statSync(abs).size;
      queue().remoteDone(job.id, worker.id, rel, result);
      return { ok: true };
    });

    w.post('/worker/jobs/:id/fail', async (req) => {
      const { worker, job } = ownJob(req);
      const message = String(((req.body ?? {}) as { message?: string }).message ?? 'unknown error').slice(0, 2000);
      queue().remoteFail(job.id, worker.id, message);
      return { ok: true };
    });
  });
}
