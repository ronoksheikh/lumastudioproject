// End-to-end: a student's whole journey in a real browser against the real server, with a scripted model.
//   pnpm --filter @luma/web e2e [outDir]
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { startStack } from './harness';

const require = createRequire(import.meta.url);
const puppeteer = require(path.resolve(import.meta.dirname, '../../../template/node_modules/puppeteer-core')) as typeof import('puppeteer-core');
type Page = import('puppeteer-core').Page;

// what the scripted model writes into the empty project: a tiny two-scene video built on the engine
const E2E_INDEX = `import { makeContext } from '../lib/timeline.js';
import hook from './00-hook.js';
import cta from './01-cta.js';

const SCENES = [hook, cta];

export async function buildTimeline(args) {
  const ctx = makeContext(args);
  ctx.initWorld({ night: 0, jitter: 0.35, particles: 0.14 });
  for (const scene of SCENES) await scene(ctx);
  return ctx.finish();
}
`;
const E2E_HOOK = `import { q } from '../lib/core.js';
import { maskedWords } from '../lib/recipes/kinetic-type.js';

export default function hook(ctx) {
  const { tl, cue, flash, show, add, wordsOut } = ctx;
  const [start, end] = ctx.range('hook');
  const s = add('<div class="scene s-hook"><div class="h-chip mono">MADE WITH LUMA</div><div class="h-title en">Every video starts with one idea.</div></div>');
  show(s, start, end);
  flash(start, 0.7, 0.4);
  cue(start, 'impact', 1);
  tl.fromTo(q(s, '.h-chip'), { opacity: 0, scale: 0.6 }, { opacity: 1, scale: 1, duration: 0.4 }, start + 0.05);
  maskedWords(ctx, q(s, '.h-title'), 'hook', 0);
  wordsOut(s, end - 0.3);
}
`;
const E2E_CTA = `import { q } from '../lib/core.js';
import { maskedWords } from '../lib/recipes/kinetic-type.js';

export default function cta(ctx) {
  const { show, add, cue } = ctx;
  const [start, end] = ctx.range('cta');
  const s = add('<div class="scene s-cta"><div class="c-line en">Make yours today with Luma.</div></div>');
  show(s, start, end);
  cue(start, 'whoosh', 0.6);
  maskedWords(ctx, q(s, '.c-line'), 'cta', 0);
}
`;
const E2E_CSS = `.s-hook .h-chip { position: absolute; left: 0; right: 0; top: 300px; text-align: center; font-size: 24px; letter-spacing: .2em; }
.s-hook .h-title { position: absolute; left: 160px; right: 160px; top: 400px; text-align: center; font: 800 110px/1.05 var(--font-display); text-wrap: balance; }
.s-cta .c-line { position: absolute; left: 160px; right: 160px; top: 460px; text-align: center; font: 800 96px/1.1 var(--font-display); }
`;

const OUT = path.resolve(process.argv[2] ?? path.join(import.meta.dirname, 'out'));
fs.mkdirSync(OUT, { recursive: true });
let step = 0;
const log = (m: string) => console.log(`\x1b[36m[e2e]\x1b[0m ${m}`);
const fail = (m: string): never => { throw new Error(m); };

async function shot(page: Page, name: string) {
  await page.screenshot({ path: path.join(OUT, `${String(++step).padStart(2, '0')}-${name}.png`) });
}
const text = (page: Page, t: string, timeout = 20_000) =>
  page.waitForFunction((s) => document.body.innerText.includes(s), { timeout }, t).catch(async () => {
    await shot(page, `FAIL-wait-${t.slice(0, 20).replace(/\W+/g, '_')}`);
    fail(`text not found: "${t}"\n--- page text ---\n${(await page.evaluate(() => document.body.innerText)).slice(0, 1500)}`);
  });
const clickText = async (page: Page, selector: string, t: string) => {
  const ok = await page.evaluate((sel, s) => {
    const el = [...document.querySelectorAll<HTMLElement>(sel)].find((e) => e.innerText.trim().includes(s));
    el?.click();
    return !!el;
  }, selector, t);
  if (!ok) { await shot(page, `FAIL-click-${t.replace(/\W+/g, '_')}`); fail(`no ${selector} with text "${t}"`); }
};
const type = async (page: Page, selector: string, value: string) => { await page.waitForSelector(selector, { timeout: 10_000 }); await page.click(selector, { count: 3 }); await page.type(selector, value); };

