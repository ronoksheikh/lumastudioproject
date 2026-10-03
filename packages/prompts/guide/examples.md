# Examples — copy these patterns

All three are tested: `npm run check -- --page` passes and `preview_frames` reports no problems.
The finished example projects that ship with the engine are listed at the end.

## A. A full minimal 16:9 video (hook → word-synced counter → white end card)

`script.json` segments: `hook` "One prompt. One finished video." · `learners` "Already two point four million
learners use Lumademy." · `cta` "Make yours today."

`public/js/scenes/index.js`
```js
import { makeContext } from '../lib/timeline.js';
import hook from './00-hook.js';
import learners from './01-learners.js';
import cta from './02-cta.js';

const SCENES = [hook, learners, cta];

export async function buildTimeline(args) {
  const ctx = makeContext(args);
  ctx.initWorld({ night: 0, jitter: 0.35, particles: 0.14 });
  for (const scene of SCENES) await scene(ctx);
  return ctx.finish();
}
```

`public/js/scenes/00-hook.js` — impact on frame 0, words punch in on their words, push-in out
```js
// Hook: impact on frame 0, every word punches in on its spoken word, push-in out.
import { q } from '../lib/core.js';
import { punchWords } from '../lib/recipes/kinetic-type.js';
import { pushIn } from '../lib/recipes/transitions.js';

export default function hook(ctx) {
  const { tl, w, cue, flash, shake, show, add } = ctx;
  const [start, end] = ctx.range('hook');
  const s = add(`<div class="scene s-hook">
      <div class="h-line en">One prompt.</div>
      <div class="h-line h-accent en">One finished video.</div>
    </div>`);
  show(s, start, end);
  flash(0, 0.8, 0.4); shake(0, 1); cue(0, 'impact', 1);       // full energy on frame 0
  const [l1, l2] = ctx.qa(s, '.h-line');
  punchWords(ctx, l1, 'hook', 0);                               // "One prompt." = words 0–1
  punchWords(ctx, l2, 'hook', 2);                               // "One finished video." = words 2–4
  tl.fromTo(l2, { scale: 0.92 }, { scale: 1, duration: 0.6 }, w('hook', 2));
  cue(w('hook', 2), 'whoosh', 0.5);
  pushIn(ctx, s, { at: end - 0.3 });
}
```

`public/js/scenes/01-learners.js` — **the counter rolls exactly while "two point four million" is spoken**
(word indices are written down from the generate_voice result; the invented number is flagged)
```js
// Word-synced counter: the number rolls exactly while "two point four million" is spoken.
import { q } from '../lib/core.js';
import { phosphor } from '../lib/icons.js';
import { countUp, fmt } from '../lib/recipes/counter.js';

export default async function learners(ctx) {
  const { tl, w, wEnd, cue, show, add } = ctx;
  const [start, end] = ctx.range('learners');
  const icon = await phosphor('users-three', 'fill');
  const s = add(`<div class="scene s-learners">
      <div class="l-icon">${icon}</div>
      <div class="l-num en">0</div>
      <div class="l-cap en">learners use Lumademy</div>
      <div class="l-note mono">PLACEHOLDER NUMBER</div>
    </div>`);
  show(s, start, end);
  tl.fromTo(q(s, '.l-icon'), { scale: 0, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.4, ease: 'back.out(2)' }, start);
  // words: 0 Already 1 two 2 point 3 four 4 million 5 learners 6 use 7 Lumademy.
  const tNum = w('learners', 1);
  tl.fromTo(q(s, '.l-num'), { opacity: 0, y: 30 }, { opacity: 1, y: 0, duration: 0.3 }, tNum - 0.05);
  countUp(ctx, q(s, '.l-num'), { to: 2.4, at: tNum, dur: wEnd('learners', 4) - tNum, format: fmt.millions(1) });
  cue(wEnd('learners', 4), 'pop', 0.7);
  const cap = q(s, '.l-cap');
  tl.fromTo(cap, { opacity: 0, y: 20 }, { opacity: 1, y: 0, duration: 0.4 }, w('learners', 5));
  tl.to([...s.children], { opacity: 0, y: -30, duration: 0.25, ease: 'power2.in' }, end - 0.25);
}
```

