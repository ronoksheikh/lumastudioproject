import fs from 'node:fs';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { projects } from '../db/schema.js';
import { signPreviewToken, verifyPreviewToken } from '../security/crypto.js';
import { loadSecrets } from '../security/secrets.js';
import { toRef } from '../projects/service.js';
import { Client, makeTestApp, seedExample } from '../test/helpers.js';

let t: Awaited<ReturnType<typeof makeTestApp>>;
let ada: Client;
let bob: Client;
let projectId: string;
let previewUrl: URL;
const PREVIEW = { host: 'preview.test' };
const get = (u: string, headers: Record<string, string> = {}) => t.app.inject({ method: 'GET', url: u, headers: { ...PREVIEW, ...headers } });

beforeAll(async () => {
  t = await makeTestApp();
  ada = new Client(t.app);
  bob = new Client(t.app);
  await ada.signup('ada@example.com');
  await bob.signup('bob@example.com');
  projectId = (await ada.post('/api/projects', { title: 'Preview me', aspect: '16:9' })).json.project.id;
  const r = await ada.post(`/api/projects/${projectId}/preview-token`);
  previewUrl = new URL(r.json.url);
}, 30_000);
afterAll(async () => {
  await t.app.close();
});

describe('signed preview tokens', () => {
  const key = Buffer.alloc(32, 9);
  it('bind user + project and expire', () => {
    const { token } = signPreviewToken('u1', 'p1', 60, key, 1_000_000);
    expect(verifyPreviewToken(token, 'p1', key, 1_000_000)).toEqual({ userId: 'u1' });
    expect(verifyPreviewToken(token, 'p2', key, 1_000_000)).toBeNull(); // other project
    expect(verifyPreviewToken(token, 'p1', key, 1_000_000 + 61_000)).toBeNull(); // expired
    expect(verifyPreviewToken(token, 'p1', Buffer.alloc(32, 1), 1_000_000)).toBeNull(); // wrong key
    expect(verifyPreviewToken(token.slice(0, -2) + 'xx', 'p1', key, 1_000_000)).toBeNull(); // tampered
    expect(verifyPreviewToken('garbage', 'p1', key)).toBeNull();
  });
});

