// Shared by the CLI scripts: argument parsing, project root, .env loading, project files.
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

export const scriptsDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

/** `--key value` and `--flag` options plus positional arguments. */
export function parseArgs(argv = process.argv.slice(2)) {
  const opts = {};
  const pos = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        opts[key] = next;
        i++;
      } else opts[key] = true;
    } else pos.push(a);
  }
  return { opts, pos };
}

/** The project folder: --root <dir> (used by Luma Studio's own pristine copy of these scripts) or the folder above scripts/. */
export function projectRoot(opts) {
  return path.resolve(opts.root ?? path.join(scriptsDir, '..'));
}

/** Loads KEY=value pairs from <root>/.env into process.env (existing variables win). */
export async function loadEnv(root) {
  try {
    const raw = await readFile(path.join(root, '.env'), 'utf8');
    for (const line of raw.split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch { /* no .env — rely on the real environment */ }
}

export const readJson = async (file) => JSON.parse(await readFile(file, 'utf8'));
export const round3 = (n) => Math.round(n * 1000) / 1000;

export const ELEVEN_BASE = () => (process.env.ELEVENLABS_API_BASE ?? 'https://api.elevenlabs.io').replace(/\/$/, '');

/** Validates script.json; returns a list of human-readable problems. */
export function validateScript(script) {
  const problems = [];
  if (!script?.voice?.voice_id) problems.push('script.json: voice.voice_id is missing');
  if (!script?.voice?.model_id) problems.push('script.json: voice.model_id is missing');
  if (!Array.isArray(script?.segments) || !script.segments.length) problems.push('script.json: segments[] is empty');
  const seen = new Set();
  for (const s of script?.segments ?? []) {
    if (!s.id || !/^[A-Za-z0-9_-]+$/.test(s.id)) problems.push(`script.json: segment id "${s.id}" must match [A-Za-z0-9_-]+`);
    if (seen.has(s.id)) problems.push(`script.json: duplicate segment id "${s.id}"`);
    seen.add(s.id);
    if (!s.text?.trim()) problems.push(`script.json: segment "${s.id}" has no text`);
  }
  return problems;
}

const sharedDirs = () => (process.env.NODE_PATH ?? '').split(path.delimiter).filter(Boolean);

/** Resolve a file inside a package from the project, then from the shared base (/opt/luma/node_modules via NODE_PATH). ESM ignores NODE_PATH, so we do it by hand. */
export function resolvePkg(spec, root) {
  const require = createRequire(path.join(root ?? process.cwd(), 'noop.js'));
  return require.resolve(spec, { paths: [root ?? process.cwd(), ...sharedDirs()] });
}

/** import() a package that may live in the project's node_modules or in the shared base. */
export async function importPkg(name, root) {
  try {
    return await import(pathToFileURL(resolvePkg(name, root)).href);
  } catch (e) {
    throw new Error(`Cannot find package "${name}" (looked in the project and in NODE_PATH). Run \`npm install ${name}\` in the project. (${e.code ?? e.message})`);
  }
}
