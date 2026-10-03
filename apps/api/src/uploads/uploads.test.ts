import fs from 'node:fs';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { config } from '../config.js';
import { projects, uploads } from '../db/schema.js';
import { toRef } from '../projects/service.js';
import { Client, makeTestApp } from '../test/helpers.js';
import { safeName, sniffUpload } from './sniff.js';

let t: Awaited<ReturnType<typeof makeTestApp>>;
let c: Client;
let projectId: string;

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63fcffff3f0005fe02fe0dcc9a8f0000000049454e44ae426082', 'hex');
const SVG = Buffer.from('<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>');
const PDF = Buffer.from(`%PDF-1.1
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 200]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj
4 0 obj<</Length 47>>stream
BT /F1 24 Tf 20 100 Td (Hello Luma PDF) Tj ET
endstream
endobj
5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj
trailer<</Root 1 0 R/Size 6>>
%%EOF`);

function multipartBody(files: Array<{ name: string; data: Buffer }>) {
  const boundary = '----luma' + Math.random().toString(16).slice(2);
  const chunks: Buffer[] = [];
  for (const f of files) {
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${f.name}"\r\nContent-Type: application/octet-stream\r\n\r\n`), f.data, Buffer.from('\r\n'));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return { payload: Buffer.concat(chunks), headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}

beforeAll(async () => {
  t = await makeTestApp();
  c = new Client(t.app);
  await c.signup('ada@example.com');
  projectId = (await c.post('/api/projects', { title: 'Uploads', aspect: '16:9' })).json.project.id;
}, 30_000);
afterAll(async () => {
  await t.app.close();
});

const upload = (files: Array<{ name: string; data: Buffer }>) => c.request('POST', `/api/projects/${projectId}/uploads`, multipartBody(files));

describe('type sniffing', () => {
  it('decides from bytes, not names', () => {
    expect(sniffUpload(PNG)?.mime).toBe('image/png');
    expect(sniffUpload(SVG)?.mime).toBe('image/svg+xml');
    expect(sniffUpload(PDF)?.mime).toBe('application/pdf');
    expect(sniffUpload(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]))?.mime).toBe('image/jpeg');
    expect(sniffUpload(Buffer.from('<html><script>alert(1)</script></html>'))).toBeNull();
    expect(sniffUpload(Buffer.from('MZ\x90\x00 exe'))).toBeNull();
  });
  it('sanitises file names', () => {
    expect(safeName('../../etc/pass wd?.PNG', 'png')).toBe('pass-wd.png');
    expect(safeName('C:\\Users\\me\\Logo (final).svg', 'svg')).toBe('Logo-final.svg');
    expect(safeName('...', 'png')).toBe('file.png');
  });
});

describe('POST /projects/:id/uploads', () => {
  it('saves a PNG and an SVG into assets/uploads, owned by the project', async () => {
    const r = await upload([{ name: 'my logo.png', data: PNG }, { name: 'mark.svg', data: SVG }]);
    expect(r.status).toBe(201);
    expect(r.json.uploads.map((u: any) => u.path)).toEqual(['assets/uploads/my-logo.png', 'assets/uploads/mark.svg']);
    const dir = toRef(t.db.select().from(projects).where(eq(projects.id, projectId)).get()!).dir;
    expect(fs.readFileSync(path.join(dir, 'assets/uploads/mark.svg'))).toEqual(SVG);
    if (typeof process.getuid === 'function' && process.getuid() === 0) {
      expect(fs.statSync(path.join(dir, 'assets/uploads/mark.svg')).uid).toBeGreaterThanOrEqual(100000);
    }
  });

  it('never overwrites: a second file with the same name gets a suffix', async () => {
    const r = await upload([{ name: 'mark.svg', data: SVG }]);
    expect(r.json.uploads[0].path).toBe('assets/uploads/mark-2.svg');
  });

  it('extracts text and page images from a PDF', async () => {
    const r = await upload([{ name: 'brief.pdf', data: PDF }]);
    expect(r.status).toBe(201);
    const up = r.json.uploads[0];
    expect(up.mime).toBe('application/pdf');
    const paths = up.derived.map((d: any) => d.path);
    expect(paths).toContain('assets/uploads/brief.txt');
    expect(paths.some((p: string) => /brief-page-1\.png$/.test(p))).toBe(true);
    const dir = toRef(t.db.select().from(projects).where(eq(projects.id, projectId)).get()!).dir;
    expect(fs.readFileSync(path.join(dir, 'assets/uploads/brief.txt'), 'utf8')).toContain('Hello Luma PDF');
  });

  it('lists attachments and deletes a PDF together with what was derived from it', async () => {
    const list = (await c.get(`/api/projects/${projectId}/uploads`)).json.uploads;
    const pdf = list.find((u: any) => u.mime === 'application/pdf');
    expect((await c.del(`/api/projects/${projectId}/uploads/${pdf.id}`)).status).toBe(200);
    const after = (await c.get(`/api/projects/${projectId}/uploads`)).json.uploads.map((u: any) => u.path);
    expect(after.some((p: string) => p.includes('brief'))).toBe(false);
  });

  it('rejects unsupported types, empty files and oversized files', async () => {
    expect((await upload([{ name: 'notes.html', data: Buffer.from('<script>alert(1)</script>') }])).status).toBe(400);
    expect((await upload([{ name: 'empty.png', data: Buffer.alloc(0) }])).status).toBe(400);
    const big = Buffer.concat([PNG, Buffer.alloc(config.uploadMaxBytes + 10)]);
    expect((await upload([{ name: 'big.png', data: big }])).status).toBe(413);
  });

  it('enforces the per-project total', async () => {
    t.db.insert(uploads).values({ id: 'fill', projectId, path: 'assets/uploads/fill.bin', mime: 'x', size: config.uploadProjectMaxBytes - 10 }).run();
    expect((await upload([{ name: 'one-more.png', data: PNG }])).status).toBe(413);
    t.db.delete(uploads).where(eq(uploads.id, 'fill')).run();
  });

  it('only the owner can upload', async () => {
    const bob = new Client(t.app);
    await bob.signup('bob@example.com');
    const r = await bob.request('POST', `/api/projects/${projectId}/uploads`, multipartBody([{ name: 'a.png', data: PNG }]));
    expect(r.status).toBe(404);
  });
});
