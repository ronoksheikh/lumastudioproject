import { hash, verify } from '@node-rs/argon2';
import { and, eq, gt, lt } from 'drizzle-orm';
import type { DB } from '../db/index.js';
import { sessions, users } from '../db/schema.js';
import { randomToken, sha256 } from '../security/crypto.js';
import { newId } from '../util/id.js';

export const SESSION_TTL_MS = 30 * 24 * 3600 * 1000;
const ARGON = { algorithm: 2 /* Argon2id */, memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

export const normalizeEmail = (email: string) => email.trim().toLowerCase();

export const hashPassword = (password: string) => hash(password, ARGON);
export const verifyPassword = (hashStr: string, password: string) => verify(hashStr, password).catch(() => false);

// a fixed hash so unknown emails cost the same time as wrong passwords (no account enumeration by timing)
let dummyHash: Promise<string> | null = null;
export const burnPasswordCheck = async (password: string) => {
  dummyHash ??= hashPassword('not-a-real-password');
  await verifyPassword(await dummyHash, password);
};

export function findUserByEmail(db: DB, email: string) {
  return db.select().from(users).where(eq(users.email, normalizeEmail(email))).get();
}

export function createUser(db: DB, email: string, passwordHash: string) {
  const id = newId();
  db.insert(users).values({ id, email: normalizeEmail(email), passwordHash }).run();
  return id;
}

/** Creates a session; returns the cookie token (only its hash is stored) and the CSRF token. */
export function createSession(db: DB, userId: string) {
  const token = randomToken(32);
  const csrfToken = randomToken(24);
  const expiresAt = Date.now() + SESSION_TTL_MS;
  db.insert(sessions).values({ id: sha256(token), userId, csrfToken, expiresAt }).run();
  return { token, csrfToken, expiresAt };
}

export function loadSession(db: DB, token: string) {
  const row = db
    .select({ session: sessions, user: users })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.id, sha256(token)), gt(sessions.expiresAt, Date.now())))
    .get();
  return row ?? null;
}

export function deleteSession(db: DB, token: string) {
  db.delete(sessions).where(eq(sessions.id, sha256(token))).run();
}

export function deleteUserSessions(db: DB, userId: string, exceptId?: string) {
  const rows = db.select({ id: sessions.id }).from(sessions).where(eq(sessions.userId, userId)).all();
  for (const r of rows) if (r.id !== exceptId) db.delete(sessions).where(eq(sessions.id, r.id)).run();
}

export function purgeExpiredSessions(db: DB) {
  db.delete(sessions).where(lt(sessions.expiresAt, Date.now())).run();
}
