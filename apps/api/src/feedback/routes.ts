// Improvements: students report a bug or suggest something (with up to 4 screenshots) and follow its status;
// admins see everything in /admin → Improvements, set the status and reply.
import fs from 'node:fs';
import path from 'node:path';
import { desc, eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../app.js';
import { isAdmin } from '../admin/routes.js';
import { authUser, requireAuth } from '../auth/plugin.js';
import { config } from '../config.js';
import { feedback, users } from '../db/schema.js';
import { badRequest, forbidden, notFound, tooLarge } from '../http/errors.js';
import { parse } from '../http/validate.js';
import { sniffUpload } from '../uploads/sniff.js';
import { newId } from '../util/id.js';

export const FEEDBACK_STATUSES = ['new', 'reviewed', 'in_progress', 'done', 'declined'] as const;
const MAX_SHOTS = 4;
const MAX_SHOT_BYTES = 8 * 1024 * 1024;
const dirFor = (id: string) => path.join(config.dataDir, 'feedback', id);

type Row = typeof feedback.$inferSelect;
const view = (f: Row, email?: string) => ({
  id: f.id, kind: f.kind, title: f.title, body: f.body, status: f.status, adminNote: f.adminNote,
  screenshots: (JSON.parse(f.screenshots) as string[]).map((n) => `/api/feedback/${f.id}/screenshots/${n}`),
  createdAt: f.createdAt, updatedAt: f.updatedAt, ...(email ? { user: email } : {}),
});

export async function feedbackRoutes(app: FastifyInstance, ctx: AppContext) {
  const { db } = ctx;
  const auth = { preHandler: requireAuth };
  const admin = { preHandler: [requireAuth, async (req: FastifyRequest) => { if (!isAdmin(authUser(req).email)) throw forbidden('Admins only'); }] };

  app.get('/feedback', auth, async (req) => ({
    items: db.select().from(feedback).where(eq(feedback.userId, authUser(req).id)).orderBy(desc(feedback.createdAt)).all().map((f) => view(f)),
  }));

  /** multipart: kind, title, body + up to 4 screenshots (PNG/JPG/WEBP) */
  app.post('/feedback', { ...auth, config: config.rateLimitDisabled ? {} : { rateLimit: { max: 10, timeWindow: '1 hour' } } }, async (req, reply) => {
    const user = authUser(req);
    const fields: Record<string, string> = {};
    const shots: Array<{ buf: Buffer; ext: string }> = [];
    try {
      for await (const part of req.parts()) {
        if (part.type === 'field') {
          fields[part.fieldname] = String(part.value ?? '');
          continue;
        }
        const buf = await part.toBuffer();
        if (!buf.length) continue;
        if (buf.length > MAX_SHOT_BYTES) throw tooLarge('Screenshots can be at most 8 MB each');
        const t = sniffUpload(buf);
        if (!t || !['png', 'jpg', 'webp'].includes(t.ext)) throw badRequest('Screenshots must be PNG, JPG or WEBP images');
        if (shots.length >= MAX_SHOTS) throw badRequest(`At most ${MAX_SHOTS} screenshots`);
        shots.push({ buf, ext: t.ext });
      }
    } catch (e) {
      if ((e as { code?: string }).code === 'FST_REQ_FILE_TOO_LARGE') throw tooLarge('A screenshot is too large');
      throw e;
    }
    const body = parse(z.object({
      kind: z.enum(['bug', 'suggestion']),
      title: z.string().trim().min(3, 'Add a short title').max(140),
      body: z.string().trim().min(5, 'Describe it in a sentence or two').max(5000),
    }), fields);
    const id = newId();
    const names: string[] = [];
    if (shots.length) {
      fs.mkdirSync(dirFor(id), { recursive: true });
      shots.forEach((s, i) => {
        const name = `${i + 1}.${s.ext}`;
        fs.writeFileSync(path.join(dirFor(id), name), s.buf);
        names.push(name);
      });
    }
    db.insert(feedback).values({ id, userId: user.id, kind: body.kind, title: body.title, body: body.body, screenshots: JSON.stringify(names) }).run();
    return reply.code(201).send({ item: view(db.select().from(feedback).where(eq(feedback.id, id)).get()!) });
  });

  /** A screenshot: its author or an admin. */
  app.get('/feedback/:id/screenshots/:name', auth, async (req, reply) => {
    const { id, name } = req.params as { id: string; name: string };
    const f = db.select().from(feedback).where(eq(feedback.id, id)).get();
    const user = authUser(req);
    if (!f || (f.userId !== user.id && !isAdmin(user.email))) throw notFound();
    if (!(JSON.parse(f.screenshots) as string[]).includes(name)) throw notFound();
    const ext = path.extname(name).slice(1);
    reply.header('content-type', ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg');
    reply.header('cache-control', 'private, max-age=3600');
    return reply.send(fs.createReadStream(path.join(dirFor(id), name)));
  });

  // ---------------- admin ----------------
  app.get('/admin/feedback', admin, async (req) => {
    const status = (req.query as { status?: string }).status;
    const email = new Map(db.select({ id: users.id, email: users.email }).from(users).all().map((u) => [u.id, u.email]));
    const rows = db.select().from(feedback).orderBy(desc(feedback.createdAt)).limit(300).all().filter((f) => !status || f.status === status);
    return { items: rows.map((f) => view(f, email.get(f.userId) ?? '?')) };
  });

  app.patch('/admin/feedback/:id', admin, async (req) => {
    const { id } = req.params as { id: string };
    const body = parse(z.object({ status: z.enum(FEEDBACK_STATUSES).optional(), adminNote: z.string().trim().max(2000).nullable().optional() }), req.body);
    const n = db.update(feedback).set({ ...body, updatedAt: Date.now() }).where(eq(feedback.id, id)).run().changes;
    if (!n) throw notFound();
    return { item: view(db.select().from(feedback).where(eq(feedback.id, id)).get()!) };
  });
}
