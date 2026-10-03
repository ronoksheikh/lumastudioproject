# Prompt for the next Claude Code session (round 2: feedback from local testing)

Copy everything below the line into a new session opened on this repo.

---

You are continuing work on **Luma Studio** (repo root: this folder; read `CLAUDE.md` and `plan.md` first). Phases 0–8 of the plan are built and committed. I (the product owner) have now run it locally with a real model and it works, and the UI looks great. Below is my first round of feedback. Please implement all of it, test it, and commit in logical steps (one commit per numbered item or per small group), pushing to the branch this session gives you. Do not open a PR unless I ask.

Ground rules
- Keep the existing security design intact: per-project unix uid + bubblewrap, path confinement (`runner/paths.ts`), pristine template scripts run by the API with the ElevenLabs key passed on stdin only, CSRF/Origin checks, signed preview origin. Anything new that touches files or the network must go through the same mechanisms.
- Brand: Lumademy blue #2970EC + white, gradient #5DAEFF → #2970EC → #1557D1 → #07358F, no navy/near-black surfaces, Inter / Anek Bangla / JetBrains Mono.
- Existing projects (created with the old demo template) must keep working. If you change the DB schema, add a migration (`pnpm db:generate`).
- Run `pnpm typecheck`, `pnpm test`, `pnpm --filter @luma/web test`, `cd template && npm test`, `pnpm evals:test`, and the browser journey (`pnpm build && pnpm --filter @luma/web e2e /tmp/e2e`). Update the tests that encode the old behaviour (e.g. the e2e flow, project-creation tests) instead of deleting them. Update `CLAUDE.md` and `plan.md` where behaviour changes.
- If something below is ambiguous, pick the simplest reading, say what you assumed in the commit message / final summary, and move on. Ask me only if two readings would lead to very different products.

## 1. New projects start empty (no demo files)

Today `createProject` → `initProjectDir` (`apps/api/src/projects/dirs.ts`) copies the whole `template/` into every project, including the demo scenes (`public/js/scenes/00-title…03-outro`), `examples/explainer`, placeholder audio/timing, starter `script.json`, etc. I want a new project to be **empty of demo content**: the agent builds everything itself.

- The agent must still know how to build good videos without the demo files being copied. Decide the cleanest architecture and explain it in your summary. Options to evaluate (pick one, justify it):
  a. Project gets only the minimal runnable engine skeleton (index.html, `main.js`, `world.js`, `lib/`, recipes, css, scripts, vendor symlinks) but **no scenes, no examples, no audio, no starter script**; the demo scenes/examples live outside the project (e.g. in `template/examples/` inside the Studio) and the agent can *read* them on demand through a read-only path or a `read_reference` tool.
  b. Engine + recipes live once in the Studio image and are served/mounted read-only into every project, so a project only contains its own files (`project.json`, `brand.json`, `script.json`, `public/js/scenes/*`, `public/audio/*`, `assets/*`).
  Whichever you pick, pristine scripts (`generate-voice`, `render`, `preview-frames`, `export-mp4`, `check`) must keep working and keep running from the Studio's own copy.
- An empty project must still open without errors: the Preview pane shows a friendly empty state ("Nothing here yet — tell Luma what video you want") instead of a broken/blank iframe, and `npm run check` / `preview_frames` / `render_video` return clear, actionable errors ("no scenes yet") rather than stack traces.
- The agent's knowledge of the engine (today in `template/LUMA.md`, the recipes list, the pitfalls from plan.md Appendix E, the example scene patterns) must be reachable **on demand** (e.g. `read_file` on a documented reference location, or a `read_guide` tool with topics) and summarized in the system prompt (see item 9). Keep every project's file tree small.
- Add tests: new project tree contains none of the demo files; an agent run on an empty project can scaffold a scene and preview it (mock-LLM test); existing demo projects still open.

## 2. Files tab: some files open blank (e.g. `index.html`)

