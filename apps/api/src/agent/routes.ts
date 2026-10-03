import fs from 'node:fs';
import path from 'node:path';
import { desc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { RunEvent } from '@luma/shared';
import type { AppContext } from '../app.js';
import { authUser, requireAuth } from '../auth/plugin.js';
import { messages, runs } from '../db/schema.js';
import { HttpError, notFound } from '../http/errors.js';
import { parse } from '../http/validate.js';
import { assertDiskAvailable } from '../quota/service.js';
import { getOwnedProject, toRef } from '../projects/service.js';
import { loadEvents } from './events.js';
import { terminalHistory } from './terminal.js';
import { FRAMES_DIR } from './tools/frames.js';

export async function agentRoutes(app: FastifyInstance, ctx: AppContext) {
  const { db } = ctx;
  const agent = ctx.agent;
  if (!agent) throw new Error('agentRoutes needs ctx.agent');
  const auth = { preHandler: requireAuth };

  const publicRun = (r: typeof runs.$inferSelect) => ({
    id: r.id, projectId: r.projectId, messageId: r.messageId, status: r.status, startedAt: r.startedAt, finishedAt: r.finishedAt,
    usage: r.usageJson ? JSON.parse(r.usageJson) : null,
  });

  /** Start an agent turn. The answer streams over /events. */
  app.post('/projects/:id/runs', auth, async (req, reply) => {
    const { id } = req.params as { id: string };
    const project = getOwnedProject(db, authUser(req).id, id);
    const body = parse(z.object({
      message: z.string().trim().min(1, 'Write a message first').max(20_000),
      attachmentIds: z.array(z.string().max(40)).max(12).optional(),
      providerId: z.string().max(40).optional(),
    }), req.body);
    assertDiskAvailable(db, authUser(req).id);
    const started = agent.start({ project, userId: authUser(req).id, text: body.message, attachmentIds: body.attachmentIds, providerId: body.providerId });
    return reply.code(202).send(started);
  });

  app.get('/projects/:id/runs', auth, async (req) => {
    const { id } = req.params as { id: string };
    getOwnedProject(db, authUser(req).id, id);
    return { runs: db.select().from(runs).where(eq(runs.projectId, id)).orderBy(desc(runs.startedAt)).limit(50).all().map(publicRun) };
  });

  app.get('/projects/:id/active-run', auth, async (req) => {
    const { id } = req.params as { id: string };
    getOwnedProject(db, authUser(req).id, id);
    const a = agent.activeFor(id);
    return { run: a ? { id: a.runId, awaitingAnswer: a.pending?.question ?? null } : null };
  });

  /** The conversation as the UI shows it: the student's messages, each with the run that answered it. */
  app.get('/projects/:id/messages', auth, async (req) => {
    const { id } = req.params as { id: string };
    getOwnedProject(db, authUser(req).id, id);
    const msgs = db.select().from(messages).where(eq(messages.projectId, id)).all().filter((m) => m.role === 'user');
    const rs = db.select().from(runs).where(eq(runs.projectId, id)).all();
    return {
      messages: msgs
        .map((m) => {
          const content = JSON.parse(m.contentJson).content;
          // the model-facing text can carry the attachment note; the UI shows it too
          const text = typeof content === 'string' ? content : '';
          const run = rs.find((r) => r.messageId === m.id);
          return { id: m.id, text, createdAt: m.createdAt, attachmentIds: m.attachmentsJson ? JSON.parse(m.attachmentsJson) : [], runId: run?.id ?? null, runStatus: run?.status ?? null };
        })
,
    };
  });

  /** The Terminal tab: every command-like tool call in this project with its output (all runs, survives reloads). */
  app.get('/projects/:id/terminal', auth, async (req) => {
    const { id } = req.params as { id: string };
    getOwnedProject(db, authUser(req).id, id);
    return { entries: terminalHistory(ctx.sqlite, id) };
  });

  const ownedRun = (req: import('fastify').FastifyRequest) => {
    const { id, runId } = req.params as { id: string; runId: string };
    getOwnedProject(db, authUser(req).id, id);
    const run = agent.runRow(runId, id);
    if (!run) throw notFound('Run not found');
    return run;
  };

  /** Plain JSON replay (no streaming). */
  app.get('/projects/:id/runs/:runId/events.json', auth, async (req) => {
    const run = ownedRun(req);
    const q = parse(z.object({ after: z.coerce.number().int().min(0).default(0) }), req.query);
    return { run: publicRun(run), events: loadEvents(db, run.id, q.after, 20_000) };
  });

  /** Server-sent events: replays everything after Last-Event-ID, then follows the live run. */
  app.get('/projects/:id/runs/:runId/events', auth, async (req, reply) => {
    const run = ownedRun(req);
    const header = req.headers['last-event-id'];
    const q = parse(z.object({ after: z.coerce.number().int().min(0).optional() }), req.query);
    const after = Number(q.after ?? (Array.isArray(header) ? header[0] : header) ?? 0) || 0;

    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write('retry: 2000\n\n');

    let lastSent = after;
    let closed = false;
    const send = (e: RunEvent) => {
      if (closed || e.id <= lastSent) return;
      lastSent = e.id;
      res.write(`id: ${e.id}\nevent: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`);
      if (e.type === 'run.finished') end();
    };
    const end = () => {
      if (closed) return;
      closed = true;
      clearInterval(ping);
      unsubscribe();
      res.end();
    };
    const live = agent.getRun(run.id);
    // subscribe BEFORE replaying so nothing slips between the two; send() de-duplicates by id
    const unsubscribe = live ? live.bus.subscribe(send) : () => {};
    const ping = setInterval(() => !closed && res.write(': ping\n\n'), 15_000);
    req.raw.on('close', end);

    for (const e of loadEvents(db, run.id, after, 50_000)) send(e);
    if (!live && !closed) end(); // a finished run: replay only
  });

  app.post('/projects/:id/runs/:runId/stop', auth, async (req) => {
    const run = ownedRun(req);
    return { ok: agent.stop(run.id) };
  });

  app.post('/projects/:id/runs/:runId/answer', auth, async (req) => {
    const run = ownedRun(req);
    const body = parse(z.object({ answer: z.string().trim().min(1).max(2000) }), req.body);
    if (!agent.answer(run.id, body.answer)) throw new HttpError(409, 'not_waiting', 'The agent is not waiting for an answer right now');
    return { ok: true };
  });

  /** Screenshots made by preview_frames (private to the owner; never served from the project's public/ folder). */
  app.get('/projects/:id/frames/:stamp/:file', auth, async (req, reply) => {
    const { id, stamp, file } = req.params as { id: string; stamp: string; file: string };
    const project = getOwnedProject(db, authUser(req).id, id);
    if (!/^\d{10,16}$/.test(stamp) || !/^t[\d.]+\.png$/.test(file)) throw notFound();
    const abs = path.join(toRef(project).dir, FRAMES_DIR, stamp, file);
    if (!fs.existsSync(abs)) throw notFound();
    return reply.header('Content-Type', 'image/png').header('Cache-Control', 'private, max-age=3600').send(fs.createReadStream(abs));
  });
}
