// `node --test test/` — exercises the CLI scripts against a mock ElevenLabs server (no network, no API key).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { execFileSync, execFile, spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readdir, readFile, writeFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const template = path.resolve(here, '..');
let dir; // scratch project
let mock;
let mockPort;
const requests = [];

function silentMp3(seconds) {
  return execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono', '-t', String(seconds), '-c:a', 'libmp3lame', '-b:a', '64k', '-f', 'mp3', '-'], { maxBuffer: 1 << 24 });
}

before(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'luma-tpl-'));
  await cp(path.join(template, 'scaffold'), dir, { recursive: true });
  // mock /v1/text-to-speech/:voice/with-timestamps: 0.05s per character, audio length = text length * 0.05
  mock = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const j = JSON.parse(body);
      requests.push({ url: req.url, key: req.headers['xi-api-key'], body: j });
      if (req.headers['xi-api-key'] !== 'test-key') return res.writeHead(401).end('{"detail":"bad key"}');
      const chars = [...j.text];
      const dur = chars.length * 0.05;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        audio_base64: silentMp3(dur).toString('base64'),
        alignment: {
          characters: chars,
          character_start_times_seconds: chars.map((_, i) => i * 0.05),
          character_end_times_seconds: chars.map((_, i) => (i + 1) * 0.05),
        },
      }));
    });
  });
  await new Promise((r) => mock.listen(0, '127.0.0.1', r));
  mockPort = mock.address().port;
});

after(async () => {
  mock.close();
  await rm(dir, { recursive: true, force: true });
});

// async on purpose: the mock server lives in this process, so a blocking spawnSync would deadlock
const run = (script, args = [], env = {}) =>
  new Promise((resolve) => {
    execFile('node', [path.join(template, 'scripts', script), '--root', dir, ...args], {
      encoding: 'utf8',
      env: { ...process.env, ELEVENLABS_API_BASE: `http://127.0.0.1:${mockPort}`, ...env },
    }, (error, stdout, stderr) => resolve({ status: error ? (error.code ?? 1) : 0, stdout, stderr }));
  });

test('generate-voice builds word timings from character alignment', async () => {
  await writeFile(path.join(dir, 'script.json'), JSON.stringify({
    voice: { voice_id: 'v1', model_id: 'm', language_code: 'en', voice_settings: {} },
    segments: [{ id: 'a', text: 'Hello big world.' }, { id: 'b', text: 'Second line here.' }],
  }));
  const r = await run('generate-voice.mjs', [], { ELEVENLABS_API_KEY: 'test-key' });
  assert.equal(r.status, 0, r.stderr + r.stdout);
  const timing = JSON.parse(await readFile(path.join(dir, 'public/audio/timing.json'), 'utf8'));
  assert.deepEqual(timing.segments.map((s) => s.id), ['a', 'b']);
  assert.deepEqual(timing.segments[0].words.map((w) => w.w), ['Hello', 'big', 'world.']);
  assert.equal(timing.segments[0].words[0].start, 0);
  assert.equal(timing.segments[0].words[1].start, 0.3); // "Hello " = 6 chars
  assert.equal(timing.segments[1].words[0].start, 0.85); // 17 chars of segment a + space
  assert.ok(Math.abs(timing.duration - 34 * 0.05) < 0.01);
  assert.equal(requests.at(-1).body.text, 'Hello big world. Second line here.');
});

test('generate-voice rescales timestamps by voice.tempo', async () => {
  const script = JSON.parse(await readFile(path.join(dir, 'script.json'), 'utf8'));
  script.voice.tempo = 1.25;
  await writeFile(path.join(dir, 'script.json'), JSON.stringify(script));
  const r = await run('generate-voice.mjs', [], { ELEVENLABS_API_KEY: 'test-key' });
  assert.equal(r.status, 0, r.stderr);
  const timing = JSON.parse(await readFile(path.join(dir, 'public/audio/timing.json'), 'utf8'));
  assert.equal(timing.segments[1].words[0].start, 0.68); // 0.85 / 1.25
  assert.ok(Math.abs(timing.duration - (34 * 0.05) / 1.25) < 0.01);
});

test('generate-voice never prints the API key on errors', async () => {
  const r = await run('generate-voice.mjs', [], { ELEVENLABS_API_KEY: 'wrong-key-123' });
  assert.notEqual(r.status, 0);
  assert.ok(!(r.stdout + r.stderr).includes('wrong-key-123'));
});

test('generate-voice --placeholder needs no key and marks timing as placeholder', async () => {
  const r = await run('generate-voice.mjs', ['--placeholder'], { ELEVENLABS_API_KEY: '' });
  assert.equal(r.status, 0, r.stderr);
  const timing = JSON.parse(await readFile(path.join(dir, 'public/audio/timing.json'), 'utf8'));
  assert.equal(timing.placeholder, true);
});

