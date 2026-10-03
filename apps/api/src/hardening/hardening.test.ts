// Quotas, maintenance, abuse controls, operator commands, metrics and error reporting.
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { eq } from 'drizzle-orm';
import Database from 'better-sqlite3';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { listUsers, rotateMasterKey, setBanned } from '../cli/commands.js';
import { config } from '../config.js';
import { providerConfigs, projects, renderJobs, sessions, userSecrets, users } from '../db/schema.js';
import { backupDatabase, latestBackup } from '../maintenance/backup.js';
import { purgeDeletedProjects } from '../maintenance/purge.js';
import { reportError } from '../observability/errors.js';
import { inc, observe, renderMetrics, resetMetrics } from '../observability/metrics.js';
import { projectDir } from '../projects/dirs.js';
import { forgetUsage, renderSecondsToday } from '../quota/service.js';
import { decrypt, encrypt } from '../security/crypto.js';
import { Client, makeTestApp } from '../test/helpers.js';

let t: Awaited<ReturnType<typeof makeTestApp>>;
let c: Client;
const saved = { ...config };

beforeAll(async () => {
  config.metricsToken = 'metrics-secret-token';
  t = await makeTestApp({ agent: true, render: true });
  c = new Client(t.app);
  await c.signup('ada@example.com');
});
afterAll(async () => {
  Object.assign(config, saved);
  await t.render!.stop();
  await t.agent!.stopAll();
  await t.app.close();
});

const mkProject = async (client = c, title = 'P') => (await client.post('/api/projects', { title, aspect: '16:9' })).json.project.id as string;
const userId = (email: string) => t.db.select().from(users).where(eq(users.email, email)).get()!.id;

describe('quotas', () => {
  it('blocks new projects, uploads and agent runs once the disk quota is used up, and says how to fix it', async () => {
    const id = await mkProject();
    forgetUsage();
    config.userQuotaBytes = 1024; // far below what one project (the template) already takes
    try {
      const usage = (await c.get('/api/usage')).json.usage;
      expect(usage.diskBytes).toBeGreaterThan(1024);
      expect(usage.diskLimitBytes).toBe(1024);

      const create = await c.post('/api/projects', { title: 'Another', aspect: '16:9' });
      expect(create.status).toBe(413);
      expect(create.json.error.code).toBe('storage_full');
      expect(create.json.error.message).toMatch(/Delete old projects/);

      const run = await c.post(`/api/projects/${id}/runs`, { message: 'hello' });
      expect(run.status).toBe(413);

      const boundary = '----x';
      const upload = await c.request('POST', `/api/projects/${id}/uploads`, {
        headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
        payload: `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="a.png"\r\nContent-Type: image/png\r\n\r\nabc\r\n--${boundary}--\r\n`,
      });
      expect(upload.status).toBe(413);
    } finally {
      config.userQuotaBytes = saved.userQuotaBytes;
      forgetUsage();
    }
    expect((await c.post('/api/projects', { title: 'Fits again', aspect: '16:9' })).status).toBe(201);
  });

  it('limits render minutes per day and explains it to the agent', async () => {
    const uid = userId('ada@example.com');
    const projectId = await mkProject();
    const now = Date.now();
    t.db.insert(renderJobs).values({ id: 'old1', projectId, userId: uid, preset: 'final', status: 'done', startedAt: now - 3 * 3600_000, finishedAt: now - 3 * 3600_000 + 40 * 60_000 }).run();
    t.db.insert(renderJobs).values({ id: 'old2', projectId, userId: uid, preset: 'final', status: 'done', startedAt: now - 30 * 3600_000, finishedAt: now - 30 * 3600_000 + 50 * 60_000 }).run();
    expect(renderSecondsToday(t.db, uid, now)).toBeCloseTo(40 * 60, -1); // yesterday's render does not count
    config.renderSecondsPerDay = 30 * 60;
    try {
      expect(() => t.render!.enqueue({ projectId, userId: uid, preset: 'draft' })).toThrow(/render minutes for today/);
    } finally {
      config.renderSecondsPerDay = 60 * 60;
    }
    expect(() => t.render!.enqueue({ projectId, userId: uid, preset: 'draft' })).not.toThrow(); // 40 of 60 minutes used
    t.render!.cancel(t.db.select().from(renderJobs).where(eq(renderJobs.status, 'queued')).get()?.id ?? '');
  });
});

