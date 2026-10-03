import fs from 'node:fs';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { RunEvent } from '@luma/shared';
import { config } from '../config.js';
import { projects } from '../db/schema.js';
import { toRef } from '../projects/service.js';
import { Client, makeTestApp, startMockEleven, startMockLlm, type MockTurn } from '../test/helpers.js';
import { htmlToText } from './html-text.js';

let t: Awaited<ReturnType<typeof makeTestApp>>;
let c: Client;
let llm: Awaited<ReturnType<typeof startMockLlm>>;
let eleven: Awaited<ReturnType<typeof startMockEleven>>;
let projectId: string;
let turns: MockTurn[] = [];
let seen: any[] = [];
const realEleven = config.elevenBase;
const ELEVEN_KEY = 'xi-valid-key-123';

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63fcffff3f0005fe02fe0dcc9a8f0000000049454e44ae426082', 'hex');
const PDF = Buffer.from(`%PDF-1.1
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 200]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj
4 0 obj<</Length 47>>stream
BT /F1 24 Tf 20 100 Td (Brand brief: be bold) Tj ET
endstream
endobj
5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj
trailer<</Root 1 0 R/Size 6>>
%%EOF`);

beforeAll(async () => {
  config.sharedModules = path.resolve(process.cwd(), '../../template/node_modules');
  config.chromePath = process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
  t = await makeTestApp({ agent: true });
  c = new Client(t.app);
  await c.signup('ada@example.com');
  eleven = await startMockEleven(ELEVEN_KEY);
  config.elevenBase = eleven.base;
  llm = await startMockLlm({
    script: (body) => {
      if (body.tools?.[0]?.function?.name === 'get_time' || JSON.stringify(body.messages).includes('(1x1 red')) return null;
      if (!body.tools) return { content: 'SUMMARY' };
      seen.push(body);
      return turns.shift() ?? { content: 'Done.' };
    },
  });
  const model = (await c.post('/api/settings/models', { name: 'Mock', baseUrl: llm.url, apiKey: 'sk-test-key-123456', model: 'mock-1' })).json.model;
  const tested = await c.post(`/api/settings/models/${model.id}/test`);
  expect(tested.json.model.supportsVision).toBe(true);
  projectId = (await c.post('/api/projects', { title: 'Tools', aspect: '16:9' })).json.project.id;
}, 60_000);

afterAll(async () => {
  config.elevenBase = realEleven;
  await t.agent!.stopAll();
  await t.app.close();
  await llm.close();
  await eleven.close();
});
afterEach(() => {
  turns = [];
  seen = [];
});

const dir = () => toRef(t.db.select().from(projects).where(eq(projects.id, projectId)).get()!).dir;
async function runToEnd(message: string, extra: Record<string, unknown> = {}) {
  const r = await c.post(`/api/projects/${projectId}/runs`, { message, ...extra });
  expect(r.status, JSON.stringify(r.json)).toBe(202);
  await t.agent!.getRun(r.json.runId)?.done;
  const events = (await c.get(`/api/projects/${projectId}/runs/${r.json.runId}/events.json`)).json.events as RunEvent[];
  return { runId: r.json.runId as string, events };
}
const of = <K extends RunEvent['type']>(events: RunEvent[], type: K) => events.filter((e) => e.type === type) as Array<RunEvent<K>>;
const results = (events: RunEvent[]) => of(events, 'tool.result').map((r) => r.data);