test('patch-voice replaces one segment and shifts the following ones', async () => {
  // real (mock) voice with three segments
  await writeFile(path.join(dir, 'script.json'), JSON.stringify({
    voice: { voice_id: 'v1', model_id: 'm', language_code: 'en', voice_settings: {} },
    segments: [{ id: 'a', text: 'One two three.' }, { id: 'b', text: 'Short.' }, { id: 'c', text: 'Last segment words.' }],
  }));
  assert.equal((await run('generate-voice.mjs', [], { ELEVENLABS_API_KEY: 'test-key' })).status, 0);
  const before = JSON.parse(await readFile(path.join(dir, 'public/audio/timing.json'), 'utf8'));
  const script = JSON.parse(await readFile(path.join(dir, 'script.json'), 'utf8'));
  script.segments[1].text = 'A much longer replacement line.';
  await writeFile(path.join(dir, 'script.json'), JSON.stringify(script));
  const r = await run('patch-voice.mjs', ['b'], { ELEVENLABS_API_KEY: 'test-key' });
  assert.equal(r.status, 0, r.stderr + r.stdout);
  const after = JSON.parse(await readFile(path.join(dir, 'public/audio/timing.json'), 'utf8'));
  assert.equal(after.segments[1].text, 'A much longer replacement line.');
  assert.ok(after.segments[1].words.length === 5);
  assert.ok(after.segments[2].start > before.segments[2].start + 0.5, 'later segments shift later');
  assert.ok(after.duration > before.duration);
  // the neighbours were sent as context
  assert.equal(requests.at(-1).body.previous_text, 'One two three.');
  assert.equal(requests.at(-1).body.next_text, 'Last segment words.');
});

/** A new project exactly as Luma Studio creates it: the scaffold only (no scenes, no script, no audio). */
async function newProject() {
  const p = await mkdtemp(path.join(tmpdir(), 'luma-new-'));
  await cp(path.join(template, 'scaffold'), p, { recursive: true });
  return p;
}
const node = (script, p, args = []) => spawnSync('node', [path.join(template, 'scripts', script), '--root', p, ...args], { encoding: 'utf8' });

test('a new project is empty: no scenes, script, audio or engine copies', async () => {
  const p = await newProject();
  try {
    const files = (await readdir(p, { recursive: true })).map((f) => f.split(path.sep).join('/')).sort();
    assert.deepEqual(files.filter((f) => !f.endsWith('/') && !['public', 'public/css'].includes(f)), ['brand.json', 'gitignore', 'package.json', 'project.json', 'public/css/scenes.css']);
  } finally {
    await rm(p, { recursive: true, force: true });
  }
});

test('check and preview-frames explain an empty project instead of crashing', async () => {
  const p = await newProject();
  try {
    const chk = node('check.mjs', p, ['--json']);
    assert.equal(chk.status, 1);
    const report = JSON.parse(chk.stdout);
    assert.ok(report.errors.some((e) => e.startsWith('no scenes yet')), chk.stdout);
    assert.ok(report.errors.some((e) => e.includes('script.json does not exist yet')), chk.stdout);
    const pf = node('preview-frames.mjs', p, ['--times', '1']);
    assert.equal(pf.status, 3);
    assert.match(pf.stderr, /no scenes yet/);
    assert.doesNotMatch(pf.stderr, /at .*\.mjs:\d+/); // no stack trace
  } finally {
    await rm(p, { recursive: true, force: true });
  }
});

test('the engine overlay serves engine files to a project but never its scenes or audio', async () => {
  const { candidates } = await import('../server.mjs');
  const p = await newProject();
  try {
    const first = (u) => candidates(u, p).find((f) => existsSync(f));
    assert.equal(first('/js/main.js'), path.join(template, 'public/js/main.js'));
    assert.equal(first('/'), path.join(template, 'public/index.html'));
    assert.equal(first('/assets/fonts/inter-latin-400-normal.woff2'), path.join(template, 'assets/fonts/inter-latin-400-normal.woff2'));
    assert.equal(first('/css/scenes.css'), path.join(p, 'public/css/scenes.css'));
    assert.equal(first('/js/scenes/index.js'), undefined);
    assert.equal(first('/audio/timing.json'), undefined);
    // a project's own copy wins (legacy projects carry the whole engine)
    await mkdir(path.join(p, 'public/js'), { recursive: true });
    await writeFile(path.join(p, 'public/js/main.js'), '// mine');
    assert.equal(first('/js/main.js'), path.join(p, 'public/js/main.js'));
  } finally {
    await rm(p, { recursive: true, force: true });
  }
});

test('check passes on the starter example and flags a bad word reference', async () => {
  const p = await newProject();
  try {
    const ex = node('use-example.mjs', p, ['starter']);
    assert.equal(ex.status, 0, ex.stderr);
    const gen = node('generate-voice.mjs', p, ['--placeholder']);
    assert.equal(gen.status, 0, gen.stderr);
    const ok = node('check.mjs', p, ['--json']);
    assert.equal(ok.status, 0, ok.stdout);
    const scene = path.join(p, 'public/js/scenes/00-title.js');
    await writeFile(scene, (await readFile(scene, 'utf8')) + "\nconst bad = w('title', 99);\nsetTimeout(() => {}, 1);\n");
    const bad = node('check.mjs', p, ['--json']);
    assert.equal(bad.status, 1);
    const report = JSON.parse(bad.stdout);
    assert.ok(report.errors.some((e) => e.includes("w('title', 99)")), bad.stdout);
    assert.ok(report.errors.some((e) => e.includes('setTimeout')), bad.stdout);
  } finally {
    await rm(p, { recursive: true, force: true });
  }
});
