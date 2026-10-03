import fs from 'node:fs';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { RunEvent } from '@luma/shared';
import { messages, projects, runEvents, runs } from '../db/schema.js';
import { toRef } from '../projects/service.js';
import { Client, makeTestApp, startMockLlm, type MockTurn } from '../test/helpers.js';

type T = Awaited<ReturnType<typeof makeTestApp>>;
let t: T;
let c: Client;
let llm: Awaited<ReturnType<typeof startMockLlm>>;
let projectId: string;
let turns: MockTurn[] = [];
let seen: any[] = [];

const KEY = 'sk-test-key-123456';

beforeAll(async () => {
  t = await makeTestApp({ agent: true });
  c = new Client(t.app);
  await c.signup('ada@example.com');
  llm = await startMockLlm({
    reasoning: true,
    script: (body) => {
      // summary requests (no tools) are answered with a fixed text; everything else follows the script
      if (body.tools?.[0]?.function?.name === 'get_time' || JSON.stringify(body.messages).includes('image_url')) return null; // connection test: default behaviour
      if (!body.tools) return { content: 'SUMMARY: the student wants a map video; scenes in public/js/scenes.' };
      seen.push(body);
      return turns.shift() ?? { content: 'Done.' };
    },
  });
  const model = (await c.post('/api/settings/models', { name: 'Mock', baseUrl: llm.url, apiKey: KEY, model: 'mock-1' })).json.model;
  await c.post(`/api/settings/models/${model.id}/test`);
  projectId = (await c.post('/api/projects', { title: 'Agent test', aspect: '16:9' })).json.project.id;
}, 60_000);

