# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

**Luma Studio**: an AI motion-graphics studio for Lumademy's AI Motion Graphics Crash Course students (Fastify + SQLite + React, agent runtime, render queue, one Docker container). `plan.md` is the phased build plan (Phase 0–8, plus appendices for the agent system prompt, tool definitions, event protocol, DB schema and known pitfalls) and the source of truth for product decisions; its "Open questions" table lists the defaults assumed. The app is being built phase by phase, one commit per phase.

Layout:

- `apps/api` — Fastify app: `src/db` (SQLite/Drizzle), `auth`, `projects` (dirs/git/service), `providers` (BYO model keys), `settings` (ElevenLabs), `uploads`, `preview` (separate-origin file server), `runner` (sandboxed exec + file tools), `cpu` (budget), `render` (queue + file serving), `agent` (loop, tools, run registry, SSE routes). `apps/web` — Vite + React + HeroUI v3 (Tailwind v4) SPA: `src/lib/reduce.ts` turns run events into chat blocks, `src/stores/live.ts` follows runs over SSE, `src/components` has the chat cards and the Preview/Files/Renders/History/Terminal panes. `packages/shared` — constants/zod schemas shared by both (TypeScript source, bundled into the api by tsup). `packages/prompts` — versioned agent prompts: `system.md` + the on-demand `guide/*.md` topics the agent reads with the `read_guide` tool. `template/` — the video **engine** (index.html, main.js, world.js, lib/ + recipes, base css, fonts, logos, scripts) plus `template/scaffold/` (the only files a new project gets: project.json, brand.json, package.json, .gitignore, an empty scenes.css) and `template/examples/` (starter, explainer). `docker/runtime-deps` — the shared `/opt/luma/node_modules` package list.
- `plan.md` — the build plan.
- `reference-ads/` — three finished, standalone ad projects. Per `plan.md` §2 they are the ground truth for how a "Lumademy-quality" video is made, and Phase 1 extracts them into one reusable template (use `lumademy-explainer-ad` as the base: newest and cleanest).
- `Lumademy_Brand_Kit/` — logos (SVG/PNG), social assets, and `03_Colors_and_Guidelines/Brand_Guidelines.md`.

## Luma Studio: commands

pnpm workspace (Node 22). From the repo root:

```
pnpm install
pnpm dev                              # api (tsx watch, :8080) + web (vite, :5180, proxies /api)
pnpm build && pnpm start              # production build; api serves apps/web/dist
pnpm typecheck
pnpm test                             # vitest (api)
pnpm --filter @luma/web test          # web unit tests (reducer, components)
pnpm --filter @luma/web e2e [outDir]  # full browser journey against the real server + mock model; screenshots in outDir (needs `pnpm build` first)
pnpm --filter @luma/api exec vitest run src/agent/agent.test.ts   # single test file (tests run serially; some spawn real sandboxed processes)
pnpm db:generate                      # after editing apps/api/src/db/schema.ts -> new SQL in apps/api/drizzle (committed; applied on start)
```

**Empty projects + engine overlay.** `createProject` copies only `template/scaffold` — no demo scenes, script or audio; the agent builds everything. The engine is never copied: the preview server (`preview/static.ts`) and the pristine scripts' own server (`template/server.mjs`) serve a project path from the project if it exists, else from the engine (`config.templateDir`), except project-owned paths (`public/js/scenes/`, `public/audio/`, `public/css/scenes.css`, root json files), which never fall back. So legacy projects (full template copies) keep their own engine, new ones stay tiny. Agent commands see the engine read-only at `$LUMA_ENGINE` (bind-mounted into bubblewrap); the scaffold's `npm run check` runs the engine's `check.mjs --root .`. `projects/content.ts` says whether a project has scenes/script/voice yet (`GET /projects/:id` → `content`); preview_frames, render_video and capture refuse an empty project with a plain-language reason, and the engine's `main.js` shows a "Nothing here yet" state. Tests that need a playable video seed one with `seedExample()` (test/helpers.ts).

Agent runs use a mock OpenAI-compatible server from `apps/api/src/test/helpers.ts` (`startMockLlm`) — no network or API keys needed. Template scripts have their own tests: `cd template && npm test`.

**Rendering.** `render_video` inserts a `render_jobs` row (one active per project) and waits; `render/service.ts` polls it, waits for a CPU-budget slot, then runs the pristine `template/scripts/render.mjs` as the project's uid. That script splits the frames into chunks (one Chromium + `export-mp4.mjs --from/--to` each), joins them, mixes voice + SFX, runs ffprobe checks and writes a 2×2 contact sheet; progress comes back as `[luma] frame i/total` lines. MP4s live in `<project>/export/` (gitignored) and are served by `render/serve.ts` (Range support, `O_NOFOLLOW`, owner-only). Timings and the CPU-vs-chunk findings are in `docs/rendering.md`. **Fast render hours + remote workers** (`docs/remote-workers.md`): a job's `pool` is `local` (this server, within the daily allowance — not shown in the UI) or `remote` (a paid 100 BDT hour from `render_boosts`; payment is not built yet: `POST /api/billing/render-boost` saves a pending purchase, `admin boost-paid` activates it, and paying also resets the allowance). Remote jobs are claimed over HTTP by `worker/luma-worker.mjs` (`render/workers.ts`, bearer tokens from `admin worker-add`, lease renewed by progress reports); with no worker online they render locally. `render/render.test.ts` swaps `config.templateDir` for a stub `render.mjs`.

