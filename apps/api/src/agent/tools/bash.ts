import type { ToolArgs } from '@luma/shared';
import { config } from '../../config.js';
import { execInProject } from '../../runner/exec.js';
import { PathError, resolveInProject } from '../../runner/paths.js';
import { dirSize } from '../../runner/files.js';
import { redactSecrets } from '../../security/redact.js';
import { diffSnapshots, snapshot } from '../workspace.js';
import { fail, ok, type ToolContext, type ToolResult } from './types.js';

/**
 * Rendering and frame capture belong to render_video / preview_frames (queued, quota-checked, run once). Starting
 * a browser or the export scripts from the terminal would bypass that, load the server and make other students
 * wait — so those commands are refused. `npm run check -- --page` (a quick page build) is fine.
 */
export const FORBIDDEN_RENDER = /\b(export-mp4(\.mjs)?|render\.mjs|preview-frames(\.mjs)?|npm\s+run\s+export)\b|\b(chromium(-browser)?|google-chrome(-stable)?|chrome|headless_shell)\b[^\n|;&]*--(headless|screenshot|print-to-pdf|remote-debugging-port)/i;

/** Dev/static servers and watchers: the Preview tab already serves the project; a server here just hangs. */
export const FORBIDDEN_SERVER = /\bnpm\s+(run\s+)?(dev|start|serve|preview|watch)\b|\b(npx\s+)?(vite|serve|http-server|live-server|webpack-dev-server|browser-sync|nodemon)\b(?!\.)|python3?\s+-m\s+http\.server|\bphp\s+-S\b|\bnode\s+\S*server\.m?js\b|\b(listen|createServer)\s*\(/i;

/** Writing files through the shell (redirects, tee, sed -i, heredocs) — write_file/edit_file show diffs and are safe. */
export const SHELL_WRITE = /(^|[^<>&|0-9])>>?\s*(?!\s*(\/dev\/(null|stderr|stdout)|&))[^\s|;&]+|\btee\b|\bsed\s+(-[a-z]*i|--in-place)|<<-?\s*['"]?\w+['"]?\s*>/i;

export async function bash(ctx: ToolContext, a: ToolArgs<'bash'>): Promise<ToolResult> {
  if (FORBIDDEN_SERVER.test(a.command)) {
    return fail('Starting servers is not allowed here: the Preview tab already shows the video (the student sees it live). To check that the page builds, use check_preview (or `npm run check -- --page`); to look at frames, preview_frames.');
  }
  if (SHELL_WRITE.test(a.command)) {
    return fail('Create and change files with write_file / edit_file, not shell redirects, tee, heredocs or sed -i (the student sees those edits as diffs, and they are checked). Commands that produce files themselves (ffmpeg -o, curl -o, npm install, git) are fine.');
  }
  if (FORBIDDEN_RENDER.test(a.command)) {
    return fail('Rendering, screenshots and browser automation are not allowed from the terminal. Use render_video for MP4s and preview_frames to look at frames (they are queued fairly and count against the student\'s render time). `npm run check -- --page` is fine for a quick page check.');
  }
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
    result = await run(); // terminal commands never wait in the render queue
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
