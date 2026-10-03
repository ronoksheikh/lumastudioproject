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

/**
 * Optional voice overrides from Settings → Voice. Every field is null unless the student set it; when null,
 * the agent chooses (list_voices + the rules in the voice guide). Set fields are applied to script.json each
 * time the voice is generated.
 */
export interface VoicePrefs {
  voiceId: string | null;
  modelId: string | null;
  languageCode: string | null;
  speed: number | null;
  tempo: number | null;
  stability: number | null;
  similarityBoost: number | null;
  style: number | null;
}
export const NO_VOICE_PREFS: VoicePrefs = { voiceId: null, modelId: null, languageCode: null, speed: null, tempo: null, stability: null, similarityBoost: null, style: null };

/** What the old Settings page saved for everyone (round 1). Stored values equal to these were never chosen by the student. */
const LEGACY_DEFAULTS: Record<string, unknown> = { voiceId: 'EXAVITQu4vr4xnSDxMaL', modelId: 'eleven_v4', languageCode: null, speed: 1.15, tempo: 1, stability: 0.5, similarityBoost: 0.8, style: 0.25 };

export function getVoicePrefs(db: DB, userId: string): VoicePrefs {
  const s = getSecret(db, userId, 'voice_prefs');
  if (!s) return { ...NO_VOICE_PREFS };
  const raw = JSON.parse(s.value) as Record<string, unknown> & { v?: number };
  const out: VoicePrefs = { ...NO_VOICE_PREFS };
  for (const k of Object.keys(NO_VOICE_PREFS) as Array<keyof VoicePrefs>) {
    const val = raw[k];
    if (val === undefined || val === null || val === '') continue;
    // round-1 records stored the whole form: keep only what the student actually changed
    if (raw.v !== 2 && val === LEGACY_DEFAULTS[k]) continue;
    (out as unknown as Record<string, unknown>)[k] = val;
  }
  return out;
}

export function setVoicePrefs(db: DB, userId: string, patch: Partial<VoicePrefs>) {
  const next = { ...getVoicePrefs(db, userId), ...patch };
  setSecret(db, userId, 'voice_prefs', JSON.stringify({ v: 2, ...next }));
  return getVoicePrefs(db, userId);
}

/** The overrides that are set, as script.json voice fields. */
export function voiceOverrides(p: VoicePrefs): { voice?: Record<string, unknown>; settings?: Record<string, number> } {
  const voice: Record<string, unknown> = {};
  if (p.voiceId) voice.voice_id = p.voiceId;
  if (p.modelId) voice.model_id = p.modelId;
  if (p.languageCode) voice.language_code = p.languageCode;
  if (p.tempo != null) voice.tempo = p.tempo;
  const settings: Record<string, number> = {};
  if (p.speed != null) settings.speed = p.speed;
  if (p.stability != null) settings.stability = p.stability;
  if (p.similarityBoost != null) settings.similarity_boost = p.similarityBoost;
  if (p.style != null) settings.style = p.style;
  return { ...(Object.keys(voice).length ? { voice } : {}), ...(Object.keys(settings).length ? { settings } : {}) };
}

/** One line for the agent, or null when nothing is overridden. */
export function describeOverrides(p: VoicePrefs): string | null {
  const parts = Object.entries(p).filter(([, v]) => v != null).map(([k, v]) => `${k}=${v}`);
  return parts.length ? parts.join(', ') : null;
}
