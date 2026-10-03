import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { useEffect, useRef } from 'react';
import type { TurnState } from '../lib/reduce';
import { splitOutput, stripAnsi } from '../lib/reduce';

/** Every command the agent has run in this project, with its output (read-only). */
export function TerminalPane({ turns, order }: { turns: Record<string, TurnState>; order: string[] }) {
  const host = useRef<HTMLDivElement>(null);
  const term = useRef<Terminal | null>(null);
  const written = useRef(new Map<string, { len: number; closed: boolean }>());

  useEffect(() => {
    if (!host.current) return;
    const t = new Terminal({
      disableStdin: true, convertEol: true, fontSize: 12.5, fontFamily: '"JetBrains Mono", ui-monospace, monospace', cursorBlink: false, scrollback: 20000,
      theme: { background: '#f5f8ff', foreground: '#1f2937', cursor: '#f5f8ff', selectionBackground: '#c9d9f7' },
    });
    const fit = new FitAddon();
    t.loadAddon(fit);
    t.open(host.current);
    fit.fit();
    term.current = t;
    written.current.clear();
    const ro = new ResizeObserver(() => { try { fit.fit(); } catch { /* hidden */ } });
    ro.observe(host.current);
    return () => { ro.disconnect(); t.dispose(); term.current = null; };
  }, []);

  useEffect(() => {
    const t = term.current;
    if (!t) return;
    const done = written.current;
    for (const runId of order) {
      for (const b of turns[runId]?.blocks ?? []) {
        if (b.kind !== 'tool' || b.name !== 'bash') continue;
        const key = b.callId;
        const cmd = (b.args as { command?: string })?.command ?? '';
        let st = done.get(key);
        if (!st) {
          t.write(`\x1b[1;34m$ ${cmd.split('\n').join('\n  ')}\x1b[0m\r\n`);
          st = { len: 0, closed: false };
          done.set(key, st);
        }
        const out = b.output;
        if (out.length > st.len) {
          const text = splitOutput(out.slice(st.len)).map((p) => (p.err ? `\x1b[31m${stripAnsi(p.text)}\x1b[0m` : stripAnsi(p.text))).join('');
          t.write(text);
          st.len = out.length;
        }
        if (b.status !== 'running' && !st.closed) {
          t.write(`\x1b[90m[${b.summary ?? 'done'}]\x1b[0m\r\n\r\n`);
          st.closed = true;
        }
      }
    }
  }, [turns, order]);

  return <div ref={host} className="h-full w-full bg-[#f5f8ff] p-2" role="region" aria-label="Terminal log" data-testid="terminal" />;
}
