# Eval rubric

Run `node evals/run.mjs …` (see README) after every change to `packages/prompts/system.md`, `template/` or the
agent tools, and for every model you recommend to students. The script scores the **automatic** checks; score the
**by hand** items by opening each project in the Studio (or the render in `export/`). 0 = fails, 1 = weak,
2 = good, 3 = could ship as is.

## Automatic (evals/score.mjs)

| Check | Passes when |
|---|---|
| `run_completed` / `no_run_errors` | the run ended `completed`, with no `run.error` |
| `tool_failures_low` | ≤ 15 % of tool calls failed (and at most a handful) |
| `npm_check_clean` | the last `npm run check` the agent ran passed |
| `previewed_scenes` | `preview_frames` covered at least one moment per script segment |
| `layout_clean` | the agent's **last** preview reported no overlap / off-stage / hidden-word problems |
| `voice_generated` | real voice (not the placeholder) was generated |
| `render_ok` | a render finished (when one was requested) |
| `duration_in_range` | video length inside the prompt's `target_seconds` |
| `brand_colors_only` | scene code only uses the brand palette hex values |
| `deterministic` | no `setTimeout`, `Math.random`, wall-clock time or CSS animation in scenes |
| `beats_on_words` | at least two timings per segment come from `w()/wEnd()/range()` |
| `guide_before_build` | the agent read the engine guide (`read_guide`) before writing its first scene |
| `verified_after_last_edit` | the last `preview_frames` came after the last scene edit (no unverified changes) |
| `voice_chosen` | the voice was chosen with `list_voices` (or the placeholder was used because there is no key) |

## By hand

1. **Hook (first 3 s).** 0 = slow fade / logo sting · 1 = text appears but nothing moves · 2 = motion and sound on
   the first word · 3 = impact + flash at t = 0, rapid cuts on words, no dead frame.
2. **Beats land on their word (±100 ms).** Scrub to five key words: counter rolls on the number, pin drops on
   "zoom", stamp slams on the key phrase. Deduct one point per visibly late/early beat (min 0).
3. **No overlapping or clipped text** at any moment of the render. Zero tolerance: 3 only if none found.
4. **Bengali.** No matra "traces" peeking out of word masks, no broken conjuncts, English/numerals on screen where
   the voice says Bengali words.
5. **Brand.** Lumademy-blue gradient or white stage, no navy/black stage, one accent per moment, no rainbow.
6. **Polish.** Easing settles, nothing jitters, transitions are hidden by motion, the end card is clean.
7. **Script fit.** When the student supplied an exact script: wording untouched. Otherwise: punchy statements, a
   concrete CTA.

A model/prompt change is a regression if any automatic check that passed before now fails on the same prompt, or
the by-hand total of a prompt drops by 2 or more.

## Recommending a model

A model goes on the Settings "recommended" list only if, over all six prompts, it passes ≥ 11 of 14 automatic
checks on average, never ends a run in `error`, and averages ≥ 2 on hook, beats and overlap.