afterAll(async () => {
  await t.agent!.stopAll();
  await t.app.close();
  await llm.close();
});
afterEach(async () => {
  await t.agent!.stopAll();
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
const types = (events: RunEvent[]) => events.map((e) => e.type);
const of = <K extends RunEvent['type']>(events: RunEvent[], type: K) => events.filter((e) => e.type === type) as Array<RunEvent<K>>;

describe('agent loop', () => {
  it('streams a turn: reasoning, tools, file changes, commit and a clean finish', async () => {
    turns = [
      { reasoning: 'I should plan first.', content: 'Starting.', toolCalls: [
        { name: 'update_plan', args: { items: [{ text: 'Write scene', status: 'doing' }, { text: 'Check', status: 'todo' }] } },
        { name: 'write_file', args: { path: 'public/js/scenes/99-demo.js', content: 'export default function demo() {}\n' } },
      ] },
      { toolCalls: [{ name: 'bash', args: { command: 'echo hello > out.txt && cat out.txt && ls public/js/scenes' } }] },
      { toolCalls: [{ name: 'edit_file', args: { path: 'out.txt', old_string: 'hello', new_string: 'hello world' } }] },
      { content: 'All done — the demo scene exists.' },
    ];
    const { runId, events } = await runToEnd('Make a demo scene');
    const ts = types(events);
    expect(ts[0]).toBe('run.started');
    expect(ts.at(-1)).toBe('run.finished');
    expect(ts).toContain('reasoning.delta');
    expect(of(events, 'plan.updated')[0]!.data.items).toHaveLength(2);
    // tool.call precedes its tool.result, and ids pair up
    for (const call of of(events, 'tool.call')) {
      const res = of(events, 'tool.result').find((r) => r.data.callId === call.data.callId)!;
      expect(res, call.data.name).toBeTruthy();
      expect(res.id).toBeGreaterThan(call.id);
      expect(res.data.ok, `${call.data.name}: ${res.data.summary}`).toBe(true);
    }
    const outDeltas = of(events, 'tool.output.delta').map((e) => e.data.text).join('');
    expect(outDeltas).toContain('hello');
    expect(outDeltas).toContain('99-demo.js');
    const changed = of(events, 'file.changed').map((e) => `${e.data.change}:${e.data.path}`);
    expect(changed).toContain('created:public/js/scenes/99-demo.js');
    expect(changed).toContain('created:out.txt');
    expect(changed).toContain('modified:out.txt');
    const msg = of(events, 'message.delta').map((e) => e.data.text).join('');
    expect(msg).toContain('Starting.');
    expect(msg).toContain('All done');
    const commit = of(events, 'git.commit')[0]!;
    expect(commit.data.files).toEqual(expect.arrayContaining(['out.txt', 'public/js/scenes/99-demo.js']));
    expect(commit.data.message).toBe('All done — the demo scene exists.');
    const fin = of(events, 'run.finished')[0]!;
    expect(fin.data.stopReason).toBe('completed');
    expect(fin.data.usage.output).toBeGreaterThan(0);
    // the run row and the project history agree
    expect(t.db.select().from(runs).where(eq(runs.id, runId)).get()).toMatchObject({ status: 'finished' });
    const log = (await c.get(`/api/projects/${projectId}/git/log`)).json.commits;
    expect(log[0].message).toBe('All done — the demo scene exists.');
    expect(fs.readFileSync(path.join(dir(), 'out.txt'), 'utf8')).toBe('hello world\n');
    // the pinned plan survived on disk
    expect(JSON.parse(fs.readFileSync(path.join(dir(), '.luma/plan.json'), 'utf8'))).toHaveLength(2);
  });

  it('keeps a terminal history rebuilt from the stored events', async () => {
    const r = await c.get(`/api/projects/${projectId}/terminal`);
    expect(r.status).toBe(200);
    const bash = r.json.entries.filter((e: any) => e.name === 'bash');
    expect(bash.length).toBeGreaterThan(0);
    const last = bash.at(-1);
    expect(last.args.command).toContain('echo hello');
    expect(last.output).toContain('hello');
    expect(last.ok).toBe(true);
    expect(r.json.entries.some((e: any) => e.name === 'write_file')).toBe(false); // file edits live in the chat, not the terminal
    const other = new Client(t.app);
    await other.signup('eve@example.com');
    expect((await other.get(`/api/projects/${projectId}/terminal`)).status).toBe(404);
  });

  it('sends the system prompt, project facts, tool schemas and previous turns to the model', async () => {
    turns = [{ content: 'Sure.' }];
    await runToEnd('Second request');
    const req = seen[0];
    expect(req.stream).toBe(true);
    expect(req.messages[0].role).toBe('system');
    expect(req.messages[0].content).toContain('You are Luma');
    expect(req.messages[0].content).toContain('1920x1080');
    expect(req.messages[0].content).toContain('## Current project state');
    expect(req.messages[0].content).toContain('This project is EMPTY');
    expect(req.tools.map((x: any) => x.function.name).sort()).toEqual(['ask_user', 'bash', 'edit_file', 'generate_voice', 'list_files', 'list_voices', 'patch_voice', 'preview_frames', 'read_file', 'read_guide', 'render_video', 'update_plan', 'web_fetch', 'write_file']);
    // history from the earlier run is replayed, including its tool calls and results, in valid order
    const roles = req.messages.map((m: any) => m.role);
    expect(roles.filter((r: string) => r === 'user').length).toBeGreaterThanOrEqual(2);
    const ids = new Set(req.messages.flatMap((m: any) => (m.tool_calls ?? []).map((tc: any) => tc.id)));
    for (const m of req.messages.filter((m: any) => m.role === 'tool')) expect(ids.has(m.tool_call_id)).toBe(true);
    expect(req.messages.at(-1)).toMatchObject({ role: 'user', content: 'Second request' });
  });

  it('turns tool mistakes into errors the model can recover from', async () => {
    turns = [
      { toolCalls: [{ name: 'write_file', args: {}, rawArgs: '{"path": "a.txt", "content": "unterminated' }] },
      { toolCalls: [{ name: 'does_not_exist', args: {} }] },
      { toolCalls: [{ name: 'edit_file', args: { path: 'nope.txt', old_string: 'x', new_string: 'y' } }] },
      { toolCalls: [{ name: 'write_file', args: { path: '../../escape.txt', content: 'x' } }] },
      { content: 'Recovered.' },
    ];
    const { events } = await runToEnd('Break things');
    const results = of(events, 'tool.result');
    expect(results.map((r) => r.data.ok)).toEqual([false, false, false, false]);
    expect(results[0]!.data.summary).toMatch(/not valid JSON/);
    expect(results[1]!.data.summary).toMatch(/Unknown tool/);
    expect(results[3]!.data.summary).toMatch(/escapes the project/);
    expect(of(events, 'run.finished')[0]!.data.stopReason).toBe('completed');
    expect(fs.existsSync(path.join(dir(), '../escape.txt'))).toBe(false);
    // the model saw those errors in its next request
    const last = seen.at(-1);
    expect(JSON.stringify(last.messages)).toContain('Unknown tool');
  });

  it('assembles tool calls whose arguments arrive in many fragments', async () => {
    const big = 'x'.repeat(5000);
    turns = [{ toolCalls: [{ name: 'write_file', args: { path: 'big.txt', content: big } }] }, { content: 'ok' }];
    await runToEnd('write a big file');
    expect(fs.readFileSync(path.join(dir(), 'big.txt'), 'utf8')).toBe(big);
  });

  it('retries transient provider errors but not auth errors', async () => {
    turns = [{ status: 503, message: 'overloaded' }, { status: 429, message: 'slow down' }, { content: 'Back again.' }];
    const { events } = await runToEnd('hello');
    expect(of(events, 'run.error').map((e) => e.data.retryable)).toEqual([true, true]);
    expect(of(events, 'run.finished')[0]!.data.stopReason).toBe('completed');

    turns = [{ status: 401, message: 'Incorrect API key provided' }];
    const bad = await runToEnd('hello again');
    const err = of(bad.events, 'run.error')[0]!;
    expect(err.data.message).toMatch(/rejected your API key/);
    expect(err.data.retryable).toBe(false);
    expect(of(bad.events, 'run.finished')[0]!.data.stopReason).toBe('error');
    expect(t.db.select().from(runs).where(eq(runs.id, bad.runId)).get()!.status).toBe('error');
  });

  it('stops on request: kills the running command, answers dangling tool calls, and can run again', async () => {
    turns = [{ toolCalls: [{ name: 'bash', args: { command: 'sleep 60' } }, { name: 'bash', args: { command: 'echo never' } }] }];
    const r = await c.post(`/api/projects/${projectId}/runs`, { message: 'long job' });
    const run = t.agent!.getRun(r.json.runId)!;
    await new Promise((res) => setTimeout(res, 700));
    const t0 = Date.now();
    expect((await c.post(`/api/projects/${projectId}/runs/${r.json.runId}/stop`)).json.ok).toBe(true);
    await run.done;
    expect(Date.now() - t0).toBeLessThan(6000);
    const events = (await c.get(`/api/projects/${projectId}/runs/${r.json.runId}/events.json`)).json.events as RunEvent[];
    expect(of(events, 'run.finished')[0]!.data.stopReason).toBe('stopped');
    expect(t.db.select().from(runs).where(eq(runs.id, r.json.runId)).get()!.status).toBe('stopped');
    // every assistant tool_call has a tool message, so the next request is valid
    turns = [{ content: 'Fresh start.' }];
    await runToEnd('go on');
    const sent = seen.at(-1).messages;
    const callIds = sent.flatMap((m: any) => (m.tool_calls ?? []).map((tc: any) => tc.id));
    const answered = sent.filter((m: any) => m.role === 'tool').map((m: any) => m.tool_call_id);
    for (const id of callIds) expect(answered).toContain(id);
  });

  it('asks the student and continues with the answer', async () => {
    turns = [
      { toolCalls: [{ name: 'ask_user', args: { question: 'Which colour?', options: ['Blue', 'White'] } }] },
      { content: 'Going with white.' },
    ];
    const r = await c.post(`/api/projects/${projectId}/runs`, { message: 'surprise me' });
    const run = t.agent!.getRun(r.json.runId)!;
    for (let i = 0; i < 50 && !run.pending; i++) await new Promise((res) => setTimeout(res, 50));
    expect(run.pending?.question).toBe('Which colour?');
    expect((await c.get(`/api/projects/${projectId}/active-run`)).json.run.awaitingAnswer).toBe('Which colour?');
    expect((await c.post(`/api/projects/${projectId}/runs/${r.json.runId}/answer`, { answer: 'White' })).status).toBe(200);
    await run.done;
    const events = (await c.get(`/api/projects/${projectId}/runs/${r.json.runId}/events.json`)).json.events as RunEvent[];
    expect(of(events, 'ask_user')[0]!.data).toEqual({ question: 'Which colour?', options: ['Blue', 'White'] });
    expect(JSON.stringify(seen.at(-1).messages)).toContain('The student answered: White');
    expect((await c.post(`/api/projects/${projectId}/runs/${r.json.runId}/answer`, { answer: 'again' })).status).toBe(409);
  });

  it('allows one active run per project and per user', async () => {
    turns = [{ toolCalls: [{ name: 'bash', args: { command: 'sleep 5' } }] }];
    const first = await c.post(`/api/projects/${projectId}/runs`, { message: 'one' });
    expect(first.status).toBe(202);
    expect((await c.post(`/api/projects/${projectId}/runs`, { message: 'two' })).status).toBe(409);
    const other = (await c.post('/api/projects', { title: 'Other', aspect: '16:9' })).json.project.id;
    expect((await c.post(`/api/projects/${other}/runs`, { message: 'three' })).status).toBe(409);
    t.agent!.stop(first.json.runId);
    await t.agent!.getRun(first.json.runId)?.done;
  });

  it('refuses to start without a tested model or a message', async () => {
    expect((await c.post(`/api/projects/${projectId}/runs`, { message: '' })).status).toBe(400);
    const bob = new Client(t.app);
    await bob.signup('bob@example.com');
    const bp = (await bob.post('/api/projects', { title: 'B', aspect: '16:9' })).json.project.id;
    const noModel = await bob.post(`/api/projects/${bp}/runs`, { message: 'hi' });
    expect(noModel.status).toBe(409);
    expect(noModel.json.error.code).toBe('no_model');
    await bob.post('/api/settings/models', { name: 'Untested', baseUrl: llm.url, apiKey: KEY, model: 'x' });
    expect((await bob.post(`/api/projects/${bp}/runs`, { message: 'hi' })).json.error.code).toBe('model_untested');
    expect((await bob.post(`/api/projects/${projectId}/runs`, { message: 'hi' })).status).toBe(404);
  });
});

describe('events: persistence and SSE', () => {
  it('persists every event and replays after Last-Event-ID', async () => {
    turns = [{ toolCalls: [{ name: 'bash', args: { command: 'echo one; echo two' } }] }, { content: 'Hello there, this is a reply.' }];
    const { runId, events } = await runToEnd('replay me');
    expect(events.length).toBeGreaterThan(5);
    expect(t.db.select().from(runEvents).where(eq(runEvents.runId, runId)).all().length).toBe(events.length);
    const mid = events[2]!.id;
    const sse = await t.app.inject({ method: 'GET', url: `/api/projects/${projectId}/runs/${runId}/events`, headers: { cookie: c.cookie, 'last-event-id': String(mid) } });
    expect(sse.headers['content-type']).toContain('text/event-stream');
    const ids = [...sse.body.matchAll(/^id: (\d+)$/gm)].map((m) => Number(m[1]));
    expect(ids[0]).toBe(events[3]!.id);
    expect(ids.at(-1)).toBe(events.at(-1)!.id);
    expect(sse.body).toContain('event: run.finished');
  });

  it('streams live over HTTP, then ends with run.finished', async () => {
    await t.app.listen({ port: 0, host: '127.0.0.1' });
    const base = `http://127.0.0.1:${(t.app.server.address() as AddressInfo).port}`;
    turns = [{ toolCalls: [{ name: 'bash', args: { command: 'echo streaming; sleep 0.5; echo more' } }] }, { content: 'finished' }];
    const r = await fetch(`${base}/api/projects/${projectId}/runs`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: c.cookie, 'x-csrf-token': c.csrf }, body: JSON.stringify({ message: 'live' }) });
    const { runId } = (await r.json()) as { runId: string };
    const res = await fetch(`${base}/api/projects/${projectId}/runs/${runId}/events`, { headers: { cookie: c.cookie } });
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const text = await res.text(); // resolves when the server ends the stream (after run.finished)
    const got = [...text.matchAll(/^event: (.+)$/gm)].map((m) => m[1]);
    expect(got[0]).toBe('run.started');
    expect(got.at(-1)).toBe('run.finished');
    expect(got).toContain('tool.output.delta');
  });

  it('serves the conversation for the UI and keeps other users out', async () => {
    const conv = (await c.get(`/api/projects/${projectId}/messages`)).json.messages;
    expect(conv.length).toBeGreaterThan(3);
    expect(conv[0]).toMatchObject({ text: 'Make a demo scene', runStatus: 'finished' });
    const bob = new Client(t.app);
    await bob.signup('bob2@example.com');
    const runList = (await c.get(`/api/projects/${projectId}/runs`)).json.runs;
    expect((await bob.get(`/api/projects/${projectId}/runs/${runList[0].id}/events`)).status).toBe(404);
  });
});

