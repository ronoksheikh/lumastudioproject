import { and, eq } from 'drizzle-orm';
import type { DB } from '../db/index.js';
import { userSecrets } from '../db/schema.js';
import { decrypt, encrypt, keyHint } from '../security/crypto.js';
import { loadSecrets } from '../security/secrets.js';
import { newId } from '../util/id.js';

export type SecretKind = 'elevenlabs' | 'voice_prefs';

export function getSecret(db: DB, userId: string, kind: SecretKind): { value: string; hint: string } | null {
  const row = db.select().from(userSecrets).where(and(eq(userSecrets.userId, userId), eq(userSecrets.kind, kind))).get();
  return row ? { value: decrypt(row.valueEnc, loadSecrets().masterKey), hint: row.hint } : null;
}

export function setSecret(db: DB, userId: string, kind: SecretKind, value: string, showHint = false) {
  const valueEnc = encrypt(value, loadSecrets().masterKey);
  const hint = showHint ? keyHint(value) : '';
  const existing = db.select({ id: userSecrets.id }).from(userSecrets).where(and(eq(userSecrets.userId, userId), eq(userSecrets.kind, kind))).get();
  if (existing) db.update(userSecrets).set({ valueEnc, hint }).where(eq(userSecrets.id, existing.id)).run();
  else db.insert(userSecrets).values({ id: newId(), userId, kind, valueEnc, hint }).run();
}

export function deleteSecret(db: DB, userId: string, kind: SecretKind) {
  db.delete(userSecrets).where(and(eq(userSecrets.userId, userId), eq(userSecrets.kind, kind))).run();
}

export interface VoicePrefs {
  voiceId: string;
  modelId: string;
  languageCode: string | null;
  speed: number;
  tempo: number;
  stability: number;
  similarityBoost: number;
  style: number;
}
export const DEFAULT_VOICE_PREFS: VoicePrefs = {
  voiceId: 'EXAVITQu4vr4xnSDxMaL', // Sarah
  modelId: 'eleven_v4',
  languageCode: null,
  speed: 1.15,
  tempo: 1,
  stability: 0.5,
  similarityBoost: 0.8,
  style: 0.25,
};

export function getVoicePrefs(db: DB, userId: string): VoicePrefs {
  const s = getSecret(db, userId, 'voice_prefs');
  return { ...DEFAULT_VOICE_PREFS, ...(s ? JSON.parse(s.value) : {}) };
}
