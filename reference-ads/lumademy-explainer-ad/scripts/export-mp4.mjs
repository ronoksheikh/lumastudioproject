// Renders the ad frame-by-frame in Chrome and encodes a 1080p60 MP4 with the
// voiceover + sound effects. Needs the server running (`npm start`) and ffmpeg.
//
// Usage: node scripts/export-mp4.mjs [out.mp4] [--fps 60]

import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import { writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const fps = Number(args[args.indexOf('--fps') + 1]) || 60;
const out = path.resolve(root, args.find((a) => a.endsWith('.mp4')) ?? 'export/lumademy-explainer-ad-1080p60.mp4');
const url = process.env.AD_URL ?? 'http://localhost:5175/?pr=1';
const CHROME = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

await mkdir(path.dirname(out), { recursive: true });
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--use-angle=metal', '--enable-gpu-rasterization', '--ignore-gpu-blocklist', '--hide-scrollbars', '--autoplay-policy=no-user-gesture-required'],
  defaultViewport: { width: 1920, height: 1080, deviceScaleFactor: 1 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.error('page error:', e.message));
await page.goto(url, { waitUntil: 'networkidle0' });
await page.waitForFunction(() => window.ad?.duration > 0, { timeout: 60000 });
await page.addStyleTag({ content: '#start,#hud{display:none!important}' });

const duration = await page.evaluate(() => window.ad.duration);
console.log(`Rendering ${duration.toFixed(2)}s at ${fps}fps…`);

// sound effects, rendered offline in the page
const sfxWav = path.join(root, 'export/.sfx.wav');
await writeFile(sfxWav, Buffer.from(await page.evaluate(() => window.ad.sfxWavBase64()), 'base64'));

const ff = spawn('ffmpeg', [
  '-y', '-loglevel', 'error',
  '-f', 'image2pipe', '-framerate', String(fps), '-i', '-',
  '-i', path.join(root, 'public/audio/voiceover.mp3'),
  '-i', sfxWav,
  '-filter_complex', '[1:a]volume=1.0[vo];[2:a]volume=0.9[fx];[vo][fx]amix=inputs=2:duration=longest:normalize=0,apad[a]',
  '-map', '0:v', '-map', '[a]', '-shortest',
  '-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-movflags', '+faststart',
  '-c:a', 'aac', '-b:a', '256k',
  out,
], { stdio: ['pipe', 'inherit', 'inherit'] });

const total = Math.round(duration * fps);
const t0 = Date.now();
for (let i = 0; i < total; i++) {
  await page.evaluate((t) => new Promise((r) => { window.ad.seek(t); requestAnimationFrame(() => requestAnimationFrame(r)); }), i / fps);
  const png = await page.screenshot({ type: 'png', optimizeForSpeed: true });
  if (!ff.stdin.write(png)) await new Promise((r) => ff.stdin.once('drain', r));
  if (i % fps === 0) process.stdout.write(`\r  ${i}/${total} frames  (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
}
ff.stdin.end();
await new Promise((r, j) => ff.on('close', (c) => (c === 0 ? r() : j(new Error('ffmpeg exited ' + c)))));
await browser.close();
console.log(`\nDone → ${out}`);
