// Static checks to run before rendering: `npm run check` (add --page to also build the video in headless Chrome).
// Engine files (public/js/lib, base css, fonts…) may live in the engine instead of the project: see overlayFile().
//   - project.json / brand.json / script.json are valid, timing.json matches the script
//   - audio exists and its length matches timing.json
//   - every scene file is imported by scenes/index.js, and every import resolves
//   - every w('segment', n) / S.segment / range('segment') used in scenes exists in timing.json
//   - no nondeterminism (setTimeout, Math.random, requestAnimationFrame, CSS animations) in scenes
//   - every assets/… referenced exists
//   - --page: the page builds without errors and the timeline is at least as long as the audio
// Exit code 1 if any error; warnings do not fail. --json prints a machine-readable report.

import { readFile, readdir, access } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { parseArgs, projectRoot, readJson, validateScript, overlayFile } from './lib/common.mjs';

const { opts } = parseArgs();
const root = projectRoot(opts);
const errors = [];
const warnings = [];
const ok = [];
const err = (m) => errors.push(m);
const warn = (m) => warnings.push(m);
const exists = (f) => access(f).then(() => true, () => false);
/** a project-relative path exists in the project or (for engine paths) in the engine Luma Studio provides */
const existsRel = (rel) => overlayFile(root, rel) !== null;
const rel = (f) => path.relative(root, f);
const lineOf = (src, idx) => src.slice(0, idx).split('\n').length;

// ---------- project files ----------
let project;
let brand;
let script;
let timing;
try {
  project = await readJson(path.join(root, 'project.json'));
  if (!['16:9', '9:16'].includes(project.aspect) && !(project.width && project.height)) err('project.json: aspect must be "16:9" or "9:16"');
  if (project.fps && ![24, 25, 30, 50, 60].includes(project.fps)) warn(`project.json: unusual fps ${project.fps}`);
} catch (e) {
  err(`project.json: ${e.message}`);
}
try {
  brand = await readJson(path.join(root, project?.brand ?? 'brand.json'));
  for (const k of ['sky', 'blue', 'royal', 'deep', 'nightA', 'nightB', 'off']) if (!brand.colors?.[k]) err(`brand.json: colors.${k} is missing`);
  for (const k of ['icon', 'lockup']) {
    if (brand.logo?.[k] && !existsRel(brand.logo[k])) err(`brand.json: logo.${k} file not found: ${brand.logo[k]}`);
  }
  if (!brand.logo?.icon) err('brand.json: logo.icon is required (particles and the 3D logo use it)');
} catch (e) {
  err(`brand.json: ${e.message}`);
}
try {
  script = await readJson(path.join(root, 'script.json'));
  validateScript(script).forEach(err);
} catch (e) {
  err(e.code === 'ENOENT' ? 'script.json does not exist yet — write the voiceover script first (voice settings + one segment per scene)' : `script.json: ${e.message}`);
}
try {
  timing = await readJson(path.join(root, 'public/audio/timing.json'));
} catch {
  err('public/audio/timing.json is missing — generate the voice first (the generate_voice tool; placeholder:true works without an ElevenLabs key)');
}

// ---------- timing vs script ----------
if (script && timing) {
  const sIds = script.segments.map((s) => s.id);
  const tIds = timing.segments.map((s) => s.id);
  if (sIds.join() !== tIds.join()) err(`timing.json segments (${tIds.join(', ')}) do not match script.json (${sIds.join(', ')}) — generate the voice again (generate_voice)`);
  else {
    for (const s of script.segments) {
      const t = timing.segments.find((x) => x.id === s.id);
      if (t.text !== s.text) err(`segment "${s.id}": script.json text changed since the voice was generated — re-record it with patch_voice "${s.id}" (one line) or generate_voice`);
    }
  }
  if (timing.placeholder) warn('timing.json is a PLACEHOLDER (silent voice) — generate the real voice before the final render');
  for (const s of timing.segments) if (!s.words.length) err(`segment "${s.id}" has no words in timing.json`);
}
const audioFile = path.join(root, 'public/audio/voiceover.mp3');
if (!(await exists(audioFile))) { if (timing) err('public/audio/voiceover.mp3 is missing — generate the voice again'); }
else if (timing) {
  try {
    const d = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', audioFile], { encoding: 'utf8' }));
    if (Math.abs(d - timing.duration) > 0.4) err(`voiceover.mp3 is ${d.toFixed(2)}s but timing.json says ${timing.duration}s — regenerate the voice`);
  } catch {
    warn('ffprobe not available — skipped audio length check');
  }
}

// ---------- scenes ----------
const scenesDir = path.join(root, 'public/js/scenes');
const sceneFiles = (await readdir(scenesDir).catch(() => [])).filter((f) => f.endsWith('.js'));
if (!sceneFiles.includes('index.js')) err('no scenes yet: public/js/scenes/index.js is missing — create the scene files and list them in public/js/scenes/index.js (read_guide "engine")');
const segIds = new Set(timing?.segments.map((s) => s.id));
const segWords = Object.fromEntries((timing?.segments ?? []).map((s) => [s.id, s.words.length]));