`public/js/scenes/02-cta.js`
```js
// CTA on a white stage: masked words + the brand lockup.
import { q } from '../lib/core.js';
import { maskedWords } from '../lib/recipes/kinetic-type.js';

export default function cta(ctx) {
  const { tl, w, cue, show, add, setStage } = ctx;
  const [start, end] = ctx.range('cta');
  const s = add(`<div class="scene s-cta">
      <div class="c-line en">Make yours today.</div>
      <img class="c-logo" src="assets/Lumademy_Icon_Blue.svg" alt="" />
    </div>`);
  show(s, start, end);
  setStage(start - 0.2, 'white');                              // white stage (+ no vignette) for the end card
  cue(start, 'shimmer', 0.6);
  maskedWords(ctx, q(s, '.c-line'), 'cta', 0);
  tl.fromTo(q(s, '.c-logo'), { scale: 0.6, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.5, ease: 'back.out(1.7)' }, w('cta', 2));
}
```

`public/css/scenes.css`
```css
.s-hook .h-line { position: absolute; left: 96px; right: 96px; text-align: center; font: 800 140px/1.05 var(--font-display); letter-spacing: -0.03em; }
.s-hook .h-line:first-child { top: 330px; }
.s-hook .h-accent { top: 500px; color: var(--ice); }

.s-learners .l-icon { position: absolute; left: 0; right: 0; top: 230px; display: flex; justify-content: center; font-size: 96px; color: var(--ice); }
.s-learners .l-num { position: absolute; left: 0; right: 0; top: 360px; text-align: center; font: 900 220px/1 var(--font-display); letter-spacing: -0.04em; }
.s-learners .l-cap { position: absolute; left: 0; right: 0; top: 620px; text-align: center; font: 600 56px/1.2 var(--font-display); }
.s-learners .l-note { position: absolute; left: 0; right: 0; top: 720px; text-align: center; font-size: 24px; letter-spacing: 0.2em; color: var(--ice); }

.s-cta { color: var(--royal); }
.s-cta .c-line { position: absolute; left: 96px; right: 96px; top: 400px; text-align: center; font: 800 120px/1.1 var(--font-display); letter-spacing: -0.03em; }
.s-cta .c-logo { position: absolute; left: 50%; top: 620px; width: 140px; margin-left: -70px; }
```

## B. A 9:16 reel structure (Bengali, numbered list, loopable end)

`script.json`: `model_id` `eleven_v3`, `language_code` `bn`, `tempo` 1.05; segments `hook` "তিনটি এআই টুল, এডিটিং
সময় অর্ধেক।" · `one` "এক, অটো ক্যাপশন।" · `two` "দুই, এক ক্লিকে ব্যাকগ্রাউন্ড সরান।" · `three` "তিন, এআই ভয়েসওভার।" ·
`follow` "আরও টিপসের জন্য ফলো করুন।"

`public/js/scenes/index.js` — one scene function reused for the three items
```js
import { makeContext } from '../lib/timeline.js';
import hook from './00-hook.js';
import { item } from './01-item.js';
import follow from './02-follow.js';

// one reusable scene function for the three numbered items
const SCENES = [
  hook,
  (ctx) => item(ctx, 'one', '১', 'Auto captions', 'closed-captioning'),
  (ctx) => item(ctx, 'two', '২', 'Remove backgrounds', 'magic-wand'),
  (ctx) => item(ctx, 'three', '৩', 'AI voice-over', 'microphone'),
  follow,
];

export async function buildTimeline(args) {
  const ctx = makeContext(args);
  ctx.initWorld({ night: 0, jitter: 0.35, particles: 0.14 });
  for (const scene of SCENES) await scene(ctx);
  return ctx.finish();
}
```

`public/js/scenes/00-hook.js`
```js
// 9:16 hook: the title IS the hook — Bengali words punch in on their spoken words (split by words, never chars).
import { q } from '../lib/core.js';
import { punchWords } from '../lib/recipes/kinetic-type.js';

export default function hook(ctx) {
  const { flash, shake, cue, show, add, wordsOut } = ctx;
  const [start, end] = ctx.range('hook');
  const s = add(`<div class="scene s-hook"><div class="h-title bn">তিনটি এআই টুল, এডিটিং সময় অর্ধেক।</div></div>`);
  show(s, start, end);
  flash(0, 0.8, 0.4); shake(0, 1); cue(0, 'impact', 1);
  punchWords(ctx, q(s, '.h-title'), 'hook', 0); // on-screen words = spoken words here
  wordsOut(s, end - 0.25);
}
```

