// Re-records ONE segment of the voiceover and splices it into the existing
// audio, leaving every other word untouched. Later segments' timings shift by
// the length difference, so the visuals stay in sync.
//
// Usage: edit the segment's text in script.json, then
//   node scripts/patch-voice.mjs <segmentId> [--root <project>]

import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { execFileSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseArgs, projectRoot, loadEnv, applyKeyFromStdin, readJson, round3, ttsWithTimestamps } from './lib/common.mjs';

const { opts, pos } = parseArgs();
const id = pos[0];
if (!id) {
  console.error('Usage: node scripts/patch-voice.mjs <segmentId> [--root <project>]');
  process.exit(1);
}
const root = projectRoot(opts);
await loadEnv(root, opts);
await applyKeyFromStdin(opts);
const apiKey = process.env.ELEVENLABS_API_KEY;
if (!apiKey) throw new Error('Missing ELEVENLABS_API_KEY');

const script = await readJson(path.join(root, 'script.json'));
const timingPath = path.join(root, 'public/audio/timing.json');
const audioPath = path.join(root, 'public/audio/voiceover.mp3');
const timing = await readJson(timingPath);

const si = script.segments.findIndex((s) => s.id === id);
const ti = timing.segments.findIndex((s) => s.id === id);
if (si < 0 || ti < 0) throw new Error(`Segment "${id}" not found in script.json and timing.json`);
const seg = script.segments[si];
const old = timing.segments[ti];
const prev = timing.segments[ti - 1];
const next = timing.segments[ti + 1];
if (!next) throw new Error('Patching the last segment is not supported — regenerate the whole voice (generate_voice)');

// --- 1. generate the new line, with the neighbours as context for natural prosody
const { voice } = script;
const data = await ttsWithTimestamps(apiKey, voice, {
  text: seg.text,
  previous_text: script.segments.slice(Math.max(0, si - 2), si).map((s) => s.text).join(' ') || undefined,
  next_text: script.segments.slice(si + 1, si + 3).map((s) => s.text).join(' ') || undefined,
}).catch((e) => {
  console.error(e.message);
  process.exit(1);
});
const al = data.alignment;

const tmp = await mkdtemp(path.join(tmpdir(), 'voicepatch-'));
const clipPath = path.join(tmp, 'clip.mp3');
// match the main track's extra tempo (see generate-voice.mjs)
const tempo = voice.tempo ?? 1;
if (tempo !== 1) {
  const raw = path.join(tmp, 'raw.mp3');
  await writeFile(raw, Buffer.from(data.audio_base64, 'base64'));
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', raw, '-filter:a', `atempo=${tempo}`, '-c:a', 'libmp3lame', '-b:a', '128k', clipPath]);
  al.character_start_times_seconds = al.character_start_times_seconds.map((t) => t / tempo);
  al.character_end_times_seconds = al.character_end_times_seconds.map((t) => t / tempo);
} else {
  await writeFile(clipPath, Buffer.from(data.audio_base64, 'base64'));
}

// --- 2. find cut points inside real silences around the old segment
function quiet(file, from, to) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-i', file, '-af', `atrim=${Math.max(0, from)}:${to},silencedetect=n=-40dB:d=0.03`, '-f', 'null', '-'], { encoding: 'utf8' });
  const log = r.stderr;
  const starts = [...log.matchAll(/silence_start: ([\d.]+)/g)].map((m) => +m[1]);
  const ends = [...log.matchAll(/silence_end: ([\d.]+)/g)].map((m) => +m[1]);
  return starts.map((s, i) => [s, ends[i] ?? to]);
}
const pickGap = (gaps, lo, hi, fallback) => {
  const g = gaps.filter(([a, b]) => b > lo && a < hi).sort((x, y) => y[1] - y[0] - (x[1] - x[0]))[0];
  return g ? (Math.max(g[0], lo) + Math.min(g[1], hi)) / 2 : fallback;
};
const cs = prev ? pickGap(quiet(audioPath, prev.end - 0.3, old.start + 0.1), prev.end - 0.15, old.start + 0.02, (prev.end + old.start) / 2) : 0;
const ce = pickGap(quiet(audioPath, old.end - 0.2, next.start + 0.1), old.end - 0.45, next.start - 0.01, (old.end + next.start) / 2);

// --- 3. trim the new clip to its speech and splice
const starts = al.character_start_times_seconds;
const ends = al.character_end_times_seconds;
const a0 = cs === 0 ? 0 : Math.max(0, starts[al.characters.findIndex((c) => !/\s/.test(c))] - 0.04);
const a1 = ends.at(-1) + 0.08;
const outPath = path.join(tmp, 'out.mp3');
execFileSync('ffmpeg', [
  '-y', '-loglevel', 'error', '-i', audioPath, '-i', clipPath, '-filter_complex',
  `[0:a]atrim=end=${Math.max(cs, 0.001)},asetpts=N/SR/TB[a];[1:a]atrim=start=${a0}:end=${a1},asetpts=N/SR/TB[b];[0:a]atrim=start=${ce},asetpts=N/SR/TB[c];[a][b][c]concat=n=3:v=0:a=1[o]`,
  '-map', '[o]', '-c:a', 'libmp3lame', '-b:a', '128k', '-ar', '44100', outPath,
]);
await writeFile(audioPath, await readFile(outPath));

// --- 4. rebuild timings
const words = [];
let cur = null;
al.characters.forEach((c, i) => {
  if (/\s/.test(c)) return (cur = null);
  if (!cur) words.push((cur = { w: '', start: starts[i], end: ends[i] }));
  cur.w += c;
  cur.end = ends[i];
});
const shiftNew = (t) => round3(cs + (t - a0));
const newWords = words.map((x) => ({ w: x.w, start: shiftNew(x.start), end: shiftNew(x.end) }));
const delta = a1 - a0 - (ce - cs);
timing.segments[ti] = { id, text: seg.text, start: newWords[0].start, end: newWords.at(-1).end, words: newWords };
for (const s of timing.segments.slice(ti + 1)) {
  s.start = round3(s.start + delta);
  s.end = round3(s.end + delta);
  s.words.forEach((x) => ((x.start = round3(x.start + delta)), (x.end = round3(x.end + delta))));
}
timing.duration = round3(timing.duration + delta);
await writeFile(timingPath, JSON.stringify(timing, null, 2));
await rm(tmp, { recursive: true, force: true });

console.log(`Patched "${id}" (cut ${cs.toFixed(3)}–${ce.toFixed(3)}s), length change ${delta >= 0 ? '+' : ''}${delta.toFixed(2)}s, total ${timing.duration}s`);
console.log('  ' + newWords.map((x) => `${x.w}@${x.start}`).join('  '));
