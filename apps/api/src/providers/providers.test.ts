import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { config } from '../config.js';
import { providerConfigs } from '../db/schema.js';
import { decrypt, encrypt } from '../security/crypto.js';
import { loadSecrets } from '../security/secrets.js';
import { Client, makeTestApp, startMockLlm } from '../test/helpers.js';
import { assertProviderUrl, isBlockedAddress, safeFetch } from './safe-fetch.js';
import { testProvider } from './test-connection.js';

let t: Awaited<ReturnType<typeof makeTestApp>>;
let c: Client;
let llm: Awaited<ReturnType<typeof startMockLlm>>;

beforeAll(async () => {
  t = await makeTestApp();
  c = new Client(t.app);
  await c.signup('ada@example.com');
  llm = await startMockLlm({ reasoning: true });
});
afterAll(async () => {
  await t.app.close();
  await llm.close();
});

describe('model providers (BYO keys)', () => {
  let id: string;

  it('stores the key encrypted and never returns it', async () => {
    const r = await c.post('/api/settings/models', { name: 'Mock', baseUrl: llm.url, apiKey: llm.apiKey, model: 'mock-1' });
    expect(r.status).toBe(201);
    id = r.json.model.id;
    expect(JSON.stringify(r.json)).not.toContain(llm.apiKey);
    expect(r.json.model.apiKeyHint).toBe('sk-…3456');
    expect(r.json.model.isDefault).toBe(true);
    const raw = t.db.select().from(providerConfigs).all()[0]!;
    expect(raw.apiKeyEnc).not.toContain(llm.apiKey);
    expect(decrypt(raw.apiKeyEnc, loadSecrets().masterKey)).toBe(llm.apiKey);
    const list = await c.get('/api/settings/models');
    expect(JSON.stringify(list.json)).not.toContain(llm.apiKey);
  });

  it('tests the connection: detects tools, vision and streamed reasoning', async () => {
    const r = await c.post(`/api/settings/models/${id}/test`);
    expect(r.status).toBe(200);
    expect(r.json.result).toMatchObject({ ok: true, supportsTools: true, supportsVision: true, supportsReasoningStream: true });
    expect(r.json.model).toMatchObject({ supportsTools: true, supportsVision: true, supportsReasoningStream: true });
    // the test hit the mock with a streaming, tool-carrying request first
    expect(llm.requests[0]).toMatchObject({ stream: true });
    expect(llm.requests[0].tools[0].function.name).toBe('get_time');
  });

  it('rejects a model without tool calling', async () => {
    const noTools = await startMockLlm({ tools: false, vision: false });
    try {
      const r = await c.post('/api/settings/models/test', { baseUrl: noTools.url, apiKey: noTools.apiKey, model: 'plain' });
      expect(r.json.result.ok).toBe(false);
      expect(r.json.result.supportsTools).toBe(false);
      expect(r.json.result.error).toMatch(/tool/i);
    } finally {
      await noTools.close();
    }
  });

  it('explains a wrong key without echoing it', async () => {
    const r = await c.post('/api/settings/models/test', { baseUrl: llm.url, apiKey: 'sk-wrong-key-999999', model: 'mock-1' });
    expect(r.json.result.ok).toBe(false);
    expect(r.json.result.error).toMatch(/rejected the API key/);
    expect(JSON.stringify(r.json)).not.toContain('sk-wrong-key');
  });

  it('changing the endpoint or key resets what the test found', async () => {
    const r = await c.patch(`/api/settings/models/${id}`, { model: 'mock-2' });
    expect(r.json.model).toMatchObject({ model: 'mock-2', supportsTools: false, supportsVision: false });
    await c.post(`/api/settings/models/${id}/test`);
    expect((await c.get('/api/settings/models')).json.models[0].supportsTools).toBe(true);
  });

  it('handles the default model and deletion', async () => {
    const second = (await c.post('/api/settings/models', { name: 'Second', baseUrl: llm.url, apiKey: llm.apiKey, model: 'm' })).json.model;
    expect(second.isDefault).toBe(false);
    await c.patch(`/api/settings/models/${second.id}`, { isDefault: true });
    const models = (await c.get('/api/settings/models')).json.models;
    expect(models.filter((m: any) => m.isDefault).map((m: any) => m.id)).toEqual([second.id]);
    await c.del(`/api/settings/models/${second.id}`);
    expect((await c.get('/api/settings/models')).json.models.find((m: any) => m.isDefault)).toBeTruthy();
  });

  it("other users cannot see or test someone else's model", async () => {
    const bob = new Client(t.app);
    await bob.signup('bob@example.com');
    expect((await bob.get('/api/settings/models')).json.models).toHaveLength(0);
    expect((await bob.post(`/api/settings/models/${id}/test`)).status).toBe(404);
    expect((await bob.del(`/api/settings/models/${id}`)).status).toBe(404);
  });
});

describe('SSRF protection for model endpoints', () => {
  it('classifies private ranges', () => {
    for (const a of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fe80::1', 'fd00::1', '::ffff:10.0.0.1']) {
      expect(isBlockedAddress(a), a).toBe(true);
    }
    for (const a of ['8.8.8.8', '1.1.1.1', '172.32.0.1', '2606:4700:4700::1111']) expect(isBlockedAddress(a), a).toBe(false);
  });

  it('refuses private endpoints when not explicitly allowed', async () => {
    config.allowPrivateProviderUrls = false;
    try {
      expect(() => assertProviderUrl('http://127.0.0.1:11434/v1')).toThrow(/https/);
      expect(() => assertProviderUrl('https://localhost/v1')).toThrow(/not reachable/);
      expect(() => assertProviderUrl('https://169.254.169.254/latest')).toThrow(/not reachable/);
      expect(() => assertProviderUrl('https://user:pass@example.com/v1')).toThrow(/credentials/);
      expect(() => assertProviderUrl('https://openrouter.ai/api/v1')).not.toThrow();
      // a hostname that resolves to loopback is stopped at connect time
      await expect(safeFetch('https://localtest.me/')).rejects.toThrow();
      const r = await testProvider({ baseUrl: 'https://localhost/v1', apiKey: 'k', model: 'm' });
      expect(r.ok).toBe(false);
    } finally {
      config.allowPrivateProviderUrls = true;
    }
  });
});

describe('crypto', () => {
  it('round-trips and detects tampering', () => {
    const key = loadSecrets().masterKey;
    const enc = encrypt('hello 🔐', key);
    expect(enc).not.toContain('hello');
    expect(decrypt(enc, key)).toBe('hello 🔐');
    const parts = enc.split('.');
    parts[3] = Buffer.from('tampered').toString('base64url');
    expect(() => decrypt(parts.join('.'), key)).toThrow();
    expect(encrypt('x', key)).not.toBe(encrypt('x', key)); // fresh IV every time
  });
});
