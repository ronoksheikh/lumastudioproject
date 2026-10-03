// Renders the whole video to an MP4: splits the frames into parallel chunks (one Chromium each, via
// export-mp4.mjs --from/--to), joins them, mixes voiceover + sound effects, checks the result with
// ffprobe and writes a 4-frame contact sheet. Luma Studio runs this to serve render_video.
//
// Usage: node scripts/render.mjs --out export/x.mp4 [--preset draft|final] [--workers 3] [--sheet export/x.jpg]
//   → progress lines "[luma] frame i/total", and a last JSON line {"render":{…}}
// Presets: draft = 30 fps, fast encode; final = project fps (60), crf 16 slow. Both at the project's full size.

import { spawn } from 'node:child_process';
import { mkdir, rm, writeFile, stat, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, projectRoot, readJson } from './lib/common.mjs';
import { openProject, loadVideo } from './lib/browser.mjs';

const { opts } = parseArgs();
const root = projectRoot(opts);
const preset = opts.preset === 'draft' ? 'draft' : 'final';
const project = await readJson(path.join(root, 'project.json'));
const fps = preset === 'draft' ? 30 : Number(opts.fps) || project.fps || 60;
const workers = Math.max(1, Math.min(8, Math.floor(Number(opts.workers) || 1)));
const out = path.resolve(process.cwd(), opts.out ?? path.join(root, `export/${Date.now()}-${preset}.mp4`));
const sheet = opts.sheet ? path.resolve(process.cwd(), opts.sheet) : out.replace(/\.mp4$/, '') + '.jpg';
const work = path.join(path.dirname(out), `.work-${path.basename(out, '.mp4')}`);
const here = path.dirname(fileURLToPath(import.meta.url));

const run = (cmd, args, { onLine, capture } = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let buf = '';
    let all = '';
    const feed = (d) => {
      const text = d.toString('utf8');
      all += text;
      if (all.length > 20000) all = all.slice(-20000);
      if (!onLine) return;
      buf += text;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        onLine(buf.slice(0, i));
        buf = buf.slice(i + 1);
      }
    };
    child.stdout.on('data', feed);
    child.stderr.on('data', feed);
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve(capture ? all : undefined) : reject(new Error(`${cmd} exited ${code}\n${all.slice(-1500)}`))));
  });

