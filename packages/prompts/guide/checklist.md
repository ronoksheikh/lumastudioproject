# Quality gates — pass all of these before you say "done"

These mirror how the videos are scored (evals/rubric.md).

1. **`npm run check` is clean** (errors = 0). Run it after every round of scene edits.
2. **Every scene previewed.** `preview_frames` at (a) the key word of every scene and (b) ~0.35 s after every scene
   starts (catches transitions), plus t = 0.3 and the last second. ≤ 8 times per call — use several calls.
3. **Zero reported problems** in your last `preview_frames` round. Every "Problems found" line is a bug: overlapping
   text, text off the stage, tiny text, empty frames, words still hidden after they were spoken. Fix and re-check, or
   explain in one line why one is intentional. ("No readable text" before the first spoken word is fine.)
4. **Hook:** something moves and a sound plays on frame 0; the first visual change happens by the first word.
5. **Beats on words:** ≥ 2 timings per scene come from `w()` / `wEnd()` / `range()`; no hard-coded seconds for content.
6. **Brand:** only palette colours in scenes.css and scene files; blue or white stage; one accent per moment.
7. **Deterministic:** no `setTimeout`, `Math.random`, `Date.now`, CSS animation/transition.
8. **Length** within the target (ads 25–45 s, reels 10–25 s unless the student asked otherwise).
9. **Real voice** generated (not the placeholder) when the student has an ElevenLabs key.
10. **Honest:** invented numbers/prices/names are marked as placeholders on screen or listed in your report.
11. **Report:** one line per scene, the placeholders to replace, the voice used, and the offer to render a Draft.
