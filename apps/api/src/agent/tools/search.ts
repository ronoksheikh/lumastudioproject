// search_files: grep the project (regex or plain text) and get back only the matching lines with line numbers,
// so the agent reads just the part of a file it needs (then read_file with offset/limit) instead of whole files.
import fs from 'node:fs';
import path from 'node:path';
import type { ToolArgs } from '@luma/shared';
import { PathError, resolveInProject } from '../../runner/paths.js';
import { fail, ok, type ToolContext, type ToolResult } from './types.js';

const SKIP = new Set(['node_modules', '.git', 'export', '.home', '.luma']);
const TEXT = /\.(js|mjs|cjs|ts|json|css|html|md|txt|svg|csv|yml|yaml|env\.example)$/i;
const MAX_MATCHES = 150;
const MAX_FILE = 2 * 1024 * 1024;

const globToRe = (g: string) => new RegExp(`^${g.split('*').map((p) => p.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*')}$`, 'i');

export function searchFiles(ctx: ToolContext, a: ToolArgs<'search_files'>): ToolResult {
  let root: string;
  try {
    root = resolveInProject(ctx.project.dir, a.path ?? '.');
  } catch (e) {
    return fail(e instanceof PathError ? e.message : (e as Error).message);
  }
  let re: RegExp;
  try {
    re = a.regex ? new RegExp(a.pattern, a.case_sensitive ? '' : 'i') : new RegExp(a.pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), a.case_sensitive ? '' : 'i');
  } catch (e) {
    return fail(`Invalid regex: ${(e as Error).message}`);
  }
  const glob = a.glob ? globToRe(a.glob) : null;
  const projectRoot = fs.realpathSync(ctx.project.dir);
  const out: string[] = [];
  let files = 0;
  const walk = (dir: string) => {
    if (out.length >= MAX_MATCHES) return;
    let entries: fs.Dirent[] = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const d of entries) {
      if (out.length >= MAX_MATCHES) return;
      if (SKIP.has(d.name)) continue;
      const abs = path.join(dir, d.name);
      if (d.isDirectory()) walk(abs);
      else if (d.isFile() && TEXT.test(d.name) && (!glob || glob.test(d.name))) {
        let text: string;
        try {
          if (fs.statSync(abs).size > MAX_FILE) continue;
          text = fs.readFileSync(abs, 'utf8');
        } catch { continue; }
        files++;
        const rel = path.relative(projectRoot, abs);
        text.split('\n').forEach((l, i) => {
          if (out.length < MAX_MATCHES && re.test(l)) out.push(`${rel}:${i + 1}: ${l.length > 240 ? `${l.slice(0, 240)}…` : l}`);
        });
      }
    }
  };
  const st = fs.statSync(root, { throwIfNoEntry: false });
  if (!st) return fail(`No such path: ${a.path}`);
  if (st.isDirectory()) walk(root);
  else {
    const text = fs.readFileSync(root, 'utf8');
    files = 1;
    text.split('\n').forEach((l, i) => { if (out.length < MAX_MATCHES && re.test(l)) out.push(`${path.relative(projectRoot, root)}:${i + 1}: ${l}`); });
  }
  if (!out.length) return ok(`No matches for ${a.regex ? '/' + a.pattern + '/' : `"${a.pattern}"`} in ${files} file(s).`, 'No matches');
  return ok(`${out.join('\n')}${out.length >= MAX_MATCHES ? `\n… (first ${MAX_MATCHES} matches; narrow the search)` : ''}`, `${out.length} match(es)`);
}