describe('voice tools', () => {
  it('without a key: explains what to do, and placeholder mode still works', async () => {
    turns = [
      { toolCalls: [{ name: 'generate_voice', args: {} }] },
      { toolCalls: [{ name: 'generate_voice', args: { placeholder: true } }] },
      { content: 'ok' },
    ];
    const { events } = await runToEnd('make the voice');
    const r = results(events);
    expect(r[0]).toMatchObject({ ok: false });
    expect(r[0]!.summary).toMatch(/No ElevenLabs API key/);
    expect(r[1]!.ok).toBe(true);
    expect(of(events, 'voice.ready')[0]!.data.placeholder).toBe(true);
    const modelSaw = JSON.stringify(seen.at(-1).messages.filter((m: any) => m.role === 'tool'));
    expect(modelSaw).toMatch(/\d+:\w+@\d+\.\d\d/); // word index:word@start for every word
    expect(modelSaw).toContain('[title]');
  });

  it('with a key: replaces the script, calls ElevenLabs, returns word times, never leaks the key', async () => {
    await c.put('/api/settings/voice', { apiKey: ELEVEN_KEY });
    eleven.calls.length = 0;
    turns = [
      { toolCalls: [{ name: 'generate_voice', args: { segments: [{ id: 'hook', text: 'Hello big world.' }, { id: 'end', text: 'Bye now.' }] } }] },
      { toolCalls: [{ name: 'bash', args: { command: 'env | sort; cat script.json; grep -rl xi-valid . --include=* 2>/dev/null | head' } }] },
      { content: 'ok' },
    ];
    const { events } = await runToEnd('real voice');
    const r = results(events);
    expect(r[0]).toMatchObject({ ok: true });
    expect(eleven.calls).toHaveLength(1);
    expect(eleven.calls[0]!.text).toBe('Hello big world. Bye now.');
    const timing = JSON.parse(fs.readFileSync(path.join(dir(), 'public/audio/timing.json'), 'utf8'));
    expect(timing.segments.map((s: any) => s.id)).toEqual(['hook', 'end']);
    expect(timing.placeholder).toBeUndefined();
    expect(of(events, 'voice.ready')[0]!.data.segments.map((s) => s.id)).toEqual(['hook', 'end']);
    const modelSaw = JSON.stringify(seen.at(-1).messages);
    expect(modelSaw).toContain('0:Hello@0.00');
    expect(modelSaw).not.toContain(ELEVEN_KEY);
    // the key is not in the project, the command environment, or any event
    expect(JSON.stringify(events)).not.toContain(ELEVEN_KEY);
    expect(fs.readFileSync(path.join(dir(), 'script.json'), 'utf8')).not.toContain(ELEVEN_KEY);
  }, 60_000);

  it('patch_voice re-records one segment and shifts the later ones', async () => {
    const script = JSON.parse(fs.readFileSync(path.join(dir(), 'script.json'), 'utf8'));
    script.segments.splice(1, 0, { id: 'mid', text: 'Short.' });
    fs.writeFileSync(path.join(dir(), 'script.json'), JSON.stringify(script));
    // regenerate with three segments, then edit the middle one
    turns = [{ toolCalls: [{ name: 'generate_voice', args: {} }] }, { content: 'ok' }];
    await runToEnd('three segments');
    const before = JSON.parse(fs.readFileSync(path.join(dir(), 'public/audio/timing.json'), 'utf8'));
    script.segments[1].text = 'A much longer middle segment now.';
    fs.writeFileSync(path.join(dir(), 'script.json'), JSON.stringify(script));
    turns = [{ toolCalls: [{ name: 'patch_voice', args: { segment_id: 'mid' } }] }, { content: 'ok' }];
    const { events } = await runToEnd('patch the middle');
    expect(results(events)[0], JSON.stringify(results(events))).toMatchObject({ ok: true });
    const after = JSON.parse(fs.readFileSync(path.join(dir(), 'public/audio/timing.json'), 'utf8'));
    expect(after.segments[1].text).toBe('A much longer middle segment now.');
    expect(after.segments[2].start).toBeGreaterThan(before.segments[2].start + 0.5);
  }, 60_000);
});

