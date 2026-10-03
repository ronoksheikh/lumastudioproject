import fs from 'node:fs';
import path from 'node:path';
import type { AppContext } from '../app.js';
import { config } from '../config.js';
import { FRAMES_DIR } from '../agent/tools/frames.js';
import { runPristineScript } from '../agent/tools/scripts.js';
import { HttpError } from '../http/errors.js';
import type { ProjectRef } from '../runner/exec.js';

/** Screenshot of the video at time `t` (full stage size), through the CPU budget. Returns an authenticated URL. */
export async function capturePng(ctx: AppContext, project: ProjectRef, projectId: string, t: number): Promise<{ url: string }> {
  const stamp = String(Date.now());
  const outDir = path.join(project.dir, FRAMES_DIR, stamp);
  fs.mkdirSync(outDir, { recursive: true });
  if (typeof process.getuid === 'function' && process.getuid() === 0 && project.uid != null) {
    for (const d of [path.join(project.dir, '.luma'), path.join(project.dir, FRAMES_DIR), outDir]) fs.chownSync(d, project.uid, project.uid);
  }
  const run = () =>
    runPristineScript(project, 'preview-frames.mjs', ['--times', String(t), '--width', '1920', '--out', outDir], {
      timeoutMs: 180_000,
      env: config.chromePath ? { CHROME_PATH: config.chromePath } : {},
    });
  const r = ctx.cpu ? await ctx.cpu.budget.run(run, { label: 'capture' }) : await run();
  const line = r.output.trim().split('\n').filter((l) => l.startsWith('{')).pop();
  const result = line ? (JSON.parse(line) as { frames: Array<{ file: string }>; issues: string[] }) : null;
  const frame = result?.frames[0];
  if (r.code !== 0 || !frame) throw new HttpError(422, 'capture_failed', result?.issues[0] ?? 'Could not render that frame');
  return { url: `/api/projects/${projectId}/frames/${stamp}/${path.basename(frame.file)}` };
}