Clicking `index.html` in the Files tab shows a blank viewer. Reproduce it (look at `apps/web/src/components/FilesPane.tsx`, `apps/web/src/monaco/viewer.ts`, the `GET /api/projects/:id/file` route, and what `readProjectFile` returns for html/large/binary files; I disabled Monaco language services/workers earlier, which may be the cause). Fix it for **every** file type in a project: html, css, js, json, md, svg (show text + a rendered preview toggle), png/jpg/webp (image preview), mp3/mp4 (player), pdf (open/preview), and unknown binary (a clear "can't preview, download" card). Large files should truncate with a notice, not go blank. Add a web test or an e2e step that opens `index.html` and asserts content is visible.

## 3. Terminal tab is blank until the agent runs a command

Make the Terminal tab useful at all times: an empty state explaining what appears there, and **persisted history** — after a reload or when reopening a project, show the previous commands and their output (rebuild from `run_events`, don't lose it). Do **not** build an interactive shell for the student in this round unless you can do it inside the existing sandbox with the same limits as agent commands; if you think it's worth it, propose it in the summary instead of building it.

## 4. Icons: use Phosphor everywhere in the website UI

Replace the hand-rolled/demo icon set (`apps/web/src/components/Icon.tsx` and any inline SVGs) with the **Phosphor icons library** (`@phosphor-icons/react`) across the whole app. Keep one thin `Icon` wrapper if useful, but the glyphs must come from Phosphor (pick a consistent weight, e.g. regular/bold). Check bundle size (tree-shake; import named icons only). Optional, if cheap: make Phosphor SVGs available to the video engine's `icons` helper so the agent can use them in videos instead of inventing icons (vendored, license noted in `docs/licenses.md`).

## 5. Header / navigation cleanup

- The global header (account in the top-right corner, "Luma Studio" / project settings links) is unnecessary inside a project. When a project is open, show **only project-level UI** (back to home, project title/rename, preview/files/history/terminal/renders tabs, run status). Account and Settings stay reachable **from the home page**.
- Make the **home page (projects dashboard) more minimal and better looking**: calm layout, a clear "new video" action, simple project cards (thumbnail from the latest render's contact sheet if there is one, title, last edited), account/settings access somewhere small and unobtrusive. White surface + Lumademy blue accents, generous spacing. Show me the result with screenshots from the e2e run (`/tmp/e2e/*.png`) in your summary.
- Keep the mobile layout working (390px wide).

## 6. Voice: no hard-coded defaults in Settings; the agent chooses

Today Settings → Voice has voice/model/speed defaults and `applyVoiceDefaults` writes them into every new project's `script.json`. Change this:

- Settings → Voice keeps the **ElevenLabs API key** (and test button). Voice id / model / speed / stability etc. become **optional overrides that are empty by default**. If the student fills them in, those values are used for their projects; if blank, nothing is injected.
- When no override is set, the **agent decides**: put the defaults and the decision rules in the system prompt (item 9). The agent needs a way to see what the student's account can actually use, so add a `list_voices` tool (run the ElevenLabs call via a pristine script with the key on stdin, like `generate-voice`; never expose the key). It returns usable voices (name, id, gender/accent/language labels, whether usable on the account's plan) and the agent picks one that fits the video's language and tone.
- **Free-plan awareness**: ElevenLabs free accounts can't use some voices/models via the API. Detect the plan/subscription tier (subscription endpoint) or handle the failure gracefully (clear error → agent retries with a free-plan-safe voice/model). Verify the current model ids, limits and free-plan restrictions against ElevenLabs' docs/API (you have internet now) instead of trusting the ids in the current prompt.
- Remove the old defaults from `settings/`, `projects/service.ts` (`applyVoiceDefaults`), the web Voice tab, and tests; keep behaviour for existing users' saved prefs sensible (treat saved prefs as explicit overrides only if the student changes them).

## 7. "Attach this frame / this time" from the Preview to the chat

In the Preview pane add an **"Attach this frame"** action (button near the playhead/controls; also available when paused at a time). It attaches the **exact timestamp** (e.g. `12.40 s`) to the chat composer as a chip with a small thumbnail (a cheap client-side snapshot is fine, or none).

- On send, the agent receives that time as structured context — **no PNG is saved into the project and the full video is not re-rendered**. Server side, resolve the attachment lazily with the existing single-frame capture path (`projects/capture.ts` / `preview-frames.mjs`, through the CPU budget) and give the agent: (a) the image for vision models, (b) always the text facts at that time from the layout probe (which scene is on, visible text, any overlap/off-stage issues, the active segment/word). Non-vision models must still get useful (b).
- Allow several frames/times per message and show them in the sent message bubble (thumbnail + `t=12.40s`).
- Add tests (mock LLM sees the frame context; no file is added to the project; CPU budget is used).

## 8. Attachments behave like files, and X no longer deletes project files

Current behaviour: an uploaded file stays shown in the composer after sending, and clicking its X **deletes the file from the project**. Wanted:

- Files attached in the chat are uploaded **into the project's files** (a sensible folder such as `assets/uploads/`, visible in the Files tab, referenced to the agent by path) as soon as they're attached/sent, instead of "hanging" in the composer.
- After the message is sent the composer chips clear; the files appear on the sent message (as attachment chips/thumbnails) and in the Files tab.
- The X on a chip in the composer only **detaches it from the pending message**. It must never delete a file that was already sent or that the agent may already use. (If a chip was uploaded but never sent, clean up that orphan — only that.) Deleting project files happens in the Files tab (with a confirmation) or by the agent.
- Keep the existing upload validation (type sniffing, size caps, quotas) and tests; add tests for "X before send removes only the pending upload" and "files survive after send".

## 9. Rewrite the agent's system prompt (this matters most)

Every project now starts blank, so the agent has to be an excellent motion designer *and* know the engine from the prompt + on-demand docs alone. Rewrite `packages/prompts/system.md` (and the on-demand guide it points to) so a mid-tier tool-calling model can reliably produce a polished, word-synced, on-brand video from an empty project. Make it concrete, ordered, and checkable. It should cover at least:

- Role, tools, how the Studio works (live student view, auto-commit each turn, what the preview/render/files tabs are).
- A strict **workflow**: understand → short plan (`update_plan`) → script (hook in the first 3 s, one idea per segment, punchy lines, concrete CTA; student-supplied scripts are kept verbatim) → voice (choose voice per item 6, language handling, Bengali TTS text vs on-screen text) → scaffold scenes → build → verify (`npm run check`, `preview_frames` on every scene incl. just after each transition; treat every reported problem as a bug) → report (scene-by-scene, placeholders to replace) → offer Draft render first.
- **Design principles** with specifics: type scale and safe margins for 16:9 and 9:16, max words on screen, contrast, one accent per moment, spacing, easing choices and durations, how to make beats land on words (`w()`, `wEnd()`, `range()`), transition rules, sound-cue usage, pacing per video type (explainer, product ad, reel, announcement), what to avoid (clutter, rainbow palettes, navy/black stages, cartoon props, per-frame randomness, CSS animations, `setTimeout`).
- The engine contract: file layout the agent creates, the recipes (what each does + a 3–5 line usage example), the timeline pitfalls from plan.md Appendix E (GSAP `fromTo` at build time, visibility vs opacity, Bengali word splitting and mask padding, fonts loading), 9:16 specifics, how to add icons (Phosphor) and images the student attached.
- Quality gates the agent must pass before saying "done", mirroring `evals/rubric.md`.
- Keep the system prompt itself reasonably short (tokens matter for weaker models); put long reference material in the on-demand guide and tell the model exactly when to read each part. Provide 2–3 compact worked examples (a full minimal scene file, a word-synced counter, a 9:16 reel structure).

Then **validate it**: run `evals/run.mjs` against the real model I have configured in Settings → Models (ask me for access or tell me the exact command to run if you don't have a key), compare against the previous prompt on at least 3 golden prompts (`evals/prompts/`), and iterate on the prompt until the automatic checks pass and the videos look good. Report the before/after results in your summary and save the run reports under `evals/results/` (gitignored) — paste the key numbers into the commit message.

## Done when
- All nine items work in the browser against a real model (not only the mock), and the automated tests + e2e pass.
- `CLAUDE.md` / `plan.md` / `docs/` are updated.
- Your final message lists what you changed per item, what you assumed, anything you chose not to do and why, and screenshots of the new home page, a project view without the global header, the Files tab with `index.html` open, the attach-frame flow, and the attachment flow.
