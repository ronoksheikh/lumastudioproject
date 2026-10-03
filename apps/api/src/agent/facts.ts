import fs from 'node:fs';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import type { DB } from '../db/index.js';
import { uploads } from '../db/schema.js';
import type { ProjectRef } from '../runner/exec.js';
import { listProjectFiles } from '../runner/files.js';
import { projectContent } from '../projects/content.js';

const readJson = <T>(file: string): T | null => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
  } catch {
    return null;
  }
};

export function brandSummary(project: ProjectRef): string {
  const b = readJson<{ name?: string; colors?: Record<string, string> }>(path.join(project.dir, 'brand.json'));
  if (!b) return 'Lumademy blue palette (default)';
  return `${b.name ?? 'brand'} — ${['blue', 'sky', 'royal', 'deep'].map((k) => `${k} ${b.colors?.[k] ?? ''}`).join(', ')}`;
}

export function attachmentsSummary(db: DB, projectId: string): string {
  const ups = db.select().from(uploads).where(eq(uploads.projectId, projectId)).all();
  if (!ups.length) return 'none';
  return ups.map((u) => `${u.path} (${u.mime})`).slice(0, 40).join(', ');
}

/** A compact picture of the project as it is right now — rebuilt for every run. */
export function projectFacts(db: DB, project: ProjectRef): string {
  const lines: string[] = [];
  const pj = readJson<{ title?: string; aspect?: string; fps?: number }>(path.join(project.dir, 'project.json'));
  lines.push(`Project: "${pj?.title ?? '?'}" · ${pj?.aspect ?? '16:9'} · ${pj?.fps ?? 60} fps`);

  const content = projectContent(project.dir);
  if (!content.scenes && !content.script) lines.push('This project is EMPTY: no script.json, no scenes, no voice yet. Build everything from scratch (read_guide("engine")).');
  else if (!content.scenes) lines.push('No scenes yet (public/js/scenes/index.js is missing).');

  const script = readJson<{ segments?: Array<{ id: string; text: string }> }>(path.join(project.dir, 'script.json'));
  if (script?.segments?.length) lines.push(`script.json segments: ${script.segments.map((s) => s.id).join(', ')}`);

  const timing = readJson<{ duration: number; placeholder?: boolean; segments: Array<{ id: string; start: number; end: number; words: unknown[] }> }>(path.join(project.dir, 'public/audio/timing.json'));
  if (timing) {
    lines.push(`Voice (public/audio/timing.json): ${timing.duration}s${timing.placeholder ? ' — PLACEHOLDER (silent)' : ''}; ` + timing.segments.map((s) => `${s.id} ${s.start.toFixed(1)}–${s.end.toFixed(1)}s (${s.words.length}w)`).join(', '));
  }

  try {
    const files = listProjectFiles(project, '.', 3).filter((e) => !e.path.startsWith('assets/fonts') && !e.path.startsWith('examples/') && !e.path.startsWith('public/js/lib') && !e.path.startsWith('scripts') && !e.path.startsWith('test'));
    lines.push('Files:\n' + files.slice(0, 70).map((e) => `  ${e.path}${e.type === 'dir' ? '/' : ''}`).join('\n'));
  } catch { /* ignore */ }

  const plan = readJson<Array<{ text: string; status: string }>>(path.join(project.dir, '.luma/plan.json'));
  if (plan?.length) lines.push('Current plan:\n' + plan.map((p) => `  [${p.status}] ${p.text}`).join('\n'));
  return lines.join('\n');
}
