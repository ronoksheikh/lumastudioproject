# Luma Studio — Build Plan

> An AI motion-graphics studio for Lumademy's **AI Motion Graphics Crash Course** students.
> A student types a prompt (and optionally attaches SVGs, images or PDFs), and Luma Studio's agent
> writes the script, generates the voiceover, builds a word-synced GSAP + Three.js motion graphic,
> previews it, and renders a 1080p60 MP4 — all inside **one main container** on our server, all visible live.

This plan is written for a fresh Claude Code session. It is self-contained, but it leans heavily on
**three reference projects** built in the session that produced this plan (see §2). Keep those
folders next to this file — they are the ground truth for how a "Lumademy-quality" video is made.

---

## Table of contents

0. [Product summary](#0-product-summary)
1. [Architecture at a glance](#1-architecture-at-a-glance)
2. [Reference implementations (read these first)](#2-reference-implementations-read-these-first)
3. [The video engine — what makes the videos good](#3-the-video-engine--what-makes-the-videos-good)
4. [Phase 0 — Monorepo & the single container](#phase-0--monorepo--the-single-container)
5. [Phase 1 — The Luma video template (engine extraction)](#phase-1--the-luma-video-template-engine-extraction)
6. [Phase 2 — Runner: commands, project isolation, CPU budget](#phase-2--runner-commands-project-isolation-cpu-budget)
7. [Phase 3 — Backend core (accounts, projects, git, keys, uploads)](#phase-3--backend-core)
8. [Phase 4 — Agent runtime (OpenAI-compatible, tools, live events)](#phase-4--agent-runtime)
9. [Phase 5 — Frontend (React + HeroUI, Lumademy branding)](#phase-5--frontend)
10. [Phase 6 — Rendering pipeline (queue, parallel chunks, progress)](#phase-6--rendering-pipeline)
11. [Phase 7 — Quality loop (system prompt, frame review, evals)](#phase-7--quality-loop)
12. [Phase 8 — Hardening & deployment](#phase-8--hardening--deployment)
13. [Appendix A — Agent system prompt (draft)](#appendix-a--agent-system-prompt-draft)
14. [Appendix B — Tool definitions](#appendix-b--tool-definitions)
15. [Appendix C — Live event protocol](#appendix-c--live-event-protocol)
16. [Appendix D — Database schema](#appendix-d--database-schema)
17. [Appendix E — Known pitfalls (learned the hard way)](#appendix-e--known-pitfalls-learned-the-hard-way)
18. [Open questions (defaults assumed)](#open-questions-defaults-assumed)

---

## 0. Product summary

**Who:** students of the Lumademy AI Motion Graphics Crash Course. Free to use, no paid plans.

**What a student does:**
1. Signs up (email + password), lands on a simple dashboard.
2. Adds their own models in **Settings → Models**: any OpenAI-compatible endpoint (OpenRouter, OpenAI, Together, Groq, DeepSeek, a self-hosted vLLM…) as `base_url + api_key + model`.
3. Adds their **ElevenLabs API key** (voiceovers).
4. Creates a project, types a prompt like the ones in this session ("make a 16:9 fast-paced ad from this Bengali script…"), optionally attaching SVG logos, images, PDFs (brand kits, scripts).
5. Watches the agent work **live**: its thinking, the plan, every command, every file created or changed (with diffs), voice generation, preview frames, render progress.
6. Previews the video in the browser (with audio), asks for changes in chat ("the transition after কীভাবে is bad", "make the voice faster"), and downloads the final MP4.

**What we never ship:** the Luma Studio codebase itself. Students only see their project files (and can download their project — see Open questions).

**Non-goals for v1:** billing, teams, social features, a timeline editor, mobile apps.

---

## 1. Architecture at a glance

```
                ┌──────────── ONE container: luma-studio (node, ffmpeg, chromium, git, fonts) ────────────┐
 Browser ──────►│ Fastify app (single Node process)                                                    │
   │            │   ├─ serves the built React SPA + /api + SSE events                                   │
   │            │   ├─ SQLite file /data/luma.db (users, projects, runs, events, render jobs)           │
   │            │   ├─ agent runtime (LLM loop, tools)                                                  │
   │            │   ├─ runner: executes agent commands as child processes, one working dir per project  │
   │            │   │          (unprivileged `luma` user, cwd = /data/projects/<id>, timeouts, limits)  │
   │            │   ├─ CPU budget: renders/heavy jobs only start while total CPU < 90% of the machine   │
   │            │   └─ render queue: `render_jobs` table, one shared Chromium, frames → ffmpeg          │
   │            │                                                                                       │
   │            │ volumes: /data (SQLite + projects/<id> git repos)   /opt/luma/node_modules (shared)   │
   │            └───────────────────────────────────────────────────────────────────────────────────────┘
   └──── preview iframe ──► preview.<domain> (separate origin) ──► same app serves /data/projects/<id>/public
```

**Stack**

| Layer | Choice | Notes |
|---|---|---|
| Frontend | React + Vite + **HeroUI** (all UI components) + Tailwind (as HeroUI requires) | Lumademy brand tokens; Inter + Anek Bangla fonts |
| API | Node 22 LTS, **Fastify**, zod, Drizzle ORM | SSE for live events (WebSocket optional later) |
| DB / queue | **SQLite** (WAL mode) via `better-sqlite3` + Drizzle | Render queue = a `render_jobs` table; locks = rows. No Postgres, Redis or BullMQ — plenty for our scale |
| Agent | Our own loop over the OpenAI Chat Completions API (streaming + tool calling) | No vendor SDK lock-in; `openai` npm client with custom `baseURL` is fine |
| Runtime | **One container** (`luma-studio` image) runs everything; projects are folders, agent commands are child processes | Docker `--cpus` limit set to ~90% of host cores; internal CPU budget queues heavy work |
| Video engine | GSAP + Three.js + DOM in a fixed 1920×1080 stage, ElevenLabs `/with-timestamps` voice, WebAudio SFX, Playwright/Chromium frame capture → ffmpeg | Shipped as a project **template** (Phase 1) |
| Version control | Every project is a git repo; the runtime auto-commits each agent turn | Restore = new commit |

**Monorepo layout**

```
luma-studio/
  apps/
    web/            React + HeroUI SPA
    api/            Fastify app: API, SPA hosting, agent runtime, runner, render queue, preview server
  packages/
    shared/         zod schemas, event types, tool schemas, constants
    prompts/        system prompt + agent guides (markdown, versioned)
  Dockerfile        the single luma-studio image (app + node + ffmpeg + chromium + fonts)
  template/         the Luma video engine (Phase 1) — served read-only to every project; scaffold/ = a new project's files (Round 2)
  evals/            golden prompts + rubric (Phase 7)
  docker-compose.yml
  .env.example
```

---

## 2. Reference implementations (read these first)

Three ads were built end-to-end in the session that wrote this plan. They live next to this file:

| Folder | What it is | Best examples of |
|---|---|---|
| `lumademy-ai-motion-ad/` | 37 s course ad, 11 scenes | 3D extruded logo from SVG, particle morphs (sphere → "AI" → logo), ring tunnel, chrome/glass showcase, wordmark DrawSVG |
| `lumademy-claude-pro-ad/` | 50 s giveaway ad, 9 scenes | Premium-minimal enroll sequence (button → circle → check → light ring), iris transition into a "?" , Discord-style UI, leaderboard grid, counters, confetti, `patch-voice.mjs` (re-record one line) |
| `lumademy-explainer-ad/` | 30 s explainer, 9 scenes, **fastest pacing** | Hook built from rapid cuts → 2×2 grid → flies into an "AI project" preview (match cut), real world map zoom to Dhaka (d3-geo + Natural Earth), bar graph + trend line, retention chart, split-screen problem, voice `tempo` (speed beyond ElevenLabs' 1.2 max) |

Each folder has the same shape:

```
server.mjs                 zero-dep static server (Range support, /vendor → node_modules)
script.json                voice settings + segments (TTS text, per scene)
scripts/generate-voice.mjs ElevenLabs /with-timestamps → public/audio/voiceover.mp3 + timing.json
scripts/patch-voice.mjs    re-record one segment and splice it in (explainer/claude-pro)
scripts/export-mp4.mjs     headless Chromium frame capture → ffmpeg 1080p60 MP4 (+ offline SFX)
scripts/build-map.mjs      (explainer) Natural Earth → SVG path JSON
public/index.html          stage + fx layers + start overlay + import map
public/js/main.js          clock locked to audio, controls, captions, window.ad hooks
public/js/world.js         Three.js layer (bg shader, particles, 3D logo, bloom)
public/js/scenes.js        DOM per scene + one master GSAP timeline
public/js/sfx.js           WebAudio sound design + offline WAV render
public/css/style.css       tokens, stage, fx, per-scene styles
```

**Phase 1 turns these into one reusable template.** Copy the explainer ad's structure as the base
(it is the newest and cleanest), and lift reusable pieces from the other two.

---

## 3. The video engine — what makes the videos good

This section is the "secret sauce". The template (Phase 1) must encode it, and the system prompt
(Appendix A) must teach it.

### 3.1 Determinism: everything is a function of time `t`

- The page has **one paused GSAP master timeline**. Every frame: `tl.time(t)`, run `onFrame(t)` hooks, render Three.js with `world.render(t)`.
- During playback, `t` comes from a `performance.now()` clock that **re-syncs to `audio.currentTime` when drift > 60 ms** (smooth frames, never drifts from the voice).
- For export, `window.ad.seek(t)` renders any frame exactly. This is what makes frame-by-frame capture — and parallel chunk rendering (Phase 6) — possible.
- Rule for the agent: **no `setTimeout`, no `Math.random()` per frame, no CSS animations for anything that matters**. Use GSAP tweens or `onFrame(t)` with deterministic pseudo-random (`rand(i, k)`).

### 3.2 Word-level sync

- `script.json` has `segments: [{ id, text }]` — one segment per scene. `text` is what the **voice** says.
- `generate-voice.mjs` sends all segments as one request (natural prosody), gets character alignment from `/with-timestamps`, rebuilds words and segments → `timing.json`:
  `{ duration, segments: [{ id, text, start, end, words: [{ w, start, end }] }] }`.
- Scenes use `w('map', 5)` → start time of word 5 of segment `map`. Scene in/out = segment starts.
- On-screen text is **separate** from TTS text: speak "ক্লড প্রো", show "Claude Pro".

### 3.3 Voice (ElevenLabs)

- Defaults used in this session: model `eleven_v4`, `language_code: "bn"`, voice **Sarah** `EXAVITQu4vr4xnSDxMaL`, `stability 0.5, similarity_boost 0.8, style 0.25, use_speaker_boost true`, `speed 1.15–1.2`.
- `output_format=mp3_44100_128` (192 kbps requires ElevenLabs Creator tier — it 403s otherwise).
- **Fast pacing:** ElevenLabs `speed` max is 1.2. For more, apply ffmpeg `atempo` (e.g. 1.1) **and divide every timestamp by the tempo** (`voice.tempo` in `script.json`).
- **Pronunciation:** with `language_code: "bn"`, write English words in Bengali script in the TTS text (ইউটিউব, এনরোল, ক্লায়েন্ট, ওয়ার্কফ্লো) and numbers as words (দশজন, চল্লিশ থেকে পঞ্চাশটা).
- **Patching one line:** `patch-voice.mjs <segmentId>` regenerates that segment with `previous_text`/`next_text` for continuity, finds real silences with `ffmpeg silencedetect`, splices, re-encodes, shifts later timings, and checks loudness.

### 3.4 Layers

- `#stage` 1920×1080, scaled to the viewport with a CSS transform. Layers bottom→top: WebGL canvas, `#scenes` (DOM), `#fx` (flash, grain, vignette, confetti), captions.
- **Three.js world** (`world.js`): full-screen background shader quad (Lumademy blue gradient ↔ white via uniforms, soft flowing lines), a 9k-point particle system whose positions are **weighted blends of target attributes** (scatter / sphere / text / logo / ring) — tweening weights morphs deterministically — extruded 3D SVG logos, bloom.
- **DOM scenes** for UI mockups, type, cards, maps (SVG), charts.

### 3.5 Sound

- `sfx.js` synthesizes whoosh, impact, pop, tick, click, riser, shimmer, glitch with WebAudio. Scenes push `cue(t, type, gain)`; playback fires cues the playhead crosses.
- Export renders the same cues offline (`OfflineAudioContext` → WAV) and mixes them with the voice in ffmpeg.

### 3.6 Export

- Chromium (headless), viewport 1920×1080 at DPR 1, page `?pr=1`, UI hidden. For each frame: `ad.seek(i/fps)`, wait two `requestAnimationFrame`s, PNG screenshot → pipe to `ffmpeg -f image2pipe … libx264 -crf 16 -preset slow -pix_fmt yuv420p -movflags +faststart`, AAC 256k.
- Speed observed on Apple Silicon with GPU: ~8–13 s of wall time per second of 60 fps video. **On a GPU-less Linux server WebGL falls back to SwiftShader and will be much slower** → see Phase 6 (parallel chunks, draft 30 fps).

### 3.7 Creative direction that the user approved

These came directly from user feedback in this session — encode them in the system prompt:

1. **The first 3 seconds decide everything.** Open with impact (no fade-in): rapid cuts on every word, a flash/impact sound at t=0, the strongest claim first.
2. **Show examples before the problem.** Wow first, then "but until now this cost ৳15,000 or a sleepless night", then the solution.
3. **Punchy statements, not chains of rhetorical questions.** "১০ জনের মধ্যে ১ জন? চোখের সামনে।" beats "যদি এমন হয়… দেখিয়ে দেওয়া যায়?".
4. **Fast but clear:** ~2.3 words/second (speed 1.2 + tempo 1.1); 30–40 s total for ads.
5. **Premium minimal beats busy.** Lumademy-blue or white stage, big type, hairlines, slow-settling masked reveals, one light sweep. No cartoon padlocks, no green buttons, no confetti in "serious" moments. ("Looks cheap" was the feedback on the busy version.)
6. **Transitions are motion design, not wipes.** Match cuts (empty timeline slot → blank frame; frozen player → editor preview; 2×2 grid → preview window), iris into an element ("?"), push-ins. Stripes/hard cuts with flashes read as cheap.
7. **Brand colors only: Lumademy blue + white.** Main blue #2970EC with its gradient (#5DAEFF → #2970EC → #1557D1 → #07358F) and white. **Don't use navy/near-black stages or text** — dark-blue only as the deep end of the gradient. Third-party logos keep their own color but never tint the background (an orange glow made the blue go purple).
8. **Every visual beat lands on a word.** Counters roll on the number word, pins drop on "জুম", stamps slam on the key phrase.
9. **Meta-reveal works:** "this whole video was made with AI" + pulling back into the code that made it.
10. **Placeholders must be flagged** (prices, view counts, subscriber numbers) — never present invented data as real.

---

## Phase 0 — Monorepo & the single container

**Goal:** `docker compose up` starts **one** container that serves everything.

**Tasks**
- pnpm workspace with `apps/*`, `packages/*`; TypeScript everywhere except `template/` (plain ESM JS — the agent edits it, keep it simple).
- `Dockerfile` (multi-stage): build the SPA + api, then a runtime stage based on `mcr.microsoft.com/playwright:<pinned>-noble` (Chromium + deps) with `ffmpeg`, `git`, `poppler-utils` (PDF → text/images), Bengali/Noto fonts, `curl`, `jq`. Pre-install the template's npm deps once in `/opt/luma/node_modules` (`three`, `gsap`, `playwright`/`puppeteer-core`, `d3-geo`, `topojson-client`, `world-atlas`) — projects reuse them by default, so a normal project needs no `npm install`. Agents can still add **extra packages per project** (see Phase 2, "Installing packages").
- `docker-compose.yml`: a single service `luma-studio`, port 80/443 behind Caddy (or the app directly), volume `data` → `/data` (SQLite at `/data/luma.db`, projects at `/data/projects/<id>`), `cpus: "<0.9 × host cores>"`, `mem_limit` set to most of the host RAM, `restart: unless-stopped`.
- `.env.example`: `DB_PATH` (default `/data/luma.db`), `MASTER_KEY` (32-byte base64 for secret encryption), `SESSION_SECRET`, `APP_ORIGIN`, `PREVIEW_ORIGIN`, `CPU_BUDGET` (default `0.9`), `MAX_RENDER_WORKERS` (default: cores − 1), `CMD_TIMEOUT_S` (default 120).
- Health endpoint, structured logging (pino), Drizzle migrations on start. SQLite pragmas: `journal_mode=WAL`, `busy_timeout=5000`, `foreign_keys=ON`. Single process → single writer, no locking issues.

**Acceptance:** `docker compose up -d` → `GET /api/health` OK, SPA loads, migrations applied, `node -v && ffmpeg -version && chromium --version` all work inside the container.

---

## Phase 1 — The Luma video template (engine extraction)

**Goal:** a project template that any agent (even a mid-tier model) can drop scenes into and get a
deterministic, word-synced, renderable video. This is the most important phase for quality.

**Template layout (`template/`)**

```
LUMA.md                     agent guide for THIS project (how the engine works, rules, recipes index)
project.json                { title, aspect: "16:9"|"9:16", fps: 60, brand: "brand.json" }
brand.json                  colors, fonts, logo paths (defaults: Lumademy palette)
script.json                 voice settings + segments
server.mjs                  static server (Range + 416 handling, /vendor)
scripts/
  generate-voice.mjs        (+ tempo support)
  patch-voice.mjs
  export-mp4.mjs            (+ --from/--to frame range for parallel chunks, --fps, --scale)
  build-map.mjs             Natural Earth → JSON (world-atlas, d3-geo)
  check.mjs                 lint: every scene's word indices exist; timeline length ≥ audio; no missing assets
public/
  index.html
  css/base.css              tokens from brand.json, stage, fx, word-mask helpers
  css/scenes.css            agent writes scene styles here
  js/main.js                clock, controls, captions, window.ad = { seek, play, pause, duration, sfxWavBase64 }
  js/world.js               Three.js world with feature flags (particles targets, logo3d, bg modes)
  js/sfx.js
  js/lib/
    core.js                 el, splitWords (Bengali-safe), splitChars (Latin only), rand, bnNum
    timeline.js             makeTimeline(timing) → { tl, w, cue, onFrame, show, flash, shake, wordIn, reveal, wordsOut }
    recipes/
      kinetic-type.js       masked word reveals, punch-in captions, stamps
      counter.js            number roll (Bengali digits), progress bars
      map-zoom.js           viewBox camera + DOM pins positioned via projection
      bar-chart.js          bars + trend line + highlight
      callouts.js           device + leader lines + labels
      ui-mockups.js         editor/NLE, IDE window, chat window, video player, cards
      transitions.js        iris(clip-path), matchCut(rect→rect), pushIn, gridSnap(→2×2), flyInto(container→target rect)
      confetti.js
      particles.js          weight-blend morph helpers
      logo3d.js             SVG → ExtrudeGeometry (rotateX(PI) flip), spin-in
  js/scenes/
    index.js                imports scenes in order, builds the master timeline
    00-hook.js              each scene: export default function scene(ctx) { … }
  assets/
    fonts/                  Inter, Anek Bangla, JetBrains Mono (vendored → deterministic, offline render)
    uploads/                user attachments land here
    world-map.json          prebuilt
```

**Tasks**
1. Port the **explainer ad** onto this layout scene by scene (`js/scenes/*.js`), moving shared code into `lib/`. The port must render a visually identical MP4 — that is the acceptance test of the template.
2. Generalize `world.js` (config-driven: which particle targets, which 3D logo, bloom on/off).
3. Make aspect ratio configurable (`W×H` from `project.json`; 1080×1920 for Reels).
4. Vendor fonts (no Google Fonts at render time — determinism, offline).
5. Write `LUMA.md` (the in-project guide the agent reads before editing): engine rules (§3.1–3.6), recipe catalog with one-line usage each, verification checklist, pitfalls (Appendix E).
6. `check.mjs`: static checks the agent runs before rendering.

**Acceptance**
- `npm run voice && npm start` plays the ported explainer with audio in a browser.
- `npm run export` produces an MP4 visually matching `lumademy-explainer-ad/export/lumademy-explainer-ad-1080p60.mp4`.
- A second scene list built only from recipes (e.g. a 15 s map + chart explainer) works without touching `lib/`.

---

## Phase 2 — Runner: commands, project isolation, CPU budget

**Goal:** the agent can run real terminal commands for many projects inside the one container — safely enough for course students, and without ever starving the machine.

**Runner (`apps/api/src/runner`)**
- `exec(projectId, cmd, { timeoutS, env })` → spawns `bash -lc <cmd>` as the unprivileged `luma` user, `cwd = /data/projects/<id>`, streams stdout/stderr, kills the whole process group on timeout or Stop.
- Clean environment: only `PATH`, `HOME=/data/projects/<id>/.home`, `NODE_PATH=/opt/luma/node_modules`, `LANG`. **No app secrets in the env** (no `MASTER_KEY`, no API keys, no DB path).
- Per-command limits with `prlimit`/`ulimit`: max processes, max file size (e.g. 2 GB), CPU time; `nice -n 10` so the web app stays responsive.
- File tools (read/write/edit/list) resolve paths inside the project dir only; reject `..` and symlinks that escape.
- Guard rails (best effort — this is a shared container): the app DB and other projects are owned by root/`app` with `0700`, so the `luma` user can't read them; projects are `luma`-owned only while a command runs in them (or use per-project Unix users if you want stronger separation — see Open questions). Block outbound access to private ranges / cloud metadata with an iptables rule inside the container (needs `NET_ADMIN` at start, dropped after) or simply accept internet-only egress.
- Optional stronger isolation without extra containers: wrap commands with **bubblewrap** (`bwrap`) to give each command a private view of just its project dir — cheap, no daemon.

**Installing packages (per project)**
- Shared base packages (`three`, `gsap`, `d3-geo`, `topojson-client`, `world-atlas`, `playwright`) come from `/opt/luma/node_modules` and are already enough for maps, charts, 3D and rendering. Example from the explainer ad: `d3-geo` + `topojson-client` + `world-atlas` turned Natural Earth data into the SVG world map via `scripts/build-map.mjs`.
- When a video needs something else (e.g. `d3-shape` for curves, `d3-scale`, `@turf/turf` for geo maths, `lottie-web`, `simplex-noise`, a chart library), the agent runs `npm install <pkg>` in the project folder. It lands in the project's own `node_modules` and `package.json`, so it never affects other projects or the shared base.
- Resolution order: project `node_modules` first, then the shared `/opt/luma/node_modules` (via `NODE_PATH` for scripts; for browser code, the project's import map points `/vendor/<pkg>` at the project copy if it exists, else the shared one).
- A shared npm cache (`/data/npm-cache`, `npm_config_cache`) makes repeat installs fast and saves disk; `npm install --ignore-scripts` by default (install scripts only for an allow-list), with a size cap per project.
- Project `node_modules` is in `.gitignore`; `package.json` + lockfile are committed, so a restore can reinstall.
- Python packages work the same way if needed (`pip install --user` into the project's `.home`), but prefer Node.

**CPU budget (`apps/api/src/cpu`)**
- Sample total CPU usage every second (`/proc/stat`, or cgroup `cpu.stat` for the container's own limit).
- Heavy jobs (renders, `preview_frames`, ffmpeg-heavy commands flagged by the tools) take a **slot** from a semaphore. A new slot is granted only while usage < `CPU_BUDGET` (90%); otherwise the job waits in the queue and the UI shows "queued — server busy (position N)".
- Agent chat / LLM calls / file edits never wait (they're I/O-bound).
- The container itself is capped by Docker at ~90% of host cores, so even a burst can't take the whole machine.

**Preview (no dev server per project)**
- The app serves `/data/projects/<id>/public` directly on `PREVIEW_ORIGIN` (plus `/vendor` → `/opt/luma/node_modules`, audio with HTTP Range + 416 handling). Nothing to start or stop per project.

**Acceptance:** two projects run commands at the same time without seeing each other's files; a command that loops forever is killed at its timeout; with CPU artificially loaded above 90%, a render stays queued and starts automatically when load drops.

---

## Phase 3 — Backend core

**Accounts**
- Email + password (argon2id), httpOnly secure session cookie, CSRF protection for mutations. No email verification in v1 (see Open questions). Rate-limit signup/login.

**Projects**
- `POST /api/projects {title, aspect}` → create row, copy `template/scaffold` → `/data/projects/<id>`, `git init`, initial commit "Create empty project". (Round 2: projects start empty; the engine is served, not copied — see "Round 2".)
- List / rename / delete (soft delete, purge job later).
- Git service (server-side `git` CLI on the projects volume): log, diff for a commit, file at commit, **restore** (checkout tree of commit X → new commit "Restore to …").

**Model providers (BYO keys)**
- `provider_configs`: `{ name, base_url, api_key_enc, model, supports_tools, supports_vision, supports_reasoning_stream, context_window }`.
- "Test connection" button: one tiny streaming completion with a dummy tool → auto-detect tool-call support; one image message → detect vision.
- Secrets encrypted with AES-256-GCM using `MASTER_KEY`; decrypted only in-memory inside the agent runtime; **never sent to the browser after save** (show `sk-…abcd`).

**ElevenLabs key** — stored the same way. Voice tools run in the app process, not through the runner, so the key never reaches agent-run commands (protects students from prompt-injection key theft via uploaded PDFs or fetched web pages).

**Uploads**
- `POST /api/projects/:id/uploads` (multipart): SVG, PNG, JPG, WEBP, PDF; size caps (e.g. 20 MB file, 200 MB project).
- Saved to `/data/projects/<id>/assets/uploads/`. PDFs: also extract `*.txt` (pdftotext) and page PNGs (pdftoppm, first N pages) for the model. SVGs: keep as-is for the project, but never serve them on the app origin (preview origin only).

**Preview proxy**
- `GET https://<PREVIEW_ORIGIN>/p/:projectId/:token/*` → served straight from the project's `public/` folder by the app. Short-lived signed token (bound to user + project). Separate origin so project JS can never touch the app's cookies. Iframe `sandbox="allow-scripts allow-same-origin"` on the preview origin only.

**Acceptance:** sign up, add a model, add ElevenLabs key, create a project, upload a PDF, open the preview iframe of the untouched template.

---

## Phase 4 — Agent runtime

**Goal:** a robust tool-calling loop over any OpenAI-compatible model, streaming every step to the UI.

**Loop**
1. Build messages: system prompt (Appendix A, from `packages/prompts`) + project facts (aspect, brand, files tree summary, latest `timing.json` summary, last render) + conversation + new user message (attachments become text/image parts; PDFs as extracted text + page images if the model supports vision).
2. `chat.completions.create({ stream: true, tools, tool_choice: "auto" })` with the user's `base_url`/key/model.
3. Stream deltas → events: `reasoning.delta` (from `delta.reasoning` / `delta.reasoning_content` when the provider sends it), `message.delta`, tool-call argument assembly.
4. Execute tool calls (Appendix B), stream their output as `tool.output.delta`, append results, loop.
5. Stop when the model returns no tool calls, the user presses **Stop** (AbortController → kill running exec), or limits hit (max 80 steps / max tokens per run).
6. End of turn: `git add -A && git commit -m "<turn summary>"` if anything changed → `git.commit` event.

**Robustness**
- Per-tool timeouts (bash default 120 s, render via queue), output truncation (head+tail, 30 KB) with "…truncated" marker, binary-safe reads.
- **Context management:** when near the model's window, summarize older turns into a "project memory" note (store in DB and in `/data/projects/<id>/.luma/memory.md`); always keep the latest user message, plan, and recent tool results.
- Malformed tool JSON → return a tool error so the model can retry; models without tool support are rejected at "Test connection".
- Redact secrets from any tool output before it reaches the model or the UI.
- One active run per project (enforced with a `runs` row in status `running` + an in-memory map; stale runs are reset on api start). Runs survive page reloads: events are persisted, and the UI replays them on reconnect (`Last-Event-ID`).

**Plan visibility:** an `update_plan` tool lets the agent publish a checklist that the UI pins at the top of the chat (like a todo list).

**Acceptance:** with an OpenRouter model, the prompt "make a 15-second map zoom to Dhaka with a Bengali voiceover" produces a committed project that plays in the preview, with every step visible live.

---

## Phase 5 — Frontend

**Stack:** React + Vite + HeroUI (every component: Navbar, Button, Input, Textarea, Card, Tabs, Modal, Dropdown, Select, Chip, Progress, Accordion, Avatar, Tooltip, Toast, Skeleton…). TanStack Query for data, a small event store (Zustand) for the live stream.

**Branding (Lumademy)**
- Colors: **Lumademy Blue `#2970EC` and White are the brand.** Supporting tints only: Sky `#5DAEFF`, Royal `#1557D1`, Deep `#07358F` (gradient end), Off-white `#EFF5FF` (light surfaces). Primary gradient `135deg, #5DAEFF → #2970EC → #1557D1 → #07358F`. **No navy/near-black surfaces** — text on white uses Lumademy Blue or a neutral dark grey for long body text only.
- Fonts: Inter (UI), Anek Bangla (Bengali), JetBrains Mono (code/terminal).
- Logos from the Lumademy brand kit (`Lumademy_All_White.svg` on blue, `Lumademy_Primary_Blue.svg` on white, icon for favicon).
- Configure a HeroUI theme with these tokens: a **white UI with Lumademy-blue** primary actions, highlights and headers (blue gradient for hero areas like auth and empty states). No dark/navy theme in v1.

**Screens**
1. **Auth** — sign up / log in (simple cards on the brand gradient).
2. **Projects** — grid of project cards (thumbnail = last preview frame, last edited), "New project" (title, 16:9 or 9:16).
3. **Project** — two panes:
   - **Left: Chat**
     - Message list. Assistant turns render as a stream of **event cards**:
       - *Thinking* (collapsible, streams live, dimmed),
       - *Plan* (pinned checklist from `update_plan`),
       - *Tool cards* with icon per tool: `bash` shows the command + live terminal output (xterm.js, read-only); `write_file`/`edit_file` show path + `+/-` counts, click → diff modal (react-diff-view or Monaco diff); `generate_voice` shows segments + an audio player; `preview_frames` shows thumbnails; `render_video` shows a progress bar → video player + download,
       - *Ask user* cards with option buttons,
       - final assistant text (markdown).
     - Composer: textarea, drag-and-drop/paste attachments (chips), model selector (from Settings), **Send / Stop**.
   - **Right: Tabs**
     - **Preview** — iframe of the project (play/pause/seek via `postMessage` to `window.ad`), "Capture frame" button.
     - **Files** — tree + read-only Monaco viewer (editing can come later).
     - **Renders** — list of MP4s with player + download.
     - **History** — git commits (message, time, files changed); view diff; **Restore**.
     - **Terminal** — the full command log of the agent for this project.
4. **Settings** — Models (add/test/delete, set default), Voice (ElevenLabs key + default voice id/settings), Account.

**Acceptance:** a student can do the full flow from §0 without any terminal, and sees everything the agent does in real time.

---

## Phase 6 — Rendering pipeline

**Goal:** reliable, fast MP4 renders on servers that may not have GPUs.

- `render_video` tool → inserts a row into `render_jobs` `{ projectId, preset, status: queued }`.
- In-process worker loop (polls every 2 s, claims the oldest `queued` job in a transaction, marks `running`; on restart, `running` jobs go back to `queued`). A job starts only when the CPU budget grants a slot (< 90% usage). It runs `scripts/export-mp4.mjs` against the preview server using **one shared Chromium** (new page per job), optionally **in parallel chunks** (split frames into N ranges with `--from/--to`, N chosen from free CPU), then `ffmpeg concat` + audio mux. Deterministic seek makes chunks seamless.
- Presets: **Draft** 1080p30 (fast, for review) and **Final** 1080p60 (crf 16, preset slow). Also 1080×1920 for 9:16 projects.
- Progress parsing (`i/total frames`) → `render.progress` events → UI progress bar with ETA.
- Output to `/data/projects/<id>/export/<timestamp>-<preset>.mp4`, committed via git LFS **or** excluded from git and tracked in the `renders` table (recommended: exclude large binaries from git; keep audio in git).
- Post-render checks (ffprobe): resolution, fps, duration ≈ timeline, audio present, peak < 0 dBFS; generate a 4-frame contact sheet for the chat card.
- Concurrency: 1 render per user; global concurrency decided by the CPU budget (max `MAX_RENDER_WORKERS`); queue position shown in UI. These videos are light (DOM + modest WebGL), so most renders run immediately.

**Acceptance:** the ported explainer renders Final 1080p60 on the target server in a reasonable time (measure; document the numbers), with live progress, and the MP4 matches the browser preview.

---

## Phase 7 — Quality loop

**Goal:** make mid-tier models produce videos close to what this session produced.

1. **System prompt** (Appendix A) + `LUMA.md` in every project + recipe library. Keep the system prompt focused on workflow and taste; put engine details in `LUMA.md` (the agent reads it at the start of each project).
2. **Frame review tool** (`preview_frames`): the agent requests screenshots at specific times (e.g. each segment's key word). Vision models get the images; non-vision models get a DOM-based report instead (text overlaps via bounding-box intersection, elements outside the stage, empty frames, words still hidden after their word time).
3. **Script review step:** before building, the agent rates its own script "as a viewer" (hook, clarity, pacing, CTA) and fixes weak lines — this mirrors the critique that improved the explainer ad.
4. **Evals (`evals/`)**: golden prompts = the three scripts from this session (+ a few short ones: map-only, chart-only, 9:16 reel). Rubric: hook impact in first 3 s, every beat lands on its word (±100 ms), no overlapping/clipped text, brand-only colors, no Bengali matra "traces", render succeeds, duration within target. Run them for each prompt/template change and for each model you recommend to students.
5. **Recommended models list** in Settings (tested via evals), with a note that tool-calling + long context are required and vision is strongly recommended.

---

## Phase 8 — Hardening & deployment

- **Isolation (shared container):** agent commands run as the unprivileged `luma` user (optionally inside bubblewrap), with a clean env and project-only paths; app data and secrets are root-owned `0700`; Docker caps the container to ~90% CPU; egress blocklist for private ranges + metadata endpoints.
- **Quotas:** 1 running agent per user, 1 render per user, disk per user (e.g. 5 GB), render minutes per day (soft), upload sizes; purge deleted projects after 7 days.
- **Abuse:** signup rate limits, optional hCaptcha on signup, ban switch, per-IP limits on the preview proxy.
- **Secrets:** AES-GCM at rest, `MASTER_KEY` only in env, rotation script; redaction in logs/events.
- **Observability:** pino logs → stdout; basic metrics (runs, tool errors, render durations); error tracking (Sentry or self-hosted GlitchTip).
- **Backups:** nightly `sqlite3 /data/luma.db ".backup …"` (safe while running) + projects volume snapshot.
- **Deploy:** one container on one host, with Caddy/Traefik for TLS on `APP_ORIGIN` and `PREVIEW_ORIGIN`; optional GPU host for rendering later.
- **Licensing check:** confirm third-party licenses fit a hosted generator — GSAP's current license terms (it is free, but check its restrictions on products that build animations for others), Three.js (MIT), fonts (OFL), Natural Earth (public domain), ffmpeg/libx264 (GPL — fine server-side), ElevenLabs terms (students use their own keys).

---

## Appendix A — Agent system prompt (draft)

> Versioned in `packages/prompts/system.md`. `{…}` are filled at runtime.

```
You are Luma, the motion-graphics agent inside Luma Studio by Lumademy. You turn a student's prompt
(and any attached SVGs, images or PDFs) into a polished, word-synced motion-graphics video built with
HTML + GSAP + Three.js, voiced with ElevenLabs, previewed in the browser and rendered to MP4.

## Your environment
- You work inside the student's project, a git repository at /data/projects/<id>, created from the Luma template.
  Read /data/projects/<id>/LUMA.md before your first edit in a project — it documents the engine, the recipe
  library (js/lib/recipes) and the rules. Prefer recipes over writing new infrastructure.
- Tools: bash (node, ffmpeg, git, chromium, internet — runs in your project folder), read_file, write_file, edit_file, list_files,
  update_plan, generate_voice, patch_voice, preview_frames, render_video, ask_user.
- Packages: three, gsap, d3-geo, topojson-client and world-atlas are preinstalled. If a video needs
  more (d3-shape, @turf/turf, simplex-noise…), `npm install <pkg>` inside the project — it stays local
  to this project.
- Project: {aspect} {width}x{height}, brand: {brand_summary}. Attachments: {attachments_summary}.
- Each of your turns is auto-committed to git. Never rewrite git history.

## Workflow
1. Understand: read the prompt and attachments. Ask (ask_user) only if something blocks you —
   otherwise choose sensible defaults and state them.
2. Plan: publish a short checklist with update_plan and keep it updated.
3. Script: write or adapt the voiceover into script.json segments (one segment per scene).
   - Rate it as a viewer before continuing: Is the first 3 seconds a hook? Are examples shown before
     the problem? Are lines punchy statements rather than chains of rhetorical questions? Is the CTA
     concrete? Fix weak lines (if the student supplied an exact script, keep their wording unless they
     asked for improvements — suggest changes instead).
   - TTS text vs screen text: in Bengali voiceovers, write English words in Bengali script for the voice
     (ইউটিউব, এনরোল) and numbers as words; show the English/numerals on screen.
4. Voice: generate_voice (defaults: eleven_v4, language from the script, voice Sarah, speed 1.2;
   add tempo 1.05–1.1 for "fast-paced"). Read timing.json and plan every visual beat on a word.
5. Build scenes in js/scenes/, one file per segment, using w(segment, wordIndex) for all timings.
6. Verify: run `npm run check`, then preview_frames at the key word of every scene. Fix overlapping or
   clipped text, empty frames, elements off-stage, hidden words, colors off-brand. Repeat until clean.
7. Report: what you built, scene by scene in one line each, and list every placeholder (prices,
   counts, data) the student should replace. Offer a render; render Draft first, Final when asked.

## Quality bar (non-negotiable)
- Deterministic: everything is a function of time. Use GSAP tweens on the master timeline or onFrame(t).
  No setTimeout, no per-frame Math.random, no CSS animations for meaningful motion.
- Every beat lands on a word: counters roll on the number, pins drop on "zoom", stamps slam on the key phrase.
- First 3 seconds: start at full energy (impact sound + flash at t=0, rapid cuts on words). Never fade in from black.
- Premium minimal: Lumademy-blue gradient or white stage (no navy/black stages), big type, generous space, masked reveals that settle,
  one accent per moment. Avoid cartoonish props, rainbow colors, clutter, confetti in serious moments.
- Transitions are designed: match cuts, iris into an element, push-ins, grid snaps, fly-into-frame.
  No plain cross-dissolves between scenes; no stripe wipes.
- Brand colors only (from brand.json). Third-party logos keep their own color but never tint the stage.
- Text: Bengali is split by words only (never characters); word reveals fade as they rise.
  Keep all text inside a 64px safe margin; never let captions overlap key visuals.
- Pacing: ~2.2–2.4 spoken words per second for ads; 30–45 s unless asked otherwise.
- Honesty: never present invented numbers, testimonials or claims as real. Mark them as placeholders.

## Editing etiquette
- Make focused edits (edit_file) rather than rewriting large files. Keep the code readable.
- When the student asks for one change ("make the transition after কীভাবে better"), change only that,
  verify it with preview_frames, and say exactly what changed.
- To change one line of the voice, edit its segment and use patch_voice — never regenerate everything.
- If something fails, read the error, fix the cause, and say what happened. Don't claim success
  without verifying.
```

---

## Appendix B — Tool definitions

All tools are JSON-schema function tools in `packages/shared/tools.ts`.

| Tool | Args | Runs in | Returns |
|---|---|---|---|
| `bash` | `command`, `timeout_s?` (≤ 600), `cwd?` | runner (project dir) | stdout/stderr (truncated), exit code; streams live |
| `read_file` | `path`, `offset?`, `limit?` | api (projects volume) | text with line numbers; images → image part (vision) |
| `write_file` | `path`, `content` | api | ok + diff stats → `file.changed` |
| `edit_file` | `path`, `old_string`, `new_string`, `replace_all?` | api | ok/err (must be unique) + diff |
| `list_files` | `path?`, `depth?` | api | tree (ignores node_modules, export) |
| `update_plan` | `items: [{ text, status: todo|doing|done }]` | api | ok → `plan.updated` |
| `generate_voice` | (reads script.json) `segments?` override | api (ElevenLabs) | durations per segment, words count; writes audio + timing.json |
| `patch_voice` | `segment_id` | app + runner ffmpeg | length delta, new word timings |
| `preview_frames` | `times: number[]` (≤ 8), `width?` | shared Chromium (CPU slot) | PNG URLs (+ image parts for vision models) + DOM checks report |
| `render_video` | `preset: draft|final` | api (render loop) | job id; progress events; final MP4 URL + contact sheet |
| `ask_user` | `question`, `options?: string[]` | api | pauses the run until the student answers |
| `web_fetch` | `url` | runner (curl) | text (HTML → markdown), truncated |

Paths are always resolved inside `/data/projects/<id>`; reject `..` escapes and symlinks pointing outside.

---

## Appendix C — Live event protocol

SSE stream: `GET /api/projects/:id/runs/:runId/events` (also persisted in `run_events` for replay).
Every event: `{ id, runId, ts, type, data }`.

| type | data |
|---|---|
| `run.started` | `{ model, userMessageId }` |
| `reasoning.delta` | `{ text }` |
| `message.delta` | `{ text }` |
| `plan.updated` | `{ items }` |
| `tool.call` | `{ callId, name, args }` |
| `tool.output.delta` | `{ callId, stream: stdout|stderr, text }` |
| `tool.result` | `{ callId, ok, summary, truncated }` |
| `file.changed` | `{ path, change: created|modified|deleted, additions, deletions }` |
| `voice.ready` | `{ duration, segments: [{ id, start, end }] , audioUrl }` |
| `preview.frames` | `{ frames: [{ t, url }], issues: [...] }` |
| `render.queued` / `render.progress` / `render.done` | `{ jobId, position? , frame?, total?, eta? , url?, contactSheetUrl? }` |
| `ask_user` | `{ question, options }` |
| `git.commit` | `{ sha, message, files }` |
| `run.error` | `{ message, retryable }` |
| `run.finished` | `{ usage: { input, output }, stopReason }` |

---

## Appendix D — Database schema

```
users(id, email unique, password_hash, created_at)
sessions(id, user_id, expires_at, created_at)
provider_configs(id, user_id, name, base_url, api_key_enc, model, supports_tools, supports_vision,
                 supports_reasoning_stream, context_window, is_default, created_at)
user_secrets(id, user_id, kind = 'elevenlabs', value_enc, created_at)
projects(id, user_id, title, aspect, status, created_at, updated_at, deleted_at?)
messages(id, project_id, role user|assistant, content_json, attachments_json, created_at)
runs(id, project_id, message_id, provider_config_id, status running|finished|stopped|error,
     started_at, finished_at, usage_json)
run_events(id integer primary key autoincrement, run_id, ts, type, data_json)  -- replay + audit
render_jobs(id, project_id, preset, status queued|running|done|error, progress, error, created_at, started_at, finished_at)
uploads(id, project_id, path, mime, size, created_at)
renders(id, project_id, job_id, preset, path, duration, size, created_at)
memories(project_id, summary, updated_at)                       -- context compaction
```

---

## Appendix E — Known pitfalls (learned the hard way)

Put these in `LUMA.md` so the agent avoids them:

1. **RoomEnvironment + bloom = white blob.** Three's `RoomEnvironment` produced values that bloomed into a giant white disc on lit materials. Use a small custom PMREM env scene (gradient sky sphere + a few emissive strips). Keep `NoToneMapping` + `OutputPass` for exact brand colors; bloom threshold ≈ 0.93.
2. **Flipping SVG geometry:** don't mirror with a negative scale; `geometry.rotateX(Math.PI)` keeps faces outward. Use `path.toShapes(true)` (SVGLoader `createShapes` is deprecated).
3. **GSAP `fromTo` renders immediately at build time.** A `fromTo(camera, {z: 24}, …)` placed late in the timeline changed the camera for the whole video. Rule: one `from/fromTo` per property per element (the entrance); exits use `to`. Shared state objects (camera, uniforms) start from a `tl.set` at 0.
4. **CSS transforms on tweened elements.** A CSS `transform: translateY(150%)` plus a GSAP `yPercent` tween left a label off-screen. Let GSAP own transforms; put initial states in `fromTo`.
5. **Descendant selectors hit word spans.** `.caption span { position: absolute }` also matched the injected `.w/.wi` word spans and broke captions. Use child selectors (`.caption > span`).
6. **`calc(var(--h) * 3.8px)` with `--h: 22%` is invalid** → zero-height bars. Keep numeric custom properties unitless.
7. **Bengali "traces".** Masked word reveals let matras (ি, ী) peek above the mask before the word appears. Always fade opacity together with the slide, and pad masks (`padding: .16em .05em .24em`).
8. **Never split Bengali by characters** (conjuncts/vowel signs break). Split by words.
9. **Fonts before canvas sampling.** `await document.fonts.load(...)` before drawing text to canvas for particle targets, and before measuring layout.
10. **Static server + changed audio.** After the voice got shorter, the browser asked for a cached byte range beyond the new file size and crashed the server. Clamp ranges and answer `416` when unsatisfiable.
11. **ElevenLabs `mp3_44100_192` → 403** on non-Creator plans. Use `mp3_44100_128`.
12. **Headless screenshot lag** in some embedded browsers: the first screenshot after a seek can be stale — wait two rAFs (export) or take a throwaway capture (manual checks).
13. **Viewbox math with `preserveAspectRatio="xMidYMid slice"`:** to place DOM pins over SVG map points, compute `k = max(W/vb.w, H/vb.h)` and offsets `(W - vb.w·k)/2`, `(H - vb.h·k)/2`.
14. **Orange glow on blue = purple.** Additive colored glows shift the brand background; keep accents white/blue.
15. **Match cuts need exact geometry.** Compute the on-screen rect of the source element after its transforms (or use `getBoundingClientRect()/stageScale` at build time) so the cut is seamless.

---

## Round 2 — feedback from local testing

Changes made after the product owner ran Phases 0–8 locally with a real model.

1. **New projects start empty.** Chosen architecture: *engine served read-only* (option b). A project holds only its
   own files (`project.json`, `brand.json`, `package.json`, `.gitignore`, `public/css/scenes.css`, later `script.json`,
   `public/js/scenes/*`, `public/audio/*`, `assets/*`). The preview server and the pristine scripts' static server
   resolve every other path (index.html, main.js, world.js, lib/, recipes, base css, fonts, logos, world map) from
   the Studio's `template/`; project files always win, so legacy projects that carry a full copy are untouched.
   Project-owned paths (scenes, audio, scenes.css, root json) never fall back, so an empty project looks empty
   (engine `main.js` shows "Nothing here yet"; tools return "no scenes yet" errors). Why not option (a): copying a
   skeleton still puts ~40 engine files in every project and freezes each project on the engine version it was
   created with; (b) keeps trees tiny, fixes reach every project, and needs no new mechanism for the pristine
   scripts (they already run from the Studio's copy with `--root`). Agent knowledge moved from `template/LUMA.md`
   into `packages/prompts/guide/*.md`, read on demand with the `read_guide` tool (which also reads engine and
   example sources); bash sees the engine read-only at `$LUMA_ENGINE`.

## Open questions (defaults assumed)

| # | Question | Default used in this plan |
|---|---|---|
| 1 | Accounts: email + password only? Email verification? | Email + password, no verification in v1 |
| 2 | Can students download their **project source** (zip) or only MP4s? ("we will not give them the codebase" was about Luma Studio itself) | Allow project zip download |
| 3 | Server specs: CPU cores/RAM, **GPU available?** (decides render speed) | Single CPU-only host; draft renders at 30 fps, parallel chunks |
| 4 | Concurrency target (students online at once) | 1 agent run + 1 render per user; heavy work gated at 90% CPU |
| 5 | Domains for app and preview (must be different origins) | `studio.<domain>` and `preview.<domain>` |
| 6 | UI language: English, Bengali, or both | English UI; content fully Bengali-capable |
| 7 | Any default model/voice credit from Lumademy, or strictly bring-your-own keys? | Strictly BYO |
| 8 | Aspect ratios | 16:9 and 9:16 |
| 9 | Can students edit files / type in the terminal themselves? | Read-only files + terminal log in v1; editing later |
| 10 | Storage/retention per student | 5 GB per user; deleted projects purged after 7 days |
| 11 | Default video brand for students | Each project asks for brand (logo SVG + colors); falls back to a neutral Luma blue palette |
| 12 | Gating to course students (enrollment code) or open signup? | Open signup |
| 13 | Stronger separation between students inside the shared container: plain unprivileged user, bubblewrap per command, or one Unix user per project? | Unprivileged `luma` user + bubblewrap per command |
