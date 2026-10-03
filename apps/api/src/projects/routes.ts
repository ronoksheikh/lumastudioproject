import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { ASPECTS } from '@luma/shared';
import { z } from 'zod';
import type { AppContext } from '../app.js';
import { authUser, requireAuth } from '../auth/plugin.js';
import { config } from '../config.js';
import { runs } from '../db/schema.js';
import { badRequest, conflict } from '../http/errors.js';
import { parse } from '../http/validate.js';
import { listProjectFiles, readProjectFile, ToolError } from '../runner/files.js';
import { signPreviewToken } from '../security/crypto.js';
import { loadSecrets } from '../security/secrets.js';
import { assertSha, gitFileAt, gitLog, gitRestore, gitShow } from './git.js';
import { createProject, getOwnedProject, listProjects, publicProject, softDeleteProject, toRef, touchProject, updateProject } from './service.js';

const title = z.string().trim().min(1, 'Give the project a title').max(120);

export const hasActiveRun = (ctx: AppContext, projectId: string) =>
  !!ctx.db.select({ id: runs.id }).from(runs).where(and(eq(runs.projectId, projectId), eq(runs.status, 'running'))).get();

export async function projectRoutes(app: FastifyInstance, ctx: AppContext) {
  const { db } = ctx;
  const auth = { preHandler: requireAuth };

  app.get('/projects', auth, async (req) => ({ projects: listProjects(db, authUser(req).id).map(publicProject) }));

  app.post('/projects', auth, async (req, reply) => {
    const body = parse(z.object({ title, aspect: z.enum(Object.keys(ASPECTS) as [string, ...string[]]).default('16:9') }), req.body);
    const row = createProject(db, authUser(req).id, { title: body.title, aspect: body.aspect as keyof typeof ASPECTS });
    return reply.code(201).send({ project: publicProject(row) });
  });

  app.get('/projects/:id', auth, async (req) => {
    const { id } = req.params as { id: string };
    return { project: publicProject(getOwnedProject(db, authUser(req).id, id)) };
  });

  app.patch('/projects/:id', auth, async (req) => {
    const { id } = req.params as { id: string };
    const p = getOwnedProject(db, authUser(req).id, id);
    const body = parse(z.object({ title }), req.body);
    return { project: publicProject(updateProject(db, p, body)) };
  });

  app.delete('/projects/:id', auth, async (req) => {
    const { id } = req.params as { id: string };
    const p = getOwnedProject(db, authUser(req).id, id);
    if (hasActiveRun(ctx, p.id)) throw conflict('Stop the running agent before deleting this project');
    softDeleteProject(db, p);
    return { ok: true };
  });

  // ---- files (read-only browser for the UI) ----
  app.get('/projects/:id/tree', auth, async (req) => {
    const { id } = req.params as { id: string };
    const q = parse(z.object({ path: z.string().max(400).default('.'), depth: z.coerce.number().int().min(1).max(6).default(4) }), req.query);
    const p = getOwnedProject(db, authUser(req).id, id);
    try {
      return { entries: listProjectFiles(toRef(p), q.path, q.depth) };
    } catch (e) {
      if (e instanceof ToolError) throw badRequest(e.message);
      throw e;
    }
  });

  app.get('/projects/:id/file', auth, async (req) => {
    const { id } = req.params as { id: string };
    const q = parse(z.object({ path: z.string().min(1).max(400) }), req.query);
    const p = getOwnedProject(db, authUser(req).id, id);
    try {
      const r = readProjectFile(toRef(p), q.path, { limit: 100_000, numbered: false }); // raw text for the viewer
      if (r.kind === 'text') return { path: r.path, kind: 'text', content: r.text, truncated: r.truncated };
      return { path: r.path, kind: r.kind, bytes: r.bytes };
    } catch (e) {
      if (e instanceof ToolError) throw badRequest(e.message);
      throw e;
    }
  });

  // ---- history ----
  app.get('/projects/:id/git/log', auth, async (req) => {
    const { id } = req.params as { id: string };
    const q = parse(z.object({ limit: z.coerce.number().int().min(1).max(200).default(50), skip: z.coerce.number().int().min(0).default(0) }), req.query);
    const p = getOwnedProject(db, authUser(req).id, id);
    return { commits: gitLog(toRef(p), q.limit, q.skip) };
  });

  app.get('/projects/:id/git/commits/:sha', auth, async (req) => {
    const { id, sha } = req.params as { id: string; sha: string };
    const p = getOwnedProject(db, authUser(req).id, id);
    return { commit: gitShow(toRef(p), assertSha(sha)) };
  });

  app.get('/projects/:id/git/commits/:sha/file', auth, async (req) => {
    const { id, sha } = req.params as { id: string; sha: string };
    const q = parse(z.object({ path: z.string().min(1).max(400) }), req.query);
    const p = getOwnedProject(db, authUser(req).id, id);
    return gitFileAt(toRef(p), sha, q.path);
  });

  app.post('/projects/:id/git/restore', auth, async (req) => {
    const { id } = req.params as { id: string };
    const body = parse(z.object({ sha: z.string() }), req.body);
    const p = getOwnedProject(db, authUser(req).id, id);
    if (hasActiveRun(ctx, p.id)) throw conflict('Wait for the agent to finish (or stop it) before restoring');
    const result = gitRestore(toRef(p), body.sha);
    touchProject(db, p.id);
    return { commit: result, unchanged: result === null };
  });

  // ---- preview ----
  /** A signed, short-lived URL for the preview iframe (served from the separate preview origin). */
  app.post('/projects/:id/preview-token', auth, async (req) => {
    const { id } = req.params as { id: string };
    const u = authUser(req);
    const p = getOwnedProject(db, u.id, id);
    const { token, expiresAt } = signPreviewToken(u.id, p.id, config.previewTokenTtlS, loadSecrets().signingKey);
    return { url: `${config.previewOrigin.replace(/\/$/, '')}/p/${p.id}/${token}/`, expiresAt };
  });
}
