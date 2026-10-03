// The layout probe against a hand-made page (needs Chromium + puppeteer-core; skipped without them).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { importPkg } from '../scripts/lib/common.mjs';
import { findChrome } from '../scripts/lib/browser.mjs';
import { probeLayout } from '../scripts/lib/layout-probe.mjs';

let browser;
let page;
let skip = false;

const HTML = `<!doctype html><body style="margin:0"><div id="stage" style="position:absolute;left:0;top:0;width:1920px;height:1080px;transform:scale(0.5);transform-origin:0 0;font:64px sans-serif;overflow:visible">
  <div id="scenes">
    <div id="ok" style="position:absolute;left:100px;top:100px">Hello world</div>
    <div id="a" style="position:absolute;left:100px;top:400px">Overlapping headline</div>
    <div id="b" style="position:absolute;left:140px;top:410px">Second headline</div>
    <div id="off" style="position:absolute;left:1700px;top:700px;white-space:nowrap">Runs off the stage</div>
    <div id="tiny" style="position:absolute;left:100px;top:900px;font-size:14px">Tiny caption text</div>
    <div id="line" style="position:absolute;left:100px;top:600px"><span class="w" style="display:inline-block;overflow:hidden"><span class="wi" style="display:inline-block">Shown</span></span> <span class="w" style="display:inline-block;overflow:hidden"><span class="wi" id="late" style="display:inline-block;opacity:0">Missing</span></span></div>
    <div id="masked" style="position:absolute;left:900px;top:100px;overflow:hidden;height:80px"><div style="transform:translateY(200px)">Masked away</div></div>
    <div id="fade" style="position:absolute;left:900px;top:300px;opacity:0">Invisible text</div>
  </div></div>`;

before(async () => {
  try {
    const puppeteer = await importPkg('puppeteer-core', process.cwd()).then((m) => m.default ?? m);
    browser = await puppeteer.launch({ executablePath: await findChrome(), headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'], defaultViewport: { width: 960, height: 540 } });
    page = await browser.newPage();
    await page.setContent(HTML);
    await page.evaluate(() => {
      window.ad = { size: { W: 1920, H: 1080 }, segments: [{ id: 's', start: 0, end: 5, words: [{ w: 'Shown', start: 0.2, end: 0.5 }, { w: 'Missing', start: 0.6, end: 1 }] }] };
    });
  } catch (e) {
    skip = `no browser available: ${e.message}`;
  }
});
after(() => browser?.close());

test('flags overlaps, off-stage text, tiny text and stuck hidden words', async (t) => {
  if (skip) return t.skip(skip);
  const issues = await page.evaluate(probeLayout, { t: 2 });
  const text = issues.join('\n');
  assert.match(text, /"Overlapping headline" overlaps "Second headline"|"Second headline" overlaps "Overlapping headline"/);
  assert.match(text, /"Runs off the stage" runs off the edge/);
  assert.match(text, /"Tiny caption text" is only 14px/);
  assert.match(text, /word "Missing" was spoken/);
  assert.ok(issues.every((i) => i.startsWith('t=2.00s: ')));
});

test('stays quiet about good text, masked-away text and faded-out text', async (t) => {
  if (skip) return t.skip(skip);
  const text = (await page.evaluate(probeLayout, { t: 2 })).join('\n');
  assert.doesNotMatch(text, /Hello world/);
  assert.doesNotMatch(text, /Masked away/);
  assert.doesNotMatch(text, /Invisible text/);
  assert.doesNotMatch(text, /"Shown"/);
});

test('reports a frame with no readable text', async (t) => {
  if (skip) return t.skip(skip);
  await page.evaluate(() => { document.getElementById('scenes').style.visibility = 'hidden'; });
  const issues = await page.evaluate(probeLayout, { t: 2 });
  assert.match(issues.join('\n'), /no readable text is visible/);
  await page.evaluate(() => { document.getElementById('scenes').style.visibility = ''; });
});