describe('maintenance', () => {
  it('purges projects deleted more than N days ago and nothing else', async () => {
    const keep = await mkProject(c, 'keep');
    const fresh = await mkProject(c, 'recently deleted');
    const old = await mkProject(c, 'long deleted');
    await c.del(`/api/projects/${fresh}`);
    await c.del(`/api/projects/${old}`);
    t.db.update(projects).set({ deletedAt: Date.now() - 8 * 86_400_000 }).where(eq(projects.id, old)).run();
    const purged = purgeDeletedProjects(t.db, Date.now(), 7);
    expect(purged).toEqual([old]);
    expect(fs.existsSync(projectDir(old))).toBe(false);
    expect(fs.existsSync(projectDir(fresh))).toBe(true);
    expect(fs.existsSync(projectDir(keep))).toBe(true);
    expect(t.db.select().from(projects).where(eq(projects.id, old)).get()).toBeUndefined();
  });

  it('writes consistent backups and keeps only the newest ones', async () => {
    const file = path.join(os.tmpdir(), `luma-backup-src-${Date.now()}.db`);
    const src = new Database(file);
    src.exec('create table t (n integer); insert into t values (1), (2), (3)');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'luma-backups-'));
    for (let i = 0; i < 4; i++) await backupDatabase(src, dir, 3, new Date(Date.UTC(2026, 0, 1 + i, 3, 0, 0)));
    const files = fs.readdirSync(dir).sort();
    expect(files).toEqual(['luma-20260102-030000.db', 'luma-20260103-030000.db', 'luma-20260104-030000.db']);
    expect(latestBackup(dir)).toBe('luma-20260104-030000.db');
    const copy = new Database(path.join(dir, files.at(-1)!), { readonly: true });
    expect((copy.prepare('select sum(n) as s from t').get() as { s: number }).s).toBe(6);
    copy.close();
    src.close();
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(file, { force: true });
  });
});

describe('abuse controls', () => {
  let verify: http.Server;
  beforeAll(async () => {
    verify = http.createServer((req, res) => {
      let body = '';
      req.on('data', (d) => (body += d));
      req.on('end', () => {
        const p = new URLSearchParams(body);
        res.setHeader('content-type', 'application/json').end(JSON.stringify({ success: p.get('response') === 'good-token' && p.get('secret') === 'hc-secret' }));
      });
    });
    await new Promise<void>((r) => verify.listen(0, '127.0.0.1', r));
    config.hcaptchaVerifyUrl = `http://127.0.0.1:${(verify.address() as AddressInfo).port}`;
  });
  afterAll(() => {
    config.hcaptchaSecret = undefined;
    config.hcaptchaSitekey = undefined;
    verify.close();
  });

  it('requires a valid captcha at signup when hCaptcha is configured, and tells the form about it', async () => {
    const anon = new Client(t.app);
    expect((await anon.get('/api/auth/config')).json).toEqual({ signupEnabled: true, captchaSiteKey: null });
    config.hcaptchaSecret = 'hc-secret';
    config.hcaptchaSitekey = 'site-123';
    expect((await anon.get('/api/auth/config')).json.captchaSiteKey).toBe('site-123');

    const body = { email: 'bot@example.com', password: 'correct horse battery' };
    expect((await anon.post('/api/auth/signup', body)).json.error.code).toBe('captcha_required');
    expect((await anon.post('/api/auth/signup', { ...body, captcha: 'wrong' })).json.error.code).toBe('captcha_failed');
    expect((await anon.post('/api/auth/signup', { ...body, captcha: 'good-token' })).status).toBe(201);

    config.hcaptchaVerifyUrl = 'http://127.0.0.1:1'; // verifier unreachable → refuse, never wave through
    expect((await new Client(t.app).post('/api/auth/signup', { email: 'x@example.com', password: 'correct horse battery', captcha: 'good-token' })).status).toBe(503);
    config.hcaptchaSecret = undefined; // back to open signup for the tests below
    config.hcaptchaSitekey = undefined;
  });

  it('suspends an account: signed out everywhere, cannot sign in, previews stop', async () => {
    const victim = new Client(t.app);
    await victim.signup('spam@example.com');
    const pid = await mkProject(victim, 'spam');
    const previewPath = new URL((await victim.post(`/api/projects/${pid}/preview-token`)).json.url as string).pathname + 'index.html';
    const preview = () => t.app.inject({ method: 'GET', url: previewPath, headers: { host: new URL(config.previewOrigin).host } });
    expect((await preview()).statusCode).toBe(200);
    expect((await victim.get('/api/auth/me')).json.user.email).toBe('spam@example.com');

    expect(setBanned(t.db, 'Spam@Example.com', true)).toBe(true);
    expect(t.db.select().from(sessions).where(eq(sessions.userId, userId('spam@example.com'))).all()).toHaveLength(0);
    expect((await victim.get('/api/projects')).status).toBe(401);
    const login = await new Client(t.app).login('spam@example.com');
    expect(login.status).toBe(403);
    expect(login.json.error.message).toMatch(/suspended/);
    expect((await preview()).statusCode).toBe(404); // the signed preview link stops working too

    expect(setBanned(t.db, 'spam@example.com', false)).toBe(true);
    expect((await new Client(t.app).login('spam@example.com')).status).toBe(200);
    expect(setBanned(t.db, 'nobody@example.com', true)).toBe(false);
  });
});

