# LUMA.md — how this project works

You are editing a **Luma motion-graphics project**: a deterministic, word-synced video built from HTML + GSAP + Three.js, voiced with ElevenLabs, previewed in a browser and rendered to MP4. Read this file once before your first edit. Prefer the **recipes** in `public/js/lib/recipes/` over writing new infrastructure, and **never edit `public/js/lib/`, `public/js/main.js`, `public/js/world.js`, `public/js/sfx.js`, `public/css/base.css` or `public/css/recipes.css`** unless the student asked for an engine change — put your work in `public/js/scenes/`, `public/css/scenes.css`, `script.json`, `project.json`, `brand.json` and `assets/`.

## 1. Files

```
project.json        { title, aspect: "16:9"|"9:16", fps, tail, features?: { particles, logo3d, bloom } }
brand.json          colors, fonts, logo paths (defaults: Lumademy blue palette)
script.json         voice settings + segments (one segment per scene): the words the VOICE says
public/audio/       voiceover.mp3 + timing.json  (generated — never edit by hand)
public/js/scenes/   index.js (scene list) + NN-name.js (one file per scene)   ← you write these
public/css/scenes.css                                                         ← and these styles
public/js/lib/      engine helpers + recipes (read-only for you)
assets/             logos, fonts (vendored), uploads/ (student attachments), world-map.json
examples/           finished example projects; `npm run example <name>` swaps one in (replaces scenes!)
```

Commands (run in the project folder):

| Command | What it does |
|---|---|
| `npm run voice` | script.json → ElevenLabs → `public/audio/{voiceover.mp3,timing.json}` (`-- --placeholder` = silent dry run) |
| `npm run patch-voice <segmentId>` | re-record ONE segment after editing its text; later timings shift automatically |
| `npm run check` | static lint: timing matches script, every `w('seg', n)` exists, no nondeterminism, assets exist (`-- --page` also builds the page in Chrome) |
| `npm run map` | rebuild `assets/world-map.json` (`-- --highlight 050 --city 90.41,23.81`; ISO numeric ids) |
| `npm start` | static server on :5173 for manual preview |
| `npm run export` | render MP4: `-- --quality draft|final --fps N --scale S --from A --to B` |

## 2. The engine in five rules

1. **Everything is a function of time `t`.** One paused GSAP master timeline (`ctx.tl`) is sought to `t` every frame, then `onFrame(t)` hooks run, then Three.js renders. This is what makes frame-exact export (and parallel render chunks) possible.
   **Never** use `setTimeout`, `setInterval`, `requestAnimationFrame`, `Date.now()`, `Math.random()` (use `rand(i, k)`), or CSS `animation`/`transition` for anything that matters. `npm run check` rejects them.
