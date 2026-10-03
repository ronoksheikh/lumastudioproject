import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { AppContext } from '../app.js';
import { config } from '../config.js';
import { users } from '../db/schema.js';
import { HttpError, forbidden } from '../http/errors.js';
import { parse } from '../http/validate.js';
import { captchaEnabled, verifyCaptcha } from '../security/captcha.js';
import { authUser, cookieOptions, requireAuth, SESSION_COOKIE } from './plugin.js';
import {
  burnPasswordCheck, createSession, createUser, deleteSession, deleteUserSessions, findUserByEmail, hashPassword, normalizeEmail, SESSION_TTL_MS, verifyPassword,
} from './service.js';

const email = z.string().trim().toLowerCase().email().max(254);
const password = z.string().min(8, 'Password must be at least 8 characters').max(200);

export async function authRoutes(app: FastifyInstance, ctx: AppContext) {
  const { db } = ctx;
  const limited = (max: number, timeWindow: string): { rateLimit?: { max: number; timeWindow: string } } => (config.rateLimitDisabled ? {} : { rateLimit: { max, timeWindow } });

  const startSession = (reply: import('fastify').FastifyReply, userId: string) => {
    const s = createSession(db, userId);
    reply.setCookie(SESSION_COOKIE, s.token, { ...cookieOptions(), maxAge: Math.floor(SESSION_TTL_MS / 1000) });
    return s;
  };

  app.post('/auth/signup', { config: limited(5, '1 hour') }, async (req, reply) => {
    if (!config.signupEnabled) throw forbidden('Signup is closed right now');
    const body = parse(z.object({ email, password, captcha: z.string().max(4000).optional() }), req.body);
    await verifyCaptcha(body.captcha, req.ip);
    if (findUserByEmail(db, body.email)) throw new HttpError(409, 'email_taken', 'An account with this email already exists');
    const id = createUser(db, body.email, await hashPassword(body.password));
    const s = startSession(reply, id);
    return reply.code(201).send({ user: { id, email: body.email }, csrfToken: s.csrfToken });
  });

  /** What the sign-up form needs to know before the user is signed in. */
  app.get('/auth/config', async () => ({ signupEnabled: config.signupEnabled, captchaSiteKey: captchaEnabled() ? config.hcaptchaSitekey : null }));

  app.post('/auth/login', { config: limited(10, '10 minutes') }, async (req, reply) => {
    const body = parse(z.object({ email, password: z.string().min(1).max(200) }), req.body);
    const user = findUserByEmail(db, body.email);
    if (!user) {
      await burnPasswordCheck(body.password);
      throw new HttpError(401, 'bad_credentials', 'Wrong email or password');
    }
    if (!(await verifyPassword(user.passwordHash, body.password))) throw new HttpError(401, 'bad_credentials', 'Wrong email or password');
    if (user.banned) throw forbidden('This account has been suspended');
    const s = startSession(reply, user.id);
    return { user: { id: user.id, email: user.email }, csrfToken: s.csrfToken };
  });

  app.post('/auth/logout', async (req, reply) => {
    if (req.auth) deleteSession(db, req.auth.token);
    reply.clearCookie(SESSION_COOKIE, cookieOptions());
    return { ok: true };
  });

  /** Who am I + the CSRF token the SPA must echo in `x-csrf-token` on every mutation. */
  app.get('/auth/me', async (req) => {
    if (!req.auth) return { user: null };
    return { user: req.auth.user, csrfToken: req.auth.csrfToken };
  });

  app.post('/auth/password', { preHandler: requireAuth }, async (req) => {
    const u = authUser(req);
    const body = parse(z.object({ currentPassword: z.string().min(1).max(200), newPassword: password }), req.body);
    const row = db.select().from(users).where(eq(users.id, u.id)).get()!;
    if (!(await verifyPassword(row.passwordHash, body.currentPassword))) throw new HttpError(403, 'bad_credentials', 'Current password is wrong');
    db.update(users).set({ passwordHash: await hashPassword(body.newPassword) }).where(eq(users.id, u.id)).run();
    deleteUserSessions(db, u.id, req.auth!.sessionId); // sign out everywhere else
    return { ok: true };
  });
}

export { normalizeEmail };
