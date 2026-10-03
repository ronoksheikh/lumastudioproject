// read_guide: the agent's on-demand reference. Projects start empty and hold only their own files, so the
// engine docs (packages/prompts/guide/*.md) and the engine/example sources (config.templateDir) are read
// through this tool instead of being copied into every project. Read-only; paths are confined.
import fs from 'node:fs';
import path from 'node:path';
import type { ToolArgs } from '@luma/shared';
import { config } from '../../config.js';
import { PathError, resolveInProject } from '../../runner/paths.js';
import { truncateMiddle } from '../../runner/truncate.js';
import { fail, ok, type ToolContext, type ToolResult } from './types.js';

const guideDir = () => path.join(config.promptsDir, 'guide');
/** Engine folders the agent may read (relative to the template dir). */
const READABLE = /^(public|examples|scaffold)(\/|$)/;
const TEXT = /\.(js|mjs|css|html|json|md|txt|svg)$/i;
const SKIP = new Set(['node_modules', 'audio', 'fonts']);

export function guideTopics(): Array<{ topic: string; title: string }> {
  try {
    return fs.readdirSync(guideDir()).filter((f) => f.endsWith('.md')).sort().map((f) => {
      const first = fs.readFileSync(path.join(guideDir(), f), 'utf8').split('\n').find((l) => l.startsWith('# ')) ?? '';
      return { topic: f.replace(/\.md$/, ''), title: first.replace(/^#\s*/, '') };
    });
  } catch {
    return [];
  }
}

function listTree(abs: string, rel: string, depth: number, out: string[]) {
  for (const e of fs.readdirSync(abs, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (SKIP.has(e.name) || e.name.startsWith('.') || e.isSymbolicLink()) continue;
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) {
      out.push(`${r}/`);
      if (depth > 1) listTree(path.join(abs, e.name), r, depth - 1, out);
    } else if (TEXT.test(e.name)) out.push(r);
  }
}

function index(): string {
  const topics = guideTopics();
  const files: string[] = [];
  for (const d of ['public', 'examples']) {
    const abs = path.join(config.templateDir, d);
    if (fs.existsSync(abs)) listTree(abs, d, 4, files);
  }
  return [
    'Guide topics — read_guide({topic: "<name>"}):',
    ...topics.map((t) => `  ${t.topic.padEnd(10)} ${t.title}`),
    '',
    'Engine + example sources (read-only, served to every project; same paths as they would have in the project):',
    ...files.map((f) => `  ${f}`),
  ].join('\n');
}

export function readGuide(_ctx: ToolContext, a: ToolArgs<'read_guide'>): ToolResult {
  const topic = (a.topic ?? '').trim().replace(/^\/+/, '').replace(/^\$LUMA_ENGINE\//, '');
  if (!topic || topic === 'index') return ok(index(), 'guide index');

  if (/^[a-z0-9-]+$/i.test(topic)) {
    const file = path.join(guideDir(), `${topic.toLowerCase()}.md`);
    if (fs.existsSync(file)) {
      const t = truncateMiddle(fs.readFileSync(file, 'utf8'), 60_000);
      return ok(t.text, `guide: ${topic}`, { truncated: t.truncated });
    }
  }

  if (!READABLE.test(topic)) {
    return fail(`No guide topic or engine file "${topic}". Topics: ${guideTopics().map((t) => t.topic).join(', ')}. Engine files start with public/ or examples/ (call read_guide without a topic for the list).`);
  }
  let abs: string;
  try {
    abs = resolveInProject(config.templateDir, topic);
  } catch (e) {
    return fail(e instanceof PathError ? e.message : (e as Error).message);
  }
  if (!fs.existsSync(abs)) return fail(`No such engine file: ${topic}. Call read_guide without a topic for the list.`);
  if (fs.statSync(abs).isDirectory()) {
    const out: string[] = [];
    listTree(abs, topic.replace(/\/$/, ''), 3, out);
    return ok(out.join('\n') || '(empty)', `${out.length} entries`);
  }
  if (!TEXT.test(abs)) return fail(`${topic} is not a text file.`);
  const t = truncateMiddle(fs.readFileSync(abs, 'utf8'), 60_000);
  return ok(t.text, `engine: ${topic}`, { truncated: t.truncated });
}
