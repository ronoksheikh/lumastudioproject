// File tools for the agent: read / write / edit / list, all confined to one project directory.
import fs from 'node:fs';
import path from 'node:path';
import { diffLines } from 'diff';
import { PathError, relInProject, resolveInProject } from './paths.js';
import { truncateMiddle } from './truncate.js';

const IGNORED = new Set(['node_modules', 'export', '.git', '.home', '.luma']);
const IMAGE_MIME: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' };
const MAX_READ_BYTES = 2 * 1024 * 1024;

export interface FileProject {
  dir: string;
  uid: number | null;
}

export class ToolError extends Error {}

export type ReadResult =
  | { kind: 'text'; path: string; text: string; totalLines: number; truncated: boolean }
  | { kind: 'image'; path: string; mime: string; base64: string; bytes: number }
  | { kind: 'binary'; path: string; bytes: number };

export interface ChangeResult {
  path: string;
  change: 'created' | 'modified';
  additions: number;
  deletions: number;
}

function resolve(project: FileProject, p: string): { abs: string; rel: string } {
  try {
    const abs = resolveInProject(project.dir, p);
    return { abs, rel: relInProject(project.dir, abs) };
  } catch (e) {
    if (e instanceof PathError) throw new ToolError(e.message);
    throw e;
  }
}

/** Open for reading without following a symlink in the last component (defence against swap races). */
function openRegular(abs: string, flags: number) {
  const fd = fs.openSync(abs, flags | fs.constants.O_NOFOLLOW);
  const st = fs.fstatSync(fd);
  if (!st.isFile()) {
    fs.closeSync(fd);
    throw new ToolError(`Not a regular file: ${abs}`);
  }
  return { fd, st };
}

export function readProjectFile(project: FileProject, p: string, opts: { offset?: number; limit?: number; numbered?: boolean } = {}): ReadResult {
  const { abs, rel } = resolve(project, p);
  if (!fs.existsSync(abs)) throw new ToolError(`File not found: ${rel || p}`);
  const { fd, st } = openRegular(abs, fs.constants.O_RDONLY);
  try {
    const ext = path.extname(abs).toLowerCase();
    if (IMAGE_MIME[ext]) {
      if (st.size > 8 * 1024 * 1024) throw new ToolError(`Image too large to read (${st.size} bytes)`);
      return { kind: 'image', path: rel, mime: IMAGE_MIME[ext]!, base64: fs.readFileSync(fd).toString('base64'), bytes: st.size };
    }
    const size = Math.min(st.size, MAX_READ_BYTES);
    const buf = Buffer.alloc(size);
    fs.readSync(fd, buf, 0, size, 0);
    if (buf.subarray(0, 8000).includes(0)) return { kind: 'binary', path: rel, bytes: st.size };
    const lines = buf.toString('utf8').split('\n');
    const offset = Math.max(0, (opts.offset ?? 1) - 1);
    const limit = opts.limit ?? 2000;
    const slice = lines.slice(offset, offset + limit);
    const body = opts.numbered === false ? slice.join('\n') : slice.map((l, i) => `${String(offset + i + 1).padStart(6)}\t${l}`).join('\n');
    const { text, truncated } = truncateMiddle(body, 200_000);
    return { kind: 'text', path: rel, text, totalLines: lines.length, truncated: truncated || st.size > MAX_READ_BYTES || offset + limit < lines.length };
  } finally {
    fs.closeSync(fd);
  }
}

function countDiff(before: string, after: string) {
  let additions = 0;
  let deletions = 0;
  for (const part of diffLines(before, after)) {
    const n = part.count ?? 0;
    if (part.added) additions += n;
    else if (part.removed) deletions += n;
  }
  return { additions, deletions };
}

/** Lines changed, as a unified-ish diff text for the UI. */
export function unifiedDiff(before: string, after: string): string {
  const out: string[] = [];
  for (const part of diffLines(before, after)) {
    const prefix = part.added ? '+' : part.removed ? '-' : ' ';
    for (const line of part.value.replace(/\n$/, '').split('\n')) out.push(prefix + line);
  }
  return out.join('\n');
}

function ensureOwned(project: FileProject, abs: string) {
  if (project.uid == null || typeof process.getuid !== 'function' || process.getuid() !== 0) return;
  // chown the new file and any directories we had to create so sandboxed commands can edit them
  let cur = abs;
  const root = fs.realpathSync(project.dir);
  while (cur !== root && cur.startsWith(root + path.sep)) {
    try {
      fs.chownSync(cur, project.uid, project.uid);
    } catch { /* best effort */ }
    cur = path.dirname(cur);
  }
}

function writeBytes(abs: string, content: string) {
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  // O_NOFOLLOW: refuse to write through a symlink that appeared after resolve()
  const fd = fs.openSync(abs, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_TRUNC | fs.constants.O_NOFOLLOW, 0o644);
  try {
    fs.writeSync(fd, content);
  } finally {
    fs.closeSync(fd);
  }
}

