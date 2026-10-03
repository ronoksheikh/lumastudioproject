// Generates the voiceover with ElevenLabs /with-timestamps and writes:
//   public/audio/voiceover.mp3  — the audio
//   public/audio/timing.json    — per-segment and per-word timings the visuals sync to
//
// Usage: node scripts/generate-voice.mjs   (reads ELEVENLABS_API_KEY from .env)

import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function loadEnv() {
  try {
    const raw = await readFile(path.join(root, '.env'), 'utf8');
    for (const line of raw.split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch { /* no .env — rely on real env */ }
}

await loadEnv();
const apiKey = process.env.ELEVENLABS_API_KEY;
if (!apiKey) {
  console.error('Missing ELEVENLABS_API_KEY (set it in .env)');
  process.exit(1);
}

const script = JSON.parse(await readFile(path.join(root, 'script.json'), 'utf8'));
const { voice, segments } = script;

// Join segments into one request so the delivery flows naturally,
// remembering where each segment starts in the full string.
let fullText = '';
const ranges = segments.map((seg, i) => {
  if (i > 0) fullText += ' ';
  const start = fullText.length;
  fullText += seg.text;
  return { start, end: fullText.length };
});

const url = `https://api.elevenlabs.io/v1/text-to-speech/${voice.voice_id}/with-timestamps?output_format=mp3_44100_128`;
const body = {
  text: fullText,
  model_id: voice.model_id,
  language_code: voice.language_code,
  voice_settings: voice.voice_settings,
};

console.log(`Requesting ${voice.model_id} (${voice.language_code}) — ${fullText.length} chars…`);
const res = await fetch(url, {
  method: 'POST',
  headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json', Accept: 'application/json' },
  body: JSON.stringify(body),
});
if (!res.ok) {
  console.error(`ElevenLabs error ${res.status}: ${await res.text()}`);
  process.exit(1);
}
const data = await res.json();
const align = data.alignment;
if (!align?.characters?.length) {
  console.error('No alignment returned.');
  process.exit(1);
}

// The alignment is per character of the text we sent. Rebuild it as a string
// so we can map our segment character ranges onto it.
const chars = align.characters;
const starts = align.character_start_times_seconds;
const ends = align.character_end_times_seconds;
const alignedText = chars.join('');
if (alignedText !== fullText) {
  console.warn('Warning: alignment text differs from input; timings are mapped by position.');
}

const isSpace = (c) => /\s/.test(c);
const words = [];
let cur = null;
for (let i = 0; i < chars.length; i++) {
  if (isSpace(chars[i])) { cur = null; continue; }
  if (!cur) { cur = { w: '', start: starts[i], end: ends[i], i0: i }; words.push(cur); }
  cur.w += chars[i];
  cur.end = ends[i];
  cur.i1 = i;
}

const round = (n) => Math.round(n * 1000) / 1000;
const out = segments.map((seg, s) => {
  const { start, end } = ranges[s];
  const segWords = words.filter((w) => w.i0 >= start && w.i0 < end);
  return {
    id: seg.id,
    text: seg.text,
    start: round(segWords[0]?.start ?? 0),
    end: round(segWords.at(-1)?.end ?? 0),
    words: segWords.map((w) => ({ w: w.w, start: round(w.start), end: round(w.end) })),
  };
});

await mkdir(path.join(root, 'public/audio'), { recursive: true });
const mp3Path = path.join(root, 'public/audio/voiceover.mp3');
await writeFile(mp3Path, Buffer.from(data.audio_base64, 'base64'));

// Optional extra speed beyond ElevenLabs' max (1.2): pitch-preserving time-stretch,
// with every timestamp rescaled so the visuals stay word-synced.
const tempo = voice.tempo ?? 1;
if (tempo !== 1) {
  const tmp = mp3Path.replace(/\.mp3$/, '.raw.mp3');
  await writeFile(tmp, Buffer.from(data.audio_base64, 'base64'));
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', tmp, '-filter:a', `atempo=${tempo}`, '-c:a', 'libmp3lame', '-b:a', '128k', mp3Path]);
  await rm(tmp);
  for (const seg of out) {
    seg.start = round(seg.start / tempo);
    seg.end = round(seg.end / tempo);
    seg.words.forEach((x) => ((x.start = round(x.start / tempo)), (x.end = round(x.end / tempo))));
  }
}
const duration = round(ends.at(-1) / tempo);
await writeFile(
  path.join(root, 'public/audio/timing.json'),
  JSON.stringify({ model: voice.model_id, duration, segments: out }, null, 2),
);

console.log(`Done. ${duration}s of audio, ${words.length} words.`);
for (const seg of out) console.log(`  ${seg.start.toFixed(2).padStart(6)}s  ${seg.id.padEnd(9)} ${seg.text}`);