describe('operator commands', () => {
  it('lists accounts with project counts and disk use', () => {
    const row = listUsers(t.db).find((u) => u.email === 'ada@example.com')!;
    expect(row.projects).toBeGreaterThan(0);
    expect(row.diskBytes).toBeGreaterThan(0);
  });

  it('rotates the master key: everything re-encrypted, old key no longer works, a wrong old key changes nothing', async () => {
    const oldKey = Buffer.alloc(32, 7);
    const newKey = Buffer.alloc(32, 9);
    const uid = userId('ada@example.com');
    t.db.insert(providerConfigs).values({ id: 'pc1', userId: uid, name: 'm', baseUrl: 'http://x', apiKeyEnc: encrypt('sk-model-key-123456', oldKey), model: 'm' }).run();
    t.db.insert(userSecrets).values({ id: 'us1', userId: uid, kind: 'elevenlabs-test', valueEnc: encrypt('xi-voice-key-123', oldKey) }).run();

    expect(() => rotateMasterKey(t.db, Buffer.alloc(32, 1), newKey)).toThrow();
    expect(decrypt(t.db.select().from(providerConfigs).where(eq(providerConfigs.id, 'pc1')).get()!.apiKeyEnc, oldKey)).toBe('sk-model-key-123456'); // untouched

    const r = rotateMasterKey(t.db, oldKey, newKey);
    expect(r.providers).toBeGreaterThanOrEqual(1);
    expect(r.secrets).toBeGreaterThanOrEqual(1);
    const row = t.db.select().from(providerConfigs).where(eq(providerConfigs.id, 'pc1')).get()!;
    expect(decrypt(row.apiKeyEnc, newKey)).toBe('sk-model-key-123456');
    expect(() => decrypt(row.apiKeyEnc, oldKey)).toThrow();
    expect(decrypt(t.db.select().from(userSecrets).where(eq(userSecrets.id, 'us1')).get()!.valueEnc, newKey)).toBe('xi-voice-key-123');
  });
});

describe('observability', () => {
  it('serves Prometheus metrics only with the token', async () => {
    resetMetrics();
    inc('luma_tool_calls_total', { tool: 'bash', ok: 'true' }, 3, 'Agent tool calls');
    observe('luma_render_seconds', 45);
    expect((await new Client(t.app).get('/api/metrics')).status).toBe(401);
    const bad = await t.app.inject({ method: 'GET', url: '/api/metrics', headers: { authorization: 'Bearer nope' } });
    expect(bad.statusCode).toBe(401);
    const ok = await t.app.inject({ method: 'GET', url: '/api/metrics', headers: { authorization: 'Bearer metrics-secret-token' } });
    expect(ok.statusCode).toBe(200);
    expect(ok.body).toContain('luma_tool_calls_total{ok="true",tool="bash"} 3');
    expect(ok.body).toContain('luma_render_seconds_bucket{le="60"} 1');
    expect(ok.body).toContain('luma_process_uptime_seconds');
    expect(renderMetrics()).toContain('# TYPE luma_render_seconds histogram');
  });

  it('sends unhandled errors to a Sentry-compatible endpoint, with secrets scrubbed', async () => {
    const got: Array<{ url: string; auth: string; body: any }> = [];
    const server = http.createServer((req, res) => {
      let b = '';
      req.on('data', (d) => (b += d));
      req.on('end', () => {
        got.push({ url: req.url!, auth: String(req.headers['x-sentry-auth']), body: JSON.parse(b) });
        res.writeHead(200).end('{}');
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const dsn = `http://pubkey123@127.0.0.1:${(server.address() as AddressInfo).port}/42`;
    try {
      expect(await reportError(new Error('boom with sk-abcdefghijklmnop123456 inside'), { route: '/x' }, dsn)).toBe(true);
      expect(got[0]!.url).toBe('/api/42/store/');
      expect(got[0]!.auth).toContain('sentry_key=pubkey123');
      expect(got[0]!.body.message).toContain('boom');
      expect(JSON.stringify(got[0]!.body)).not.toContain('sk-abcdefghijklmnop123456');
      expect(got[0]!.body.tags.route).toBe('/x');
      expect(await reportError(new Error('x'), {}, undefined)).toBe(false); // not configured: silently off
      expect(await reportError(new Error('x'), {}, 'not a dsn')).toBe(false);
    } finally {
      server.close();
    }
  });
});
