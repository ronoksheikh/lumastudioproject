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
