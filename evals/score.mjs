// Automatic part of the eval rubric. Pure functions over a finished run's events and the project's scene
// files, so they can be unit-tested without a model. The judgement calls (hook impact, taste) are scored
// by hand with rubric.md.

export const BRAND_HEX = ['#5DAEFF', '#2970EC', '#1557D1', '#07358F', '#10234B', '#071738', '#101E46', '#030A1D', '#EFF5FF', '#BFE2FF', '#FFFFFF', '#FFF', '#000', '#000000'].map((c) => c.toLowerCase());

const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

/** Hex colours used in the scene sources that are not in the brand palette. */
export function offBrandColors(files) {
  const found = new Set();
  for (const [file, src] of Object.entries(files)) {
    for (const m of strip(src).matchAll(/#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})\b/g)) {
      const hex = m[0].toLowerCase();
      if (!BRAND_HEX.includes(hex)) found.add(`${hex} (${file.split('/').pop()})`);
    }
  }
  return [...found];
}

/** Non-deterministic or forbidden constructs in scene code. */
export function determinismViolations(files) {
  const bad = [];
  const rules = [
    [/\bsetTimeout\s*\(|\bsetInterval\s*\(/, 'setTimeout/setInterval'],
    [/\bMath\.random\s*\(/, 'Math.random()'],
    [/\bDate\.now\s*\(|\bperformance\.now\s*\(/, 'wall-clock time'],
    [/@keyframes|\banimation\s*:/, 'CSS animation'],
  ];
  for (const [file, src] of Object.entries(files)) {
    const code = strip(src);
    for (const [re, what] of rules) if (re.test(code)) bad.push(`${what} in ${file.split('/').pop()}`);
  }
  return bad;
}

/** How many scene timings are tied to spoken words (w('seg', i) / wEnd / range) versus numbers. */
export function wordSyncStats(files, segmentCount) {
  let onWords = 0;
  let literal = 0;
  for (const [file, src] of Object.entries(files)) {
    if (!/scenes\/\d/.test(file)) continue;
    const code = strip(src);
    onWords += (code.match(/\b(?:w|wEnd|range)\(\s*['"`]/g) ?? []).length;
    // a tween whose position argument is a bare number: `, 3.2)` at the end of a tl call
    literal += (code.match(/,\s*\d+(?:\.\d+)?\s*\)\s*;/g) ?? []).length;
  }
  return { onWords, literal, perSegment: segmentCount ? onWords / segmentCount : 0 };
}

const lastWhere = (arr, fn) => [...arr].reverse().find(fn);

/**
 * @param {object} input
 * @param {Array<{type:string,data:any}>} input.events  all run events (in order)
 * @param {Record<string,string>} input.files  scene/CSS sources by path
 * @param {[number,number]} input.targetSeconds
 * @param {boolean} input.renderRequested
 * @param {number} input.segments  number of script segments
 * @returns {{ checks: Array<{id:string,ok:boolean,detail:string}>, passed:number, total:number, stats:object }}
 */
export function scoreRun({ events, files, targetSeconds, renderRequested, segments }) {
  const checks = [];
  const add = (id, ok, detail) => checks.push({ id, ok: Boolean(ok), detail });
  const of = (t) => events.filter((e) => e.type === t);

  const fin = lastWhere(events, (e) => e.type === 'run.finished');
  add('run_completed', fin?.data.stopReason === 'completed', `stop reason: ${fin?.data.stopReason ?? 'none (run never finished)'}`);
  add('no_run_errors', of('run.error').length === 0, `${of('run.error').length} run.error event(s)${of('run.error')[0] ? `: ${of('run.error')[0].data.message}` : ''}`);

  const calls = of('tool.call');
  const results = new Map(of('tool.result').map((e) => [e.data.callId, e.data]));
  const failedTools = calls.filter((c) => results.get(c.data.callId)?.ok === false);
  add('tool_failures_low', failedTools.length <= Math.max(3, Math.ceil(calls.length * 0.15)), `${failedTools.length} of ${calls.length} tool calls failed`);

  const checkCalls = calls.filter((c) => c.data.name === 'bash' && /npm run check|scripts\/check/.test(String(c.data.args?.command ?? '')));
  const lastCheck = checkCalls.at(-1);
  add('npm_check_clean', lastCheck && results.get(lastCheck.data.callId)?.ok === true, lastCheck ? `last "npm run check": ${results.get(lastCheck.data.callId)?.ok ? 'passed' : 'failed'}` : 'never ran npm run check');

  // the workflow the prompt asks for: read the engine guide before building, verify after the last edit
  const sceneEdits = calls.filter((c) => ['write_file', 'edit_file'].includes(c.data.name) && /public\/js\/scenes\//.test(String(c.data.args?.path ?? '')));
  const firstGuide = events.indexOf(calls.find((c) => c.data.name === 'read_guide'));
  const firstEdit = events.indexOf(sceneEdits[0]);
  add('guide_before_build', sceneEdits.length > 0 && firstGuide >= 0 && firstGuide < firstEdit, sceneEdits.length ? (firstGuide >= 0 && firstGuide < firstEdit ? 'read the guide before the first scene' : 'wrote scenes without reading the engine guide first') : 'no scene files written');
  const lastEdit = events.lastIndexOf(sceneEdits.at(-1));
  const lastPreview = events.findLastIndex((e) => e.type === 'preview.frames');
  add('verified_after_last_edit', lastEdit >= 0 && lastPreview > lastEdit, lastEdit < 0 ? 'no scene edits' : lastPreview > lastEdit ? 'previewed after the last scene edit' : 'edited scenes after the last preview (unverified changes)');

  const frames = of('preview.frames');
  const previewed = new Set(frames.flatMap((e) => e.data.frames.map((f) => Math.round(f.t))));
  add('previewed_scenes', previewed.size >= Math.max(2, segments), `${previewed.size} distinct moments previewed for ${segments} segment(s)`);
  const lastFrames = frames.at(-1);
  add('layout_clean', lastFrames && lastFrames.data.issues.length === 0, lastFrames ? (lastFrames.data.issues.length ? `last preview still reports: ${lastFrames.data.issues.slice(0, 3).join(' | ')}` : 'last preview reported no problems') : 'no preview_frames call');

  const voice = lastWhere(events, (e) => e.type === 'voice.ready');
  const listed = calls.some((c) => c.data.name === 'list_voices');
  add('voice_chosen', listed || voice?.data.placeholder === true, listed ? 'chose the voice with list_voices' : voice?.data.placeholder ? 'placeholder voice (no key)' : 'generated a voice without checking which voices the account can use');
  add('voice_generated', voice && !voice.data.placeholder, voice ? (voice.data.placeholder ? 'placeholder voice only' : `${voice.data.duration.toFixed(1)}s of voice`) : 'no voice generated');

  const done = lastWhere(events, (e) => e.type === 'render.done');
  if (renderRequested) add('render_ok', Boolean(done), done ? 'render finished' : 'no render.done event');
  const dur = done?.data.durationS ?? (voice ? voice.data.duration + 2.4 : null);
  add('duration_in_range', dur != null && dur >= targetSeconds[0] && dur <= targetSeconds[1], dur != null ? `${dur.toFixed(1)}s (target ${targetSeconds[0]}–${targetSeconds[1]}s)` : 'unknown duration');

  const off = offBrandColors(files);
  add('brand_colors_only', off.length === 0, off.length ? `off-palette colours: ${off.slice(0, 6).join(', ')}` : 'only palette colours');
  const nd = determinismViolations(files);
  add('deterministic', nd.length === 0, nd.length ? nd.slice(0, 4).join('; ') : 'no timers, randomness or CSS animations');
  const sync = wordSyncStats(files, segments);
  add('beats_on_words', sync.perSegment >= 2, `${sync.onWords} timings read from word times (${sync.perSegment.toFixed(1)} per segment), ${sync.literal} hard-coded`);

  const usage = fin?.data.usage ?? { input: 0, output: 0 };
  const stats = {
    toolCalls: calls.length,
    failedTools: failedTools.length,
    tokens: usage,
    seconds: fin && events[0] ? Math.round(((events.at(-1).ts ?? 0) - (events[0].ts ?? 0)) / 1000) : null,
    renderSeconds: dur,
  };
  return { checks, passed: checks.filter((c) => c.ok).length, total: checks.length, stats };
}
