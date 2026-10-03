import { useQuery } from '@tanstack/react-query';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { useEffect, useMemo, useRef } from 'react';
import { api } from '../api/client';
import type { TerminalEntry } from '../api/types';
import type { TurnState } from '../lib/reduce';
import { splitOutput, stripAnsi } from '../lib/reduce';
import { useInvalidateOn } from '../lib/hooks';
import { Icon } from './Icon';

const TERMINAL_TOOLS = new Set(['bash', 'generate_voice', 'patch_voice', 'preview_frames', 'render_video', 'list_voices']);

/** The line a tool call starts with: the shell command itself, or a readable stand-in for Luma's own tools. */
export function commandLine(e: Pick<TerminalEntry, 'name' | 'args'>): string {
  const a = (e.args ?? {}) as Record<string, unknown>;
  switch (e.name) {
    case 'bash': return `$ ${String(a.command ?? '').split('\n').join('\n  ')}`;
    case 'generate_voice': return `› generate voice${a.placeholder ? ' (placeholder, silent)' : ''}`;
    case 'patch_voice': return `› re-record segment "${String(a.segment_id ?? '')}"`;
    case 'preview_frames': return `› render preview frames at ${Array.isArray(a.times) ? a.times.map((t) => `${Number(t).toFixed(2)}s`).join(', ') : '…'}`;
    case 'render_video': return `› render ${String(a.preset ?? '')} MP4`;
    case 'list_voices': return '› list ElevenLabs voices';
    default: return `› ${e.name}`;
  }
}

/**
 * Everything Luma ran in this project — shell commands and its own voice/frames/render tools — with output.
 * History comes from the server (rebuilt from stored run events, so it survives reloads); the run that is
 * streaming right now is merged in live. Read-only.
 */
export function TerminalPane({ projectId, turns, order, tick }: { projectId: string; turns: Record<string, TurnState>; order: string[]; tick: number }) {
  const host = useRef<HTMLDivElement>(null);
  const term = useRef<Terminal | null>(null);
  const written = useRef<Array<{ key: string; len: number; closed: boolean }>>([]);
  const history = useQuery({ queryKey: ['terminal', projectId], queryFn: () => api.terminal(projectId).then((r) => r.entries) });
  useInvalidateOn([['terminal', projectId]], tick);

  // history + whatever the live runs have that the server didn't return yet (a command still running)
  const entries = useMemo(() => {
    const list: TerminalEntry[] = [...(history.data ?? [])];
    const known = new Set(list.map((e) => `${e.runId}:${e.callId}`));
    for (const runId of order) {
      const turn = turns[runId];
      for (const b of turn?.blocks ?? []) {
        if (b.kind !== 'tool' || !TERMINAL_TOOLS.has(b.name)) continue;
        const key = `${runId}:${b.callId}`;
        const live: TerminalEntry = { runId, callId: b.callId, name: b.name, args: b.args, output: b.output, ok: b.status === 'running' ? null : b.status === 'ok', summary: b.summary ?? null, ts: b.startedAt };
        if (known.has(key)) {
          // the live block may be ahead of the (cached) history
          const i = list.findIndex((e) => `${e.runId}:${e.callId}` === key);
          if (live.output.length >= list[i]!.output.length) list[i] = { ...list[i]!, ...live };
        } else list.push(live);
      }
    }
    return list;
  }, [history.data, turns, order]);

  useEffect(() => {
    if (!host.current) return;
    const t = new Terminal({
      disableStdin: true, convertEol: true, fontSize: 12.5, fontFamily: '"JetBrains Mono", ui-monospace, monospace', cursorBlink: false, scrollback: 20000,
      theme: { background: '#f5f8ff', foreground: '#1f2937', cursor: '#f5f8ff', selectionBackground: '#c9d9f7' },
    });
    const fit = new FitAddon();
    t.loadAddon(fit);
    t.open(host.current);
    try { fit.fit(); } catch { /* hidden */ }
    term.current = t;
    written.current = [];
    const ro = new ResizeObserver(() => { try { fit.fit(); } catch { /* hidden */ } });
    ro.observe(host.current);
    return () => { ro.disconnect(); t.dispose(); term.current = null; };
  }, []);

  useEffect(() => {
    const t = term.current;
    if (!t) return;
    const keys = entries.map((e) => `${e.runId}:${e.callId}`);
    // something arrived out of order (history loaded after live output): start over
    if (written.current.some((w, i) => w.key !== keys[i])) {
      t.reset();
      written.current = [];
    }
    entries.forEach((e, i) => {
      let st = written.current[i];
      if (!st) {
        t.write(`\x1b[1;34m${commandLine(e)}\x1b[0m\r\n`);
        st = { key: keys[i]!, len: 0, closed: false };
        written.current.push(st);
      }
      if (e.output.length > st.len) {
        const text = splitOutput(e.output.slice(st.len)).map((p) => (p.err ? `\x1b[31m${stripAnsi(p.text)}\x1b[0m` : stripAnsi(p.text))).join('');
        t.write(text);
        st.len = e.output.length;
      }
      if (e.ok !== null && !st.closed) {
        if (e.output && !e.output.endsWith('\n') && !e.output.endsWith('\u0002')) t.write('\r\n');
        t.write(`\x1b[90m[${e.summary ?? (e.ok ? 'done' : 'failed')}]\x1b[0m\r\n\r\n`);
        st.closed = true;
      }
    });
  }, [entries]);

  const empty = !history.isLoading && entries.length === 0;
  return (
    <div className="relative h-full w-full bg-[#f5f8ff]">
      <div ref={host} className="h-full w-full p-2" role="region" aria-label="Terminal log" data-testid="terminal" />
      {empty && (
        <div className="absolute inset-0 grid place-items-center p-6 text-center" data-testid="terminal-empty">
          <div className="max-w-sm">
            <Icon name="terminal" size={26} className="mx-auto mb-2 text-[#2970ec]" />
            <p className="text-sm font-semibold text-[#1557d1]">No commands yet</p>
            <p className="mt-1 text-sm text-[#5b6b8f]">Everything Luma runs in this project shows up here with its output — shell commands (npm, node, ffmpeg…), voice generation, frame checks and renders. The log is kept, so it’s still here after a reload. It’s read-only.</p>
          </div>
        </div>
      )}
    </div>
  );
}
