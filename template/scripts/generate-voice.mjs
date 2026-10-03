// Generates the voiceover with ElevenLabs /with-timestamps and writes:
//   public/audio/voiceover.mp3  — the audio
//   public/audio/timing.json    — per-segment and per-word timings the visuals sync to
//
// Usage: node scripts/generate-voice.mjs [--root <project>] [--placeholder]
//   reads ELEVENLABS_API_KEY from the environment or <project>/.env
//   --placeholder  no API call: silent audio + evenly spaced word timings (for dry runs; marked placeholder:true)

import { writeFile, readFile, mkdir, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { parseArgs, projectRoot, loadEnv, applyKeyFromStdin, readJson, round3, validateScript, ttsWithTimestamps } from './lib/common.mjs';

const { opts } = parseArgs();
const root = projectRoot(opts);
await loadEnv(root, opts);
await applyKeyFromStdin(opts);

const script = await readJson(path.join(root, 'script.json'));
const problems = validateScript(script, { requireVoice: !opts.placeholder });
if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}
const { segments } = script;
const voice = script.voice ?? {};
const audioDir = path.join(root, 'public/audio');
const mp3Path = path.join(audioDir, 'voiceover.mp3');
await mkdir(audioDir, { recursive: true });

// Join segments into one request so the delivery flows naturally,
// remembering where each segment starts in the full string.
let fullText = '';
const ranges = segments.map((seg, i) => {
  if (i > 0) fullText += ' ';
  const start = fullText.length;
  fullText += seg.text;
  return { start, end: fullText.length };
});

let words; // [{ w, start, end, i0 }]
let rawDuration;
let audioBytes;

if (opts.placeholder) {
  // ~2.3 words/s, a short breath between segments
  let t = 0.2;
  words = [];
  segments.forEach((seg, s) => {
    let pos = ranges[s].start;
    for (const w of seg.text.trim().split(/\s+/)) {
      const dur = Math.min(0.9, 0.16 + 0.04 * [...w].length);
      words.push({ w, start: t, end: t + dur, i0: seg.text.indexOf(w, pos - ranges[s].start) + ranges[s].start });
      pos = words.at(-1).i0 + w.length;
      t += dur + 0.06;
    }
    t += 0.25;
  });
  rawDuration = t;
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono', '-t', String(round3(rawDuration)), '-c:a', 'libmp3lame', '-b:a', '64k', mp3Path]);
  console.log('Placeholder voice (silent) — run without --placeholder and with ELEVENLABS_API_KEY for the real thing.');
} else {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    console.error('Missing ELEVENLABS_API_KEY (set it in the environment or .env, or use --placeholder)');
    process.exit(1);
  }
  console.log(`Requesting ${voice.model_id}${voice.language_code ? ` (${voice.language_code})` : ''}, voice ${voice.voice_id} — ${fullText.length} chars…`);
  let data;
  try {
    data = await ttsWithTimestamps(apiKey, voice, { text: fullText });
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
  const align = data.alignment;
  if (!align?.characters?.length) {
    console.error('No alignment returned.');
    process.exit(1);
  }
  // The alignment is per character of the text we sent.
  const chars = align.characters;
  const starts = align.character_start_times_seconds;
  const ends = align.character_end_times_seconds;
  if (chars.join('') !== fullText) console.warn('Warning: alignment text differs from input; timings are mapped by position.');
  words = [];
  let cur = null;
  for (let i = 0; i < chars.length; i++) {
    if (/\s/.test(chars[i])) { cur = null; continue; }
    if (!cur) { cur = { w: '', start: starts[i], end: ends[i], i0: i }; words.push(cur); }
    cur.w += chars[i];
    cur.end = ends[i];
  }
  rawDuration = ends.at(-1);
  audioBytes = Buffer.from(data.audio_base64, 'base64');
  await writeFile(mp3Path, audioBytes);
}

const out = segments.map((seg, s) => {
  const { start, end } = ranges[s];
  const segWords = words.filter((w) => w.i0 >= start && w.i0 < end);
  return {
    id: seg.id,
    text: seg.text,
    start: round3(segWords[0]?.start ?? 0),
    end: round3(segWords.at(-1)?.end ?? 0),
    words: segWords.map((w) => ({ w: w.w, start: round3(w.start), end: round3(w.end) })),
  };
});

// Optional extra speed beyond ElevenLabs' max (1.2): pitch-preserving time-stretch,
// with every timestamp rescaled so the visuals stay word-synced.
const tempo = voice.tempo ?? 1;
if (tempo !== 1) {
  const tmp = mp3Path.replace(/\.mp3$/, '.raw.mp3');
  await writeFile(tmp, audioBytes ?? (await readFile(mp3Path)));
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', tmp, '-filter:a', `atempo=${tempo}`, '-c:a', 'libmp3lame', '-b:a', '128k', mp3Path]);
  await rm(tmp);
  for (const seg of out) {
    seg.start = round3(seg.start / tempo);
    seg.end = round3(seg.end / tempo);
    seg.words.forEach((x) => ((x.start = round3(x.start / tempo)), (x.end = round3(x.end / tempo))));
  }
}
const duration = round3(rawDuration / tempo);
await writeFile(
  path.join(audioDir, 'timing.json'),
  JSON.stringify({ model: voice.model_id ?? null, duration, ...(opts.placeholder ? { placeholder: true } : {}), segments: out }, null, 2),
);

console.log(`Done. ${duration}s of audio, ${words.length} words.`);
for (const seg of out) console.log(`  ${seg.start.toFixed(2).padStart(6)}s  ${seg.id.padEnd(9)} ${seg.text}`);
