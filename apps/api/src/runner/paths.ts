import fs from 'node:fs';
import path from 'node:path';

export class PathError extends Error {
  constructor(message: string, readonly code: 'outside' | 'symlink' | 'invalid' = 'outside') {
    super(message);
  }
}

const within = (base: string, target: string) => target === base || target.startsWith(base + path.sep);

/**
 * Resolves a user/model supplied path against the project directory. Rejects:
 *  - NUL bytes
 *  - `..` escapes and absolute paths outside the project
 *  - symlinks (anywhere along the existing part of the path) that point outside the project
 * Returns the absolute, symlink-free path. The target itself need not exist.
 */
export function resolveInProject(projectDir: string, input: string): string {
  if (input.includes('\0')) throw new PathError('Path contains a NUL byte', 'invalid');
  const root = fs.realpathSync(projectDir);
  const nominal = path.resolve(projectDir);
  let candidate = path.isAbsolute(input) ? path.normalize(input) : path.normalize(path.join(root, input));
  // an absolute path spelled through the (possibly symlinked) nominal project dir
  if (within(nominal, candidate) && nominal !== root) candidate = path.join(root, path.relative(nominal, candidate));
  if (!within(root, candidate)) throw new PathError(`Path escapes the project: ${input}`);

  // resolve symlinks along the deepest existing ancestor, then re-attach the missing tail
  let existing = candidate;
  const missing: string[] = [];
  while (!fs.existsSync(existing)) {
    let dangling = false;
    try {
      dangling = fs.lstatSync(existing).isSymbolicLink();
    } catch { /* not even an entry: keep walking up */ }
    if (dangling) throw new PathError(`Dangling symlink in path: ${input}`, 'symlink');
    missing.unshift(path.basename(existing));
    const parent = path.dirname(existing);
    if (parent === existing) break;
    existing = parent;
  }
  const real = fs.realpathSync(existing);
  if (!within(root, real)) throw new PathError(`Path escapes the project through a symlink: ${input}`, 'symlink');
  return path.join(real, ...missing);
}

/** Path relative to the project root ('' for the root itself). */
export const relInProject = (projectDir: string, abs: string) => path.relative(fs.realpathSync(projectDir), abs);
