// Render without the agent (used by the Luma Studio API and scripts): queue a render of the project as it is now,
// then poll the job. The finished MP4 appears in GET /projects/:id/renders and downloads from …/renders/:rid/file.
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../app.js';
import { authUser, requireAuth } from '../auth/plugin.js';
import { renderJobs, renders } from '../db/schema.js';
import { HttpError, notFound } from '../http/errors.js';
import { parse } from '../http/validate.js';
import { notPlayableReason } from '../projects/content.js';
import { getOwnedProject, toRef } from '../projects/service.js';

export async function renderRoutes(app: FastifyInstance, ctx: AppContext) {
  const { db } = ctx;
  const auth = { preHandler: requireAuth };

  app.post('/projects/:id/renders', auth, async (req, reply) => {
    const { id } = req.params as { id: string };
    const user = authUser(req);
    const project = getOwnedProject(db, user.id, id);
    if (!ctx.render) throw new HttpError(503, 'unavailable', 'Rendering is not running on this server');
    const body = parse(z.object({ preset: z.enum(['draft', 'final']).default('draft'), mode: z.enum(['free', 'fast']).optional() }), req.body ?? {});
    const empty = notPlayableReason(toRef(project).dir);
    if (empty) throw new HttpError(409, 'not_playable', empty);
    const jobId = ctx.render.enqueue({ projectId: id, userId: user.id, preset: body.preset, mode: body.mode });
    return reply.code(202).send({ jobId, position: ctx.render.position(jobId) });
  });

  app.get('/projects/:id/render-jobs/:jobId', auth, async (req) => {
    const { id, jobId } = req.params as { id: string; jobId: string };
    getOwnedProject(db, authUser(req).id, id);
    const job = db.select().from(renderJobs).where(and(eq(renderJobs.id, jobId), eq(renderJobs.projectId, id))).get();
    if (!job) throw notFound('Render job not found');
    const done = job.status === 'done' ? db.select().from(renders).where(eq(renders.jobId, job.id)).get() : null;
    return {
      id: job.id,
      status: job.status, // queued | running | done | error
      pool: job.pool === 'remote' ? 'fast' : 'free',
      preset: job.preset,
      progress: job.progress / 10, // percent
      position: job.status === 'queued' ? ctx.render?.position(job.id) ?? null : null,
      error: job.error,
      render: done ? { id: done.id, durationMs: done.duration, size: done.size, fileUrl: `/api/projects/${id}/renders/${done.id}/file`, sheetUrl: `/api/projects/${id}/renders/${done.id}/sheet` } : null,
    };
  });
}
