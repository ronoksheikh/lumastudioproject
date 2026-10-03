// Swap the project's content for one of the engine's bundled examples (scenes, styles, script, voice, project settings).
// The examples live in the engine (Luma Studio provides it read-only), not in the project.
//
// Usage: node scripts/use-example.mjs <name> [--root <project>]     |   node scripts/use-example.mjs --list
import { cp, readdir, rm, mkdir, copyFile, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { parseArgs, projectRoot, engineDir } from './lib/common.mjs';

const { opts, pos } = parseArgs();
const root = projectRoot(opts);
// a legacy project may still carry its own examples/ folder
const examplesDir = existsSync(path.join(root, 'examples')) ? path.join(root, 'examples') : path.join(engineDir, 'examples');
const available = existsSync(examplesDir) ? (await readdir(examplesDir, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name) : [];

if (opts.list || !pos[0]) {
  console.log(available.length ? `Examples: ${available.join(', ')}` : 'No examples in this project.');
  process.exit(opts.list ? 0 : 1);
}
const name = pos[0];
if (!available.includes(name)) {
  console.error(`Unknown example "${name}". Available: ${available.join(', ')}`);
  process.exit(1);
}
const ex = path.join(examplesDir, name);

// scenes: replace the whole folder
const scenesDst = path.join(root, 'public/js/scenes');
await rm(scenesDst, { recursive: true, force: true });
await cp(path.join(ex, 'scenes'), scenesDst, { recursive: true });
// the rest, if the example provides it
const copies = [
  ['scenes.css', 'public/css/scenes.css'],
  ['script.json', 'script.json'],
];
for (const [from, to] of copies) {
  if (existsSync(path.join(ex, from))) {
    await mkdir(path.dirname(path.join(root, to)), { recursive: true });
    await copyFile(path.join(ex, from), path.join(root, to));
  }
}
// project.json: the example's settings (aspect, fps, features) but the student's own title
if (existsSync(path.join(ex, 'project.json'))) {
  const mine = existsSync(path.join(root, 'project.json')) ? JSON.parse(await readFile(path.join(root, 'project.json'), 'utf8')) : {};
  const theirs = JSON.parse(await readFile(path.join(ex, 'project.json'), 'utf8'));
  await writeFile(path.join(root, 'project.json'), JSON.stringify({ ...theirs, ...(mine.title ? { title: mine.title } : {}) }, null, 2) + '\n');
}
if (existsSync(path.join(ex, 'audio'))) await cp(path.join(ex, 'audio'), path.join(root, 'public/audio'), { recursive: true });
if (existsSync(path.join(ex, 'assets'))) await cp(path.join(ex, 'assets'), path.join(root, 'assets'), { recursive: true });
await mkdir(path.join(root, 'assets'), { recursive: true });
console.log(`Project now uses the "${name}" example.`);
