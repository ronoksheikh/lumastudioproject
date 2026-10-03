// Launch headless Chrome against a project (starting the static server if no URL is given).
import { access } from 'node:fs/promises';
import { importPkg, emptyProjectReason } from './common.mjs';
import { createServer } from '../../server.mjs';

export async function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    '/usr/local/bin/chromium',
    '/opt/pw-browsers/chromium',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/chromium',
    '/usr/bin/google-chrome',
  ].filter(Boolean);
  for (const c of candidates) {
    try {
      await access(c);
      return c;
    } catch { /* next */ }
  }
  throw new Error('No Chrome/Chromium found — set CHROME_PATH');
}

/** → { browser, url, close() }. Without `url`, serves `root` on a random local port. */
export async function openProject(root, { url, query = '?pr=1', width = 1920, height = 1080 } = {}) {
  // an empty project has nothing to play: say so plainly instead of timing out in Chrome
  const empty = url ? null : emptyProjectReason(root);
  if (empty) throw Object.assign(new Error(empty), { code: 'EMPTY_PROJECT' });
  const puppeteer = await importPkg('puppeteer-core', root).then((m) => m.default ?? m);
  let server;
  if (!url) {
    server = createServer(root);
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    url = `http://127.0.0.1:${server.address().port}/${query}`;
  }
  const gpuArgs = process.platform === 'darwin'
    ? ['--use-angle=metal', '--enable-gpu-rasterization', '--ignore-gpu-blocklist']
    : process.env.LUMA_GPU ? ['--ignore-gpu-blocklist'] : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
  const browser = await puppeteer.launch({
    executablePath: await findChrome(),
    headless: 'new',
    args: [...gpuArgs, '--hide-scrollbars', '--autoplay-policy=no-user-gesture-required', '--no-sandbox', '--disable-dev-shm-usage'],
    defaultViewport: { width, height, deviceScaleFactor: 1 },
  });
  return {
    browser,
    url,
    async close() {
      await browser.close();
      server?.close();
    },
  };
}

/** Opens a page, waits for the video to build (or fail) and returns { page, error }. */
export async function loadVideo(browser, url, { timeout = 120000 } = {}) {
  const page = await browser.newPage();
  const logs = [];
  page.on('pageerror', (e) => logs.push(`page error: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') logs.push(`console: ${m.text()}`); });
  page.on('requestfailed', (r) => logs.push(`request failed: ${r.url()} ${r.method()} ${r.failure()?.errorText}`));
  await page.goto(url, { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => window.ad?.duration > 0 || window.adError || window.adEmpty, { timeout });
  const error = await page.evaluate(() => window.adError);
  await page.addStyleTag({ content: '#start,#hud{display:none!important}' });
  return { page, error, logs };
}
