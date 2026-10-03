// The Terminal tab's history: every process-running tool call in a project (shell commands, voice
// generation, frame checks, renders…) with its output, rebuilt from the persisted run_events — so the
// log survives reloads and is independent of how much of the chat the page has loaded.
import type BetterSqlite3 from 'better-sqlite3';

/** Tools whose work is a process with output worth showing in the terminal. */
export const TERMINAL_TOOLS = ['bash', 'generate_voice', 'patch_voice', 'preview_frames', 'render_video', 'list_voices'] as const;

export interface TerminalEntry {
  runId: string;
  callId: string;
  name: string;
  args: unknown;
  output: string;
  /** null while still running (or the run died before a result) */
  ok: boolean | null;
  summary: string | null;
  ts: number;
}

const MAX_OUTPUT = 40_000;

/** The newest `limit` entries, oldest first. Outputs keep their tail; stderr is wrapped in \u0001…\u0002 like the chat. */
export function terminalHistory(sqlite: BetterSqlite3.Database, projectId: string, limit = 300): TerminalEntry[] {
  const calls = sqlite
    .prepare(
      `select e.id, e.run_id as runId, e.ts, e.data_json as d from run_events e join runs r on r.id = e.run_id
       where r.project_id = ? and e.type = 'tool.call' and json_extract(e.data_json, '$.name') in (${TERMINAL_TOOLS.map(() => '?').join(',')})
       order by e.id desc limit ?`,
    )
    .all(projectId, ...TERMINAL_TOOLS, limit) as Array<{ id: number; runId: string; ts: number; d: string }>;
  if (!calls.length) return [];
  calls.reverse();
  const byCall = new Map<string, TerminalEntry>();
  for (const c of calls) {
    const d = JSON.parse(c.d) as { callId: string; name: string; args: unknown };
    byCall.set(`${c.runId}:${d.callId}`, { runId: c.runId, callId: d.callId, name: d.name, args: d.args, output: '', ok: null, summary: null, ts: c.ts });
  }
  const runIds = [...new Set(calls.map((c) => c.runId))];
  const rows = sqlite
    .prepare(
      `select run_id as runId, type, data_json as d from run_events where run_id in (${runIds.map(() => '?').join(',')})
       and id >= ? and type in ('tool.output.delta', 'tool.result') order by id`,
    )
    .all(...runIds, calls[0]!.id) as Array<{ runId: string; type: string; d: string }>;
  for (const r of rows) {
    const d = JSON.parse(r.d) as { callId: string; stream?: string; text?: string; ok?: boolean; summary?: string };
    const e = byCall.get(`${r.runId}:${d.callId}`);
    if (!e) continue;
    if (r.type === 'tool.output.delta') {
      e.output += d.stream === 'stderr' ? `\u0001${d.text ?? ''}\u0002` : (d.text ?? '');
      if (e.output.length > MAX_OUTPUT * 1.5) e.output = e.output.slice(-MAX_OUTPUT);
    } else {
      e.ok = d.ok ?? null;
      e.summary = d.summary ?? null;
    }
  }
  return [...byCall.values()].map((e) => ({ ...e, output: e.output.length > MAX_OUTPUT ? e.output.slice(-MAX_OUTPUT) : e.output }));
}
