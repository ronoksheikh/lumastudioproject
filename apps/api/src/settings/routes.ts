import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../app.js';
import { authUser, requireAuth } from '../auth/plugin.js';
import { config } from '../config.js';
import { HttpError } from '../http/errors.js';
import { parse } from '../http/validate.js';
import { redactSecrets } from '../security/redact.js';
import { buildSystemPrompt } from '../agent/prompts.js';
import { deleteSecret, getAgentPrompt, getSecret, getVoicePrefs, setAgentPrompt, setSecret, setVoicePrefs } from './service.js';

/** Every field is an optional override; null clears it (the agent decides again). */
const prefsSchema = z.object({
  voiceId: z.string().trim().min(5).max(64).regex(/^[A-Za-z0-9_-]+$/).nullable(),
  modelId: z.string().trim().min(2).max(64).regex(/^[A-Za-z0-9_.-]+$/).nullable(),
  languageCode: z.string().trim().min(2).max(10).regex(/^[A-Za-z-]+$/).nullable(),
  speed: z.number().min(0.7).max(1.2).nullable(),
  tempo: z.number().min(1).max(1.5).nullable(),
  stability: z.number().min(0).max(1).nullable(),
  similarityBoost: z.number().min(0).max(1).nullable(),
  style: z.number().min(0).max(1).nullable(),
}).partial();

export async function settingsRoutes(app: FastifyInstance, ctx: AppContext) {
  const { db } = ctx;
  const auth = { preHandler: requireAuth };

  /** The ElevenLabs key never comes back — only whether one exists, a hint, and the optional voice overrides. */
  app.get('/settings/voice', auth, async (req) => {
    const u = authUser(req);
    const key = getSecret(db, u.id, 'elevenlabs');
    return { hasKey: !!key, keyHint: key?.hint ?? '', prefs: getVoicePrefs(db, u.id) };
  });

  app.put('/settings/voice', auth, async (req) => {
    const u = authUser(req);
    const body = parse(z.object({ apiKey: z.string().trim().min(8).max(300).optional(), prefs: prefsSchema.optional() }), req.body);
    if (body.apiKey) setSecret(db, u.id, 'elevenlabs', body.apiKey, true);
    if (body.prefs) setVoicePrefs(db, u.id, body.prefs);
    const key = getSecret(db, u.id, 'elevenlabs');
    return { hasKey: !!key, keyHint: key?.hint ?? '', prefs: getVoicePrefs(db, u.id) };
  });

  /** Settings → Agent: the student's own system prompt (append to Luma's, or replace it). Also returns Luma's default for reference. */
  const agentView = (userId: string) => ({
    prompt: getAgentPrompt(db, userId),
    defaultPrompt: buildSystemPrompt({ aspect: '16:9', brandSummary: '{brand_summary}', attachmentsSummary: '{attachments_summary}' }),
  });
  app.get('/settings/agent', auth, async (req) => agentView(authUser(req).id));
  app.put('/settings/agent', auth, async (req) => {
    const u = authUser(req);
    const body = parse(z.object({ mode: z.enum(['append', 'replace']), text: z.string().max(40_000) }).nullable(), req.body ?? null);
    setAgentPrompt(db, u.id, body);
    return agentView(u.id);
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
      const res = await fetch(`${config.elevenBase}/v1/user/subscription`, { headers: { 'xi-api-key': key.value }, signal: AbortSignal.timeout(15_000) });
      const body = await res.text();
      // a key limited to text-to-speech can't read the subscription but still works for voiceovers
      if (res.status === 401 && /permission/i.test(body)) return { ok: true, tier: null, charactersUsed: null, characterLimit: null, note: 'The key works but can’t read your plan (missing user_read permission).' };
      if (res.status === 401 || res.status === 403) return { ok: false, error: 'ElevenLabs rejected this API key.' };
      if (!res.ok) return { ok: false, error: `ElevenLabs answered ${res.status}.` };
      let j: { tier?: string; character_count?: number; character_limit?: number } = {};
      try { j = JSON.parse(body); } catch { /* keep empty */ }
      return { ok: true, tier: j.tier ?? null, charactersUsed: j.character_count ?? null, characterLimit: j.character_limit ?? null };
    } catch (e) {
      return { ok: false, error: redactSecrets(`Could not reach ElevenLabs: ${(e as Error).message}`, [key.value]) };
    }
  });
}
