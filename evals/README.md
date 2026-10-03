# Evals

Golden prompts (`prompts/*.json`) + rubric (`rubric.md`) for judging a prompt, template or model change.

- `explainer-ad`, `ai-motion-ad`, `claude-pro-ad` — the three reference ads' exact Bengali scripts.
- `map-only`, `chart-only`, `reel-9x16` — short single-recipe prompts, the last one 9:16.

```
node evals/run.mjs --url http://localhost:8080 --email you@example.com --password '…' \
     --model "My Model" [--prompts map-only,chart-only] [--render draft|final|none] [--timeout 45]
```

The account needs a saved model (Settings → Models) and, for real voice, an ElevenLabs key. Each prompt creates a
project named `eval: …` in that account, so use a throwaway account. Output: `evals/results/<stamp>-<model>/`
(`report.md` with a hand-scoring table, `results.json`). `results/` is git-ignored.

`pnpm evals:test` tests the scoring code itself (no model needed).

## Comparing two prompts (or models)

Projects now start empty, so a prompt is judged on the whole build. To compare the previous system prompt with the
current one on the same model, run the Studio twice with different `LUMA_PROMPTS_DIR`:

```
# 1. the previous prompt (round 1) — its guide topics didn't exist, it pointed at LUMA.md
mkdir -p /tmp/prompts-before && git show 54ec7bc:packages/prompts/system.md > /tmp/prompts-before/system.md
cp -r packages/prompts/guide /tmp/prompts-before/   # read_guide still works, the prompt just doesn't use it
LUMA_PROMPTS_DIR=/tmp/prompts-before pnpm start      # (or the dev server) in one terminal
node evals/run.mjs --url http://localhost:8080 --email … --password … --model "<your model>" \
     --prompts map-only,chart-only,reel-9x16 --render none --label "prompt before" --out evals/results/before

# 2. the current prompt (restart the Studio without LUMA_PROMPTS_DIR)
node evals/run.mjs … --prompts map-only,chart-only,reel-9x16 --render none --label "prompt after" --out evals/results/after

node evals/compare.mjs evals/results/before/results.json evals/results/after/results.json --out evals/results/compare.md
```
Then open the projects (named `eval: …`) and fill the by-hand columns of each `report.md`.
