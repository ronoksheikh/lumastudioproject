#!/usr/bin/env node
// Runs the golden prompts against a running Luma Studio with one of your saved models and scores the
// automatic part of the rubric (score.mjs). Hand-scoring sheet: rubric.md. Each run creates real projects
// and spends the model's tokens (and ElevenLabs credits unless the account has no voice key → placeholder).
//
//   node evals/run.mjs --url http://localhost:8080 --email me@x.com --password '…' [--model "My Model"]
//        [--prompts map-only,chart-only] [--render draft|final|none] [--timeout 45] [--out evals/results/<name>]
//
// → evals/results/<stamp>-<model>/{report.md,results.json}

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scoreRun } from './score.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true]] : acc), []));
if (!args.url || !args.email || !args.password) {
  console.error('Usage: node evals/run.mjs --url <studio url> --email <e> --password <p> [--model <name|id>] [--prompts a,b] [--render draft|final|none] [--timeout minutes]');
  process.exit(2);
}
const base = String(args.url).replace(/\/$/, '');
const origin = new URL(base).origin;
const renderMode = args.render ?? 'draft';
const timeoutMs = (Number(args.timeout) || 45) * 60_000;

let cookie = '';
let csrf = '';
async function api(method, url, body) {
  const res = await fetch(base + url, {
    method,
    headers: { 'content-type': 'application/json', origin, ...(cookie ? { cookie } : {}), ...(csrf && method !== 'GET' ? { 'x-csrf-token': csrf } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const set = res.headers.getSetCookie?.() ?? [];
  for (const c of set) cookie = c.split(';')[0];
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${url} → ${res.status} ${json?.error?.message ?? ''}`);
  return json;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const login = await api('POST', '/api/auth/login', { email: args.email, password: args.password });
csrf = login.csrfToken;
const { models } = await api('GET', '/api/settings/models');
const model = models.find((m) => m.id === args.model || m.name === args.model) ?? models[0];
if (!model) throw new Error('This account has no model configured (Settings → Models).');
console.log(`model: ${model.name} (${model.model})`);

const wanted = args.prompts ? String(args.prompts).split(',') : fs.readdirSync(path.join(here, 'prompts')).map((f) => f.replace(/\.json$/, ''));
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const outDir = path.resolve(args.out ?? path.join(here, 'results', `${stamp}-${model.name.replace(/[^\w.-]+/g, '_')}`));
fs.mkdirSync(outDir, { recursive: true });

const results = [];
for (const id of wanted) {
  const spec = JSON.parse(fs.readFileSync(path.join(here, 'prompts', `${id}.json`), 'utf8'));
  console.log(`\n▶ ${spec.title}`);
  const { project } = await api('POST', '/api/projects', { title: `eval: ${spec.title}`, aspect: spec.aspect });
  const suffix = renderMode === 'none' ? '' : `\n\nWhen the preview is clean, render a ${renderMode} version.`;
  const { runId } = await api('POST', `/api/projects/${project.id}/runs`, { message: spec.prompt + suffix, providerId: model.id });
  const t0 = Date.now();
  let events = [];
  let answered = 0;
  for (;;) {
    await sleep(3000);
    events = (await api('GET', `/api/projects/${project.id}/runs/${runId}/events.json`)).events;
    const asks = events.filter((e) => e.type === 'ask_user').length;
    if (asks > answered) {
      answered = asks;
      await api('POST', `/api/projects/${project.id}/runs/${runId}/answer`, { answer: 'Use your best judgement and continue.' }).catch(() => {});
    }
    if (events.some((e) => e.type === 'run.finished')) break;
    if (Date.now() - t0 > timeoutMs) {
      await api('POST', `/api/projects/${project.id}/runs/${runId}/stop`).catch(() => {});
      break;
    }
    process.stdout.write(`\r  ${Math.round((Date.now() - t0) / 1000)}s, ${events.length} events`);
  }
  process.stdout.write('\n');

  // scene sources
  const files = {};
  const tree = await api('GET', `/api/projects/${project.id}/tree?path=public&depth=4`).catch(() => ({ entries: [] }));
  for (const e of tree.entries) {
    if (e.type !== 'file' || !/(public\/js\/scenes\/.+\.js|public\/css\/scenes\.css)$/.test(e.path)) continue;
    const f = await api('GET', `/api/projects/${project.id}/file?path=${encodeURIComponent(e.path)}`).catch(() => null);
    if (f?.content) files[e.path] = f.content;
  }
  let segments = 1;
  const sj = await api('GET', `/api/projects/${project.id}/file?path=script.json`).catch(() => null);
  try { segments = JSON.parse(sj.content).segments.length; } catch { /* keep 1 */ }

  const score = scoreRun({ events, files, targetSeconds: spec.target_seconds, renderRequested: renderMode !== 'none', segments });
  results.push({ id, title: spec.title, projectId: project.id, runId, ...score });
  console.log(`  ${score.passed}/${score.total} automatic checks passed`);
  for (const c of score.checks.filter((x) => !x.ok)) console.log(`   ✗ ${c.id}: ${c.detail}`);
}

fs.writeFileSync(path.join(outDir, 'results.json'), JSON.stringify({ model: model.name, modelId: model.model, results }, null, 2));
const md = [`# Eval report — ${model.name} (${model.model})`, '', `Run ${stamp}. Automatic checks below; fill the "by hand" columns using rubric.md.`, '', '| Prompt | Auto | Hook (0-3) | Beats on words (0-3) | Polish (0-3) | Notes |', '|---|---|---|---|---|---|'];
for (const r of results) md.push(`| ${r.title} | ${r.passed}/${r.total} | | | | project ${r.projectId} |`);
for (const r of results) {
  md.push('', `## ${r.title}`, '');
  for (const c of r.checks) md.push(`- ${c.ok ? '✅' : '❌'} **${c.id}** — ${c.detail}`);
  md.push('', `Tool calls: ${r.stats.toolCalls} (${r.stats.failedTools} failed) · tokens in/out: ${r.stats.tokens.input}/${r.stats.tokens.output} · wall time: ${r.stats.seconds ?? '?'}s`);
}
fs.writeFileSync(path.join(outDir, 'report.md'), md.join('\n') + '\n');
console.log(`\nreport: ${path.join(outDir, 'report.md')}`);