describe('screenshots (preview_frames) and vision', () => {
  it('renders frames, serves them privately and hands them to a vision model', async () => {
    // back to the working starter voice so the page can build
    turns = [{ toolCalls: [{ name: 'generate_voice', args: { segments: [{ id: 'title', text: 'This whole video was built from a single prompt.' }, { id: 'map', text: 'Any country, any city. One smooth zoom.' }, { id: 'chart', text: 'Growth at a glance. Up and to the right.' }, { id: 'cta', text: 'Make yours today.' }] } }] }, { content: 'ok' }];
    await runToEnd('reset voice');
    turns = [{ toolCalls: [{ name: 'preview_frames', args: { times: [0.8, 5, 9], width: 640 } }] }, { content: 'Looks fine.' }];
    const { events } = await runToEnd('check the frames');
    const res = results(events).at(-1)!;
    expect(res.ok, res.summary).toBe(true);
    const pf = of(events, 'preview.frames')[0]!.data;
    expect(pf.issues, JSON.stringify(pf)).toEqual([]);
    expect(pf.frames.map((f) => f.t)).toEqual([0.8, 5, 9]);
    // owner can fetch the screenshot, others cannot, and it is a real PNG
    const png = await c.get(pf.frames[0]!.url);
    expect(png.status).toBe(200);
    expect(png.raw.rawPayload.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    const bob = new Client(t.app);
    await bob.signup('bob@example.com');
    expect((await bob.get(pf.frames[0]!.url)).status).toBe(404);
    expect((await c.get(`/api/projects/${projectId}/frames/123/..%2f..%2fx.png`)).status).toBe(404);
    // vision: the follow-up request carries the images
    const last = seen.at(-1).messages;
    const imgMsg = last.find((m: any) => Array.isArray(m.content) && m.content.some((p: any) => p.type === 'image_url'));
    expect(imgMsg).toBeTruthy();
    expect(imgMsg.content.filter((p: any) => p.type === 'image_url')).toHaveLength(3);
    expect(imgMsg.content[1].text ?? imgMsg.content[0].text).toBeTruthy();
    // ...but base64 images are not stored in the conversation
    const stored = t.sqlite.prepare("select content_json from messages where project_id = ? and content_json like '%Images from the tool results%'").all(projectId) as Array<{ content_json: string }>;
    expect(stored.length).toBeGreaterThan(0);
    expect(stored.every((r) => !r.content_json.includes('base64'))).toBe(true);
  }, 120_000);

  it('reports a broken video instead of a blank screenshot', async () => {
    fs.writeFileSync(path.join(dir(), 'public/js/scenes/00-title.js'), "export default function t(ctx) { ctx.w('title', 99); }\n");
    turns = [{ toolCalls: [{ name: 'preview_frames', args: { times: [1] } }] }, { content: 'ok' }];
    const { events } = await runToEnd('break it');
    const pf = of(events, 'preview.frames')[0]!.data;
    expect(pf.issues.join(' ')).toMatch(/failed to build.*w\('title', 99\)/);
    // restore
    const r = (await c.get(`/api/projects/${projectId}/git/log`)).json.commits;
    const first = r.at(-1).sha;
    expect((await c.post(`/api/projects/${projectId}/git/restore`, { sha: first })).status).toBe(200);
  }, 120_000);

  it('read_file shows images to vision models and says so to others', async () => {
    fs.mkdirSync(path.join(dir(), 'assets/uploads'), { recursive: true });
    fs.writeFileSync(path.join(dir(), 'assets/uploads/pic.png'), PNG);
    turns = [{ toolCalls: [{ name: 'read_file', args: { path: 'assets/uploads/pic.png' } }] }, { content: 'seen' }];
    await runToEnd('look at pic.png');
    const parts = seen.at(-1).messages.flatMap((m: any) => (Array.isArray(m.content) ? m.content : []));
    expect(parts.some((p: any) => p.type === 'image_url')).toBe(true);
    t.sqlite.prepare('update provider_configs set supports_vision = 0').run();
    turns = [{ toolCalls: [{ name: 'read_file', args: { path: 'assets/uploads/pic.png' } }] }, { content: 'seen' }];
    await runToEnd('look again');
    expect(JSON.stringify(seen.at(-1).messages)).toContain('cannot view images');
    t.sqlite.prepare('update provider_configs set supports_vision = 1').run();
  });
});

describe('attachments', () => {
  it('puts the PDF text and the image into the user message', async () => {
    const boundary = '----luma';
    const body = (name: string, data: Buffer) => ({
      payload: Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\n\r\n`), data, Buffer.from(`\r\n--${boundary}--\r\n`)]),
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
    });
    const a = await c.request('POST', `/api/projects/${projectId}/uploads`, body('brief.pdf', PDF));
    const b = await c.request('POST', `/api/projects/${projectId}/uploads`, body('logo.png', PNG));
    expect(a.status).toBe(201);
    turns = [{ content: 'Got the brief.' }];
    await runToEnd('Use my brand brief', { attachmentIds: [a.json.uploads[0].id, b.json.uploads[0].id] });
    const user = seen.at(-1).messages.findLast((m: any) => m.role === 'user');
    const text = user.content.filter((p: any) => p.type === 'text').map((p: any) => p.text).join('\n');
    expect(text).toContain('Use my brand brief');
    expect(text).toContain('assets/uploads/brief.pdf');
    expect(text).toContain('Brand brief: be bold');
    expect(user.content.some((p: any) => p.type === 'image_url')).toBe(true);
    // the stored (replayed) version is text only
    const conv = (await c.get(`/api/projects/${projectId}/messages`)).json.messages.at(-1);
    expect(conv.text, conv.text).toContain('assets/uploads/brief.pdf');
    expect(conv.text).toContain('assets/uploads/logo.png');
    expect(conv.attachmentIds).toHaveLength(2);
  }, 60_000);
});

describe('web_fetch', () => {
  it('refuses private and local addresses', async () => {
    turns = [
      { toolCalls: [{ name: 'web_fetch', args: { url: 'http://127.0.0.1:8080/api/health' } }, { name: 'web_fetch', args: { url: 'http://169.254.169.254/latest/meta-data/' } }, { name: 'web_fetch', args: { url: 'file:///etc/passwd' } }, { name: 'web_fetch', args: { url: 'http://localhost/' } }] },
      { content: 'ok' },
    ];
    const { events } = await runToEnd('fetch internal things');
    expect(results(events).map((r) => r.ok)).toEqual([false, false, false, false]);
    expect(results(events)[0]!.summary).toMatch(/not reachable/);
  });

  it('converts HTML to readable text', () => {
    const text = htmlToText('<html><head><title>x</title><script>evil()</script></head><body><h1>Title</h1><p>Hello <a href="https://a.b/c">link</a> &amp; <b>bold</b></p><ul><li>one</li><li>two</li></ul><pre>code()</pre></body></html>');
    expect(text).toContain('# Title');
    expect(text).toContain('[link](https://a.b/c)');
    expect(text).toContain('& bold');
    expect(text).toContain('- one');
    expect(text).not.toContain('evil');
  });
});

describe('render_video before the render pipeline exists', () => {
  it('fails gracefully', async () => {
    turns = [{ toolCalls: [{ name: 'render_video', args: { preset: 'draft' } }] }, { content: 'ok' }];
    const { events } = await runToEnd('render');
    expect(results(events)[0]!.ok).toBe(false);
  });
});
