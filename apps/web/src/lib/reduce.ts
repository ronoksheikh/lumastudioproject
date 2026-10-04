// Turns the flat run-event stream into the blocks the chat renders. Pure: the same reducer handles
// live SSE events and a replay from the database.
import type { EventDataMap, PlanItem, RunEvent, StopReason } from '@luma/shared';

export interface FileChange {
  path: string;
  change: 'created' | 'modified' | 'deleted';
  additions: number;
  deletions: number;
  diff?: string;
}

export type Block =
  | { kind: 'reasoning'; id: number; text: string }
  | { kind: 'text'; id: number; text: string }
  | {
      kind: 'tool';
      id: number;
      callId: string;
      name: string;
      args: unknown;
      output: string;
      status: 'running' | 'ok' | 'error';
      summary?: string;
      truncated?: boolean;
      files: FileChange[];
      voice?: EventDataMap['voice.ready'];
      frames?: EventDataMap['preview.frames'];
      render?: { jobId: string; state: 'queued' | 'running' | 'done'; position?: number; frame?: number; total?: number; eta?: number; url?: string; contactSheetUrl?: string; durationS?: number };
      startedAt: number;
      endedAt?: number;
    }
  | { kind: 'ask'; id: number; question: string; options: string[]; answer?: string }
  | ({ kind: 'offer'; id: number } & EventDataMap['billing.offer'])
  | { kind: 'commit'; id: number; sha: string; message: string; files: string[] }
  | { kind: 'notice'; id: number; message: string; retryable: boolean };

export interface TurnState {
  runId: string;
  status: 'running' | 'finished' | 'stopped' | 'error';
  blocks: Block[];
  plan: PlanItem[] | null;
  model?: string;
  usage?: { input: number; output: number };
  stopReason?: StopReason;
  lastEventId: number;
  startedAt?: number;
  finishedAt?: number;
}

export const emptyTurn = (runId: string): TurnState => ({ runId, status: 'running', blocks: [], plan: null, lastEventId: 0 });

const MAX_OUTPUT = 200_000;

const lastOpenTool = (blocks: Block[]) => {
  for (let i = blocks.length - 1; i >= 0; i--) {
    const b = blocks[i]!;
    if (b.kind === 'tool' && b.status === 'running') return i;
  }
  return -1;
};

function updateTool(blocks: Block[], index: number, fn: (b: Extract<Block, { kind: 'tool' }>) => Extract<Block, { kind: 'tool' }>): Block[] {
  const b = blocks[index];
  if (!b || b.kind !== 'tool') return blocks;
  const next = blocks.slice();
  next[index] = fn(b);
  return next;
}

