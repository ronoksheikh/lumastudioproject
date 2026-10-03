import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { config } from '../config.js';
import { userSecrets } from '../db/schema.js';
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
  it('starts empty with sensible defaults', async () => {
    const r = await c.get('/api/settings/voice');
    expect(r.json).toMatchObject({ hasKey: false, prefs: { voiceId: 'EXAVITQu4vr4xnSDxMaL', modelId: 'eleven_v4', speed: 1.15 } });
  });

  it('stores the key encrypted, shows only a hint, and keeps voice prefs', async () => {
    const r = await c.put('/api/settings/voice', { apiKey: 'xi-valid-key-123', prefs: { speed: 1.2, tempo: 1.1, languageCode: 'bn' } });
    expect(r.json).toMatchObject({ hasKey: true, keyHint: 'xi-…-123'.replace('-123', '-123'), prefs: { speed: 1.2, tempo: 1.1, languageCode: 'bn', voiceId: 'EXAVITQu4vr4xnSDxMaL' } });
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
  });

  it('validates ranges', async () => {
    expect((await c.put('/api/settings/voice', { prefs: { speed: 3 } })).status).toBe(400);
    expect((await c.put('/api/settings/voice', { prefs: { voiceId: '../etc' } })).status).toBe(400);
  });

  it('tests the key against ElevenLabs', async () => {
    const ok = await c.post('/api/settings/voice/test');
    expect(ok.json).toMatchObject({ ok: true, tier: 'creator' });
    await c.put('/api/settings/voice', { apiKey: 'xi-wrong-key-99999' });
    const bad = await c.post('/api/settings/voice/test');
    expect(bad.json.ok).toBe(false);
    expect(JSON.stringify(bad.json)).not.toContain('xi-wrong');
  });

  it('new projects start with the saved voice defaults', async () => {
    await c.put('/api/settings/voice', { prefs: { speed: 1.2, tempo: 1.1, languageCode: 'bn', voiceId: 'abcDEF12345' } });
    const id = (await c.post('/api/projects', { title: 'Voice defaults', aspect: '16:9' })).json.project.id;
    const file = (await c.get(`/api/projects/${id}/file`, { path: 'script.json' })).json.content;
    const voice = JSON.parse(file).voice;
    expect(voice).toMatchObject({ voice_id: 'abcDEF12345', language_code: 'bn', tempo: 1.1, model_id: 'eleven_v4' });
    expect(voice.voice_settings.speed).toBe(1.2);
    expect(JSON.parse(file).segments.length).toBeGreaterThan(0); // the starter script is kept
  });

  it('removes the key', async () => {
    await c.del('/api/settings/voice/key');
    expect((await c.get('/api/settings/voice')).json.hasKey).toBe(false);
    expect((await c.post('/api/settings/voice/test')).status).toBe(409);
  });
});
