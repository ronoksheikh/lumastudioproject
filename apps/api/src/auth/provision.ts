// Provisioning API: lumademy.com's backend creates a Luma Studio account for a student who bought the course and
// gets back the login (email + a generated password) to send to the student. Public sign-up is off by default.
//
//   POST /api/provision/users          { email, resetPassword? }   Authorization: Bearer <PROVISION_API_KEY>
//     new email           → 201 { email, password, created: true, loginUrl }
//     existing account    → 200 { email, password: null, created: false, loginUrl }
//     … with resetPassword → 200 { email, password: <new>, created: false, loginUrl }  (signs them out everywhere)
//   POST /api/provision/users/revoke   { email }    → { email, revoked: true }   (refund: suspends the account)
//   POST /api/provision/users/restore  { email }    → { email, restored: true }
//
// Deliberately simple: one shared secret (server-to-server only), no CORS, no IP lists. Unset key = 404.
import crypto from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../app.js';
import { config } from '../config.js';
import { users } from '../db/schema.js';
import { HttpError, notFound, unauthorized } from '../http/errors.js';
import { parse } from '../http/validate.js';
import { createUser, deleteUserSessions, findUserByEmail, hashPassword } from './service.js';

const email = z.string().trim().toLowerCase().email().max(254);

/** 12 easy-to-type characters (no 0/O/1/l/I), e.g. "k7mq-x4tz-9hwe". */
function newPassword(): string {
  const abc = 'abcdefghjkmnpqrstuvwxyz23456789';
  const bytes = crypto.randomBytes(12);
  const chars = [...bytes].map((b) => abc[b % abc.length]).join('');
  return `${chars.slice(0, 4)}-${chars.slice(4, 8)}-${chars.slice(8, 12)}`;
}

function checkKey(req: FastifyRequest) {
  const key = config.provisionApiKey;
  if (!key) throw notFound();
  const h = req.headers.authorization ?? '';
  const given = Buffer.from(h.startsWith('Bearer ') ? h.slice(7).trim() : '');
  const want = Buffer.from(key);
  if (given.length !== want.length || !crypto.timingSafeEqual(given, want)) throw unauthorized('Invalid provisioning key');
}

export async function provisionRoutes(app: FastifyInstance, ctx: AppContext) {
  const { db } = ctx;
  const loginUrl = `${config.appOrigin}/login`;

  app.post('/provision/users', async (req, reply) => {
    checkKey(req);
    const body = parse(z.object({ email, resetPassword: z.boolean().optional() }), req.body);
    const existing = findUserByEmail(db, body.email);
    if (!existing) {
      const password = newPassword();
      createUser(db, body.email, await hashPassword(password));
      return reply.code(201).send({ email: body.email, password, created: true, loginUrl });
    }
    if (!body.resetPassword) return { email: existing.email, password: null, created: false, loginUrl };
    const password = newPassword();
    db.update(users).set({ passwordHash: await hashPassword(password) }).where(eq(users.id, existing.id)).run();
    deleteUserSessions(db, existing.id);
    return { email: existing.email, password, created: false, loginUrl };
  });

  const setBanned = (banned: boolean) => async (req: FastifyRequest) => {
    checkKey(req);
    const body = parse(z.object({ email }), req.body);
    const u = findUserByEmail(db, body.email);
    if (!u) throw new HttpError(404, 'not_found', 'No Luma Studio account with this email');
    db.update(users).set({ banned }).where(eq(users.id, u.id)).run();
    if (banned) deleteUserSessions(db, u.id);
    return banned ? { email: u.email, revoked: true } : { email: u.email, restored: true };
  };
  app.post('/provision/users/revoke', setBanned(true));
  app.post('/provision/users/restore', setBanned(false));
}
