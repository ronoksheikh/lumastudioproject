import multipart from '@fastify/multipart';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../app.js';
import { authUser, requireAuth } from '../auth/plugin.js';
import { config } from '../config.js';
import { uploads } from '../db/schema.js';
import { badRequest, notFound, tooLarge } from '../http/errors.js';
import { getOwnedProject, toRef, touchProject } from '../projects/service.js';
import { sniffUpload, safeName } from './sniff.js';
import { assertDiskAvailable } from '../quota/service.js';
import { projectUploadBytes, removeUpload, saveUpload } from './service.js';

export async function uploadRoutes(app: FastifyInstance, ctx: AppContext) {
  const { db } = ctx;
  const auth = { preHandler: requireAuth };
  await app.register(multipart, { limits: { fileSize: config.uploadMaxBytes, files: 6, fields: 4, parts: 12 } });

  app.get('/projects/:id/uploads', auth, async (req) => {
    const { id } = req.params as { id: string };
    getOwnedProject(db, authUser(req).id, id);
    return { uploads: db.select().from(uploads).where(eq(uploads.projectId, id)).all() };
  });

  app.post('/projects/:id/uploads', auth, async (req, reply) => {
    const { id } = req.params as { id: string };
    const project = getOwnedProject(db, authUser(req).id, id);
    assertDiskAvailable(db, authUser(req).id);
    const ref = toRef(project);
    const saved = [];
    let used = projectUploadBytes(db, project.id);
    try {
      for await (const part of req.parts()) {
        if (part.type !== 'file') continue;
        const buf = await part.toBuffer(); // throws RequestFileTooLargeError past the limit
        if (!buf.length) throw badRequest(`${part.filename || 'file'} is empty`);
        const type = sniffUpload(buf);
        if (!type) throw badRequest(`${part.filename || 'file'}: only SVG, PNG, JPG, WEBP and PDF files can be attached`);
        if (used + buf.length > config.uploadProjectMaxBytes) throw tooLarge(`This project's attachments would exceed ${Math.round(config.uploadProjectMaxBytes / 1024 / 1024)} MB`);
        const result = saveUpload(db, ref, buf, type, safeName(part.filename || 'file', type.ext));
        used += buf.length;
        saved.push(result);
      }
    } catch (e) {
      if ((e as { code?: string }).code === 'FST_REQ_FILE_TOO_LARGE') throw tooLarge(`Files can be at most ${Math.round(config.uploadMaxBytes / 1024 / 1024)} MB`);
      throw e;
    }
    if (!saved.length) throw badRequest('No file received');
    touchProject(db, project.id);
    return reply.code(201).send({ uploads: saved });
  });

  app.delete('/projects/:id/uploads/:uploadId', auth, async (req) => {
    const { id, uploadId } = req.params as { id: string; uploadId: string };
    const project = getOwnedProject(db, authUser(req).id, id);
    if (!removeUpload(db, toRef(project), uploadId)) throw notFound('Upload not found');
    return { ok: true };
  });
}
