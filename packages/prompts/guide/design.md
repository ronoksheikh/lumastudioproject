# Design — what makes a Luma video look premium

These are the rules the student's course teaches. Apply them by default; the student's explicit wishes win.

## Stage, colour, contrast
- Stage = Lumademy-blue gradient (default world background) or white (`ctx.setStage(t, 'white')`, back with `'blue'`).
  Never navy/near-black stages or black text; deep blue only as the gradient's dark end.
- Palette: blue `#2970EC`, sky `#5DAEFF`, royal `#1557D1`, deep `#07358F`, off-white `#EFF5FF`, ice `#BFE2FF`,
  white. Use the CSS vars (`var(--blue)` …). **One accent per moment** (e.g. one word in sky, everything else white).
- White text on the blue stage; blue (`--royal`/`--deep`) text on white cards/stages. Body text on white may be
  dark grey `#1f2937`. Don't put light-blue text on the blue stage (low contrast).
- Third-party logos keep their own colours but never tint the stage (no coloured glows — orange on blue = purple).

## Type scale (stage pixels)
| | 16:9 (1920×1080) | 9:16 (1080×1920) |
|---|---|---|
| Hero line / hook | 110–160px, weight 800, letter-spacing -0.03em | 120–170px, weight 800 |
| Headline | 72–96px, 700–800 | 84–110px |
| Supporting line | 40–56px, 500–600 | 48–64px |
| Labels / chips | 22–30px, 600, letter-spacing .12–.2em, uppercase Latin | 28–36px |
| Minimum anything | 22px (the layout check flags smaller) | 28px |
- Line-height 1.05–1.15 for big type; `text-wrap: balance` on headlines; Bengali (`.bn`) needs ~1.25 line-height.
- **Max ~7 words on screen at once** for hooks/ads, ~12 for explainers. One idea per frame.

## Layout and spacing
- Safe margins: 16:9 → 96px left/right, 80px top/bottom (never < 64px). 9:16 → 72px left/right, 220px top,
  300px bottom (social UI covers the bottom and top).
- Centre big statements; build layouts on a simple grid (halves/thirds). Generous empty space; nothing touches edges.
- Cards: white, radius 28–40px, soft blue shadow `0 40px 90px rgba(3,20,70,.35)`, padding 40–60px.
- Never overlap text with text; keep captions away from key visuals.

## Motion
- Entrances: `expo.out` / `power3.out`, 0.35–0.6 s. Masked word reveals (slide up through a mask + fade).
- Emphasis: `back.out(1.7–3)` 0.3–0.4 s for pops/stamps; scale 1.3 → 1 punch-ins for hooks.
- Exits: `power2.in` / `power3.in`, 0.2–0.3 s, ending at or just before the scene end (`end - 0.3`).
- Camera moves: `power3.inOut` / `expo.inOut`, 0.7–1.2 s. Linear (`none`) only for slow continuous drifts.
- Things settle — no endless wobble; at most one continuous drift per scene.

## Beats land on words
- Every visible change starts on a word: `w('seg', i)` (start 0.03–0.05 s early so it reads on the syllable),
  `wEnd` to hold until a word finishes, `range` for scene in/out. Counters roll on the number word, pins drop on
  "zoom/here", stamps slam on the key phrase, the CTA button appears on "enrol/join/buy".
- Plan beats from the real `generate_voice` word list; never hard-code seconds for content.
- Rapid-cut hooks: change the visual on (almost) every word of the first segment.

## Transitions
- Designed, motivated cuts: push-in out of the old scene + scale-in of the new; iris into an element; a whole frame
  flying into a screen (match cut); grid snap; a shape that becomes the next scene's background.
- The cut happens on a segment boundary (`range`), ideally on an impact cue. No cross-dissolves, no stripe wipes,
  no "slide the whole scene sideways" PowerPoint moves.

## Sound
- `cue(t, …)` on beats: `impact` (hook frame 0, stamps, big reveals), `whoosh` (transitions, camera moves),
  `pop`/`tick` (items appearing, counters), `shimmer` (positive reveal, logo), `riser` (0.8–1.5 s before a big moment),
  `click` (UI), `glitch` (tech only). Gain 0.3–0.9; at most ~1 cue per second on average.

## Pacing by video type
| Type | Length | Words/s | Shape |
|---|---|---|---|
| Product ad / course ad | 25–40 s | 2.3–2.6 | hook (claim or wow) → examples → problem → solution → proof → CTA |
| Explainer | 30–60 s | 2.0–2.3 | question hook → 3–5 steps, one visual metaphor each → recap → CTA |
| Reel / short (9:16) | 10–25 s | 2.4–2.8 | text-led, a cut on every 1–3 words, numbered structure, loopable end |
| Announcement | 15–25 s | 2.0 | the news in 3 s → what/when/where → CTA; calm, confident |

## Avoid
Clutter, rainbow palettes, gradients in random colours, navy/black stages, cartoon props (padlocks, coins, emoji
piles), drop shadows on text over blue, more than one font family per scene (besides mono labels), per-frame
randomness, CSS animations/transitions, `setTimeout`, fading in from black, slow logo stings at the start, chains of
rhetorical questions, confetti in serious moments, invented numbers presented as real.
