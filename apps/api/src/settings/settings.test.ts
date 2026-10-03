import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { config } from '../config.js';
import { userSecrets, users } from '../db/schema.js';
import { getVoicePrefs, setSecret, setVoicePrefs } from './service.js';
import { Client, makeTestApp, startMockEleven } from '../test/helpers.js';

let t: Awaited<ReturnType<typeof makeTestApp>>;
let c: Client;
let eleven: Awaited<ReturnType<typeof startMockEleven>>;
const realBase = config.elevenBase;

beforeAll(async () => {
  t = await makeTestApp();
  c = new Client(t.app);
  await c.signup('ada@example.com');
  eleven = await startMockEleven('xi-valid-key-123');
  config.elevenBase = eleven.base;
});
afterAll(async () => {
  config.elevenBase = realBase;
  await t.app.close();
  await eleven.close();
});

describe('ElevenLabs voice settings', () => {
  it('starts with no key and no voice overrides (the agent chooses)', async () => {
    const r = await c.get('/api/settings/voice');
    expect(r.json).toEqual({ hasKey: false, keyHint: '', prefs: { voiceId: null, modelId: null, languageCode: null, speed: null, tempo: null, stability: null, similarityBoost: null, style: null } });
  });

  it('stores the key encrypted, shows only a hint, and keeps voice prefs', async () => {
    const r = await c.put('/api/settings/voice', { apiKey: 'xi-valid-key-123', prefs: { speed: 1.2, tempo: 1.1, languageCode: 'bn' } });
    expect(r.json).toMatchObject({ hasKey: true, keyHint: 'xi-…-123'.replace('-123', '-123'), prefs: { speed: 1.2, tempo: 1.1, languageCode: 'bn', voiceId: null, modelId: null } });
    expect(JSON.stringify(r.json)).not.toContain('xi-valid-key-123');
    const rows = t.db.select().from(userSecrets).all();
    expect(rows.every((x) => !x.valueEnc.includes('xi-valid-key'))).toBe(true);
    expect((await c.get('/api/settings/voice')).json.prefs.speed).toBe(1.2);
  });

  it('updating prefs alone keeps the key', async () => {
    await c.put('/api/settings/voice', { prefs: { speed: 1.0 } });
    const r = await c.get('/api/settings/voice');
    expect(r.json.hasKey).toBe(true);
    expect(r.json.prefs.speed).toBe(1);
    // null clears an override
    expect((await c.put('/api/settings/voice', { prefs: { speed: null, tempo: null, languageCode: null } })).json.prefs).toMatchObject({ speed: null, tempo: null, languageCode: null });
  });

  it('treats round-1 saved prefs as overrides only where the student changed a default', async () => {
    const legacy = { voiceId: 'EXAVITQu4vr4xnSDxMaL', modelId: 'eleven_v4', languageCode: null, speed: 1.2, tempo: 1, stability: 0.5, similarityBoost: 0.8, style: 0.25 };
    const user = t.db.select().from(users).all().find((u) => u.email === 'ada@example.com')!;
    setSecret(t.db, user.id, 'voice_prefs', JSON.stringify(legacy));
    expect(getVoicePrefs(t.db, user.id)).toEqual({ voiceId: null, modelId: null, languageCode: null, speed: 1.2, tempo: null, stability: null, similarityBoost: null, style: null });
    // a new-format record keeps a value even when it equals an old default
    setVoicePrefs(t.db, user.id, { stability: 0.5 });
    expect(getVoicePrefs(t.db, user.id)).toMatchObject({ stability: 0.5, speed: 1.2 });
    setVoicePrefs(t.db, user.id, { stability: null, speed: null });
  });

  it('validates ranges', async () => {
    expect((await c.put('/api/settings/voice', { prefs: { speed: 3 } })).status).toBe(400);
    expect((await c.put('/api/settings/voice', { prefs: { voiceId: '../etc' } })).status).toBe(400);
  });

  it('tests the key against ElevenLabs', async () => {
    const ok = await c.post('/api/settings/voice/test');
    expect(ok.json).toMatchObject({ ok: true, tier: 'free', characterLimit: 10000 });
    await c.put('/api/settings/voice', { apiKey: 'xi-wrong-key-99999' });
    const bad = await c.post('/api/settings/voice/test');
    expect(bad.json.ok).toBe(false);
    expect(JSON.stringify(bad.json)).not.toContain('xi-wrong');
  });

  it('new projects are empty: no script.json is written from the voice settings', async () => {
    const id = (await c.post('/api/projects', { title: 'Voice', aspect: '16:9' })).json.project.id;
    expect((await c.get(`/api/projects/${id}/file`, { path: 'script.json' })).status).toBe(404);
  });

  it('removes the key', async () => {
    await c.del('/api/settings/voice/key');
    expect((await c.get('/api/settings/voice')).json.hasKey).toBe(false);
    expect((await c.post('/api/settings/voice/test')).status).toBe(409);
  });
});
