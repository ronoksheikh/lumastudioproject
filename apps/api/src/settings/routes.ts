import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../app.js';
import { authUser, requireAuth } from '../auth/plugin.js';
import { config } from '../config.js';
import { HttpError } from '../http/errors.js';
import { parse } from '../http/validate.js';
import { redactSecrets } from '../security/redact.js';
import { deleteSecret, getSecret, getVoicePrefs, setSecret } from './service.js';

const prefsSchema = z.object({
  voiceId: z.string().trim().min(5).max(64).regex(/^[A-Za-z0-9_-]+$/),
  modelId: z.string().trim().min(2).max(64),
  languageCode: z.string().trim().min(2).max(10).nullable(),
  speed: z.number().min(0.7).max(1.2),
  tempo: z.number().min(1).max(1.5),
  stability: z.number().min(0).max(1),
  similarityBoost: z.number().min(0).max(1),
  style: z.number().min(0).max(1),
}).partial();

export async function settingsRoutes(app: FastifyInstance, ctx: AppContext) {
  const { db } = ctx;
  const auth = { preHandler: requireAuth };

  /** The ElevenLabs key never comes back — only whether one exists, a hint, and the voice defaults. */
  app.get('/settings/voice', auth, async (req) => {
    const u = authUser(req);
    const key = getSecret(db, u.id, 'elevenlabs');
    return { hasKey: !!key, keyHint: key?.hint ?? '', prefs: getVoicePrefs(db, u.id) };
  });

  app.put('/settings/voice', auth, async (req) => {
    const u = authUser(req);
    const body = parse(z.object({ apiKey: z.string().trim().min(8).max(300).optional(), prefs: prefsSchema.optional() }), req.body);
    if (body.apiKey) setSecret(db, u.id, 'elevenlabs', body.apiKey, true);
    if (body.prefs) setSecret(db, u.id, 'voice_prefs', JSON.stringify({ ...getVoicePrefs(db, u.id), ...body.prefs }));
    const key = getSecret(db, u.id, 'elevenlabs');
    return { hasKey: !!key, keyHint: key?.hint ?? '', prefs: getVoicePrefs(db, u.id) };
  });

  app.delete('/settings/voice/key', auth, async (req) => {
    deleteSecret(db, authUser(req).id, 'elevenlabs');
    return { ok: true };
  });

  /** Checks the stored key against ElevenLabs. */
  app.post('/settings/voice/test', auth, async (req) => {
    const key = getSecret(db, authUser(req).id, 'elevenlabs');
    if (!key) throw new HttpError(409, 'no_key', 'Add your ElevenLabs API key first');
    try {
      const res = await fetch(`${config.elevenBase}/v1/user`, { headers: { 'xi-api-key': key.value }, signal: AbortSignal.timeout(15_000) });
      if (res.status === 401 || res.status === 403) return { ok: false, error: 'ElevenLabs rejected this API key.' };
      if (!res.ok) return { ok: false, error: `ElevenLabs answered ${res.status}.` };
      const j = (await res.json().catch(() => ({}))) as { subscription?: { tier?: string; character_count?: number; character_limit?: number } };
      return { ok: true, tier: j.subscription?.tier ?? null, charactersUsed: j.subscription?.character_count ?? null, characterLimit: j.subscription?.character_limit ?? null };
    } catch (e) {
      return { ok: false, error: redactSecrets(`Could not reach ElevenLabs: ${(e as Error).message}`, [key.value]) };
    }
  });
}