2. **Every beat lands on a word.** `ctx.w('segmentId', wordIndex)` returns that word's start time in seconds (negative index counts from the end; `ctx.wEnd` gives the end). Read `public/audio/timing.json` after generating the voice, and plan visuals against real word times — not guesses.
3. **Scene = a segment.** `ctx.range('seg')` → `[start, end]` (end = next segment's start). A scene file builds its DOM with `ctx.add(html)`, shows it with `ctx.show(node, start, end)`, and puts tweens on `ctx.tl` at word times.
4. **One layer stack** (1920×1080, or 1080×1920 for 9:16): WebGL canvas (blue gradient background, particles, 3D logo) → `#scenes` (your DOM) → `#fx` (flash, grain, vignette) → captions.
5. **GSAP owns transforms.** Put initial states in `fromTo`, not in CSS `transform`. One `from/fromTo` per property per element (the entrance); exits use `to`. Shared state objects (camera, uniforms) start from a `tl.set` at 0.

## 3. Anatomy of a scene

```js
// public/js/scenes/02-benefits.js
import { q, qa, splitWords } from '../lib/core.js';
import { maskedWords } from '../lib/recipes/kinetic-type.js';

export default function benefits(ctx) {
  const { tl, w, cue, flash, shake, show, add, wordsOut } = ctx;
  const [start, end] = ctx.range('benefits');            // segment id from script.json
  const s = add(`<div class="scene s-benefits">
      <div class="b-title en">Three reasons</div>
    </div>`);
  show(s, start, end);                                   // visible only during its segment
  maskedWords(ctx, q(s, '.b-title'), 'benefits', 0);     // each word slides in on its spoken word
  flash(w('benefits', 2), 0.3);                          // a beat on the 3rd word
  cue(w('benefits', 2), 'impact', 0.8);                  // sound effect at the same time
  wordsOut(q(s, '.b-title'), end - 0.3);
}
```
Then add it to `public/js/scenes/index.js` (`import` + the `SCENES` array). Scenes may be `async` (e.g. `await loadMap(ctx)`).

### `ctx` reference

| Member | Meaning |
|---|---|
| `tl` | master GSAP timeline (paused). `tl.fromTo(node, from, to, time)` |
| `w(id, i)` / `wEnd(id, i)` | start / end time (s) of word `i` of segment `id` |
| `range(id)` / `S[id]` | `[start, end]` / the segment `{start,end,words}` |
| `END`, `W`, `H`, `size` | total length, stage width/height |
| `add(html)` → node, `show(node, from, to)` | create a scene, toggle visibility |
| `wordIn(span, t)`, `reveal(spans, id, offset)`, `wordsOut(node, t)` | masked word reveal / exit |
| `flash(t, peak, dur)`, `shake(t, amount, dur)`, `cue(t, type, gain)` | white flash, camera+scene shake, sound effect |
| `onFrame(fn(t))` | per-frame hook (deterministic only!) |
| `st` (camera/logo state), `P` (particle uniforms), `BG` (background uniforms) | tween these with `tl` — e.g. `tl.to(BG.uWhite, {value:1}, t)` white stage, `BG.uNight` deep-blue stage |
| `brand`, `project` | parsed brand.json / project.json |
| `initWorld(opts)` | called once from `scenes/index.js` to set the starting world state |

Sound effect types for `cue`: `impact`, `whoosh`, `pop`, `tick`, `click`, `riser`, `shimmer`, `glitch`. Gain 0–1. Keep them under the voice.

### `lib/core.js`

`el(html)`, `q(node, sel)`, `qa(node, sel)`, `splitWords(node)` (Bengali-safe, returns `.wi` spans), `splitChars(node)` (**Latin only**), `rand(i, k)`, `bnNum(n)` (১২৩), `withCommas(n)`, `clamp`, `lerp`, `icons` (arrow, play, pause, spark, person, clock, star, pin, camera, brief, check, lens).

## 4. Recipes (public/js/lib/recipes/)

Import what you need: `import { … } from '../lib/recipes/<file>.js'`. All take `ctx` first.

| File | Exports | Use it for |
|---|---|---|
| `kinetic-type.js` | `maskedWords(ctx, node, id, offset)`, `punchWords(…)`, `stamp(ctx, node, t, opts)`, `stampMarkup(icon, text, {cls})` | headlines that appear word by word; hooks (punch-in); a stamp slamming on the key phrase |
| `counter.js` | `countUp(ctx, node, {to, from, at, dur, ease, format})`, `fmt.millions(1)`, `fmt.thousands`, `progressBar(ctx, fill, {at, dur})` | numbers that roll on the number word; progress bars |
| `map-zoom.js` | `loadMap(ctx)`, `mapMarkup(map)`, `pinMarkup()`, `mapCamera(ctx, svg, map, {from, to, overlays})` → `{vb, view(w,x,y), toPx, world(), flyTo}`, `mapPoints(map)` | world → region → city zoom with pins/cards that follow map coordinates. Needs `assets/world-map.json` (`npm run map`) |
| `bar-chart.js` | `barChart({title, chip, values, labels, valueFmt, lang, cls})` → `{html, animate(ctx, root, {at, labelsAt, trendAt, focusAt, focus})}` | bars + trend line + headline chip + "focus on the winner" |
| `callouts.js` | `calloutsMarkup({items})`, `animateCallouts(ctx, root, {at})`, `PHONE_CALLOUTS` | device with leader lines and labels |
| `ui-mockups.js` | `ideWindow({title, lines, prompt})` + `animateIde`, `videoPlayer({screen, time})`, `channelRow({name, stats})` | "this is how it's made" code window; a video player / channel UI |
| `transitions.js` | `flyInto(ctx, node, {x,y,width}, {at})`, `gridSnap(ctx, nodes, {at, tiles})`, `iris(ctx, node, {at, cx, cy, dir})`, `pushIn`, `matchCut`, `stageRect(ctx, node)` | designed transitions (match cut, iris into an element, grid snap, fly into a frame) |
| `particles.js` | `morph(ctx, t, 'scatter'|'sphere'|'logo'|'ring'|'text', {dur, ease, opacity, jitter, spin})`, `particlesTo(ctx, t, opacity)` | the 9,000-particle cloud morphing between shapes (`await ctx.world.setTextTarget('AI')` first for `'text'`) |
| `logo3d.js` | `logoIn(ctx, t, {x, y, size})`, `logoOut(ctx, t)` | the extruded 3D brand mark landing in 3D |
| `confetti.js` | `createConfetti(ctx)` → `burst(t, x, y, power)` | celebrations only — never in serious moments |

Recipe markup uses `rc-*` classes defined in `recipes.css`. Position and size recipe blocks with **your own class** in `scenes.css` (e.g. `.c-card { position:absolute; left:50%; top:250px; … }`); don't edit `recipes.css`.

Working examples: `public/js/scenes/` is a small starter built only from recipes; `examples/explainer/` is a full 30 s Bengali explainer (hook montage → grid → fly-into-preview, map zoom, graph, UI mockups, split-screen, stamp, 3D logo end card).

## 5. Script & voice

- `script.json` → `segments: [{ id, text }]`, one per scene. `text` is what the **voice** says; on-screen text is written separately in the scene.
- Voice defaults: model `eleven_v4`, voice Sarah `EXAVITQu4vr4xnSDxMaL`, `speed` 1.15–1.2, `voice.tempo` 1.05–1.1 for fast ads (ffmpeg time-stretch; timestamps are rescaled for you). Output is `mp3_44100_128`.
- With `language_code: "bn"` write English words in Bengali script for the voice (ইউটিউব, এনরোল, ক্লায়েন্ট) and numbers as words (দশজন), but show Latin/numerals on screen.
- After changing a segment's text, run `npm run patch-voice <id>` (one line) — don't regenerate everything. Check `timing.json` for the real word times.
- Pacing: ~2.2–2.4 spoken words per second for ads; 30–45 s total unless asked otherwise.

## 6. Creative rules (quality bar)

1. **The first 3 seconds decide everything.** Open at full energy: a flash + impact at `t=0`, rapid cuts on words, the strongest claim first. Never fade in from black.
2. **Wow before problem.** Show the examples first, then "but until now this was hard", then the solution.
3. **Punchy statements, not chains of rhetorical questions.**
4. **Premium minimal.** Lumademy-blue gradient or white stage, big type, generous space, masked reveals that settle, one accent per moment. No cartoon props, no rainbow colors, no clutter, no confetti in serious moments.
5. **Transitions are designed**: match cuts, iris into an element, push-ins, grid snaps, fly-into-frame. No plain cross-dissolves, no stripe wipes.
6. **Brand colors only** (`brand.json`): blue `#2970EC` with its gradient `#5DAEFF → #2970EC → #1557D1 → #07358F`, and white. Don't use navy/near-black stages or text (dark blue only as the gradient's deep end). Third-party logos keep their own color but never tint the stage — an orange glow turns the blue purple.
7. **Every beat lands on a word** (counters roll on the number word, pins drop on "zoom", stamps slam on the key phrase).
8. **Honesty**: never present invented numbers, testimonials or claims as real. Mark prices, view counts, subscriber numbers as **placeholders** in the scene and tell the student.
9. Text stays inside a 64px safe margin; captions never cover key visuals.

