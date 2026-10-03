// The render queue, end to end, with a stand-in for template/scripts/render.mjs (the real script needs
// Chromium and takes minutes; it is exercised by template/test and by the manual benchmark).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RunEvent } from '@luma/shared';
import { config } from '../config.js';
import { renderJobs } from '../db/schema.js';
import { toRef, type ProjectRow } from '../projects/service.js';
import { Client, makeTestApp, startMockLlm, type MockTurn, seedExample } from '../test/helpers.js';
import { projects } from '../db/schema.js';
import { eq } from 'drizzle-orm';

const STUB = `
import fs from 'node:fs';
import path from 'node:path';
const a = process.argv.slice(2);
const get = (k) => a[a.indexOf('--' + k) + 1];
const root = get('root');
const cfg = fs.existsSync(path.join(root, 'stub.json')) ? JSON.parse(fs.readFileSync(path.join(root, 'stub.json'), 'utf8')) : {};
const total = 100;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
console.log('[luma] 1920x1080 30fps 3.00s ' + total + ' frames, ' + get('workers') + ' worker(s), preset ' + get('preset'));
for (let i = 0; i <= total; i += 25) {
  console.log('[luma] frame ' + i + '/' + total + ' ' + i + 's');
  await sleep(cfg.sleep ?? 30);
}
if (cfg.fail) { console.error('ffmpeg exploded'); process.exit(1); }
const out = get('out');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, Buffer.from('0123456789'.repeat(100)));
fs.writeFileSync(get('sheet'), Buffer.from('JPEGDATA'));
console.log(JSON.stringify({ render: { out, sheet: get('sheet'), preset: get('preset'), fps: 30, width: 1920, height: 1080, duration: 3, size: 1000, frames: total, workers: Number(get('workers')), seconds: 1,
  checks: [{ name: 'resolution', ok: true, detail: '1920x1080' }, { name: 'peak', ok: !cfg.clip, detail: cfg.clip ? '0.0 dBFS' : '-3 dBFS' }], ok: !cfg.clip } }));
`;

let t: Awaited<ReturnType<typeof makeTestApp>>;
let c: Client;
let llm: Awaited<ReturnType<typeof startMockLlm>>;
let projectId: string;
let project: ProjectRow;
let turns: MockTurn[] = [];
let tmpl: string;
const realTemplate = config.templateDir;

