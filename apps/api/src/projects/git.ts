// Server-side git for project folders. Every call runs as the project's own uid (see runAsProject).
import type { ProjectRef } from '../runner/exec.js';
import { badRequest, notFound } from '../http/errors.js';
import { git } from './dirs.js';

const SHA = /^[0-9a-f]{7,40}$/;
export const assertSha = (sha: string) => {
  if (!SHA.test(sha)) throw badRequest('Invalid commit id');
  return sha;
};

function run(project: ProjectRef, args: string[], input?: string) {
  const r = git(project, args, { input });
  if (r.error) throw new Error(`git ${args[0]}: ${r.error.message}`);
  return r;
}

export interface CommitSummary {
  sha: string;
  message: string;
  time: number;
  files: number;
  additions: number;
  deletions: number;
}

/** Newest first. */
export function gitLog(project: ProjectRef, limit = 50, skip = 0): CommitSummary[] {
  const r = run(project, ['log', `-n${limit}`, `--skip=${skip}`, '--numstat', '--pretty=format:%x1e%H%x1f%at%x1f%s']);
  if (r.status !== 0) return []; // no commits yet
  return r.stdout
    .split('\x1e')
    .filter(Boolean)
    .map((block) => {
      const [head, ...stat] = block.split('\n');
      const [sha, at, ...msg] = head!.split('\x1f');
      let additions = 0;
      let deletions = 0;
      let files = 0;
      for (const l of stat) {
        const m = /^(\d+|-)\t(\d+|-)\t/.exec(l);
        if (!m) continue;
        files++;
        additions += m[1] === '-' ? 0 : Number(m[1]);
        deletions += m[2] === '-' ? 0 : Number(m[2]);
      }
      return { sha: sha!, message: msg.join('\x1f'), time: Number(at) * 1000, files, additions, deletions };
    });
}

export interface CommitDetail extends CommitSummary {
  changes: Array<{ path: string; status: string; additions: number; deletions: number }>;
  /** unified diff, capped */
  diff: string;
  diffTruncated: boolean;
}

export function gitShow(project: ProjectRef, sha: string, maxDiff = 300_000): CommitDetail {
  assertSha(sha);
  const meta = run(project, ['show', '-s', '--pretty=format:%H%x1f%at%x1f%s', sha]);
  if (meta.status !== 0) throw notFound('Commit not found');
  const [full, at, ...msg] = meta.stdout.split('\x1f');
  const ns = run(project, ['show', '--numstat', '--name-status', '--pretty=format:', '--no-renames', sha]);
  const stat = run(project, ['show', '--numstat', '--pretty=format:', '--no-renames', sha]).stdout.split('\n').filter(Boolean);
  const status = new Map<string, string>();
  for (const l of ns.stdout.split('\n')) {
    const m = /^([AMD])\t(.+)$/.exec(l);
    if (m) status.set(m[2]!, m[1]!);
  }
  const changes = stat
    .map((l) => /^(\d+|-)\t(\d+|-)\t(.+)$/.exec(l))
    .filter((m): m is RegExpExecArray => !!m)
    .map((m) => ({ path: m[3]!, status: status.get(m[3]!) ?? 'M', additions: m[1] === '-' ? 0 : Number(m[1]), deletions: m[2] === '-' ? 0 : Number(m[2]) }));
  const patch = run(project, ['show', '--pretty=format:', '--no-renames', '--no-color', sha]).stdout;
  return {
    sha: full!,
    time: Number(at) * 1000,
    message: msg.join('\x1f'),
    files: changes.length,
    additions: changes.reduce((a, c) => a + c.additions, 0),
    deletions: changes.reduce((a, c) => a + c.deletions, 0),
    changes,
    diff: patch.slice(0, maxDiff),
    diffTruncated: patch.length > maxDiff,
  };
}

/** File content at a commit (text, capped). */
export function gitFileAt(project: ProjectRef, sha: string, file: string, max = 1_000_000): { content: string; truncated: boolean } {
  assertSha(sha);
  if (file.includes('\0') || file.startsWith('/') || file.split('/').includes('..')) throw badRequest('Invalid path');
  const r = run(project, ['show', `${sha}:${file}`]);
  if (r.status !== 0) throw notFound('File not found in that commit');
  return { content: r.stdout.slice(0, max), truncated: r.stdout.length > max };
}

export interface CommitResult {
  sha: string;
  message: string;
  files: string[];
}

/** `git add -A && git commit` — returns null when nothing changed. */
export function commitAll(project: ProjectRef, message: string): CommitResult | null {
  run(project, ['add', '-A']);
  const staged = run(project, ['diff', '--cached', '--name-only']).stdout.split('\n').filter(Boolean);
  if (!staged.length) return null;
  const r = run(project, ['commit', '-q', '-m', message.slice(0, 200)]);
  if (r.status !== 0) throw new Error(`git commit failed: ${r.stderr}`);
  const sha = run(project, ['rev-parse', 'HEAD']).stdout.trim();
  return { sha, message, files: staged };
}

/**
 * Restore = a NEW commit whose tree equals commit `sha` (history is never rewritten).
 * Returns null when the project already matches that commit.
 */
export function gitRestore(project: ProjectRef, sha: string): CommitResult | null {
  assertSha(sha);
  const meta = run(project, ['show', '-s', '--pretty=format:%h %s', sha]);
  if (meta.status !== 0) throw notFound('Commit not found');
  const r = run(project, ['read-tree', '-u', '--reset', sha]);
  if (r.status !== 0) throw new Error(`git read-tree failed: ${r.stderr}`);
  return commitAll(project, `Restore to ${meta.stdout.trim()}`);
}
