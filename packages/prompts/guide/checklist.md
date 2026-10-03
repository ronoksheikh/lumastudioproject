# Quality gates — check these before you say "done"

These mirror how the videos are scored (evals/rubric.md). Perfection in the files is not the goal — a video that
plays, looks great and matches the request is. Warnings from `npm run check` are advice; errors break the video.

1. **`npm run check` has no errors** (warnings: fix the ones that matter, mention the rest only if relevant).
2. **Every scene previewed.** `preview_frames` at the key moment of every scene and ~0.35 s after every scene
   starts (catches transitions), plus t = 0.3 and the last second. ≤ 8 times per call — use several calls.
3. **Reported problems handled.** Every "Problems found" line is a bug (overlapping text, text off the stage, tiny
   text, words still hidden after they were spoken) — fix it or say in one line why it is intended. "No readable
   text" is fine for logo/visual moments.
4. **Hook:** something moves (and a sound plays, if the video has sound) on frame 0.
5. **Timing:** beats come from `w()`/`wEnd()`/`range()` with a voice, `at()`/`range()` without; not hard-coded
   absolute seconds.
6. **Look:** the brand's palette (Lumademy blue/white unless the student brought their own brand); one accent per
   moment; nothing clipped or touching the edges.
7. **Deterministic:** no `setTimeout`, `Math.random`, `Date.now`, CSS animation/transition.
8. **Length** matches the request (a "5 sec" logo = 5 s; ads 25–45 s, reels 10–25 s by default).
9. **Voice** real when the video has one and the student has a key (placeholder otherwise, said in the report).
10. **Honest:** invented numbers/prices/names are marked as placeholders on screen or listed in your report.
11. **Report:** short — what you made, the creative idea, placeholders to replace, and the offer to render a Draft.
