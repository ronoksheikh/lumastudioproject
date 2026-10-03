// Turns ANY voiceover audio into the engine's voice files — for a voice from another TTS provider (generated
// with a key the student gave you), a recording the student uploaded, or a music-led video with narration.
//   public/audio/voiceover.mp3  (converted to mp3)
//   public/audio/timing.json    (segments + word times from script.json)
//
// Usage: node "$LUMA_ENGINE/scripts/import-voice.mjs" --audio assets/uploads/voice.wav [--words words.json] [--root .]
//   --words  optional exact word timings from the provider: [{ "w": "Hello", "start": 0.12, "end": 0.4 }, …] in
//            script order (many TTS APIs return these). Without it, word times are ESTIMATED: speech regions are
//            found with ffmpeg silencedetect and each segment's words are spread over them by length. Estimated
//            timing is marked "estimated": true — check the beats in preview_frames.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { execFileSync, spawnSync } from 'node:child_process';
import path from 'node:path';
import { parseArgs, projectRoot, readJson, round3 } from './lib/common.mjs';

const { opts } = parseArgs();
const root = projectRoot(opts);
if (!opts.audio) {
  console.error('Usage: import-voice.mjs --audio <file> [--words words.json] [--root <project>]');
  process.exit(2);
}
const src = path.resolve(root, String(opts.audio));
const script = await readJson(path.join(root, 'script.json')).catch(() => null);
if (!script?.segments?.length) {
  console.error('script.json with segments (one per scene, the words that are spoken) is needed to time the voice.');
  process.exit(1);
}
const audioDir = path.join(root, 'public/audio');
await mkdir(audioDir, { recursive: true });
const mp3 = path.join(audioDir, 'voiceover.mp3');
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', src, '-vn', '-c:a', 'libmp3lame', '-b:a', '128k', mp3]);
const duration = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', mp3], { encoding: 'utf8' }));

const segWords = script.segments.map((s) => s.text.trim().split(/\s+/));
let words; // flat [{w,start,end}]
let estimated = false;
if (opts.words) {
  const given = JSON.parse(await readFile(path.resolve(root, String(opts.words)), 'utf8'));
  const need = segWords.flat().length;
  if (!Array.isArray(given) || given.length !== need) {
    console.error(`--words has ${Array.isArray(given) ? given.length : 0} entries but script.json has ${need} words — they must match one to one, in order.`);
    process.exit(1);
  }
  words = given.map((g, i) => ({ w: segWords.flat()[i], start: Number(g.start), end: Number(g.end) }));
} else {
  estimated = true;
  // speech regions = everything that isn't a silence of ≥ 0.25 s
  // silencedetect reports on stderr
  const log = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', mp3, '-af', 'silencedetect=noise=-35dB:d=0.25', '-f', 'null', '-'], { encoding: 'utf8' }).stderr ?? '';
  const sil = [];
  for (const m of log.matchAll(/silence_start: ([\d.]+)[\s\S]*?silence_end: ([\d.]+)/g)) sil.push([Number(m[1]), Number(m[2])]);
  const speech = [];
  let t = 0;
  for (const [a, b] of sil) {
    if (a > t + 0.05) speech.push([t, a]);
    t = b;
  }
  if (t < duration - 0.05) speech.push([t, duration]);
  if (!speech.length) speech.push([0, duration]);
  // map "speech time" (silences removed) to real time
  const total = speech.reduce((n, [a, b]) => n + (b - a), 0);
  const toReal = (x) => {
    let left = x;
    for (const [a, b] of speech) {
      if (left <= b - a) return a + left;
      left -= b - a;
    }
    return speech.at(-1)[1];
  };
  const flat = segWords.flat();
  const weight = (w) => [...w].length + 2;
  const sum = flat.reduce((n, w) => n + weight(w), 0);
  let acc = 0;
  words = flat.map((w) => {
    const s = (acc / sum) * total;
    acc += weight(w);
    const e = (acc / sum) * total;
    return { w, start: round3(toReal(s)), end: round3(toReal(e)) };
  });
}

let k = 0;
const segments = script.segments.map((s, i) => {
  const ws = words.slice(k, k + segWords[i].length);
  k += segWords[i].length;
  return { id: s.id, text: s.text, start: round3(ws[0].start), end: round3(ws.at(-1).end), words: ws.map((x) => ({ w: x.w, start: round3(x.start), end: round3(x.end) })) };
});
await writeFile(path.join(audioDir, 'timing.json'), JSON.stringify({ model: 'imported', duration: round3(duration), ...(estimated ? { estimated: true } : {}), segments }, null, 2));
console.log(`Imported ${round3(duration)}s of voice, ${words.length} words${estimated ? ' (word times ESTIMATED from pauses — verify the beats)' : ''}.`);
for (const s of segments) console.log(`  ${s.start.toFixed(2).padStart(6)}s  ${s.id}`);