await mkdir(work, { recursive: true });
let exitCode = 0;
try {
  // 1. what are we rendering? (duration, size, sound effects) — one short browser session
  const { browser, url, close } = await openProject(root);
  let duration;
  let W;
  let H;
  try {
    const { page, error, logs } = await loadVideo(browser, url);
    if (error) throw new Error(`The video failed to build:\n${error}\n${logs.join('\n')}`);
    ({ W, H } = await page.evaluate(() => window.ad.size));
    duration = await page.evaluate(() => window.ad.duration);
    await writeFile(path.join(work, 'sfx.wav'), Buffer.from(await page.evaluate(() => window.ad.sfxWavBase64()), 'base64'));
  } finally {
    await close();
  }
  const total = Math.round(duration * fps);
  // a voiceover is optional: videos without a voice get only their sound design / music
  const voicePath = path.join(root, 'public/audio/voiceover.mp3');
  const voice = await access(voicePath).then(() => voicePath, () => null);
  console.log(`[luma] ${W}x${H} ${fps}fps ${duration.toFixed(2)}s ${total} frames, ${workers} worker(s), preset ${preset}`);

  // 2. render chunks in parallel
  const per = Math.ceil(total / workers);
  const ranges = [];
  for (let a = 0; a < total; a += per) ranges.push([a, Math.min(total, a + per)]);
  const done = ranges.map(() => 0);
  const t0 = Date.now();
  let lastPrinted = -1;
  const report = () => {
    const sum = done.reduce((x, y) => x + y, 0);
    if (sum === lastPrinted) return;
    lastPrinted = sum;
    const el = (Date.now() - t0) / 1000;
    console.log(`[luma] frame ${sum}/${total} ${el.toFixed(0)}s`);
  };
  const ticker = setInterval(report, 1000);
  try {
    await Promise.all(
      ranges.map(([from, to], k) =>
        run(process.execPath, [
          path.join(here, 'export-mp4.mjs'), path.join(work, `chunk-${k}.mp4`),
          '--root', root, '--fps', String(fps), '--quality', preset, '--from', String(from), '--to', String(to), '--video-only',
        ], {
          onLine: (line) => {
            const m = line.match(/^\[luma\] frame (\d+)\/(\d+)/);
            if (m) done[k] = Number(m[1]);
          },
        }).then(() => { done[k] = to - from; }),
      ),
    );
  } finally {
    clearInterval(ticker);
  }
  report();

  // 3. join + mux
  await writeFile(path.join(work, 'list.txt'), ranges.map((_, k) => `file 'chunk-${k}.mp4'`).join('\n'));
  await mkdir(path.dirname(out), { recursive: true });
  await run('ffmpeg', [
    '-y', '-loglevel', 'error',
    '-f', 'concat', '-safe', '0', '-i', path.join(work, 'list.txt'),
    ...(voice ? ['-i', voice] : []), '-i', path.join(work, 'sfx.wav'),
    '-filter_complex', voice
      ? '[1:a]volume=1.0[vo];[2:a]volume=0.9[fx];[vo][fx]amix=inputs=2:duration=longest:normalize=0,apad[a]'
      : '[1:a]volume=0.9,apad[a]',
    '-map', '0:v', '-map', '[a]', '-t', duration.toFixed(3), '-c:v', 'copy', '-c:a', 'aac', '-b:a', '256k', '-movflags', '+faststart', out,
  ]);

  // 4. checks
  const probe = JSON.parse(await run('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', out], { capture: true }));
  const v = probe.streams.find((s) => s.codec_type === 'video');
  const a = probe.streams.find((s) => s.codec_type === 'audio');
  const [fn, fd] = (v?.r_frame_rate ?? '0/1').split('/').map(Number);
  const actualFps = fd ? fn / fd : 0;
  const actualDur = Number(probe.format.duration);
  const volOut = await run('ffmpeg', ['-hide_banner', '-nostats', '-i', out, '-vn', '-af', 'volumedetect', '-f', 'null', '-'], { capture: true });
  const peak = Number((volOut.match(/max_volume:\s*(-?[\d.]+) dB/) ?? [])[1]);
  const checks = [
    { name: 'resolution', ok: v?.width === W && v?.height === H, detail: `${v?.width}x${v?.height} (expected ${W}x${H})` },
    { name: 'fps', ok: Math.abs(actualFps - fps) < 0.01, detail: `${actualFps.toFixed(2)} (expected ${fps})` },
    { name: 'duration', ok: Math.abs(actualDur - duration) < 0.25, detail: `${actualDur.toFixed(2)}s (timeline ${duration.toFixed(2)}s)` },
    { name: 'audio', ok: Boolean(a), detail: a ? `${a.codec_name} ${a.channels}ch` : 'no audio stream' },
    { name: 'peak', ok: !Number.isFinite(peak) || peak < 0, detail: Number.isFinite(peak) ? `${peak} dBFS (must stay below 0)` : 'silent or not measurable' },
  ];

  // 5. contact sheet (2×2)
  const at = [0.12, 0.37, 0.62, 0.87].map((p) => (duration * p).toFixed(2));
  await run('ffmpeg', [
    '-y', '-loglevel', 'error',
    ...at.flatMap((t) => ['-ss', t, '-i', out]),
    '-filter_complex', '[0:v]scale=640:-2[a];[1:v]scale=640:-2[b];[2:v]scale=640:-2[c];[3:v]scale=640:-2[d];[a][b]hstack[t];[c][d]hstack[u];[t][u]vstack',
    '-frames:v', '1', '-q:v', '3', sheet,
  ]);

  const size = (await stat(out)).size;
  console.log(`[luma] frame ${total}/${total} ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  console.log(JSON.stringify({ render: { out, sheet, preset, fps, width: W, height: H, duration, size, frames: total, workers: ranges.length, seconds: Math.round((Date.now() - t0) / 1000), checks, ok: checks.every((c) => c.ok) } }));
} catch (e) {
  console.error(e.message ?? e);
  exitCode = 1;
} finally {
  await rm(work, { recursive: true, force: true });
}
process.exit(exitCode);