**Videos without a voice.** A project without `public/audio/timing.json` can use a `project.json` `"timeline": [{id, duration}]` time base (`ctx.at(id, s)`; logo stings, music-only). Sounds: built-in cues, `ctx.sound(name, fn)` WebAudio synths, `ctx.cueFile(t, url)` audio files — all mixed into renders; `render.mjs` works without a voiceover. Other TTS providers or recordings go through `npm run import-voice -- --audio <file> [--words …]`. `check.mjs` errors only on what breaks the video (the rest are warnings).

**Voice.** No hard-coded voice defaults: Settings → Voice holds the key plus optional overrides (`settings/service.ts` `getVoicePrefs`, null = the agent chooses), applied to script.json by `generate_voice`. The agent's `list_voices` tool runs the pristine `template/scripts/list-voices.mjs` with the key on stdin. Shared ElevenLabs request/error handling lives in `template/scripts/lib/common.mjs` (`ttsWithTimestamps`, `explainElevenError`).

**Chat attachments.** Uploads are project files from the moment they are attached (`uploads/service.ts`: `sent_at` set by `markSent` when a run starts; `DELETE /uploads/:id` only removes never-sent ones; `GET /uploads?pending=1` restores composer chips). Preview frames attached to a message are resolved when the run starts (`agent/frame-attach.ts`): text facts for every model, the image for vision models, PNG kept outside the project in `DATA_DIR/frame-attachments/`.

**Buttons.** Import `Button` from `apps/web/src/components/Button.tsx`, not from `@heroui/react`: it is HeroUI's Button plus HeroUI's ripple click effect (`@heroui/ripple` 2.2.20, the one HeroUI 2.8.5's Button uses; pinned). The ripple only needs framer-motion at runtime; its `@heroui/system`/`@heroui/theme` peers (HeroUI v2) are deliberately not installed (`pnpm.peerDependencyRules.ignoreMissing`). Icons: `components/Icon.tsx` (Phosphor).

**Agent settings.** Settings → Agent stores the student's own prompt (`settings/service.ts` `getAgentPrompt`, kind `agent_prompt`; `append` to or `replace` Luma's `system.md`). `MAX_RUNS_PER_USER` (default 4) projects can run at once. The `compact_context` tool forces `compactIfNeeded`. **Shared lessons** (`agent/lessons.ts`, table `agent_lessons`): the `save_lesson` tool stores a generic fact learned in one run (e.g. an ElevenLabs free-plan limit); active lessons are added to every system prompt for all students, framed as hints. Guarded by secret/e-mail redaction, length caps, rate limits (5 per run, 20 per student per day) and near-duplicate merging (counted as confirmations); `AGENT_LESSONS=review` holds new ones for `admin lesson-approve`, `off` disables; `admin lessons` / `lesson-archive` / `lesson-add` manage them. **Shared library** (`agent/library.ts`, table `shared_assets`, files in `DATA_DIR/library/<kind>/`): `share_asset` copies a reusable project file (open-licence font, sound, data json, snippet) in server-side — uploads, hidden files, unknown extensions, >20 MB and text containing keys/e-mails are refused, identical files stored once — and `use_asset` copies one into a project; the index is in every system prompt. `SHARED_LIBRARY=auto|review|off`; `admin assets` / `asset-approve` / `asset-archive`. **Frame checks** (Settings → Agent, `getAgentPrefs`, kind `agent_prefs`): `full` | `light` (one preview_frames call per message) | `off` (tool removed; the agent uses `npm run check -- --page` and asks the student to watch the preview), enforced in `loop.ts`. Guides added this round: `studio` (UI + fixing a blank preview), `logo`, `sound`.

**Quality loop.** `preview_frames` (pristine `template/scripts/preview-frames.mjs`) also runs `scripts/lib/layout-probe.mjs` in the page at every captured time — overlapping text, text off the stage, tiny text, frames with no text, spoken words still hidden — and returns the sentences as `issues` (the model's only eyes when it has no vision). `evals/` holds the golden prompts, `rubric.md`, the scoring code (`score.mjs`, unit-tested with `pnpm evals:test`) and `run.mjs`, which drives a running Studio with a saved model.

**Process cleanup.** Commands and pristine scripts run as the project's uid are counted per uid (`trackUid` in `runner/exec.ts`); a finished command reaps leftover uid processes (`pkill -U`) only when no other command of that project is still running, so a render, a preview capture and an agent command can overlap safely (a stopped command's SIGKILL escalation is cancelled once it has exited).

