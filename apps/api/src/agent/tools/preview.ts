// check_preview: why the preview is (not) working — what the student's browser reported, plus a fresh build of
// the page in headless Chrome (check.mjs --page: build errors, failed requests with their URLs, font warnings).
import type { ToolArgs } from '@luma/shared';
import { getPreviewReport } from '../preview-report.js';
import { runPristineScript } from './scripts.js';
import { notPlayableReason } from '../../projects/content.js';
import { fail, ok, type ToolContext, type ToolResult } from './types.js';

export async function checkPreview(ctx: ToolContext, a: ToolArgs<'check_preview'>): Promise<ToolResult> {
  const lines: string[] = [];
  const r = getPreviewReport(ctx.projectId);
  if (r) {
    const ago = Math.round((Date.now() - r.at) / 1000);
    lines.push(`Student's browser (${ago}s ago): ${r.status === 'error' ? `ERROR — ${r.message}` : r.status === 'empty' ? 'no scenes yet ("Nothing here yet")' : `playing fine (${r.duration?.toFixed(1) ?? '?'}s)`}`);
  } else lines.push("Student's browser: no report yet (the Preview tab hasn't loaded this project since the server started).");

  const empty = notPlayableReason(ctx.project.dir);
  if (empty) {
    lines.push(`Project: ${empty}`);
    return ok(lines.join('\n'), 'Preview: nothing to play yet');
  }
  if (a.build === false) return ok(lines.join('\n'), lines[0]!.slice(0, 160));
  const res = await runPristineScript(ctx.project, 'check.mjs', ['--page', '--json'], { timeoutMs: 150_000, signal: ctx.signal, secrets: ctx.secrets });
  const at = res.output.search(/^\{/m); // check.mjs --json prints the report last, starting at a line beginning with {
  const line = at >= 0 ? res.output.slice(at) : '';
  try {
    const j = JSON.parse(line) as { ok: boolean; errors: string[]; warnings: string[]; info: string[] };
    lines.push(`Headless build: ${j.ok ? 'OK' : 'FAILED'}`);
    for (const e of j.errors) lines.push(`ERROR: ${e}`);
    for (const w of j.warnings) lines.push(`warning: ${w}`);
    for (const i of j.info) lines.push(`ok: ${i}`);
    return j.ok ? ok(lines.join('\n'), r?.status === 'error' ? 'Builds here, but the student\'s browser reported an error' : 'Preview builds') : fail(lines.join('\n'));
  } catch {
    if (res.timedOut) return fail(`${lines.join('\n')}\nThe headless build timed out (150 s).`);
    return fail(`${lines.join('\n')}\nHeadless build output:\n${res.output.slice(-4000)}`);
  }
}