export function reduceEvent(turn: TurnState, e: RunEvent): TurnState {
  if (e.id <= turn.lastEventId) return turn; // replay + live overlap
  const t: TurnState = { ...turn, lastEventId: e.id };
  const blocks = t.blocks;
  const last = blocks.at(-1);

  switch (e.type) {
    case 'run.started': {
      const d = e.data as EventDataMap['run.started'];
      return { ...t, model: d.model, startedAt: e.ts };
    }
    case 'reasoning.delta': {
      const { text } = e.data as EventDataMap['reasoning.delta'];
      if (last?.kind === 'reasoning') return { ...t, blocks: [...blocks.slice(0, -1), { ...last, text: last.text + text }] };
      return { ...t, blocks: [...blocks, { kind: 'reasoning', id: e.id, text }] };
    }
    case 'message.delta': {
      const { text } = e.data as EventDataMap['message.delta'];
      if (last?.kind === 'text') return { ...t, blocks: [...blocks.slice(0, -1), { ...last, text: last.text + text }] };
      return { ...t, blocks: [...blocks, { kind: 'text', id: e.id, text }] };
    }
    case 'plan.updated':
      return { ...t, plan: (e.data as EventDataMap['plan.updated']).items };
    case 'tool.call': {
      const d = e.data as EventDataMap['tool.call'];
      return { ...t, blocks: [...blocks, { kind: 'tool', id: e.id, callId: d.callId, name: d.name, args: d.args, output: '', status: 'running', files: [], startedAt: e.ts }] };
    }
    case 'tool.output.delta': {
      const d = e.data as EventDataMap['tool.output.delta'];
      const i = blocks.findIndex((b) => b.kind === 'tool' && b.callId === d.callId);
      if (i < 0) return t;
      const text = d.stream === 'stderr' ? `\u0001${d.text}\u0002` : d.text; // markers: stderr runs
      return { ...t, blocks: updateTool(blocks, i, (b) => ({ ...b, output: (b.output + text).slice(-MAX_OUTPUT) })) };
    }
    case 'tool.result': {
      const d = e.data as EventDataMap['tool.result'];
      const i = blocks.findIndex((b) => b.kind === 'tool' && b.callId === d.callId);
      if (i < 0) return t;
      return { ...t, blocks: updateTool(blocks, i, (b) => ({ ...b, status: d.ok ? 'ok' : 'error', summary: d.summary, truncated: d.truncated, endedAt: e.ts })) };
    }
    case 'file.changed': {
      const d = e.data as EventDataMap['file.changed'];
      const i = lastOpenTool(blocks);
      const change: FileChange = { path: d.path, change: d.change, additions: d.additions, deletions: d.deletions, diff: d.diff };
      if (i < 0) return t;
      return {
        ...t,
        blocks: updateTool(blocks, i, (b) => {
          const files = b.files.filter((f) => f.path !== change.path);
          // keep a created file "created" even if the same call edits it again
          const prev = b.files.find((f) => f.path === change.path);
          return { ...b, files: [...files, prev?.change === 'created' && change.change === 'modified' ? { ...change, change: 'created' as const, additions: prev.additions + change.additions } : change] };
        }),
      };
    }
    case 'voice.ready': {
      const i = lastOpenTool(blocks);
      return i < 0 ? t : { ...t, blocks: updateTool(blocks, i, (b) => ({ ...b, voice: e.data as EventDataMap['voice.ready'] })) };
    }
    case 'preview.frames': {
      const i = lastOpenTool(blocks);
      return i < 0 ? t : { ...t, blocks: updateTool(blocks, i, (b) => ({ ...b, frames: e.data as EventDataMap['preview.frames'] })) };
    }
    case 'render.queued':
    case 'render.progress':
    case 'render.done': {
      const d = e.data as { jobId: string } & Record<string, unknown>;
      let i = blocks.findIndex((b) => b.kind === 'tool' && b.render?.jobId === d.jobId);
      if (i < 0) i = lastOpenTool(blocks);
      if (i < 0) return t;
      return {
        ...t,
        blocks: updateTool(blocks, i, (b) => {
          const r = b.render ?? { jobId: d.jobId, state: 'queued' as const };
          if (e.type === 'render.queued') return { ...b, render: { ...r, state: 'queued', position: d.position as number } };
          if (e.type === 'render.progress') return { ...b, render: { ...r, state: d.total ? 'running' : 'queued', frame: d.frame as number, total: d.total as number, eta: d.eta as number | undefined, position: d.position as number | undefined } };
          return { ...b, render: { ...r, state: 'done', url: d.url as string, contactSheetUrl: d.contactSheetUrl as string | undefined, durationS: d.durationS as number | undefined } };
        }),
      };
    }
    case 'ask_user': {
      const d = e.data as EventDataMap['ask_user'];
      return { ...t, blocks: [...blocks, { kind: 'ask', id: e.id, question: d.question, options: d.options }] };
    }
    case 'billing.offer':
      return { ...t, blocks: [...blocks, { kind: 'offer', id: e.id, ...(e.data as EventDataMap['billing.offer']) }] };
    case 'git.commit': {
      const d = e.data as EventDataMap['git.commit'];
      return { ...t, blocks: [...blocks, { kind: 'commit', id: e.id, sha: d.sha, message: d.message, files: d.files }] };
    }
    case 'run.error': {
      const d = e.data as EventDataMap['run.error'];
      return { ...t, blocks: [...blocks, { kind: 'notice', id: e.id, message: d.message, retryable: d.retryable }] };
    }
    case 'run.finished': {
      const d = e.data as EventDataMap['run.finished'];
      const status = d.stopReason === 'stopped' ? 'stopped' : d.stopReason === 'error' ? 'error' : 'finished';
      return { ...t, status, usage: d.usage, stopReason: d.stopReason, finishedAt: e.ts };
    }
    default:
      return t;
  }
}

/** Marks `ask_user` blocks as answered once the matching tool result arrives (the answer is in the tool result text). */
export function answerAsk(turn: TurnState, answer: string): TurnState {
  const blocks = turn.blocks.map((b) => (b.kind === 'ask' && b.answer === undefined ? { ...b, answer } : b));
  return { ...turn, blocks };
}

export function reduceAll(runId: string, events: RunEvent[]): TurnState {
  return events.reduce(reduceEvent, emptyTurn(runId));
}

/** Splits tool output into stdout/stderr segments (the reducer wraps stderr in \u0001…\u0002). */
export function splitOutput(output: string): Array<{ text: string; err: boolean }> {
  const out: Array<{ text: string; err: boolean }> = [];
  let i = 0;
  while (i < output.length) {
    const s = output.indexOf('\u0001', i);
    if (s < 0) {
      out.push({ text: output.slice(i), err: false });
      break;
    }
    if (s > i) out.push({ text: output.slice(i, s), err: false });
    const e = output.indexOf('\u0002', s);
    const end = e < 0 ? output.length : e;
    out.push({ text: output.slice(s + 1, end), err: true });
    i = e < 0 ? output.length : e + 1;
  }
  return out;
}

/** Strips ANSI escape sequences (colours, cursor moves) from command output. */
export const stripAnsi = (s: string) => s.replace(/\u001b\[[0-9;?]*[A-Za-z]/g, '').replace(/\r(?!\n)/g, '\n');