## 7. Verification checklist (do this before saying "done")

1. `npm run check` is clean (`-- --page` to prove the page builds).
2. Look at frames at the key word of **every scene** (the Studio's `preview_frames` tool, or open `npm start` and use `?t=<seconds>`; `?captions` shows word captions). Fix: overlapping or clipped text, empty frames, elements off the stage, words still hidden after their time, off-brand colors.
3. Confirm the first 3 seconds, every scene change, and the last frame.
4. Render a **draft** first (`npm run export -- --quality draft --fps 30`), the final only when the student asks.
5. Report what you built scene by scene, and list every placeholder the student should replace.

## 8. Known pitfalls (learned the hard way)

1. **RoomEnvironment + bloom = white blob.** The world uses a custom PMREM env scene; keep `NoToneMapping` + `OutputPass`, bloom threshold ≈ 0.93.
2. **Flipping SVG geometry:** never mirror with a negative scale; `geometry.rotateX(Math.PI)`. Use `path.toShapes(true)`.
3. **GSAP `fromTo` renders immediately at build time.** A `fromTo(camera, {z: 24}, …)` placed late in the timeline changed the camera for the whole video. One `from/fromTo` per property per element; exits use `to`; shared state starts from `tl.set` at 0.
4. **CSS transforms on tweened elements.** `transform: translateY(150%)` in CSS plus a GSAP `yPercent` tween left a label off-screen. Let GSAP own transforms.
5. **Descendant selectors hit word spans.** `.caption span { position: absolute }` also matches the injected `.w/.wi` spans. Use child selectors (`.caption > span`).
6. **`calc(var(--h) * 3.8px)` with `--h: 22%` is invalid** → zero-height bars. Keep numeric custom properties unitless.
7. **Bengali "traces".** Masked word reveals let matras (ি, ী) peek above the mask early. Fade opacity together with the slide (the helpers do) and pad masks (`padding: .16em .05em .24em`).
8. **Never split Bengali by characters** (conjuncts/vowel signs break). Split by words (`splitWords`).
9. **Fonts before canvas sampling.** `await document.fonts.load(...)` before drawing text to canvas for particle targets or measuring layout (main.js already waits for the vendored fonts).
10. **Static server + changed audio:** clamp byte ranges and answer 416 (server.mjs does).
11. **ElevenLabs `mp3_44100_192` → 403** on non-Creator plans. Use `mp3_44100_128`.
12. **Headless screenshot lag:** the first screenshot after a seek can be stale — wait two `requestAnimationFrame`s (export does).
13. **`preserveAspectRatio="xMidYMid slice"` math:** to place DOM pins over SVG map points compute `k = max(W/vb.w, H/vb.h)` and offsets `(W - vb.w·k)/2`, `(H - vb.h·k)/2` — `mapCamera().toPx` does it.
14. **Orange glow on blue = purple.** Additive colored glows shift the brand background; keep accents white/blue.
15. **Match cuts need exact geometry.** Use `stageRect(ctx, node)` to read an element's on-screen rect at build time instead of guessing.
16. **Portrait (9:16):** the stage is 1080×1920 — the starter's px layout is for 16:9, so re-lay out scenes (single column, bigger type). 3D content auto-fits.
17. **`show()` owns a scene's `visibility`** (it only toggles `visibility`, never opacity) — so tween the scene's children or its opacity freely, but never `tl.set(scene, { visibility … })` yourself or add a second set/`autoAlpha` on the same property at an overlapping time.
18. **Use relative URLs everywhere** (`assets/logo.svg`, `audio/…`, `vendor/gsap/…` — no leading `/`). The Studio serves the project under `/p/<id>/<token>/`, so root-absolute URLs would escape it.
19. **Extra npm packages:** `npm install <pkg>` here, then map it in the `importmap` in `public/index.html` (`"<pkg>": "./vendor/<pkg>/<entry>.js"`). `three` and `gsap` are already available.
