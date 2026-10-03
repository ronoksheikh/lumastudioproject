// "Attach this frame": the student points at a moment of the preview and the agent gets it as context.
// Resolved lazily when the message is sent — one capture through the CPU budget (the pristine
// preview-frames.mjs with --describe), never a re-render of the video and never a file in the project:
// the PNG is moved out to DATA_DIR/frame-attachments/<project>/ (served to the owner for the chat bubble).
// The model always gets the text facts (spoken segment/word, scenes and text on screen, layout problems);
// vision models also get the image.
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import type { CpuBudget } from '../cpu/budget.js';
import { notPlayableReason } from '../projects/content.js';
import type { ProjectRef } from '../runner/exec.js';
import { runPristineScript } from './tools/scripts.js';

export interface FrameRef {
  id: string;
  t: number;
}

export interface ResolvedFrame extends FrameRef {
  ok: boolean;
  /** what the model reads about this moment */
  facts: string;
  png?: Buffer;
}

interface Facts {
  t: number;
  segment: { id: string; start: number; end: number; text: string } | null;
  word: { index: number; w: string; start: number; spokenNow: boolean } | null;
  scenes: string[];
  text: string[];
}

export const frameAttachDir = (projectId: string) => path.join(config.dataDir, 'frame-attachments', projectId);
export const frameAttachFile = (projectId: string, id: string) => path.join(frameAttachDir(projectId), `${id}.png`);
export const isFrameId = (id: string) => /^[A-Za-z0-9_-]{6,40}$/.test(id);

export function describeFacts(f: Facts, issues: string[], duration: number): string {
  const lines = [`Frame the student attached: t=${f.t.toFixed(2)}s${duration ? ` (video length ${duration.toFixed(2)}s)` : ''}`];
  if (f.segment) {
    const word = f.word ? ` — at word ${f.word.index} "${f.word.w}" (w('${f.segment.id}', ${f.word.index}) = ${f.word.start.toFixed(2)}s${f.word.spokenNow ? ', being spoken' : ', after it'})` : ' — before its first word';
    lines.push(`- Voice: segment "${f.segment.id}" (${f.segment.start.toFixed(2)}–${f.segment.end.toFixed(2)}s) "${f.segment.text}"${word}`);
  } else lines.push('- Voice: before the first segment');
  lines.push(`- Scenes on screen: ${f.scenes.length ? f.scenes.join(', ') : 'none'}`);
  lines.push(`- Text on screen: ${f.text.length ? f.text.map((x) => `"${x}"`).join(' · ') : 'none readable'}`);
  lines.push(`- Automatic checks at this moment: ${issues.length ? issues.map((i) => i.replace(/^t=[\d.]+s: /, '')).join(' | ') : 'no problems found'}`);
  return lines.join('\n');
}

/** Captures every attached time in one browser session (one CPU-budget slot). Never throws: failures become facts. */
export async function resolveFrames(project: ProjectRef, frames: FrameRef[], opts: { cpu?: CpuBudget; signal?: AbortSignal } = {}): Promise<ResolvedFrame[]> {
  if (!frames.length) return [];
  const empty = notPlayableReason(project.dir);
  if (empty) return frames.map((f) => ({ ...f, ok: false, facts: `Frame the student attached: t=${f.t.toFixed(2)}s — there is no playable video yet (${empty})` }));

  const tmp = path.join(project.dir, '.luma/tmp', `attach-${Date.now()}`);
  fs.mkdirSync(tmp, { recursive: true });
  if (typeof process.getuid === 'function' && process.getuid() === 0 && project.uid != null) {
    for (const d of [path.join(project.dir, '.luma'), path.join(project.dir, '.luma/tmp'), tmp]) fs.chownSync(d, project.uid, project.uid);
  }
  try {
    const run = () =>
      runPristineScript(project, 'preview-frames.mjs', ['--times', frames.map((f) => f.t).join(','), '--width', '960', '--describe', '--out', tmp], {
        signal: opts.signal,
        timeoutMs: 180_000,
        env: config.chromePath ? { CHROME_PATH: config.chromePath } : {},
      });
    const r = opts.cpu ? await opts.cpu.run(run, { label: 'frame attachment', signal: opts.signal }) : await run();
    const line = r.output.trim().split('\n').filter((l) => l.startsWith('{')).pop();
    const result = line ? (JSON.parse(line) as { frames: Array<{ t: number; file: string; facts?: Facts }>; issues: string[]; duration: number }) : null;
    if (r.code !== 0 || !result) {
      const why = result?.issues[0] ?? r.output.trim().split('\n').pop() ?? 'unknown error';
      return frames.map((f) => ({ ...f, ok: false, facts: `Frame the student attached: t=${f.t.toFixed(2)}s — it could not be rendered: ${why}` }));
    }
    const buildFailed = result.issues.find((i) => i.startsWith('The video failed to build'));
    fs.mkdirSync(frameAttachDir(project.id), { recursive: true, mode: 0o700 });
    return frames.map((f, i) => {
      const got = result.frames[i];
      if (!got?.facts) return { ...f, ok: false, facts: `Frame the student attached: t=${f.t.toFixed(2)}s — ${buildFailed ?? 'could not be rendered'}` };
      const prefix = `t=${got.t.toFixed(2)}s: `;
      let png: Buffer | undefined;
      try {
        png = fs.readFileSync(got.file);
        fs.writeFileSync(frameAttachFile(project.id, f.id), png, { mode: 0o600 });
      } catch { /* facts still help */ }
      return { ...f, ok: true, png, facts: describeFacts(got.facts, result.issues.filter((x) => x.startsWith(prefix)), result.duration) };
    });
  } catch (e) {
    return frames.map((f) => ({ ...f, ok: false, facts: `Frame the student attached: t=${f.t.toFixed(2)}s — it could not be rendered: ${(e as Error).message}` }));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true }); // nothing stays in the project
  }
}