async function main() {
  const stack = await startStack();
  const browser = await puppeteer.launch({
    executablePath: process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    headless: true,
    args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'],
    defaultViewport: { width: 1440, height: 900 },
  });
  const page = await browser.newPage();
  const consoleErrors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon|Failed to load resource.*(404|403)/.test(m.text())) consoleErrors.push(m.text()); });
  page.on('pageerror', (e: unknown) => consoleErrors.push(`pageerror: ${(e as Error).message}`));

  try {
    // ---------- sign up ----------
    log('sign up');
    await page.goto(`${stack.appUrl}/signup`, { waitUntil: 'networkidle0' });
    await text(page, 'Create your Luma Studio account');
    await shot(page, 'signup');
    await type(page, 'input[type="email"]', 'student@example.com');
    await type(page, 'input[type="password"]', 'correct horse battery');
    await clickText(page, 'button', 'Create account');
    await text(page, 'Make your first motion-graphics video');
    await shot(page, 'projects-empty');

    // ---------- settings: model + voice ----------
    log('add a model');
    await page.goto(`${stack.appUrl}/settings/models`, { waitUntil: 'networkidle0' });
    await clickText(page, 'button', 'Add model');
    await type(page, 'input[placeholder="https://openrouter.ai/api/v1"]', stack.llm.url);
    await type(page, 'input[placeholder="sk-…"]', stack.llm.apiKey);
    await type(page, 'input[placeholder="anthropic/claude-sonnet-4.5"]', 'mock-1');
    await clickText(page, 'button', 'Test connection');
    await text(page, 'Works — answered in');
    await shot(page, 'model-tested');
    await clickText(page, 'button', 'Save model');
    await text(page, 'Tool calling');
    await text(page, 'Default');
    if ((await page.evaluate(() => document.body.innerText)).includes(stack.llm.apiKey)) fail('API key leaked into the page');
    await shot(page, 'models');

    log('add the ElevenLabs key');
    await page.goto(`${stack.appUrl}/settings/voice`, { waitUntil: 'networkidle0' });
    await type(page, 'input[placeholder="Paste your ElevenLabs key"]', 'xi-e2e-key-123456');
    await clickText(page, 'button', 'Save');
    await text(page, 'Saved key:');
    await clickText(page, 'button', 'Test key');
    await text(page, 'Key works');
    await shot(page, 'voice-settings');

    // ---------- create a project ----------
    log('create a project');
    await page.goto(stack.appUrl, { waitUntil: 'networkidle0' });
    await clickText(page, 'button', 'New project');
    await type(page, 'input[placeholder="e.g. Lumademy course ad"]', 'E2E explainer');
    await shot(page, 'new-project');
    await clickText(page, 'button', 'Create project');
    await text(page, 'What should we make?');
    await page.waitForFunction(() => /\/projects\/[a-f0-9]+/.test(location.pathname));
    const projectUrl = page.url();
    await shot(page, 'project-empty');

    // a new project is empty: the preview says so instead of showing a demo or a broken frame
    log('empty project');
    await page.waitForSelector('[data-testid="preview-empty"]', { timeout: 20_000 });
    await text(page, 'Nothing here yet');
    await shot(page, 'preview-empty');

    const previewFrame = async () => {
      for (let i = 0; i < 60; i++) {
        const f = page.frames().find((fr) => /\/p\/[a-f0-9]+\//.test(fr.url()));
        if (f) {
          const ok = await f.evaluate(() => (window as unknown as { ad?: { duration: number } }).ad?.duration ?? 0).catch(() => 0);
          if (ok > 0) return { frame: f, duration: ok };
        }
        await new Promise((r) => setTimeout(r, 500));
      }
      return fail('the preview never became playable');
    };

    // ---------- script the model ----------
    stack.turns.push(
      { reasoning: 'The project is empty. I will plan, write the script, make a placeholder voice and build one scene.', content: 'Great idea — let me plan this.', toolCalls: [
        { name: 'update_plan', args: { items: [{ text: 'Read the engine guide', status: 'doing' }, { text: 'Write the script + voice', status: 'todo' }, { text: 'Build the scenes', status: 'todo' }, { text: 'Check the frames', status: 'todo' }] } },
        { name: 'read_guide', args: { topic: 'engine' } },
        { name: 'bash', args: { command: 'ls -a && echo "warning: demo stderr" 1>&2' } },
      ] },
      { toolCalls: [{ name: 'write_file', args: { path: 'script.json', content: JSON.stringify({ voice: { voice_id: 'v1', model_id: 'eleven_multilingual_v2', language_code: 'en', voice_settings: {} }, segments: [{ id: 'hook', text: 'Every video starts with one idea.' }, { id: 'cta', text: 'Make yours today with Luma.' }] }, null, 2) } }] },
      { toolCalls: [{ name: 'generate_voice', args: { placeholder: true } }] },
      { toolCalls: [
        { name: 'write_file', args: { path: 'public/js/scenes/index.js', content: E2E_INDEX } },
        { name: 'write_file', args: { path: 'public/js/scenes/00-hook.js', content: E2E_HOOK } },
        { name: 'write_file', args: { path: 'public/js/scenes/01-cta.js', content: E2E_CTA } },
        { name: 'write_file', args: { path: 'public/css/scenes.css', content: E2E_CSS } },
      ] },
      { toolCalls: [{ name: 'edit_file', args: { path: 'public/js/scenes/00-hook.js', old_string: 'MADE WITH LUMA', new_string: 'MADE WITH LUMA — E2E' } }] },
      { toolCalls: [{ name: 'bash', args: { command: 'npm run check' } }] },
      { toolCalls: [{ name: 'preview_frames', args: { times: [0.5, 1.8, 3.5], width: 640 } }] },
      { toolCalls: [{ name: 'ask_user', args: { question: 'Shall I render a draft now?', options: ['Yes, draft', 'Not yet'] } }] },
      { content: '## All set\n\nI built the demo:\n\n- **Scene 1** – title with the new chip\n- **Scene 2** – map zoom\n\n> Placeholder voice only – add your ElevenLabs key for the real one.' },
    );

    // ---------- chat ----------
    log('send the first message');
    await page.click('textarea[aria-label="Message to Luma"]');
    await page.type('textarea[aria-label="Message to Luma"]', 'Make a short explainer about our course.');
    await shot(page, 'composer-filled');
    await clickText(page, 'button', 'Send');
    await text(page, 'Make a short explainer about our course.');
    await text(page, 'Great idea — let me plan this.');
    await text(page, 'Luma is working');
    await shot(page, 'run-start');
    await text(page, 'Read the engine guide'); // pinned plan
    await text(page, 'Voiceover');
    await text(page, 'placeholder (silent)');
    await shot(page, 'run-voice');
    await text(page, 'Shall I render a draft now?', 120_000);
    await shot(page, 'run-ask');
    // frames arrived (thumbnails) and the model "saw" them
    await page.waitForSelector('img[alt^="Frame at"]', { timeout: 10_000 });
    const thumbs = await page.$$eval('img[alt^="Frame at"]', (els) => (els as HTMLImageElement[]).map((e) => ({ ok: e.complete && e.naturalWidth > 100, w: e.naturalWidth })));
    if (!thumbs.length || !thumbs.every((t) => t.ok)) fail(`frame thumbnails did not load: ${JSON.stringify(thumbs)}`);

    log('answer the question');
    await clickText(page, 'button', 'Yes, draft');
    await text(page, 'All set', 30_000);
    await text(page, 'Scene 1');
    await text(page, 'Saved a snapshot');
    await page.waitForFunction(() => !document.body.innerText.includes('Luma is working'), { timeout: 20_000 });
    await shot(page, 'run-finished');
    const md = await page.$eval('.md ul', (ul) => ul.querySelectorAll('li').length);
    if (md !== 2) fail(`markdown list not rendered (found ${md} items)`);

    // diff modal for the edited file
    log('diff modal');
    // the edit (the last change to that file), not the file's creation
    await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('button[title="View changes"]')].filter((e) => e.innerText.includes('public/js/scenes/00-hook.js')).at(-1)?.click());
    await text(page, 'MADE WITH LUMA — E2E');
    await shot(page, 'diff');
    await page.keyboard.press('Escape');

    // preview reloaded with the edit applied; still plays
    log('preview after the agent finished');
    const pv2 = await previewFrame();
    if (pv2.duration <= 0) fail('preview broken after edit');
    const chipText = await pv2.frame.evaluate(() => document.querySelector('.h-chip')?.textContent ?? '');
    if (!chipText.includes('E2E')) fail(`preview did not pick up the edit: "${chipText}"`);
    await shot(page, 'preview-after');

    // ---------- tabs ----------
    log('files tab');
    await clickText(page, '[role="tab"]', 'Files');
    await text(page, 'scenes');
    await clickText(page, '[role="treeitem"]', '00-hook.js');
    await page.waitForSelector('[data-testid="code-viewer"] .monaco-editor', { timeout: 20_000 });
    await page.waitForFunction(() => document.querySelector('[data-testid="code-viewer"]')?.textContent?.includes('E2E'), { timeout: 10_000 });
    await shot(page, 'files');

    log('history tab');
    await clickText(page, '[role="tab"]', 'History');
    await text(page, 'Create empty project');
    await clickText(page, 'button', 'Create empty project');
    await text(page, 'Restore this version');
    await shot(page, 'history');

    log('terminal tab');
    await clickText(page, '[role="tab"]', 'Terminal');
    await page.waitForSelector('[data-testid="terminal"] .xterm-rows', { timeout: 10_000 });
    await page.waitForFunction(() => document.querySelector('[data-testid="terminal"] .xterm-rows')?.textContent?.includes('npm run check'), { timeout: 10_000 });
    await shot(page, 'terminal');

    log('renders tab');
    await clickText(page, '[role="tab"]', 'Renders');
    await text(page, 'No renders yet');

    // ---------- a page reload keeps everything ----------
    log('reload: conversation and history persist');
    await page.goto(projectUrl, { waitUntil: 'networkidle0' });
    await text(page, 'Make a short explainer about our course.');
    await text(page, 'All set');
    await text(page, 'Read the engine guide');
    await shot(page, 'reloaded');

    // ---------- stop a long command ----------
    log('stop');
    stack.turns.push({ toolCalls: [{ name: 'bash', args: { command: 'echo started; sleep 120' } }] });
    await page.click('textarea[aria-label="Message to Luma"]');
    await page.type('textarea[aria-label="Message to Luma"]', 'Run something long.');
    await clickText(page, 'button', 'Send');
    await text(page, 'echo started');
    await page.waitForSelector('button[aria-label="Stop the agent"]');
    await shot(page, 'long-command');
    await page.click('button[aria-label="Stop the agent"]');
    await text(page, 'Stopped.');
    await page.waitForSelector('button[aria-label="Send message"]', { timeout: 15_000 });
    await shot(page, 'stopped');

    // ---------- the finished flow is reachable from the project list ----------
    await page.goto(stack.appUrl, { waitUntil: 'networkidle0' });
    await text(page, 'E2E explainer');
    await shot(page, 'projects');

    // ---------- phone width: nothing overflows, the two panes are reachable ----------
    log('mobile layout');
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
    await page.goto(projectUrl, { waitUntil: 'networkidle0' });
    await text(page, 'Make a short explainer about our course.');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    if (overflow > 1) fail(`horizontal overflow on mobile: ${overflow}px`);
    // nothing important may be pushed past the right edge (an overflow-hidden parent would hide it from the check above)
    const clipped = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('header button, header a, [role="tab"], button[aria-label="Send message"], textarea, h1, h2')]
      .filter((e) => e.offsetParent !== null && !e.closest('[hidden]'))
      .map((e) => ({ t: (e.getAttribute('aria-label') ?? e.textContent ?? e.tagName).trim().slice(0, 20), right: Math.round(e.getBoundingClientRect().right) }))
      .filter((r) => r.right > window.innerWidth + 1));
    if (clipped.length) fail(`elements clipped on mobile: ${JSON.stringify(clipped)}`);
    await shot(page, 'mobile-chat');
    await clickText(page, '[role="tab"]', 'Video');
    await page.waitForSelector('iframe[title="Video preview"]');
    await shot(page, 'mobile-video');
    await page.goto(`${stack.appUrl}/settings/models`, { waitUntil: 'networkidle0' });
    const overflow2 = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    if (overflow2 > 1) fail(`horizontal overflow on mobile settings: ${overflow2}px`);
    await shot(page, 'mobile-settings');

    if (consoleErrors.length) fail(`browser console errors:\n${consoleErrors.join('\n')}`);
    log(`\x1b[32mPASS\x1b[0m — screenshots in ${OUT}`);
  } catch (e) {
    await shot(page, 'FAILURE').catch(() => {});
    console.error(e);
    process.exitCode = 1;
  } finally {
    await browser.close();
    await stack.stop();
  }
}
void main();