export function writeProjectFile(project: FileProject, p: string, content: string): ChangeResult & { diff: string } {
  const { abs, rel } = resolve(project, p);
  if (!rel) throw new ToolError('Cannot write to the project root itself');
  const existed = fs.existsSync(abs);
  if (existed && fs.statSync(abs).isDirectory()) throw new ToolError(`${rel} is a directory`);
  const before = existed ? fs.readFileSync(abs, 'utf8') : '';
  writeBytes(abs, content);
  ensureOwned(project, abs);
  return { path: rel, change: existed ? 'modified' : 'created', ...countDiff(before, content), diff: unifiedDiff(before, content) };
}

export function editProjectFile(project: FileProject, p: string, oldString: string, newString: string, replaceAll = false): ChangeResult & { diff: string } {
  const { abs, rel } = resolve(project, p);
  if (!fs.existsSync(abs)) throw new ToolError(`File not found: ${rel || p}`);
  if (oldString === newString) throw new ToolError('old_string and new_string are identical');
  if (!oldString) throw new ToolError('old_string must not be empty (use write_file to create or replace a file)');
  const before = fs.readFileSync(abs, 'utf8');
  const count = before.split(oldString).length - 1;
  if (count === 0) throw new ToolError(`old_string not found in ${rel}. Re-read the file and copy the text exactly (including indentation).`);
  if (count > 1 && !replaceAll) throw new ToolError(`old_string matches ${count} places in ${rel}. Add more surrounding context to make it unique, or pass replace_all: true.`);
  const after = replaceAll ? before.split(oldString).join(newString) : before.replace(oldString, () => newString);
  writeBytes(abs, after);
  ensureOwned(project, abs);
  return { path: rel, change: 'modified', ...countDiff(before, after), diff: unifiedDiff(before, after) };
}

export function deleteProjectFile(project: FileProject, p: string): { path: string } {
  const { abs, rel } = resolve(project, p);
  if (!rel) throw new ToolError('Cannot delete the project root');
  if (!fs.existsSync(abs)) throw new ToolError(`File not found: ${rel}`);
  fs.rmSync(abs, { recursive: true, force: true });
  return { path: rel };
}

export interface TreeEntry {
  path: string;
  type: 'file' | 'dir';
  size?: number;
}

/** Flat listing (sorted), skipping node_modules/export/.git/.home. */
export function listProjectFiles(project: FileProject, p = '.', depth = 3): TreeEntry[] {
  const { abs } = resolve(project, p);
  const root = fs.realpathSync(project.dir);
  const out: TreeEntry[] = [];
  const walk = (dir: string, level: number) => {
    let names: string[];
    try {
      names = fs.readdirSync(dir).sort();
    } catch {
      return;
    }
    for (const name of names) {
      if (IGNORED.has(name)) continue;
      const full = path.join(dir, name);
      const lst = fs.lstatSync(full);
      if (lst.isSymbolicLink()) continue; // never follow links out of the project
      const rel = path.relative(root, full);
      if (lst.isDirectory()) {
        out.push({ path: rel, type: 'dir' });
        if (level < depth) walk(full, level + 1);
      } else out.push({ path: rel, type: 'file', size: lst.size });
    }
  };
  if (!fs.existsSync(abs)) throw new ToolError(`Directory not found: ${p}`);
  if (!fs.statSync(abs).isDirectory()) throw new ToolError(`${p} is not a directory`);
  walk(abs, 1);
  return out;
}

/** Total bytes under a directory (skips symlinks). Used for quotas. */
export function dirSize(dir: string): number {
  let total = 0;
  const walk = (d: string) => {
    for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, ent.name);
      if (ent.isSymbolicLink()) continue;
      if (ent.isDirectory()) walk(full);
      else total += fs.statSync(full).size;
    }
  };
  walk(dir);
  return total;
}

/** A project file's bytes (regular file, no symlinks), refusing anything over `maxBytes`. */
export function readProjectBytes(project: FileProject, p: string, maxBytes: number): { rel: string; bytes: Buffer } {
  const { abs, rel } = resolve(project, p);
  const { fd, st } = openRegular(abs, fs.constants.O_RDONLY);
  try {
    if (st.size > maxBytes) throw new ToolError(`${rel} is larger than ${Math.round(maxBytes / 1024 / 1024)} MB`);
    return { rel, bytes: fs.readFileSync(fd) };
  } finally {
    fs.closeSync(fd);
  }
}

/** Write bytes into the project (owned by the project uid). Refuses to overwrite an existing file. */
export function writeProjectBytes(project: FileProject, p: string, bytes: Buffer): { rel: string } {
  const { abs, rel } = resolve(project, p);
  if (!rel) throw new ToolError('Cannot write to the project root itself');
  if (fs.existsSync(abs)) throw new ToolError(`${rel} already exists — choose another path or delete it first`);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  const fd = fs.openSync(abs, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o644);
  try {
    fs.writeSync(fd, bytes);
  } finally {
    fs.closeSync(fd);
  }
  ensureOwned(project, abs);
  return { rel };
}