describe('secrets never reach the model or the UI', () => {
  it('redacts the LLM key from command output', async () => {
    turns = [{ toolCalls: [{ name: 'bash', args: { command: `echo "my key is ${KEY}"` } }] }, { content: 'ok' }];
    const { events } = await runToEnd('leak the key');
    // what the command printed is scrubbed everywhere it can travel: live output, tool results, the model's context
    const outputs = JSON.stringify(of(events, 'tool.output.delta')) + JSON.stringify(of(events, 'tool.result'));
    const toolMessages = JSON.stringify(seen.at(-1).messages.filter((m: any) => m.role === 'tool'));
    expect(outputs).not.toContain(KEY);
    expect(toolMessages).not.toContain(KEY);
    expect(outputs).toContain('***');
    expect(JSON.stringify(of(events, 'tool.call'))).not.toContain(KEY); // even the model's own echo of it
  });
});

describe('context management', () => {
  it('folds old turns into a project memory when the window fills up', async () => {
    t.db.query.providerConfigs.findMany().sync(); // sanity: table reachable
    const provider = t.db.query.providerConfigs.findFirst().sync()!;
    t.sqlite.prepare('update provider_configs set context_window = 4200 where id = ?').run(provider.id);
    // a few bulky steps push the estimate over 70 % of the (tiny) window
    const bulk = 'lorem ipsum '.repeat(400);
    turns = [
      { toolCalls: [{ name: 'bash', args: { command: `echo "${bulk}"` } }] },
      { toolCalls: [{ name: 'bash', args: { command: `echo "${bulk}"` } }] },
      { toolCalls: [{ name: 'bash', args: { command: `echo "${bulk}"` } }] },
      { toolCalls: [{ name: 'bash', args: { command: `echo "${bulk}"` } }] },
      { content: 'Wrapped up.' },
    ];
    const { events } = await runToEnd('do lots of work and keep the context small');
    expect(of(events, 'run.finished')[0]!.data.stopReason).toBe('completed');
    const mem = t.sqlite.prepare('select summary, upto_rowid as u from memories where project_id = ?').get(projectId) as { summary: string; u: number } | undefined;
    expect(mem?.summary).toContain('SUMMARY');
    expect(mem!.u).toBeGreaterThan(0);
    expect(fs.readFileSync(path.join(dir(), '.luma/memory.md'), 'utf8')).toContain('SUMMARY');
    // after folding, the model gets the memory in its system prompt and fewer raw messages
    const last = seen.at(-1);
    expect(last.messages[0].content).toContain('## Project memory');
    t.sqlite.prepare('update provider_configs set context_window = 128000 where id = ?').run(provider.id);
  });
});

describe('restart safety', () => {
  it('marks runs left running by a dead process as failed', async () => {
    t.db.insert(runs).values({ id: 'ghost', projectId, status: 'running' }).run();
    t.agent!.resetStaleRuns();
    expect(t.db.select().from(runs).where(eq(runs.id, 'ghost')).get()!.status).toBe('error');
    const evs = t.agent!.events('ghost');
    expect(evs.map((e) => e.type)).toEqual(['run.error', 'run.finished']);
    // and the project is usable again
    turns = [{ content: 'alive' }];
    await runToEnd('still works?');
  });

  it('persists user messages with their role in the messages table', () => {
    const roles = new Set(t.db.select().from(messages).where(eq(messages.projectId, projectId)).all().map((m) => m.role));
    expect(roles).toEqual(new Set(['user', 'assistant', 'tool']));
    expect(roles.has('internal')).toBe(false); // none were needed in this file
  });
});
