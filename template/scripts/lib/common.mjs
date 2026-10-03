// Shared by the CLI scripts: argument parsing, project root, .env loading, project files.
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

export const scriptsDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
/** The engine (this template): index.html, main.js, lib/, recipes, base css, fonts — shared read-only by every project. */
export const engineDir = path.dirname(scriptsDir);

/** Project paths that never fall back to the engine (see server.mjs). */
const PROJECT_OWNED = /^(public\/js\/scenes(\/|$)|public\/audio(\/|$)|public\/css\/scenes\.css$|(project|brand|script)\.json$)/;

/**
 * Where a project-relative path really lives: the project's own file if it exists, else the engine's copy
 * (for engine paths like public/js/lib/… or assets/fonts/…). Returns null when neither exists.
 */
export function overlayFile(root, rel) {
  const clean = path.normalize(rel).replace(/^[/\\]+/, '');
  if (clean.startsWith('..')) return null;
  const candidates = [path.join(root, clean)];
  if (!PROJECT_OWNED.test(clean.split(path.sep).join('/')) && path.resolve(root) !== path.resolve(engineDir)) candidates.push(path.join(engineDir, clean));
  return candidates.find((f) => existsSync(f)) ?? null;
}

/** Plain-language reason a project cannot be played/rendered yet, or null when it has scenes. */
export function emptyProjectReason(root) {
  if (!existsSync(path.join(root, 'public/js/scenes/index.js'))) {
    return 'This project has no scenes yet (public/js/scenes/index.js does not exist). Write script.json, generate the voice, then create the scene files and public/js/scenes/index.js — see read_guide("engine").';
  }
  if (!existsSync(path.join(root, 'public/audio/timing.json'))) {
    return 'This project has no voice timing yet (public/audio/timing.json is missing). Generate the voice first (generate_voice; placeholder:true works without a key).';
  }
  return null;
}

/** Flags that never take a value (so a positional argument after them stays positional). */
const BOOLEAN_FLAGS = new Set(['placeholder', 'key-stdin', 'no-env', 'video-only', 'page', 'json', 'list', 'help', 'no-checks', 'describe']);

/** `--key value` and `--flag` options plus positional arguments. */
export function parseArgs(argv = process.argv.slice(2)) {
  const opts = {};
  const pos = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (!BOOLEAN_FLAGS.has(key) && next !== undefined && !next.startsWith('--')) {
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
export async function loadEnv(root, opts = {}) {
  if (opts['no-env']) return; // Luma Studio runs these scripts itself and never trusts a project's .env
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

/** Validates script.json; returns a list of human-readable problems. A placeholder (silent) voice needs no voice/model yet. */
export function validateScript(script, { requireVoice = true } = {}) {
  const problems = [];
  if (requireVoice && !script?.voice?.voice_id) problems.push('script.json: voice.voice_id is missing — call list_voices and pick one');
  if (requireVoice && !script?.voice?.model_id) problems.push('script.json: voice.model_id is missing (e.g. eleven_multilingual_v2, or eleven_v3 for Bengali)');
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

/** Reads the ElevenLabs key from stdin (`--key-stdin`) so it never appears in a process environment or argv. */
export async function applyKeyFromStdin(opts) {
  if (!opts['key-stdin']) return;
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  const key = Buffer.concat(chunks).toString('utf8').trim();
  if (key) process.env.ELEVENLABS_API_KEY = key;
}

/** A plain-language explanation (and what to try next) for an ElevenLabs error response. */
export function explainElevenError(status, bodyText) {
  let detail = {};
  try { detail = JSON.parse(bodyText)?.detail ?? {}; } catch { /* not json */ }
  const code = typeof detail === 'object' ? String(detail.status ?? detail.code ?? '') : '';
  const message = typeof detail === 'string' ? detail : String(detail.message ?? bodyText).slice(0, 400);
  const all = `${code} ${message}`;
  let hint = '';
  if (status === 401 && /permission/i.test(all)) hint = 'The key lacks a permission (it needs text_to_speech, and voices_read for list_voices). Ask the student to edit the key in ElevenLabs.';
  else if (status === 401) hint = 'ElevenLabs rejected the API key — the student should check it in Settings → Voice.';
  else if (/free users|free_users|paid|subscription|upgrade|plan/i.test(all)) hint = 'Not available on this ElevenLabs plan. Pick a "premade" voice from list_voices (usable: yes) and a free-plan model (eleven_multilingual_v2, or eleven_v3 for languages it lacks such as Bengali), then try again.';
  else if (/quota|credits|character_limit|exceeds your/i.test(all)) hint = 'The ElevenLabs account is out of characters this month. Tell the student; continue with generate_voice placeholder:true meanwhile.';
  else if (/voice_not_found|voice.*not found|does not exist/i.test(all)) hint = 'That voice id does not exist for this account. Call list_voices and use one of its voice_id values.';
  else if (/model/i.test(all)) hint = 'That model can\'t be used here. Try eleven_v3 (all languages incl. Bengali) or eleven_multilingual_v2 (English and 28 other languages).';
  else if (status === 429) hint = 'ElevenLabs is rate limiting / busy. Wait a little and try again.';
  return `ElevenLabs refused the request (${status}${code ? ` ${code}` : ''}): ${message}${hint ? `\n→ ${hint}` : ''}`;
}

/** True when ElevenLabs complains about language_code (some models, e.g. eleven_multilingual_v2, don't take it). */
export const isLanguageCodeError = (status, bodyText) => status >= 400 && status < 500 && /language[_ ]code|language enforcement/i.test(bodyText);

/**
 * POST /v1/text-to-speech/:voice/with-timestamps. language_code is only sent when set, and dropped (with a note)
 * if the model refuses it. Throws an Error whose message is already explained for the agent (explainElevenError).
 */
export async function ttsWithTimestamps(apiKey, voice, fields) {
  const url = `${ELEVEN_BASE()}/v1/text-to-speech/${encodeURIComponent(voice.voice_id)}/with-timestamps?output_format=mp3_44100_128`;
  const send = (withLang) => fetch(url, {
    method: 'POST',
    headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ ...fields, model_id: voice.model_id, ...(withLang && voice.language_code ? { language_code: voice.language_code } : {}), voice_settings: voice.voice_settings }),
  });
  let res = await send(true);
  if (!res.ok) {
    const text = (await res.text()).replaceAll(apiKey, '***');
    if (voice.language_code && isLanguageCodeError(res.status, text)) {
      console.log(`Note: ${voice.model_id} does not take language_code — retrying without it (the language comes from the text).`);
      res = await send(false);
      if (!res.ok) throw new Error(explainElevenError(res.status, (await res.text()).replaceAll(apiKey, '***')));
    } else throw new Error(explainElevenError(res.status, text));
  }
  return res.json();
}
