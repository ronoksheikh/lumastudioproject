import fs from 'node:fs';
import path from 'node:path';
import type { ToolArgs } from '@luma/shared';
import { config } from '../../config.js';
import { runPristineScript } from './scripts.js';
import { fail, ok, type ImagePart, type ToolContext, type ToolResult } from './types.js';

export const FRAMES_DIR = '.luma/frames';

/** Captures the video at the requested times and (for vision models) hands the screenshots to the model. */
export async function previewFrames(ctx: ToolContext, a: ToolArgs<'preview_frames'>): Promise<ToolResult> {
  const stamp = String(Date.now());
  const outDir = path.join(ctx.project.dir, FRAMES_DIR, stamp);
  fs.mkdirSync(outDir, { recursive: true });
  if (typeof process.getuid === 'function' && process.getuid() === 0 && ctx.project.uid != null) {
    for (const d of [path.join(ctx.project.dir, '.luma'), path.join(ctx.project.dir, FRAMES_DIR), outDir]) fs.chownSync(d, ctx.project.uid, ctx.project.uid);
  }
  const run = () =>
    runPristineScript(ctx.project, 'preview-frames.mjs', ['--times', a.times.join(','), '--width', String(a.width ?? 960), '--out', outDir], {
      signal: ctx.signal,
      secrets: ctx.secrets,
      timeoutMs: 240_000,
      env: config.chromePath ? { CHROME_PATH: config.chromePath } : {},
    });
  let r;
  try {
    r = ctx.cpu
      ? await ctx.cpu.run(run, {
          label: 'preview_frames',
          signal: ctx.signal,
          onPosition: (n) => ctx.bus.delta('tool.output.delta', { callId: ctx.callId, stream: 'stderr', text: `[queued — the server is busy (position ${n})]\n` }),
        })
      : await run();
  } catch (e) {
    if ((e as Error).name === 'AbortError') return fail('Stopped.');
    throw e;
  }
  const line = r.output.trim().split('\n').filter((l) => l.startsWith('{')).pop();
  if (r.code !== 0 || !line) return fail(`Could not render preview frames:\n${r.output.slice(-1500)}`);
  let result: { frames: Array<{ t: number; file: string }>; issues: string[]; duration: number };
  try {
    result = JSON.parse(line);
  } catch {
    return fail(`Unreadable preview result:\n${line.slice(0, 500)}`);
  }
  const frames = result.frames.map((f) => ({ t: f.t, url: `/api/projects/${ctx.projectId}/frames/${stamp}/${path.basename(f.file)}` }));
  ctx.bus.emit('preview.frames', { frames, issues: result.issues });

  const images: ImagePart[] = [];
  if (ctx.supportsVision) {
    for (const f of result.frames) {
      try {
        images.push({ mime: 'image/png', base64: fs.readFileSync(f.file).toString('base64'), label: `frame at ${f.t.toFixed(2)}s` });
      } catch { /* skip unreadable */ }
    }
  }
  const issueText = result.issues.length ? `Problems found:\n- ${result.issues.join('\n- ')}` : 'No problems detected by the automatic checks.';
  const note = ctx.supportsVision ? 'The screenshots are attached below.' : 'This model cannot view images, so rely on the automatic checks and your knowledge of the scene code.';
  return ok(`Rendered ${result.frames.length} frame(s) at ${result.frames.map((f) => f.t.toFixed(2)).join(', ')}s (video length ${result.duration.toFixed(2)}s). ${note}\n${issueText}`, `${result.frames.length} frames`, { images });
}
