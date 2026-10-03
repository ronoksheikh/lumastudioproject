// Renders the project at the given timeline seconds and saves PNGs; prints one JSON line with the result.
//
// Usage: node scripts/preview-frames.mjs --times 1.5,6,12 [--width 960] [--out <dir>] [--root <project>] [--no-checks] [--describe]
// --describe adds per-frame facts (segment, word being spoken, scenes on screen, readable text): frames[].facts
// Each frame is also probed for layout problems (see lib/layout-probe.mjs); they come back in "issues".
//   → {"frames":[{"t":1.5,"file":"/abs/t1.50.png"}],"issues":["…"],"duration":14.56,"size":{"W":1920,"H":1080}}

import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs, projectRoot } from './lib/common.mjs';
import { openProject, loadVideo } from './lib/browser.mjs';
import { probeLayout, describeFrame } from './lib/layout-probe.mjs';

const { opts } = parseArgs();
const root = projectRoot(opts);
const times = String(opts.times ?? '').split(',').map(Number).filter((n) => Number.isFinite(n) && n >= 0).slice(0, 8);
if (!times.length) {
  console.error('Usage: node scripts/preview-frames.mjs --times 1.5,6,12 [--width 960]');
  process.exit(2);
}
const outDir = path.resolve(opts.out ?? path.join(root, '.luma/frames'));
await mkdir(outDir, { recursive: true });

let opened;
try {
  opened = await openProject(root, { url: opts.url });
} catch (e) {
  if (e.code !== 'EMPTY_PROJECT') throw e;
  console.error(e.message);
  process.exit(3);
}
const { browser, url, close } = opened;
const result = { frames: [], issues: [], duration: 0, size: null };
try {
  const { page, error, logs } = await loadVideo(browser, url);
  if (error) {
    result.issues.push(`The video failed to build: ${error.split('\n').slice(0, 6).join(' | ')}`);
  } else {
    result.issues.push(...logs.map((l) => `browser: ${l}`));
    const { W, H } = await page.evaluate(() => window.ad.size);
    result.size = { W, H };
    result.duration = await page.evaluate(() => window.ad.duration);
    const scale = Math.min(1, (Number(opts.width) || 960) / W);
    await page.setViewport({ width: Math.round(W * scale), height: Math.round(H * scale), deviceScaleFactor: 1 });
    for (const t of times) {
      const tt = Math.min(t, result.duration);
      // seek twice: the first screenshot after a seek can be stale
      for (let k = 0; k < 2; k++) await page.evaluate((x) => new Promise((r) => { window.ad.seek(x); requestAnimationFrame(() => requestAnimationFrame(r)); }), tt);
      const file = path.join(outDir, `t${tt.toFixed(2)}.png`);
      await page.screenshot({ path: file, type: 'png' });
      if (!opts['no-checks']) result.issues.push(...(await page.evaluate(probeLayout, { t: tt })));
      const facts = opts.describe ? await page.evaluate(describeFrame, { t: tt }) : undefined;
      result.frames.push({ t: tt, file, ...(facts ? { facts } : {}) });
    }
  }
} finally {
  await close();
}
console.log(JSON.stringify(result));
