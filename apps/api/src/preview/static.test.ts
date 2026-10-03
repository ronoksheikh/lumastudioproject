import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resolvePreviewFile, servePreview } from './static.js';

let dir: string;
let shared: string;
let app: FastifyInstance;

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'luma-prev-'));
  shared = fs.mkdtempSync(path.join(os.tmpdir(), 'luma-shared-'));
  for (const f of ['public/index.html', 'public/audio/v.mp3', 'assets/logo.svg', 'project.json', 'node_modules/local/index.js']) {
    fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
    fs.writeFileSync(path.join(dir, f), f === 'public/audio/v.mp3' ? '0123456789' : `content of ${f}`);
  }
  fs.mkdirSync(path.join(shared, 'three/build'), { recursive: true });
  fs.writeFileSync(path.join(shared, 'three/build/three.module.js'), 'THREE');
  fs.writeFileSync(path.join(shared, 'secret.txt'), 'nope');
  fs.symlinkSync('/etc/passwd', path.join(dir, 'public/leak'));
  fs.symlinkSync('/etc', path.join(dir, 'assets/etc'));
  app = Fastify();
  app.get('/*', (req, reply) => servePreview(req, reply, dir, req.url));
  await app.ready();
});
afterAll(async () => {
  await app.close();
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(shared, { recursive: true, force: true });
});

describe('preview file mapping', () => {
  it('maps / to public/index.html, /assets to assets, root json files, /vendor project-first', () => {
    expect(resolvePreviewFile(dir, '/', shared)).toBe(fs.realpathSync(path.join(dir, 'public/index.html')));
    expect(resolvePreviewFile(dir, '/assets/logo.svg', shared)).toContain('assets/logo.svg');
    expect(resolvePreviewFile(dir, '/project.json', shared)).toContain('project.json');
    expect(resolvePreviewFile(dir, '/vendor/local/index.js', shared)).toContain('node_modules/local/index.js');
    expect(resolvePreviewFile(dir, '/vendor/three/build/three.module.js', shared)).toBe(fs.realpathSync(path.join(shared, 'three/build/three.module.js')));
  });
  it('refuses traversal, symlink escapes and unknown files', () => {
    expect(resolvePreviewFile(dir, '/../project.json', shared)).toBeNull();
    expect(resolvePreviewFile(dir, '/vendor/../../secret.txt', shared)).toBeNull();
    expect(resolvePreviewFile(dir, '/leak', shared)).toBeNull();
    expect(resolvePreviewFile(dir, '/assets/etc/passwd', shared)).toBeNull();
    expect(resolvePreviewFile(dir, '/%2e%2e/%2e%2e/etc/passwd', shared)).toBeNull();
    expect(resolvePreviewFile(dir, '/nope.js', shared)).toBeNull();
    expect(resolvePreviewFile(dir, '/script.json', shared)).toBeNull(); // not present
  });
});

describe('preview http', () => {
  it('serves with content types and ranges; 416 when unsatisfiable', async () => {
    const full = await app.inject({ url: '/audio/v.mp3' });
    expect(full.statusCode).toBe(200);
    expect(full.headers['content-type']).toBe('audio/mpeg');
    expect(full.headers['accept-ranges']).toBe('bytes');
    const part = await app.inject({ url: '/audio/v.mp3', headers: { range: 'bytes=2-5' } });
    expect(part.statusCode).toBe(206);
    expect(part.body).toBe('2345');
    expect(part.headers['content-range']).toBe('bytes 2-5/10');
    const tail = await app.inject({ url: '/audio/v.mp3', headers: { range: 'bytes=-3' } });
    expect(tail.body).toBe('789');
    const bad = await app.inject({ url: '/audio/v.mp3', headers: { range: 'bytes=500-' } });
    expect(bad.statusCode).toBe(416);
    expect(bad.headers['content-range']).toBe('bytes */10');
    expect((await app.inject({ url: '/missing' })).statusCode).toBe(404);
  });
});