async function runToEnd(client: Client, pid: string, message: string) {
  const r = await client.post(`/api/projects/${pid}/runs`, { message });
  expect(r.status).toBe(202);
  const runId = r.json.runId as string;
  for (let i = 0; i < 400; i++) {
    const ev = (await client.get(`/api/projects/${pid}/runs/${runId}/events.json`)).json.events as RunEvent[];
    if (ev.some((e) => e.type === 'run.finished')) return { runId, events: ev };
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error('run did not finish');
}
const of = <K extends RunEvent['type']>(events: RunEvent[], type: K) => events.filter((e) => e.type === type) as Array<RunEvent<K>>;
const setStub = (cfg: object) => fs.writeFileSync(path.join(toRef(project).dir, 'stub.json'), JSON.stringify(cfg));

beforeAll(async () => {
  t = await makeTestApp({ agent: true, render: true });
  c = new Client(t.app);
  await c.signup('ada@example.com');
  llm = await startMockLlm({
    script: (body) => {
      if (body.tools?.[0]?.function?.name === 'get_time' || JSON.stringify(body.messages).includes('(1x1 red')) return null;
      if (!body.tools) return { content: 'SUMMARY' };
      return turns.shift() ?? { content: 'Done.' };
    },
  });
  const model = (await c.post('/api/settings/models', { name: 'Mock', baseUrl: llm.url, apiKey: 'sk-test-key-123456', model: 'mock-1' })).json.model;
  await c.post(`/api/settings/models/${model.id}/test`);
  projectId = (await c.post('/api/projects', { title: 'Render', aspect: '16:9' })).json.project.id;
  project = t.db.select().from(projects).where(eq(projects.id, projectId)).get()!;
  await seedExample(toRef(project)); // something to render (new projects start empty)

  tmpl = fs.mkdtempSync(path.join(os.tmpdir(), 'luma-stub-template-'));
  fs.mkdirSync(path.join(tmpl, 'scripts'));
  fs.writeFileSync(path.join(tmpl, 'scripts/render.mjs'), STUB);
  fs.chmodSync(tmpl, 0o755);
  fs.chmodSync(path.join(tmpl, 'scripts'), 0o755);
  fs.chmodSync(path.join(tmpl, 'scripts/render.mjs'), 0o644);
  config.templateDir = tmpl;
}, 60_000);

afterAll(async () => {
  config.templateDir = realTemplate;
  await t.render!.stop();
  await t.agent!.stopAll();
  await t.app.close();
  fs.rmSync(tmpl, { recursive: true, force: true });
});

describe('render_video', () => {
  it('queues, reports progress, stores the render and serves it', async () => {
    setStub({});
    turns = [{ toolCalls: [{ name: 'render_video', args: { preset: 'draft' } }] }, { content: 'Rendered.' }];
    const { events } = await runToEnd(c, projectId, 'render it');

    const result = of(events, 'tool.result').find((e) => e.data.summary.includes('render ready'));
    expect(result?.data.ok).toBe(true);
    expect(of(events, 'render.queued')).toHaveLength(1);
    const progress = of(events, 'render.progress').filter((e) => e.data.total > 0);
    expect(progress.length).toBeGreaterThan(0);
    expect(progress.at(-1)!.data.total).toBe(100);
    const done = of(events, 'render.done')[0]!;
    expect(done.data.url).toMatch(/\/renders\/[\w-]+\/file$/);
    expect(done.data.durationS).toBe(3);

    const list = (await c.get(`/api/projects/${projectId}/renders`)).json.renders;
    expect(list).toHaveLength(1);
    expect(list[0].preset).toBe('draft');
    expect(list[0].duration).toBe(3000);
    expect(t.db.select().from(renderJobs).get()).toMatchObject({ status: 'done', progress: 1000 });

    // whole file, with the right type
    const file = await c.get(list[0].url);
    expect(file.status).toBe(200);
    expect(file.headers['content-type']).toBe('video/mp4');
    expect(file.headers['accept-ranges']).toBe('bytes');
    expect(file.raw.rawPayload.length).toBe(1000);

    // ranges (the browser's <video> seeks with these)
    const part = await c.request('GET', list[0].url, { headers: { range: 'bytes=10-19' } });
    expect(part.status).toBe(206);
    expect(part.headers['content-range']).toBe('bytes 10-19/1000');
    expect(part.body).toBe('0123456789');
    const tail = await c.request('GET', list[0].url, { headers: { range: 'bytes=-5' } });
    expect(tail.headers['content-range']).toBe('bytes 995-999/1000');
    expect((await c.request('GET', list[0].url, { headers: { range: 'bytes=5000-' } })).status).toBe(416);
    expect((await c.request('GET', list[0].url, { headers: { range: 'bytes=abc' } })).status).toBe(416);

    expect((await c.get(list[0].contactSheetUrl)).headers['content-type']).toBe('image/jpeg');
    expect((await c.get(`${list[0].url}?download=1`)).headers['content-disposition']).toContain('attachment');
  });

  it('keeps renders private to their owner', async () => {
    const list = (await c.get(`/api/projects/${projectId}/renders`)).json.renders;
    const other = new Client(t.app);
    await other.signup('grace@example.com');
    expect((await other.get(list[0].url)).status).toBe(404);
    expect((await other.get(list[0].contactSheetUrl)).status).toBe(404);
    expect((await other.del(`/api/projects/${projectId}/renders/${list[0].id}`)).status).toBe(404);
    expect((await new Client(t.app).get(list[0].url)).status).toBe(401);
  });

  it('never follows a symlink swapped in for the MP4', async () => {
    const list = (await c.get(`/api/projects/${projectId}/renders`)).json.renders;
    const row = t.sqlite.prepare('select path from renders where id = ?').get(list[0].id) as { path: string };
    const abs = path.join(toRef(project).dir, row.path);
    const secret = path.join(os.tmpdir(), `luma-secret-${Date.now()}`);
    fs.writeFileSync(secret, 'TOP SECRET');
    const backup = fs.readFileSync(abs);
    fs.rmSync(abs);
    fs.symlinkSync(secret, abs);
    try {
      const r = await c.get(list[0].url);
      expect(r.status).toBe(404);
      expect(r.body).not.toContain('SECRET');
    } finally {
      fs.rmSync(abs);
      fs.writeFileSync(abs, backup);
      fs.rmSync(secret);
    }
  });

  it('reports a failed render to the model and marks the job', async () => {
    setStub({ fail: true });
    turns = [{ toolCalls: [{ name: 'render_video', args: { preset: 'final' } }] }, { content: 'It failed.' }];
    const { events } = await runToEnd(c, projectId, 'render final');
    const res = of(events, 'tool.result').at(-1)!;
    expect(res.data.ok).toBe(false);
    const call = of(events, 'tool.result').length;
    expect(call).toBeGreaterThan(0);
    const jobs = t.db.select().from(renderJobs).all();
    const failed = jobs.find((j) => j.status === 'error')!;
    expect(failed.error).toContain('ffmpeg exploded');
    expect(of(events, 'render.done')).toHaveLength(0);
  });

  it('tells the model about failed automatic checks', async () => {
    setStub({ clip: true });
    turns = [{ toolCalls: [{ name: 'render_video', args: { preset: 'draft' } }] }, { content: 'Clipping.' }];
    const { events } = await runToEnd(c, projectId, 'render again');
    expect(of(events, 'render.done')).toHaveLength(1);
    expect(of(events, 'tool.result').at(-1)!.data.ok).toBe(true);
  });

  it('stopping the run cancels the render', async () => {
    setStub({ sleep: 2000 });
    turns = [{ toolCalls: [{ name: 'render_video', args: { preset: 'draft' } }] }, { content: 'never' }];
    const r = await c.post(`/api/projects/${projectId}/runs`, { message: 'render and stop' });
    const runId = r.json.runId as string;
    for (let i = 0; i < 200 && !t.db.select().from(renderJobs).all().some((j) => j.status === 'running'); i++) await new Promise((x) => setTimeout(x, 25));
    expect(t.db.select().from(renderJobs).all().some((j) => j.status === 'running')).toBe(true);
    expect((await c.post(`/api/projects/${projectId}/runs/${runId}/stop`)).status).toBeLessThan(300);
    for (let i = 0; i < 200 && t.db.select().from(renderJobs).all().some((j) => j.status === 'running'); i++) await new Promise((x) => setTimeout(x, 25));
    const cancelled = t.db.select().from(renderJobs).all().filter((j) => j.status === 'error').at(-1)!;
    expect(cancelled.error).toBeTruthy();
    expect(t.cpu!.status().running).toBe(0); // the CPU slot came back
  });
});

describe('queue rules', () => {
  it('allows one active render per user', async () => {
    setStub({ sleep: 300 });
    const a = t.render!.enqueue({ projectId, userId: project.userId, preset: 'draft' });
    expect(() => t.render!.enqueue({ projectId, userId: project.userId, preset: 'draft' })).toThrow(/already have a render/);
    for (let i = 0; i < 400 && t.db.select().from(renderJobs).all().find((j) => j.id === a)?.status !== 'done'; i++) await new Promise((x) => setTimeout(x, 25));
    expect(t.db.select().from(renderJobs).all().find((j) => j.id === a)?.status).toBe('done');
    expect(() => t.render!.enqueue({ projectId, userId: project.userId, preset: 'draft' })).not.toThrow();
    for (let i = 0; i < 400 && t.db.select().from(renderJobs).all().some((j) => j.status !== 'done' && j.status !== 'error'); i++) await new Promise((x) => setTimeout(x, 25));
  });

  it('requeues jobs that were running when the server died', async () => {
    setStub({});
    const id = 'stale-job';
    t.db.insert(renderJobs).values({ id, projectId, userId: project.userId, preset: 'draft', status: 'running', startedAt: Date.now(), progress: 400 }).run();
    t.render!.resetStale();
    expect(t.db.select().from(renderJobs).where(eq(renderJobs.id, id)).get()).toMatchObject({ status: 'queued', progress: 0, startedAt: null });
    // the poller then picks it up again and finishes it
    for (let i = 0; i < 400 && t.db.select().from(renderJobs).where(eq(renderJobs.id, id)).get()?.status !== 'done'; i++) await new Promise((x) => setTimeout(x, 25));
    expect(t.db.select().from(renderJobs).where(eq(renderJobs.id, id)).get()!.status).toBe('done');
  });

  it('lets the student delete a render and its files', async () => {
    const list = (await c.get(`/api/projects/${projectId}/renders`)).json.renders;
    const row = t.sqlite.prepare('select path from renders where id = ?').get(list[0].id) as { path: string };
    expect(fs.existsSync(path.join(toRef(project).dir, row.path))).toBe(true);
    expect((await c.del(`/api/projects/${projectId}/renders/${list[0].id}`)).status).toBe(200);
    expect(fs.existsSync(path.join(toRef(project).dir, row.path))).toBe(false);
    expect((await c.get(list[0].url)).status).toBe(404);
  });
});