describe('preview origin', () => {
  it('serves an empty project: the engine from the Studio, no scenes or audio', async () => {
    const base = previewUrl.pathname;
    expect((await get(base)).body).toContain('id="stage"');
    expect((await get(`${base}js/main.js`)).statusCode).toBe(200);
    expect((await get(`${base}js/lib/recipes/counter.js`)).statusCode).toBe(200);
    expect((await get(`${base}js/scenes/index.js`)).statusCode).toBe(404); // main.js shows the empty state
    expect((await get(`${base}audio/timing.json`)).statusCode).toBe(404);
    expect((await get(`${base}css/scenes.css`)).statusCode).toBe(200); // the project's own (empty) styles
  });

  it('serves a built project from the signed URL (index, assets, vendor, root json)', async () => {
    await seedExample(toRef(t.db.select().from(projects).where(eq(projects.id, projectId)).get()!));
    expect(previewUrl.origin).toBe('http://preview.test');
    const base = previewUrl.pathname; // /p/<id>/<token>/
    const index = await get(base);
    expect(index.statusCode).toBe(200);
    expect(index.headers['content-type']).toContain('text/html');
    expect(index.body).toContain('id="stage"');
    expect(index.headers['referrer-policy']).toBe('same-origin'); // never to third parties; lets /assets/… be mapped back
    expect(index.headers['content-security-policy']).toBe('frame-ancestors http://app.test');
    expect((await get(`${base}js/main.js`)).statusCode).toBe(200);
    expect((await get(`${base}css/base.css`)).statusCode).toBe(200);
    expect((await get(`${base}assets/Lumademy_Icon_White.svg`)).headers['content-type']).toBe('image/svg+xml');
    expect(JSON.parse((await get(`${base}project.json`)).body).title).toBe('Preview me');
    expect((await get(`${base}audio/timing.json`)).statusCode).toBe(200);
    expect((await get(`${base}nope.js`)).statusCode).toBe(404);
  });

  it('redirects to the trailing slash so relative URLs resolve', async () => {
    const r = await get(previewUrl.pathname.replace(/\/$/, ''));
    expect(r.statusCode).toBe(301);
    expect(r.headers.location).toBe(previewUrl.pathname);
  });

  it('serves audio with Range support', async () => {
    const dir = toRef(t.db.select().from(projects).where(eq(projects.id, projectId)).get()!).dir;
    const size = fs.statSync(path.join(dir, 'public/audio/voiceover.mp3')).size;
    const part = await get(`${previewUrl.pathname}audio/voiceover.mp3`, { range: 'bytes=0-9' });
    expect(part.statusCode).toBe(206);
    expect(part.headers['content-range']).toBe(`bytes 0-9/${size}`);
    expect((await get(`${previewUrl.pathname}audio/voiceover.mp3`, { range: `bytes=${size + 100}-` })).statusCode).toBe(416);
  });

  it('rejects bad, expired and cross-project tokens', async () => {
    expect((await get(`/p/${projectId}/not-a-token/`)).statusCode).toBe(403);
    const other = (await ada.post('/api/projects', { title: 'Other', aspect: '16:9' })).json.project.id;
    const token = previewUrl.pathname.split('/')[3]!;
    expect((await get(`/p/${other}/${token}/`)).statusCode).toBe(403); // token is for another project
    const expired = signPreviewToken(t.db.select().from(projects).where(eq(projects.id, projectId)).get()!.userId, projectId, 60, loadSecrets().signingKey, Date.now() - 3_600_000).token;
    expect((await get(`/p/${projectId}/${expired}/`)).statusCode).toBe(403);
  });

  it('a token for a project the user no longer owns stops working (deleted project)', async () => {
    const id = (await bob.post('/api/projects', { title: 'Bobs', aspect: '16:9' })).json.project.id;
    const url = new URL((await bob.post(`/api/projects/${id}/preview-token`)).json.url);
    expect((await get(url.pathname)).statusCode).toBe(200);
    await bob.del(`/api/projects/${id}`);
    expect((await get(url.pathname)).statusCode).toBe(404);
  });

  it('cannot read files outside the project through the preview (traversal, encoded, symlinks)', async () => {
    const base = previewUrl.pathname;
    for (const evil of ['../../../../etc/passwd', '..%2f..%2f..%2f..%2fetc%2fpasswd', '%2e%2e/%2e%2e/etc/passwd', 'assets/../../../../etc/passwd']) {
      const r = await get(base + evil);
      // normalised away by the URL parser (redirect/403) or refused by the file resolver (404) — never served
      expect([301, 403, 404], evil).toContain(r.statusCode);
      expect(r.body).not.toContain('root:');
    }
    const dir = toRef(t.db.select().from(projects).where(eq(projects.id, projectId)).get()!).dir;
    fs.symlinkSync('/etc/passwd', path.join(dir, 'public/leak.txt'));
    expect((await get(`${base}leak.txt`)).statusCode).toBe(404);
  });
});

describe('origin separation', () => {
  it('the app origin never serves project code, the preview origin never serves the API', async () => {
    const onApp = await t.app.inject({ method: 'GET', url: previewUrl.pathname, headers: { host: 'app.test' } });
    expect(onApp.statusCode).toBe(404);
    const apiOnPreview = await get('/api/projects');
    expect(apiOnPreview.statusCode).toBe(404);
    const me = await get('/api/auth/me');
    expect(me.statusCode).toBe(404);
  });

  it('honours X-Forwarded-Host behind a reverse proxy; health works on any host', async () => {
    const r = await t.app.inject({ method: 'GET', url: previewUrl.pathname, headers: { host: 'internal:8080', 'x-forwarded-host': 'preview.test' } });
    expect(r.statusCode).toBe(200);
    expect((await t.app.inject({ method: 'GET', url: '/api/health', headers: { host: 'whatever:1' } })).statusCode).toBe(200);
  });

  it('the preview origin gets no cookies from the app (and sets none)', async () => {
    const r = await get(previewUrl.pathname, { cookie: ada.cookie });
    expect(r.headers['set-cookie']).toBeUndefined();
  });
});
