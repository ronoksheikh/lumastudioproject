import { describe, expect, it } from 'vitest';
import type { RunEvent } from '@luma/shared';
import { emptyTurn, reduceAll, reduceEvent, splitOutput } from './reduce';

let id = 0;
const ev = <T extends RunEvent['type']>(type: T, data: unknown): RunEvent => ({ id: ++id, runId: 'r1', ts: 1000 + id, type, data: data as never });

describe('reduceEvent', () => {
  it('merges deltas into reasoning and text blocks in order', () => {
    id = 0;
    const t = reduceAll('r1', [
      ev('run.started', { model: 'm', userMessageId: 'u' }),
      ev('reasoning.delta', { text: 'think ' }), ev('reasoning.delta', { text: 'hard' }),
      ev('message.delta', { text: 'Hello ' }), ev('message.delta', { text: 'world' }),
      ev('reasoning.delta', { text: 'again' }),
    ]);
    expect(t.blocks.map((b) => b.kind)).toEqual(['reasoning', 'text', 'reasoning']);
    expect(t.blocks[0]).toMatchObject({ text: 'think hard' });
    expect(t.blocks[1]).toMatchObject({ text: 'Hello world' });
    expect(t.model).toBe('m');
  });

  it('builds a tool card: call → streamed output → file changes → result', () => {
    id = 0;
    const t = reduceAll('r1', [
      ev('tool.call', { callId: 'c1', name: 'bash', args: { command: 'echo hi' } }),
      ev('tool.output.delta', { callId: 'c1', stream: 'stdout', text: 'hi\n' }),
      ev('tool.output.delta', { callId: 'c1', stream: 'stderr', text: 'warn\n' }),
      ev('file.changed', { path: 'a.txt', change: 'created', additions: 2, deletions: 0 }),
      ev('file.changed', { path: 'a.txt', change: 'modified', additions: 1, deletions: 1 }),
      ev('tool.result', { callId: 'c1', ok: true, summary: 'exit 0', truncated: false }),
    ]);
    const tool = t.blocks[0]!;
    expect(tool).toMatchObject({ kind: 'tool', name: 'bash', status: 'ok', summary: 'exit 0' });
    if (tool.kind !== 'tool') throw new Error();
    expect(tool.files).toEqual([{ path: 'a.txt', change: 'created', additions: 3, deletions: 1, diff: undefined }]);
    expect(splitOutput(tool.output)).toEqual([{ text: 'hi\n', err: false }, { text: 'warn\n', err: true }]);
  });

  it('attaches voice, frames and renders to the running tool, plan to the turn', () => {
    id = 0;
    const t = reduceAll('r1', [
      ev('plan.updated', { items: [{ text: 'a', status: 'doing' }] }),
      ev('tool.call', { callId: 'v', name: 'generate_voice', args: {} }),
      ev('voice.ready', { duration: 12, segments: [], audioUrl: 'audio/voiceover.mp3' }),
      ev('tool.result', { callId: 'v', ok: true, summary: '12s', truncated: false }),
      ev('tool.call', { callId: 'p', name: 'preview_frames', args: {} }),
      ev('preview.frames', { frames: [{ t: 1, url: '/x.png' }], issues: ['overlap'] }),
      ev('tool.result', { callId: 'p', ok: true, summary: '1 frame', truncated: false }),
      ev('tool.call', { callId: 'r', name: 'render_video', args: {} }),
      ev('render.queued', { jobId: 'j1', position: 2 }),
      ev('render.progress', { jobId: 'j1', frame: 30, total: 300 }),
      ev('render.done', { jobId: 'j1', url: '/m.mp4' }),
    ]);
    expect(t.plan).toEqual([{ text: 'a', status: 'doing' }]);
    const [v, p, r] = t.blocks as Array<Extract<typeof t.blocks[number], { kind: 'tool' }>>;
    expect(v!.voice?.duration).toBe(12);
    expect(p!.frames?.issues).toEqual(['overlap']);
    expect(r!.render).toMatchObject({ state: 'done', url: '/m.mp4', frame: 30, total: 300 });
  });

  it('ignores events it already saw (SSE reconnect / replay overlap)', () => {
    id = 0;
    const events = [ev('message.delta', { text: 'a' }), ev('message.delta', { text: 'b' })];
    let t = reduceAll('r1', events);
    t = events.reduce(reduceEvent, t);
    expect(t.blocks[0]).toMatchObject({ text: 'ab' });
  });

  it('tracks asks, commits, notices and the finish', () => {
    id = 0;
    const t = reduceAll('r1', [
      ev('ask_user', { question: 'Q?', options: ['A', 'B'] }),
      ev('git.commit', { sha: 'abc', message: 'm', files: ['f'] }),
      ev('run.error', { message: 'retrying', retryable: true }),
      ev('run.finished', { usage: { input: 1, output: 2 }, stopReason: 'stopped' }),
    ]);
    expect(t.blocks.map((b) => b.kind)).toEqual(['ask', 'commit', 'notice']);
    expect(t.status).toBe('stopped');
    expect(t.usage).toEqual({ input: 1, output: 2 });
    expect(emptyTurn('x').status).toBe('running');
  });
});
