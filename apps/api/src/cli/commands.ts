// Operator commands (see admin.ts). Kept free of process/argv so they can be tested.
import { and, desc, eq } from 'drizzle-orm';
import type { DB } from '../db/index.js';
import { projects, providerConfigs, renderBoosts, renderWorkers, sessions, userSecrets, users } from '../db/schema.js';
import { userDiskBytes } from '../quota/service.js';
import { decrypt, encrypt, randomToken, sha256 } from '../security/crypto.js';
import { newId } from '../util/id.js';

export function listUsers(db: DB) {
  return db.select().from(users).all().map((u) => ({
    email: u.email,
    banned: u.banned,
    createdAt: u.createdAt,
    projects: db.select({ id: projects.id }).from(projects).where(eq(projects.userId, u.id)).all().length,
    diskBytes: userDiskBytes(db, u.id, { fresh: true }),
  }));
}

/** Suspends (or restores) an account; suspending also signs it out everywhere. */
export function setBanned(db: DB, email: string, banned: boolean): boolean {
  const u = db.select().from(users).where(eq(users.email, email.trim().toLowerCase())).get();
  if (!u) return false;
  db.update(users).set({ banned }).where(eq(users.id, u.id)).run();
  if (banned) db.delete(sessions).where(eq(sessions.userId, u.id)).run();
  return true;
}

/** Re-encrypts every secret at rest from `oldKey` to `newKey` in one transaction. Throws (and changes nothing) if any value does not decrypt with `oldKey`. */
export function rotateMasterKey(db: DB, oldKey: Buffer, newKey: Buffer): { providers: number; secrets: number } {
  if (oldKey.length !== 32 || newKey.length !== 32) throw new Error('both keys must be 32 bytes (base64)');
  return db.transaction((tx) => {
    let p = 0;
    let s = 0;
    for (const row of tx.select().from(providerConfigs).all()) {
      const plain = decrypt(row.apiKeyEnc, oldKey);
      tx.update(providerConfigs).set({ apiKeyEnc: encrypt(plain, newKey) }).where(eq(providerConfigs.id, row.id)).run();
      p++;
    }
    for (const row of tx.select().from(userSecrets).all()) {
      const plain = decrypt(row.valueEnc, oldKey);
      tx.update(userSecrets).set({ valueEnc: encrypt(plain, newKey) }).where(eq(userSecrets.id, row.id)).run();
      s++;
    }
    return { providers: p, secrets: s };
  });
}

// ---------------- remote render workers + fast render hours ----------------

/** Registers a render worker; returns its token (shown once, only the hash is stored). */
export function addWorker(db: DB, name: string): { id: string; token: string } {
  const id = newId();
  const token = `lw_${randomToken(32)}`;
  db.insert(renderWorkers).values({ id, name, tokenHash: sha256(token) }).run();
  return { id, token };
}

export const listWorkers = (db: DB) => db.select().from(renderWorkers).all();

export function setWorkerDisabled(db: DB, idOrName: string, disabled: boolean): boolean {
  const w = db.select().from(renderWorkers).all().find((x) => x.id === idOrName || x.name === idOrName);
  if (!w) return false;
  db.update(renderWorkers).set({ disabled }).where(eq(renderWorkers.id, w.id)).run();
  return true;
}

export function removeWorker(db: DB, idOrName: string): boolean {
  const w = db.select().from(renderWorkers).all().find((x) => x.id === idOrName || x.name === idOrName);
  if (!w) return false;
  db.delete(renderWorkers).where(eq(renderWorkers.id, w.id)).run();
  return true;
}

export function listBoosts(db: DB, status?: string) {
  const rows = db.select({ b: renderBoosts, email: users.email }).from(renderBoosts).innerJoin(users, eq(users.id, renderBoosts.userId)).orderBy(desc(renderBoosts.createdAt)).all();
  return rows.filter((r) => !status || r.b.status === status);
}

/** Marks a pending purchase paid (what the payment callback will do), or grants a pack to an email directly. */
export function markBoostPaid(db: DB, id: string, paymentRef?: string): boolean {
  return db.update(renderBoosts).set({ status: 'paid', paidAt: Date.now(), paymentRef: paymentRef ?? null }).where(and(eq(renderBoosts.id, id), eq(renderBoosts.status, 'pending'))).run().changes > 0;
}

export function grantBoost(db: DB, email: string, minutes: number): string | null {
  const u = db.select().from(users).where(eq(users.email, email.trim().toLowerCase())).get();
  if (!u) return null;
  const id = newId();
  db.insert(renderBoosts).values({ id, userId: u.id, seconds: Math.round(minutes * 60), priceBdt: 0, status: 'paid', provider: 'grant', paidAt: Date.now(), paymentRef: 'granted' }).run();
  return id;
}
