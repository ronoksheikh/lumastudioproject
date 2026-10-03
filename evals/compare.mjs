#!/usr/bin/env node
// Side-by-side of two eval runs (e.g. the previous system prompt vs the new one, or two models):
//   node evals/compare.mjs evals/results/<before>/results.json evals/results/<after>/results.json [--out compare.md]
import fs from 'node:fs';

const [a, b] = process.argv.slice(2).filter((x) => !x.startsWith('--'));
if (!a || !b) {
  console.error('Usage: node evals/compare.mjs <before/results.json> <after/results.json> [--out file.md]');
  process.exit(2);
}
const load = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const A = load(a);
const B = load(b);
const ids = [...new Set([...A.results, ...B.results].map((r) => r.id))];
const lines = [`# Eval comparison`, '', `before: ${A.label ?? A.model} · after: ${B.label ?? B.model}`, '', '| Prompt | before | after | newly passing | newly failing |', '|---|---|---|---|---|'];
let before = 0;
let after = 0;
let total = 0;
for (const id of ids) {
  const x = A.results.find((r) => r.id === id);
  const y = B.results.find((r) => r.id === id);
  const okA = new Set(x?.checks.filter((c) => c.ok).map((c) => c.id) ?? []);
  const okB = new Set(y?.checks.filter((c) => c.ok).map((c) => c.id) ?? []);
  const gained = [...okB].filter((c) => !okA.has(c));
  const lost = [...okA].filter((c) => !okB.has(c));
  lines.push(`| ${y?.title ?? x?.title ?? id} | ${x ? `${x.passed}/${x.total}` : '–'} | ${y ? `${y.passed}/${y.total}` : '–'} | ${gained.join(', ') || '–'} | ${lost.join(', ') || '–'} |`);
  before += x?.passed ?? 0;
  after += y?.passed ?? 0;
  total += Math.max(x?.total ?? 0, y?.total ?? 0);
}
lines.push('', `Total automatic checks passed: before ${before}, after ${after} (of up to ${total}).`);
const out = lines.join('\n') + '\n';
const i = process.argv.indexOf('--out');
if (i > 0 && process.argv[i + 1]) fs.writeFileSync(process.argv[i + 1], out);
console.log(out);
