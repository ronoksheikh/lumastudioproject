import { test } from 'node:test';
import assert from 'node:assert/strict';
import { determinismViolations, offBrandColors, scoreRun, wordSyncStats } from './score.mjs';

test('flags colours outside the brand palette, ignores comments', () => {
  const off = offBrandColors({ 'a/scene.js': "el.style.color = '#ff00aa'; // #123456\n const ok = '#2970EC'; const short = '#fff';", 'b.css': 'a{color:#abc}' });
  assert.deepEqual(off.map((s) => s.split(' ')[0]), ['#ff00aa', '#abc']);
});

test('finds timers, randomness and CSS animation', () => {
  const bad = determinismViolations({ 'x.js': 'setTimeout(f, 10); const r = Math.random();', 'y.css': '.a{animation: spin 1s}' });
  assert.equal(bad.length, 3);
  assert.deepEqual(determinismViolations({ 'z.js': "tl.to(a, {x: 1}, w('s1', 2)); // setTimeout is banned" }), []);
});

test('counts timings that come from word times', () => {
  const s = wordSyncStats({ 'public/js/scenes/00-a.js': "tl.to(a, {}, w('s1', 0)); tl.to(b, {}, wEnd('s1', 2)); tl.to(c, {}, 3.5);" }, 1);
  assert.equal(s.onWords, 2);
  assert.equal(s.literal, 1);
});

const ev = (type, data, ts = 0) => ({ type, data, ts });
test('scores a clean run and a broken one', () => {
  const good = [
    ev('run.started', {}, 0),
    ev('tool.call', { callId: 'a', name: 'bash', args: { command: 'npm run check' } }),
    ev('tool.result', { callId: 'a', ok: true }),
    ev('voice.ready', { duration: 20, placeholder: false }),
    ev('preview.frames', { frames: [{ t: 1 }, { t: 6 }, { t: 12 }], issues: [] }),
    ev('render.done', { durationS: 22 }),
    ev('run.finished', { usage: { input: 10, output: 5 }, stopReason: 'completed' }, 90_000),
  ];
  const files = { 'public/js/scenes/00-a.js': "tl.to(a, {}, w('s1', 0)); tl.to(b, {}, w('s1', 3));" };
  const r = scoreRun({ events: good, files, targetSeconds: [15, 30], renderRequested: true, segments: 1 });
  assert.equal(r.passed, r.total, JSON.stringify(r.checks.filter((c) => !c.ok)));
  assert.equal(r.stats.seconds, 90);

  const bad = scoreRun({ events: [ev('run.error', { message: 'boom' }), ev('run.finished', { usage: { input: 0, output: 0 }, stopReason: 'error' })], files: {}, targetSeconds: [15, 30], renderRequested: true, segments: 3 });
  const failed = bad.checks.filter((c) => !c.ok).map((c) => c.id);
  for (const id of ['run_completed', 'no_run_errors', 'npm_check_clean', 'previewed_scenes', 'layout_clean', 'voice_generated', 'render_ok', 'duration_in_range', 'beats_on_words']) assert.ok(failed.includes(id), id);
});
