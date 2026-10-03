# Rendering: how it works and what it costs

`render_video` → `render_jobs` row → `RenderQueue` (apps/api/src/render/service.ts) → CPU-budget slot →
`template/scripts/render.mjs` run as the project's unix user:

1. One short Chromium session reads the duration/size and renders the sound effects to a WAV.
2. The frames are split into N contiguous chunks; each chunk is `export-mp4.mjs --from A --to B --video-only`
   (its own Chromium, frame-by-frame `window.ad.seek(t)` + screenshot piped to ffmpeg/x264).
3. ffmpeg joins the chunks (stream copy), mixes voiceover + SFX, writes `export/<ts>-<preset>.mp4`.
4. ffprobe/volumedetect checks (resolution, fps, duration ±0.25 s, audio present, peak < 0 dBFS) and a 2×2
   contact sheet (`.jpg` next to the MP4).

N = `min(MAX_RENDER_WORKERS, 1 + free CPU slots)` when the job starts. Presets: **draft** = 30 fps, JPEG capture,
x264 `veryfast` crf 23; **final** = project fps (60), PNG capture, x264 `slow` crf 16. Both at the project's full
stage size (1920×1080, or 1080×1920 for 9:16). Limits: one active render per user, `RENDER_TIMEOUT_MIN` (90)
per render, jobs interrupted by a restart go back to `queued`.

## Measured on the dev host (4 vCPU, no GPU, Chromium on SwiftShader)

| Render | Frames | Workers | Wall time | Notes |
|---|---|---|---|---|
| Starter template, draft 1080p30 (14.6 s) | 437 | 3 | 4 m 43 s | other tests were running at the same time |
| Ported explainer, **final 1080p60 (32.6 s)** | 1955 | 2 | **22 m 00 s** | 29.7 MB, all checks passed (peak −1.9 dBFS) |

Single-page capture speed (1920×1080, 15 frames): PNG 1.22 frames/s, JPEG 1.32 frames/s.

What this means:

- Software WebGL already uses every core of one Chromium, so **extra chunks do not speed things up on a 4-core
  host** (3 workers ≈ 1.4 frames/s, about the same as one). Chunking pays off from ~8 cores or with a GPU
  (`LUMA_GPU=1` drops the SwiftShader flags).
- Budget about **0.7 s per frame** per render on a 4-core CPU host: a 30 s final is ~20–25 min, the same video as a
  draft ~6–8 min. The chat card shows live progress and an ETA, so students can keep working while it runs.
- If this is too slow for a class, the levers in order of effect: a GPU host; more cores (`MAX_RENDER_WORKERS`);
  telling students to use Draft while iterating and Final once.
