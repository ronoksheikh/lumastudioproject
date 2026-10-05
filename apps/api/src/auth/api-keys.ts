// Luma Studio API keys (the "api" add-on). A key signs requests in as its owner, so the API is the same /api/*
// the app uses (projects, uploads, agent runs, renders) — see the docs at /docs/api. Only the SHA-256 is stored.
// Keys never reach account/billing/admin/key-management endpoints, and stop working if the add-on is gone
// or the account is suspended.
import { and, desc, eq, isNull } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../app.js';
import { hasAddon } from '../billing/addons.js';
import type { DB } from '../db/index.js';
import { apiKeys, users } from '../db/schema.js';
import { HttpError, notFound } from '../http/errors.js';
import { parse } from '../http/validate.js';
import { randomToken, sha256 } from '../security/crypto.js';
import { newId } from '../util/id.js';
import { authUser, requireAuth } from './plugin.js';

export const API_KEY_PREFIX = 'lsk_';

/** Paths an API key may NOT call (account, money, admin, key management, feedback). */
export const KEY_BLOCKED = /^\/api\/(auth\/(password|logout)|settings\/api-keys|billing|admin|provision|feedback)(\/|\?|$)/;

/** The user behind a bearer key, or null. Throws for a key that exists but can't be used. */
export function userForApiKey(db: DB, token: string): { id: string; email: string; keyId: string } | null {
  if (!token.startsWith(API_KEY_PREFIX)) return null;
  const row = db.select({ key: apiKeys, user: users }).from(apiKeys).innerJoin(users, eq(users.id, apiKeys.userId))
    .where(and(eq(apiKeys.tokenHash, sha256(token)), isNull(apiKeys.revokedAt))).get();
  if (!row) throw new HttpError(401, 'invalid_api_key', 'Invalid or revoked API key');
  if (row.user.banned) throw new HttpError(403, 'forbidden', 'This account has been suspended');
  if (!hasAddon(db, row.user.id, 'api')) throw new HttpError(402, 'api_addon_required', 'This account does not have the Luma Studio API add-on (Settings → Add-ons).');
  const now = Date.now();
  if (!row.key.lastUsedAt || now - row.key.lastUsedAt > 60_000) db.update(apiKeys).set({ lastUsedAt: now }).where(eq(apiKeys.id, row.key.id)).run();
  return { id: row.user.id, email: row.user.email, keyId: row.key.id };
}

export async function apiKeyRoutes(app: FastifyInstance, ctx: AppContext) {
  const { db } = ctx;
  const auth = { preHandler: requireAuth };
  const view = (k: typeof apiKeys.$inferSelect) => ({ id: k.id, name: k.name, prefix: k.prefix, createdAt: k.createdAt, lastUsedAt: k.lastUsedAt });

  app.get('/settings/api-keys', auth, async (req) => {
    const u = authUser(req);
    return {
      hasAddon: hasAddon(db, u.id, 'api'),
      keys: db.select().from(apiKeys).where(and(eq(apiKeys.userId, u.id), isNull(apiKeys.revokedAt))).orderBy(desc(apiKeys.createdAt)).all().map(view),
    };
  });

  /** The full key is returned once, here. */
  app.post('/settings/api-keys', auth, async (req, reply) => {
    const u = authUser(req);
    if (!hasAddon(db, u.id, 'api')) throw new HttpError(402, 'api_addon_required', 'Buy the Luma Studio API add-on first (Settings → Add-ons).');
    const { name } = parse(z.object({ name: z.string().trim().min(1).max(60) }), req.body);
    const active = db.select({ id: apiKeys.id }).from(apiKeys).where(and(eq(apiKeys.userId, u.id), isNull(apiKeys.revokedAt))).all().length;
    if (active >= 10) throw new HttpError(409, 'too_many_keys', 'You have 10 keys already — revoke one first.');
    const token = `${API_KEY_PREFIX}${randomToken(32)}`;
    const id = newId();
    db.insert(apiKeys).values({ id, userId: u.id, name, tokenHash: sha256(token), prefix: token.slice(0, 10) }).run();
    return reply.code(201).send({ key: token, ...view(db.select().from(apiKeys).where(eq(apiKeys.id, id)).get()!) });
  });

  app.delete('/settings/api-keys/:id', auth, async (req) => {
    const { id } = req.params as { id: string };
    const n = db.update(apiKeys).set({ revokedAt: Date.now() }).where(and(eq(apiKeys.id, id), eq(apiKeys.userId, authUser(req).id), isNull(apiKeys.revokedAt))).run().changes;
    if (!n) throw notFound('Key not found');
    return { ok: true };
  });
}