**Hardening.** Quotas live in `quota/service.ts` (disk per user, render seconds per day; checked at project create, upload, run start and render enqueue); `maintenance/` has the project purge and nightly SQLite backup (scheduled from `index.ts`); `security/captcha.ts` is the optional hCaptcha; `observability/` has the Prometheus-style metrics (`/api/metrics`, token-gated) and a Sentry-compatible error reporter; `cli/admin.ts` (`pnpm --filter @luma/api admin …`, `node dist/admin.js` in the image) bans users, purges, backs up and rotates `MASTER_KEY`. `docker/egress.sh` (run by `entrypoint.sh`) blocks private/metadata networks for project uids. Ops and deploy notes: `docs/deploy.md`; licences: `docs/licenses.md`.

Configuration is via env (see `.env.example`, parsed in `apps/api/src/config.ts`). `docker compose up` builds the single `luma-studio` image (Dockerfile at the root).

## Reference ads: commands

Each ad under `reference-ads/` is an independent npm project (ESM, no build step, no linter, no tests). Run commands from inside the ad's folder.

```
npm install
npm start                 # static server for the ad (http://localhost:5173; explainer-ad uses 5175)
npm run voice             # ElevenLabs TTS -> public/audio/voiceover.mp3 + timing.json (needs ELEVENLABS_API_KEY in .env)
npm run export            # headless Chrome frame capture -> ffmpeg -> export/*.mp4 (needs `npm start` running + ffmpeg)
node scripts/export-mp4.mjs out.mp4 --fps 30    # custom output/fps (default 60, 1920x1080)
node scripts/patch-voice.mjs <segmentId>        # re-record one segment and splice it in (claude-pro-ad, explainer-ad only)
npm run map               # explainer-ad only: rebuild public/assets/world-map.json from Natural Earth
```

Gotchas:
- `export-mp4.mjs` defaults `CHROME_PATH` to a macOS Chrome path. On Linux set `CHROME_PATH` (here Playwright's Chromium is at `/opt/pw-browsers/chromium`). Use `AD_URL` to point at a non-default port. Without a GPU, WebGL falls back to SwiftShader and export is very slow.
- `.env`, `node_modules/`, `export/`, `*.mp4`, `/work/`, `/outputs/` are gitignored. Never commit API keys.
- A committed `voiceover.mp3`/`timing.json` exists in each ad, so `npm start` works without regenerating audio.

## Reference ads: architecture

All three ads share one engine design (details in `plan.md` §3); understanding it needs several files together:

- **Everything is a pure function of time `t`.** `public/js/scenes.js` builds the DOM for every scene plus **one paused GSAP master timeline**. `main.js` `draw(t)` does `tl.time(t)`, runs `frameHooks`, then `world.render(t)` (Three.js layer in `world.js`). Because any frame can be reproduced exactly, `export-mp4.mjs` just calls `window.ad.seek(i/fps)` and screenshots. Consequently: no `setTimeout`, no per-frame `Math.random()`, no CSS animations for anything that matters.
- **Word-level sync.** `script.json` (voice settings + one TTS segment per scene) → `scripts/generate-voice.mjs` sends all segments as one ElevenLabs `/with-timestamps` request and writes `timing.json` (`segments[].words[].start/end`). `scenes.js` reads it via helpers like `w('segId', wordIndex)`, so visual beats and scene boundaries are driven by spoken-word times. On-screen text is separate from TTS text (speak Bengali phonetics, show "Claude Pro").
- **Playback clock** in `main.js` runs on `performance.now()` and re-syncs to `audio.currentTime` when drift > 60 ms.
- **Layers** inside the 1920×1080 `#stage` (CSS-scaled to the viewport): WebGL canvas → `#scenes` DOM → `#fx` (flash/grain/vignette) → captions. `world.js` is driven by plain numeric props on `world.state` that GSAP tweens; particles are weighted blends of target position attributes.
- **Sound.** `sfx.js` synthesizes SFX with WebAudio; scenes register `cue(t, type, gain)`. Export renders the same cues offline to WAV (`window.ad.sfxWavBase64()`) and ffmpeg mixes them with the voiceover.
- `server.mjs` is a zero-dependency static server: `/` → `public/`, `/vendor/*` → `node_modules/*` (index.html imports three/gsap from there), with HTTP Range support (clamp ranges, answer 416 when unsatisfiable).

When editing scenes, read `plan.md` Appendix E first. The ones that bite most: GSAP `fromTo` renders at build time (one `from/fromTo` per property per element, exits use `to`); let GSAP own transforms rather than CSS; never split Bengali text by character (split by word, pad word masks); `await document.fonts.load(...)` before canvas sampling or layout measurement; keep CSS numeric custom properties unitless.

## Brand rules

From `Brand_Guidelines.md` and `plan.md` §3.7: Lumademy blue `#2970EC` with gradient `#5DAEFF → #2970EC → #1557D1 → #07358F`, plus white. No navy/near-black stages, no orange accents or glows (shifts blue to purple). Use `Lumademy_All_White.svg` on blue/dark backgrounds and `Lumademy_Primary_Blue.svg` on white. Typography is Inter (Anek Bangla for Bengali). Flag placeholder data (prices, view counts) rather than presenting it as real.
