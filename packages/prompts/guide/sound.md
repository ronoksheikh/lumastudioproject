# Sound — no voice, other voices, music, sounds made in code

A video does not need an ElevenLabs voice. Choose what the request needs:

| The video | Time base | Sound |
|---|---|---|
| Voiced ad/explainer (default for "make an ad") | script.json → generate_voice → `w()` | voice + cues |
| Logo sting, intro/outro, text-only reel, loop, "no voiceover" | `project.json` `timeline` → `at()`/`range()` | cues, custom sounds, music file |
| The student's own recording or another TTS API | `npm run import-voice` → `w()` (estimated) | their audio + cues |

## Silent / music-only videos
`project.json`: `"timeline": [{ "id": "intro", "duration": 3 }, { "id": "cta", "duration": 4 }], "tail": 0`.
Scenes still map to ids (`range('intro')`), beats use `ctx.at('intro', 1.2)`. No script.json needed;
`npm run check` won't complain. Music: put the file in `assets/` (an upload, or one the student allowed you to
download) and `ctx.cueFile(0, 'assets/music.mp3', { gain: 0.6 })` — plays in the preview and is mixed into renders.
`offset` skips into the file. Keep music low (gain 0.4–0.7) if there is also a voice.

## Sounds made in code
`ctx.sound(name, (audioCtx, destination, t, gain) => { … })` registers a synthesizer; `cue(t, name, gain)` plays it.
Build from oscillators (sine/triangle/square/sawtooth), noise buffers, `BiquadFilter`s, gain envelopes. Rules:
deterministic (noise from `rand(i, k)`, never `Math.random`), schedule everything relative to `t`, stop sources
(`o.stop(t + len)`), keep gain ≤ 1. Worth making: a soft brand chime (3 sines in a major chord, staggered
60–90 ms), a sub "boom" (sine 60 → 35 Hz pitch drop, 0.6 s), a riser (filtered noise with the cutoff sweeping up),
a UI tick (8 ms square blip at 2 kHz), a glassy shimmer (high sines with vibrato).
Built-ins `impact whoosh pop tick click riser shimmer glitch` cover most beats — combine them before inventing.

## Another voice provider (OpenAI TTS, Google, Azure, PlayHT, a local model…)
The terminal has internet access. If the student gives you another TTS API (and its key) — not ElevenLabs: an
ElevenLabs key belongs in Settings → Voice, where the voice tools use it:
1. Store the key in the project's `.env` (gitignored) — never in a committed file, never echo it back in chat.
   Read it in commands with `set -a; . ./.env; set +a`.
2. Call the API with `curl` (or a small node script you write in `scripts/`), saving e.g. `voice-raw.mp3`.
   Several files (one per segment)? Join them with ffmpeg (`concat`) in script order.
3. Write script.json first (`segments` with ids + the exact spoken texts, in order; the `voice` block is optional),
   then `npm run import-voice -- --audio voice-raw.mp3`. It converts to `public/audio/voiceover.mp3` and writes
   `timing.json`. If the provider returns word timestamps, pass them (`--words words.json`, format
   `[{ "w": "Hello", "start": 0.12, "end": 0.4 }, …]` in script order) for exact sync; otherwise the words are
   spread over the detected speech (marked `estimated`) — put beats on segment starts and strong words, and
   check with preview_frames.
The student's own recording works the same way (it's an upload: convert it with import-voice).