const FORBIDDEN = [
  [/\bsetTimeout\s*\(/, 'setTimeout — use timeline times (tl.… , t)'],
  [/\bsetInterval\s*\(/, 'setInterval — use onFrame(t)'],
  [/\bMath\.random\s*\(/, 'Math.random() — use rand(i, k) from lib/core.js (deterministic)'],
  [/\brequestAnimationFrame\s*\(/, 'requestAnimationFrame — the engine owns the frame loop'],
  [/\bDate\.now\s*\(|performance\.now\s*\(/, 'wall-clock time — everything must be a function of t'],
  [/\.splitText|SplitText/, 'SplitText (not available) — use splitWords()'],
];

for (const f of sceneFiles) {
  const file = path.join(scenesDir, f);
  const src = await readFile(file, 'utf8');
  // static w('id', n) / wEnd / reveal-style references
  for (const m of src.matchAll(/\b(?:w|wEnd)\(\s*['"]([\w-]+)['"]\s*(?:,\s*(-?\d+)\s*)?\)/g)) {
    const [, id, n] = m;
    if (timing && !segIds.has(id)) err(`${rel(file)}:${lineOf(src, m.index)}: segment "${id}" is not in timing.json (have: ${[...segIds].join(', ')})`);
    else if (timing && n !== undefined) {
      const i = Number(n);
      const count = segWords[id];
      if (i >= count || i < -count) err(`${rel(file)}:${lineOf(src, m.index)}: ${m[0]} — segment "${id}" only has ${count} words (0-${count - 1})`);
    }
  }
  for (const m of src.matchAll(/\bS\.([A-Za-z_]\w*)|\bS\[\s*['"]([\w-]+)['"]\s*\]|\brange\(\s*['"]([\w-]+)['"]\s*\)/g)) {
    const id = m[1] ?? m[2] ?? m[3];
    if (timing && !segIds.has(id)) err(`${rel(file)}:${lineOf(src, m.index)}: segment "${id}" is not in timing.json`);
  }
  for (const [re, what] of FORBIDDEN) {
    const m = src.match(re);
    if (m) err(`${rel(file)}:${lineOf(src, m.index)}: ${what}`);
  }
  // relative imports must resolve
  for (const m of src.matchAll(/from\s+['"](\.[^'"]+)['"]/g)) {
    if (!existsRel(path.relative(root, path.resolve(path.dirname(file), m[1])))) err(`${rel(file)}:${lineOf(src, m.index)}: import not found: ${m[1]}`);
  }
  // assets
  for (const m of src.matchAll(/['"`]((?:\/)?assets\/[^'"`$\s]+)['"`]/g)) {
    const a = m[1].replace(/^\//, '');
    if (!existsRel(a)) err(`${rel(file)}:${lineOf(src, m.index)}: asset not found: ${a}`);
  }
}
if (sceneFiles.includes('index.js')) {
  const idx = await readFile(path.join(scenesDir, 'index.js'), 'utf8');
  for (const f of sceneFiles.filter((x) => /^\d/.test(x))) {
    if (!idx.includes(`./${f}`)) warn(`scenes/${f} is not imported by scenes/index.js (it will not play)`);
  }
}

// ---------- CSS ----------
const cssFile = path.join(root, 'public/css/scenes.css');
if (await exists(cssFile)) {
  const css = await readFile(cssFile, 'utf8');
  if (/@keyframes|animation\s*:|transition\s*:/.test(css)) warn('scenes.css uses CSS animation/transition — frames must be a function of t; animate with GSAP instead');
  for (const m of css.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g)) {
    if (m[1].startsWith('data:') || m[1].startsWith('http')) continue;
    const a = m[1].replace(/^\.\.\//, '').replace(/^\//, '');
    if (!existsRel(a) && !existsRel(path.join('public', a))) err(`scenes.css: url() not found: ${m[1]}`);
  }
  if (/(?:^|[^-\w])(?:#0{3,6}|black)\b/i.test(css.replace(/rgba?\([^)]*\)/g, ''))) warn('scenes.css uses pure black — brand stages are Lumademy blue or white');
}

// ---------- page build ----------
if (opts.page && errors.length === 0) {
  const { openProject, loadVideo } = await import('./lib/browser.mjs');
  const { browser, url, close } = await openProject(root, { url: opts.url });
  try {
    const { page, error, logs } = await loadVideo(browser, url);
    if (error) err(`the video failed to build:\n${error}`);
    else {
      const d = await page.evaluate(() => window.ad.duration);
      if (timing && d < timing.duration) err(`timeline is ${d.toFixed(2)}s but the audio is ${timing.duration}s`);
      else ok.push(`page builds: ${d.toFixed(2)}s timeline`);
    }
    for (const l of logs) warn(l);
  } finally {
    await close();
  }
}

if (!errors.length) ok.unshift('project files, timing and scenes look consistent');
if (opts.json) {
  console.log(JSON.stringify({ ok: errors.length === 0, errors, warnings, info: ok }, null, 2));
} else {
  for (const m of ok) console.log(`✓ ${m}`);
  for (const m of warnings) console.log(`! ${m}`);
  for (const m of errors) console.log(`✗ ${m}`);
  console.log(errors.length ? `\n${errors.length} error(s), ${warnings.length} warning(s)` : `\nOK (${warnings.length} warning(s))`);
}
process.exit(errors.length ? 1 : 0);
