# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

**Luma Studio**: an AI motion-graphics studio for Lumademy's AI Motion Graphics Crash Course students (Fastify + SQLite + React, agent runtime, render queue, one Docker container). `plan.md` is the phased build plan (Phase 0–8, plus appendices for the agent system prompt, tool definitions, event protocol, DB schema and known pitfalls) and the source of truth for product decisions; its "Open questions" table lists the defaults assumed. The app is being built phase by phase, one commit per phase.

Layout:

- `apps/api` — Fastify app: `src/db` (SQLite/Drizzle), `auth`, `projects` (dirs/git/service), `providers` (BYO model keys), `settings` (ElevenLabs), `uploads`, `preview` (separate-origin file server), `runner` (sandboxed exec + file tools), `cpu` (budget), `agent` (loop, tools, run registry, SSE routes). `apps/web` — Vite + React SPA. `packages/shared` — constants/zod schemas shared by both (TypeScript source, bundled into the api by tsup). `packages/prompts` — versioned agent prompts. `template/` — the video template copied into every project. `docker/runtime-deps` — the shared `/opt/luma/node_modules` package list.
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
pnpm --filter @luma/api exec vitest run src/agent/agent.test.ts   # single test file (tests run serially; some spawn real sandboxed processes)
pnpm db:generate                      # after editing apps/api/src/db/schema.ts -> new SQL in apps/api/drizzle (committed; applied on start)
```

Agent runs use a mock OpenAI-compatible server from `apps/api/src/test/helpers.ts` (`startMockLlm`) — no network or API keys needed. Template scripts have their own tests: `cd template && npm test`.

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
