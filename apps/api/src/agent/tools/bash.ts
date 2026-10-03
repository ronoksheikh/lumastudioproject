import type { ToolArgs } from '@luma/shared';
import { config } from '../../config.js';
import { execInProject } from '../../runner/exec.js';
import { PathError, resolveInProject } from '../../runner/paths.js';
import { dirSize } from '../../runner/files.js';
import { redactSecrets } from '../../security/redact.js';
import { diffSnapshots, snapshot } from '../workspace.js';
import { fail, ok, type ToolContext, type ToolResult } from './types.js';

/** Commands that eat CPU (rendering, browsers, installs) wait for a CPU-budget slot. */
export const HEAVY = /\b(ffmpeg|ffprobe|chromium|chrome|puppeteer|export-mp4|preview-frames|npm\s+(run\s+)?(export|install|i|ci)\b|npx|pdftoppm|check\.mjs\s+.*--page|npm\s+run\s+check\s+--\s+.*--page)/i;

export async function bash(ctx: ToolContext, a: ToolArgs<'bash'>): Promise<ToolResult> {
  let cwd: string | undefined;
  if (a.cwd && a.cwd !== '.') {
    try {
      cwd = resolveInProject(ctx.project.dir, a.cwd);
    } catch (e) {
      return fail(e instanceof PathError ? e.message : (e as Error).message);
    }
  }
  const timeoutS = Math.min(a.timeout_s ?? config.cmdTimeoutS, 600);
  const before = snapshot(ctx.project);

  const run = () =>
    execInProject(ctx.project, a.command, {
      timeoutS,
      cwd,
      signal: ctx.signal,
      secrets: ctx.secrets,
      onOutput: (stream, text) => ctx.bus.delta('tool.output.delta', { callId: ctx.callId, stream, text }),
    });

  let result;
  try {
    if (ctx.cpu && HEAVY.test(a.command)) {
      result = await ctx.cpu.run(run, {
        label: 'bash',
        signal: ctx.signal,
        onPosition: (n) => ctx.bus.delta('tool.output.delta', { callId: ctx.callId, stream: 'stderr', text: `[queued — the server is busy (position ${n})]\n` }),
      });
    } else result = await run();
  } catch (e) {
    if ((e as Error).name === 'AbortError') return fail('Stopped.');
    throw e;
  }

  ctx.bus.flushDeltas();
  for (const c of diffSnapshots(ctx.project, before, snapshot(ctx.project))) {
    ctx.bus.emit('file.changed', { path: c.path, change: c.change, additions: c.additions, deletions: c.deletions });
  }

  let content = `exit code: ${result.exitCode ?? `signal ${result.signal}`}${result.timedOut ? ' (timed out)' : ''}\n${result.output}`;
  // keep the student's disk in check: warn the model if the project outgrew its quota
  try {
    const bytes = dirSize(ctx.project.dir);
    if (bytes > config.projectQuotaMb * 1024 * 1024) content += `\n[warning: the project folder is ${Math.round(bytes / 1048576)} MB, over the ${config.projectQuotaMb} MB limit — delete large files]`;
  } catch { /* ignore */ }
  content = redactSecrets(content, ctx.secrets);
  const okRun = result.exitCode === 0 && !result.timedOut && !result.aborted;
  return {
    ok: okRun,
    content,
    summary: result.aborted ? 'stopped' : result.timedOut ? `timed out after ${timeoutS}s` : `exit ${result.exitCode}`,
    truncated: result.truncated,
  };
}

export { ok };