`public/js/scenes/01-item.js`
```js
// One numbered item: big Bengali numeral on the number word, icon + Latin tool name on the next word.
import { q } from '../lib/core.js';
import { phosphor } from '../lib/icons.js';

export async function item(ctx, id, numeral, name, icon) {
  const { tl, w, cue, show, add, wordsOut } = ctx;
  const [start, end] = ctx.range(id);
  const svg = await phosphor(icon, 'fill');
  const s = add(`<div class="scene s-item">
      <div class="i-num bn">${numeral}</div>
      <div class="i-icon">${svg}</div>
      <div class="i-name en">${name}</div>
    </div>`);
  show(s, start, end);
  tl.fromTo(q(s, '.i-num'), { scale: 1.6, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.35, ease: 'back.out(2)' }, w(id, 0) - 0.03);
  cue(w(id, 0), 'pop', 0.8);
  tl.fromTo(q(s, '.i-icon'), { y: 40, opacity: 0 }, { y: 0, opacity: 1, duration: 0.4 }, w(id, 1) - 0.03);
  tl.fromTo(q(s, '.i-name'), { y: 40, opacity: 0 }, { y: 0, opacity: 1, duration: 0.4 }, w(id, 1) + 0.05);
  cue(w(id, 1), 'whoosh', 0.4);
  wordsOut(s, end - 0.22);
}
```

`public/js/scenes/02-follow.js`
```js
// Loop-friendly ending on a white stage; holds ≥ 1.5 s.
import { q } from '../lib/core.js';
import { maskedWords } from '../lib/recipes/kinetic-type.js';

export default function follow(ctx) {
  const { show, add, setStage, cue } = ctx;
  const [start, end] = ctx.range('follow');
  const s = add(`<div class="scene s-follow"><div class="f-line bn">আরও টিপসের জন্য ফলো করুন।</div></div>`);
  show(s, start, end);
  setStage(start - 0.2, 'white');
  cue(start, 'shimmer', 0.6);
  maskedWords(ctx, q(s, '.f-line'), 'follow', 0);
}
```

`public/css/scenes.css`
```css
/* 9:16 — stage 1080×1920, safe area x 72–1008, y 220–1620 */
.s-hook .h-title { position: absolute; left: 72px; right: 72px; top: 620px; text-align: center; font: 700 132px/1.25 var(--font-bn); text-wrap: balance; }

.s-item .i-num { position: absolute; left: 0; right: 0; top: 420px; text-align: center; font: 800 360px/1 var(--font-bn); color: var(--ice); }
.s-item .i-icon { position: absolute; left: 0; right: 0; top: 900px; display: flex; justify-content: center; font-size: 150px; }
.s-item .i-name { position: absolute; left: 72px; right: 72px; top: 1100px; text-align: center; font: 800 96px/1.1 var(--font-display); letter-spacing: -0.02em; text-wrap: balance; }

.s-follow { color: var(--royal); }
.s-follow .f-line { position: absolute; left: 72px; right: 72px; top: 760px; text-align: center; font: 700 120px/1.25 var(--font-bn); text-wrap: balance; }
```

## C. Bundled example projects (read their files for bigger patterns)

| Example | What it shows |
|---|---|
| `examples/starter/` | 15 s English: impact hook (`scenes/00-title.js`), map zoom to a city pin (`01-map.js`), bar chart + counter (`02-chart.js`), 3D logo end card (`03-outro.js`) |
| `examples/explainer/` | 30 s Bengali ad, fast pacing: rapid-cut hook montage → 2×2 grid → fly into a preview (`00-hook.js`), counters (`01-ten.js`), map (`02-map.js`), graph (`03-graph.js`), UI mockups (`04-youtube.js`), split screen (`05-paths.js`), stamp (`06-you.js`), end card (`08-end.js`) |

Read one with `read_guide("examples/explainer/scenes/00-hook.js")`. `npm run example <name>` replaces the project's
scenes, styles, script and audio with an example — only when the student asks to start from one.
