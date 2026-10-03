import { and, eq, isNull } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../app.js';
import { config } from '../config.js';
import { projects, users } from '../db/schema.js';
import { verifyPreviewToken } from '../security/crypto.js';
import { loadSecrets } from '../security/secrets.js';
import { projectDir } from '../projects/dirs.js';
import { servePreview } from './static.js';

/**
 * `GET /p/:projectId/:token/*` — only reachable on the PREVIEW origin (see app.ts). Project JavaScript runs
 * there, so it can never touch the app origin's cookies. The token is a short-lived HMAC bound to user + project.
 */
export async function previewRoutes(app: FastifyInstance, ctx: AppContext) {
  const { db } = ctx;

  const handler = async (req: import('fastify').FastifyRequest, reply: import('fastify').FastifyReply) => {
    const { projectId, token, '*': rest } = req.params as { projectId: string; token: string; '*'?: string };
    const claims = verifyPreviewToken(token, projectId, loadSecrets().signingKey);
    if (!claims) return reply.code(403).send('This preview link has expired. Reload the project page.');
    const row = db
      .select({ id: projects.id, banned: users.banned })
      .from(projects)
      .innerJoin(users, eq(users.id, projects.userId))
      .where(and(eq(projects.id, projectId), eq(projects.userId, claims.userId), isNull(projects.deletedAt)))
      .get();
    if (!row || row.banned) return reply.code(404).send('Not found');
    reply.header('Referrer-Policy', 'no-referrer'); // the token lives in the URL: never leak it to third parties
    reply.header('Content-Security-Policy', `frame-ancestors ${new URL(config.appOrigin).origin}`);
    return servePreview(req, reply, projectDir(projectId), '/' + (rest ?? ''));
  };

  app.get('/p/:projectId/:token', (req, reply) => {
    const q = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
    return reply.redirect(`${req.url.split('?')[0]}/${q}`, 301);
  });
  app.get('/p/:projectId/:token/*', handler);
}
