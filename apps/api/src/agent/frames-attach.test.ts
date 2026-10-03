// "Attach this frame": the student's chosen moments reach the model as facts (+ images for vision models),
// through one CPU-budget capture, without adding anything to the project.
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { RunEvent } from '@luma/shared';
import { config } from '../config.js';
import { projects } from '../db/schema.js';
import { git } from '../projects/dirs.js';
import { toRef } from '../projects/service.js';
import { Client, makeTestApp, seedExample, startMockLlm, type MockTurn } from '../test/helpers.js';

let t: Awaited<ReturnType<typeof makeTestApp>>;
let c: Client;
let llm: Awaited<ReturnType<typeof startMockLlm>>;
let projectId: string;
let turns: MockTurn[] = [];
let seen: any[] = [];

beforeAll(async () => {
  config.sharedModules = path.resolve(process.cwd(), '../../template/node_modules');
  config.chromePath = process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
  t = await makeTestApp({ agent: true, render: true });
  c = new Client(t.app);
  await c.signup('ada@example.com');
  llm = await startMockLlm({
    script: (body) => {
      if (body.tools?.[0]?.function?.name === 'get_time' || (!body.tools && JSON.stringify(body.messages).includes('image_url'))) return null;
      if (!body.tools) return { content: 'SUMMARY' };
      seen.push(body);
      return turns.shift() ?? { content: 'Done.' };
    },
  });
  const model = (await c.post('/api/settings/models', { name: 'Mock', baseUrl: llm.url, apiKey: 'sk-test-key-123456', model: 'mock-1' })).json.model;
  await c.post(`/api/settings/models/${model.id}/test`);
  projectId = (await c.post('/api/projects', { title: 'Frames', aspect: '16:9' })).json.project.id;
  await seedExample(ref());
}, 60_000);
afterAll(async () => {
  await t.render!.stop();
  await t.agent!.stopAll();
  await t.app.close();
  await llm.close();
});

const ref = () => toRef(t.db.select().from(projects).where(eq(projects.id, projectId)).get()!);
async function send(message: string, frames: number[]) {
  const r = await c.post(`/api/projects/${projectId}/runs`, { message, frames });
  expect(r.status, JSON.stringify(r.json)).toBe(202);
  await t.agent!.getRun(r.json.runId)?.done;
  return (await c.get(`/api/projects/${projectId}/runs/${r.json.runId}/events.json`)).json.events as RunEvent[];
}
const userMsg = () => seen.at(-1).messages.findLast((m: any) => m.role === 'user');
const textOf = (m: any) => (typeof m.content === 'string' ? m.content : m.content.filter((p: any) => p.type === 'text').map((p: any) => p.text).join('\n'));

describe('attach this frame', () => {
  it('gives a vision model the image and the facts at that time, via one CPU-budget slot, adding nothing to the project', async () => {
    const run = vi.spyOn(t.cpu!, 'run');
    turns = [{ content: 'I see the title scene.' }];
    const status = () => git(ref(), ['status', '--porcelain', '--untracked-files=all']).stdout;
    const before = status();
    await send('The title here looks off', [1.2, 6]);
    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0]![1]).toMatchObject({ label: 'frame attachment' });
    run.mockRestore();

    const u = userMsg();
    const text = textOf(u);
    expect(text).toContain('The title here looks off');
    expect(text).toContain('Frame the student attached: t=1.20s');
    expect(text).toMatch(/Voice: segment "title" .* at word 2 "video"/);
    expect(text).toContain('Scenes on screen: s-title');
    expect(text).toMatch(/Text on screen: .*"MADE WITH LUMA STUDIO"/);
    expect(text).toContain('Frame the student attached: t=6.00s');
    expect(text).toContain('segment "map"');
    expect(u.content.filter((p: any) => p.type === 'image_url')).toHaveLength(2);
    // no PNG (or anything else) was added to the project, nothing was re-rendered
    expect(status()).toBe(before);
    expect((await c.get(`/api/projects/${projectId}/renders`)).json.renders).toEqual([]);

    // the sent message shows the frames; their thumbnails are private to the owner
    const msg = (await c.get(`/api/projects/${projectId}/messages`)).json.messages.at(-1);
    expect(msg.text.startsWith('The title here looks off')).toBe(true);
    expect(msg.frames.map((f: any) => [f.t, f.ready])).toEqual([[1.2, true], [6, true]]);
    const png = await c.get(msg.frames[0].url);
    expect(png.status).toBe(200);
    expect(png.raw.rawPayload.subarray(0, 4).toString('hex')).toBe('89504e47');
    const bob = new Client(t.app);
    await bob.signup('bob@example.com');
    expect((await bob.get(msg.frames[0].url)).status).toBe(404);
  }, 120_000);

  it('a model without vision still gets the facts (and a replay keeps them)', async () => {
    t.sqlite.prepare('update provider_configs set supports_vision = 0').run();
    turns = [{ content: 'ok' }];
    await send('What is on screen at the end?', [11]);
    const u = userMsg();
    expect(JSON.stringify(u)).not.toContain('image_url');
    expect(textOf(u)).toContain('Frame the student attached: t=11.00s');
    expect(textOf(u)).toContain('segment "cta"');
    // the next turn replays the stored message with the facts
    turns = [{ content: 'ok' }];
    await send('thanks', []);
    expect(JSON.stringify(seen.at(-1).messages)).toContain('Frame the student attached: t=11.00s');
    t.sqlite.prepare('update provider_configs set supports_vision = 1').run();
  }, 120_000);

  it('an empty project explains that there is nothing to show yet', async () => {
    const empty = (await c.post('/api/projects', { title: 'Empty', aspect: '16:9' })).json.project.id;
    turns = [{ content: 'ok' }];
    const r = await c.post(`/api/projects/${empty}/runs`, { message: 'look', frames: [2] });
    await t.agent!.getRun(r.json.runId)?.done;
    expect(textOf(userMsg())).toMatch(/t=2\.00s — there is no playable video yet/);
  }, 60_000);
});
