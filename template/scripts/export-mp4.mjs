// Renders the project frame-by-frame in Chrome and encodes an MP4 with the voiceover + sound effects.
// Starts its own static server unless --url is given. Needs ffmpeg and a Chrome/Chromium (CHROME_PATH).
//
// Usage: node scripts/export-mp4.mjs [out.mp4] [options]
//   --fps N          frames per second (default: project.json fps, else 60)
//   --quality Q      final (crf 16, slow — default) | draft (crf 23, veryfast)
//   --scale S        render size multiplier, e.g. 0.5 for 960×540 (default 1)
//   --from A --to B  render only frames [A, B) as a video-only chunk (parallel rendering; mux later)
//   --video-only     skip audio even for a full render
//   --url U          render an already running server instead of starting one
//   --root DIR       project folder (default: the folder above scripts/)
// Output lines "[luma] frame i/total" are machine-readable progress.

import { spawn } from 'node:child_process';
import { writeFile, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs, projectRoot, readJson } from './lib/common.mjs';
import { openProject, loadVideo } from './lib/browser.mjs';

const { opts, pos } = parseArgs();
const root = projectRoot(opts);
const project = await readJson(path.join(root, 'project.json'));
const fps = Number(opts.fps) || project.fps || 60;
const scale = Number(opts.scale) || 1;
const quality = opts.quality ?? 'final';
const out = path.resolve(process.cwd(), pos.find((a) => a.endsWith('.mp4')) ?? path.join(root, `export/${path.basename(root)}-${quality}.mp4`));

await mkdir(path.dirname(out), { recursive: true });
const { browser, url, close } = await openProject(root, { url: opts.url });

let exitCode = 0;
try {
  const { page, error, logs } = await loadVideo(browser, url);
  if (error) throw new Error(`The video failed to build:\n${error}\n${logs.join('\n')}`);

  const { W, H } = await page.evaluate(() => window.ad.size);
  await page.setViewport({ width: Math.round(W * scale), height: Math.round(H * scale), deviceScaleFactor: 1 });
  const duration = await page.evaluate(() => window.ad.duration);
  const total = Math.round(duration * fps);
  const from = Math.max(0, Number(opts.from) || 0);
  const to = Math.min(total, opts.to != null ? Number(opts.to) : total);
  const chunk = from !== 0 || to !== total;
  const withAudio = !chunk && !opts['video-only'];
  console.log(`[luma] ${W * scale}x${H * scale} ${fps}fps ${duration.toFixed(2)}s frames ${from}-${to} of ${total}${withAudio ? ' +audio' : ''}`);

  const enc = quality === 'draft' ? ['-preset', 'veryfast', '-crf', '23'] : ['-preset', 'slow', '-crf', '16'];
  const args = ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(fps), '-i', '-'];
  let sfxWav;
  if (withAudio) {
    // sound effects, rendered offline in the page
    sfxWav = path.join(path.dirname(out), '.sfx.wav');
    await writeFile(sfxWav, Buffer.from(await page.evaluate(() => window.ad.sfxWavBase64()), 'base64'));
    args.push(
      '-i', path.join(root, 'public/audio/voiceover.mp3'), '-i', sfxWav,
      '-filter_complex', '[1:a]volume=1.0[vo];[2:a]volume=0.9[fx];[vo][fx]amix=inputs=2:duration=longest:normalize=0,apad[a]',
      '-map', '0:v', '-map', '[a]', '-shortest', '-c:a', 'aac', '-b:a', '256k',
    );
  } else args.push('-an');
  args.push('-c:v', 'libx264', ...enc, '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-movflags', '+faststart', out);
  const ff = spawn('ffmpeg', args, { stdio: ['pipe', 'inherit', 'inherit'] });
  const ffDone = new Promise((r, j) => ff.on('close', (c) => (c === 0 ? r() : j(new Error('ffmpeg exited ' + c)))));
  ff.stdin.on('error', () => { /* surfaced by ffDone */ });

  const t0 = Date.now();
  for (let i = from; i < to; i++) {
    // two animation frames after a seek: the first screenshot can otherwise be stale (pitfall #12)
    await page.evaluate((t) => new Promise((r) => { window.ad.seek(t); requestAnimationFrame(() => requestAnimationFrame(r)); }), i / fps);
    const png = await page.screenshot({ type: 'png', optimizeForSpeed: true });
    if (!ff.stdin.write(png)) await new Promise((r) => ff.stdin.once('drain', r));
    if ((i - from) % Math.max(1, Math.round(fps / 2)) === 0) console.log(`[luma] frame ${i - from}/${to - from} ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  }
  ff.stdin.end();
  await ffDone;
  if (sfxWav) await rm(sfxWav, { force: true });
  console.log(`[luma] frame ${to - from}/${to - from}`);
  console.log(`[luma] done ${out}`);
} catch (e) {
  console.error(e.message ?? e);
  exitCode = 1;
} finally {
  await close();
}
process.exit(exitCode);
