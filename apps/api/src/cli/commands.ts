// Operator commands (see admin.ts). Kept free of process/argv so they can be tested.
import { eq } from 'drizzle-orm';
import type { DB } from '../db/index.js';
import { projects, providerConfigs, sessions, userSecrets, users } from '../db/schema.js';
import { userDiskBytes } from '../quota/service.js';
import { decrypt, encrypt } from '../security/crypto.js';

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
