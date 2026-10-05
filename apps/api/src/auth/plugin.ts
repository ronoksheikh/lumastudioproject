import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { config } from '../config.js';
import type { DB } from '../db/index.js';
import { forbidden, unauthorized } from '../http/errors.js';
import { safeEqual } from '../security/crypto.js';
import { loadSession } from './service.js';
import { API_KEY_PREFIX, KEY_BLOCKED, userForApiKey } from './api-keys.js';

export const SESSION_COOKIE = 'luma_session';

export interface AuthInfo {
  user: { id: string; email: string };
  sessionId: string;
  csrfToken: string;
  token: string;
  /** signed in with a Luma Studio API key (Authorization: Bearer lsk_…), not a browser session */
  apiKeyId?: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    auth: AuthInfo | null;
  }
}

const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const appOrigin = () => new URL(config.appOrigin).origin;

export const cookieOptions = () => ({
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: config.appOrigin.startsWith('https://'),
  path: '/',
});

/**
 * Reads the session cookie into `request.auth` for every /api request, enforces the Origin check on
 * mutations, and the CSRF header on authenticated mutations.
 */
export function registerAuth(app: FastifyInstance, db: DB) {
  app.decorateRequest('auth', null);

  app.addHook('onRequest', async (req) => {
    if (!req.url.startsWith('/api/')) return;
    const token = req.cookies[SESSION_COOKIE];
    if (token) {
      const row = loadSession(db, token);
      if (row) {
        if (row.user.banned) throw forbidden('This account has been suspended');
        req.auth = { user: { id: row.user.id, email: row.user.email }, sessionId: row.session.id, csrfToken: row.session.csrfToken, token };
      }
    }
    // the Luma Studio API: a bearer key instead of the session cookie (server-to-server, so no CSRF token)
    const bearer = req.headers.authorization;
    if (!req.auth && typeof bearer === 'string' && bearer.startsWith(`Bearer ${API_KEY_PREFIX}`)) {
      const u = userForApiKey(db, bearer.slice(7).trim());
      if (u) {
        if (KEY_BLOCKED.test(req.url)) throw forbidden('API keys cannot use this endpoint');
        req.auth = { user: { id: u.id, email: u.email }, sessionId: `api-key:${u.keyId}`, csrfToken: '', token: '', apiKeyId: u.keyId };
      }
    }
    if (UNSAFE.has(req.method)) {
      // defence in depth on top of SameSite=Lax: a browser always sends Origin on cross-site POSTs
      const origin = req.headers.origin;
      if (origin && origin !== appOrigin()) throw forbidden('Cross-origin request blocked');
      if (req.auth && !req.auth.apiKeyId) {
        const header = req.headers['x-csrf-token'];
        if (typeof header !== 'string' || !safeEqual(header, req.auth.csrfToken)) throw forbidden('Missing or invalid CSRF token');
      }
    }
  });
}

/** preHandler: the request must be signed in. */
export async function requireAuth(req: FastifyRequest, _reply: FastifyReply) {
  if (!req.auth) throw unauthorized();
}

export const authUser = (req: FastifyRequest) => {
  if (!req.auth) throw unauthorized();
  return req.auth.user;
};
