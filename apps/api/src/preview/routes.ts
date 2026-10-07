import { and, eq, isNull } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../app.js';
import { config } from '../config.js';
import { projects, users } from '../db/schema.js';
import { verifyPreviewToken } from '../security/crypto.js';
import { loadSecrets } from '../security/secrets.js';
import { projectDir } from '../projects/dirs.js';
import { servePreview } from './static.js';
import { addPreviewLogs, setPreviewReport } from '../agent/preview-report.js';

/**
 * `GET /p/:projectId/:token/*` — only reachable on the PREVIEW origin (see app.ts). Project JavaScript runs
 * there, so it can never touch the app origin's cookies. The token is a short-lived HMAC bound to user + project.
 */
/** The project a (projectId, token) pair opens, or null when the token is invalid/expired or the project is gone. */
function previewProject(db: AppContext['db'], projectId: string, token: string) {
  const claims = verifyPreviewToken(token, projectId, loadSecrets().signingKey);
  if (!claims) return { expired: true as const };
  const row = db
    .select({ id: projects.id, banned: users.banned })
    .from(projects)
    .innerJoin(users, eq(users.id, projects.userId))
    .where(and(eq(projects.id, projectId), eq(projects.userId, claims.userId), isNull(projects.deletedAt)))
    .get();
  return row && !row.banned ? { id: row.id } : null;
}

const previewHeaders = (reply: import('fastify').FastifyReply) => {
  // the token lives in the URL: send the Referer only to the preview origin itself (never to third parties) —
  // it lets a stray root-absolute path ("/assets/font.woff2") be mapped back to its project, see serveByReferer
  reply.header('Referrer-Policy', 'same-origin');
  reply.header('Content-Security-Policy', `frame-ancestors ${new URL(config.appOrigin).origin}`);
};

/**
 * A request for a root-absolute path ("/assets/x.woff2", "/js/…") made BY a preview page: renders serve projects
 * at "/", so such paths work there, while the preview lives under /p/<id>/<token>/ — the classic "render works,
 * preview says network error". The Referer (same-origin only) names the page's project: serve the file from it.
 * Returns true when it handled the request.
 */
export function serveByReferer(ctx: AppContext, req: import('fastify').FastifyRequest, reply: import('fastify').FastifyReply): boolean {
  if (req.method !== 'GET' && req.method !== 'HEAD') return false;
  const ref = req.headers.referer;
  if (typeof ref !== 'string') return false;
  let u: URL;
  try {
    u = new URL(ref);
  } catch {
    return false;
  }
  const host = String(req.headers['x-forwarded-host'] ?? req.headers.host ?? '').split(',')[0]!.trim().toLowerCase();
  if (u.host.toLowerCase() !== host) return false;
  const m = /^\/p\/([^/]+)\/([^/]+)\//.exec(u.pathname);
  if (!m) return false;
  const p = previewProject(ctx.db, m[1]!, m[2]!);
  if (!p || 'expired' in p) return false;
  previewHeaders(reply);
  void servePreview(req, reply, projectDir(p.id), req.url.split('?')[0]!);
  return true;
}

export async function previewRoutes(app: FastifyInstance, ctx: AppContext) {
  const { db } = ctx;

  const handler = async (req: import('fastify').FastifyRequest, reply: import('fastify').FastifyReply) => {
    const { projectId, token, '*': rest } = req.params as { projectId: string; token: string; '*'?: string };
    const p = previewProject(db, projectId, token);
    if (p && 'expired' in p) return reply.code(403).send('This preview link has expired. Reload the project page.');
    if (!p) return reply.code(404).send('Not found');
    previewHeaders(reply);
    return servePreview(req, reply, projectDir(projectId), '/' + (rest ?? ''));
  };

  /**
   * The engine's reporter (engine public/js/lib/reporter.js) posts what happens in the page — build errors, failed
   * files, console errors — from the Preview tab AND from "open in new tab", so the agent sees it (check_preview).
   */
  app.post('/p/:projectId/:token/__luma/report', { config: config.rateLimitDisabled ? {} : { rateLimit: { max: 120, timeWindow: '1 minute' } } }, async (req, reply) => {
    const { projectId, token } = req.params as { projectId: string; token: string };
    const p = previewProject(db, projectId, token);
    if (!p || 'expired' in p) return reply.code(403).send({ ok: false });
    const b = (req.body ?? {}) as { status?: string; message?: string; duration?: number; logs?: Array<{ level?: string; text?: string }>; where?: string };
    if (b.status === 'ready' || b.status === 'error' || b.status === 'empty') {
      setPreviewReport(projectId, { status: b.status, message: b.message?.slice(0, 4000), duration: typeof b.duration === 'number' ? b.duration : undefined });
    }
    if (Array.isArray(b.logs)) {
      addPreviewLogs(projectId, b.logs.slice(0, 50).map((l) => ({ level: String(l.level ?? 'log').slice(0, 10), text: String(l.text ?? '').slice(0, 1000), where: b.where === 'tab' ? 'tab' : 'preview' })));
    }
    return { ok: true };
  });

  app.get('/p/:projectId/:token', (req, reply) => {
    const q = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
    return reply.redirect(`${req.url.split('?')[0]}/${q}`, 301);
  });
  // per-IP cap on the preview origin: one video loads a few dozen files, a scraper loads thousands
  const limit = config.rateLimitDisabled ? {} : { config: { rateLimit: { max: config.previewRatePerMin, timeWindow: '1 minute' } } };
  app.get('/p/:projectId/:token/*', limit, handler);
}
