// Tracks what changed in the project folder between two points in time (used around bash/voice calls).
import fs from 'node:fs';
import path from 'node:path';
import { git } from '../projects/dirs.js';
import type { ProjectRef } from '../runner/exec.js';

export interface Snapshot {
  /** path -> "size:mtimeMs" for every file git considers changed or untracked, plus tracked files that vanished */
  files: Map<string, string>;
}

const sig = (abs: string) => {
  try {
    const st = fs.lstatSync(abs);
    return `${st.size}:${Math.round(st.mtimeMs)}`;
  } catch {
    return 'deleted';
  }
};

/** Files that differ from the last commit (modified, added, deleted, untracked) with a cheap signature. */
export function snapshot(project: ProjectRef): Snapshot {
  const files = new Map<string, string>();
  const r = git(project, ['status', '--porcelain=v1', '-z', '--untracked-files=all']);
  if (r.status !== 0) return { files };
  for (const entry of r.stdout.split('\0').filter(Boolean)) {
    const file = entry.slice(3);
    if (entry[0] === 'R' || entry[1] === 'R') continue;
    files.set(file, sig(path.join(project.dir, file)));
  }
  return { files };
}

export interface FileChange {
  path: string;
  change: 'created' | 'modified' | 'deleted';
  additions: number;
  deletions: number;
}

function countLines(abs: string): number {
  try {
    const buf = fs.readFileSync(abs);
    if (buf.subarray(0, 8000).includes(0)) return 0;
    const text = buf.toString('utf8');
    return text ? text.split('\n').length - (text.endsWith('\n') ? 1 : 0) : 0;
  } catch {
    return 0;
  }
}

/** Changes that happened between two snapshots, with line counts relative to the last commit. */
export function diffSnapshots(project: ProjectRef, before: Snapshot, after: Snapshot): FileChange[] {
  const changed = new Set<string>();
  for (const [f, s] of after.files) if (before.files.get(f) !== s) changed.add(f);
  for (const f of before.files.keys()) if (!after.files.has(f)) changed.add(f); // reverted to the committed state
  if (!changed.size) return [];

  const tracked = new Set(git(project, ['ls-files', '-z']).stdout.split('\0').filter(Boolean));
  const numstat = new Map<string, { a: number; d: number }>();
  const ns = git(project, ['diff', '--numstat', '-z', 'HEAD', '--']);
  if (ns.status === 0) {
    // -z numstat: "<add>\t<del>\t<path>\0"
    for (const rec of ns.stdout.split('\0').filter(Boolean)) {
      const m = /^(\d+|-)\t(\d+|-)\t(.+)$/.exec(rec);
      if (m) numstat.set(m[3]!, { a: m[1] === '-' ? 0 : Number(m[1]), d: m[2] === '-' ? 0 : Number(m[2]) });
    }
  }
  const out: FileChange[] = [];
  for (const f of [...changed].sort()) {
    if (f.startsWith('.home/') || f.startsWith('.luma/') || f.startsWith('node_modules/')) continue;
    const abs = path.join(project.dir, f);
    const exists = fs.existsSync(abs);
    if (!exists) {
      const d = numstat.get(f);
      out.push({ path: f, change: 'deleted', additions: 0, deletions: d?.d ?? 0 });
    } else if (!tracked.has(f)) {
      out.push({ path: f, change: 'created', additions: countLines(abs), deletions: 0 });
    } else {
      const d = numstat.get(f);
      out.push({ path: f, change: 'modified', additions: d?.a ?? 0, deletions: d?.d ?? 0 });
    }
  }
  return out;
}
