#!/usr/bin/env node
// Luma Studio remote render worker. Runs on any machine with Node 22, ffmpeg and Chrome/Chromium (a VPS, a
// desktop with a good CPU/GPU…) and renders the paid "fast render" jobs of a Luma Studio server over HTTP.
//
//   1. On the server:  node dist/admin.js worker-add my-vps      → prints a token (once)
//   2. Here, in a checkout of the Luma Studio repo:
//        (cd template && npm install)
//        LUMA_URL=https://studio.example.com LUMA_WORKER_TOKEN=lw_… CHROME_PATH=/usr/bin/chromium node worker/luma-worker.mjs
//
// Loop: claim a job → download the project tarball → render it with this checkout's engine
// (template/scripts/render.mjs --root <project>) → stream progress → upload the MP4 + contact sheet → repeat.
// Env: LUMA_URL, LUMA_WORKER_TOKEN (required); LUMA_RENDER_WORKERS (parallel Chromium chunks, default = CPUs/2);
// LUMA_WORK_DIR (default OS tmp); LUMA_POLL_S (idle poll, default 5); CHROME_PATH.
import { spawn } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = (process.env.LUMA_URL ?? '').replace(/\/+$/, '');
const TOKEN = process.env.LUMA_WORKER_TOKEN ?? '';
if (!BASE || !TOKEN) {
  console.error('Set LUMA_URL (the studio address) and LUMA_WORKER_TOKEN (from `admin worker-add <name>`).');
  process.exit(2);
}
const here = path.dirname(fileURLToPath(import.meta.url));
const RENDER = path.resolve(here, '../template/scripts/render.mjs');
const CHUNKS = Math.max(1, Number(process.env.LUMA_RENDER_WORKERS) || Math.floor(os.cpus().length / 2) || 1);
const WORK = process.env.LUMA_WORK_DIR || os.tmpdir();
const POLL = Math.max(1, Number(process.env.LUMA_POLL_S) || 5) * 1000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

class Cancelled extends Error {}

async function api(method, p, { json, body, headers = {}, raw = false } = {}) {
  const res = await fetch(`${BASE}/api${p}`, {
    method,
    headers: { authorization: `Bearer ${TOKEN}`, ...(json ? { 'content-type': 'application/json' } : {}), ...headers },
    body: json ? JSON.stringify(json) : body,
    ...(body && !json ? { duplex: 'half' } : {}),
  });
  if (res.status === 409) throw new Cancelled('the server cancelled this render');
  if (!res.ok) throw new Error(`${method} ${p} → ${res.status} ${(await res.text()).slice(0, 300)}`);
  return raw ? res : res.json();
}

const run = (cmd, args, opts = {}) => new Promise((resolve, reject) => {
  const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], ...opts });
  let out = '';
  const feed = (d) => {
    const t = d.toString('utf8');
    out = (out + t).slice(-20000);
    opts.onOutput?.(t, child);
  };
  child.stdout.on('data', feed);
  child.stderr.on('data', feed);
  child.on('error', reject);
  child.on('close', (code) => resolve({ code, out }));
  opts.onChild?.(child);
});

async function upload(jobId, kind, file) {
  const { size } = await stat(file);
  await api('PUT', `/worker/jobs/${jobId}/file?kind=${kind}`, { body: createReadStream(file), headers: { 'content-type': 'application/octet-stream', 'content-length': String(size) } });
}

async function renderJob(job) {
  const dir = await mkdtemp(path.join(WORK, `luma-${job.id}-`));
  const proj = path.join(dir, 'project');
  try {
    log(`job ${job.id}: ${job.preset} render of project ${job.projectId}`);
    const res = await api('GET', `/worker/jobs/${job.id}/bundle`, { raw: true });
    const tgz = path.join(dir, 'project.tgz');
    await writeFile(tgz, Buffer.from(await res.arrayBuffer()));
    await run('mkdir', ['-p', proj]);
    const x = await run('tar', ['-xzf', tgz, '-C', proj, '--no-same-owner', '--no-same-permissions']);
    if (x.code !== 0) throw new Error(`could not unpack the project: ${x.out.slice(-500)}`);

    const out = path.join(proj, 'export', 'out.mp4');
    const sheet = path.join(proj, 'export', 'out.jpg');
    let child;
    let last = 0;
    let cancelled = false;
    const t0 = Date.now();
    const r = await run(process.execPath, [RENDER, '--root', proj, '--preset', job.preset, '--workers', String(CHUNKS), '--out', out, '--sheet', sheet, '--no-env'], {
      cwd: proj,
      env: { ...process.env, LUMA_ENGINE: path.dirname(path.dirname(RENDER)) },
      onChild: (c) => (child = c),
      onOutput: (text) => {
        for (const m of text.matchAll(/\[luma\] frame (\d+)\/(\d+)/g)) {
          const frame = Number(m[1]);
          const total = Number(m[2]);
          if (Date.now() - last < 1500 && frame < total) continue;
          last = Date.now();
          const elapsed = (Date.now() - t0) / 1000;
          const eta = frame > 0 ? Math.round((elapsed / frame) * (total - frame)) : undefined;
          api('POST', `/worker/jobs/${job.id}/progress`, { json: { frame, total, eta } }).catch((e) => {
            if (e instanceof Cancelled && !cancelled) {
              cancelled = true;
              log(`job ${job.id}: cancelled by the server, stopping`);
              child?.kill('SIGKILL');
            }
          });
        }
      },
    });
    if (cancelled) return;
    const line = r.out.split('\n').reverse().find((l) => l.startsWith('{"render"'));
    if (r.code !== 0 || !line) {
      const reason = r.out.replace(/\[luma\] frame [^\n]*\n?/g, '').trim().slice(-1500) || `render exited ${r.code}`;
      await api('POST', `/worker/jobs/${job.id}/fail`, { json: { message: reason } });
      log(`job ${job.id}: failed`);
      return;
    }
    const result = JSON.parse(line).render;
    result.seconds = Math.round((Date.now() - t0) / 1000);
    await upload(job.id, 'mp4', out);
    await upload(job.id, 'jpg', sheet).catch(() => {}); // the sheet is a nice-to-have
    await api('POST', `/worker/jobs/${job.id}/done`, { json: { result } });
    log(`job ${job.id}: done in ${result.seconds}s`);
  } catch (e) {
    if (e instanceof Cancelled) return log(`job ${job.id}: cancelled`);
    log(`job ${job.id}: error ${e.message}`);
    await api('POST', `/worker/jobs/${job.id}/fail`, { json: { message: e.message } }).catch(() => {});
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

log(`Luma render worker → ${BASE} (${CHUNKS} parallel chunk(s))`);
let stopping = false;
process.on('SIGINT', () => { stopping = true; log('stopping after the current job (Ctrl-C again to quit now)'); process.once('SIGINT', () => process.exit(130)); });
while (!stopping) {
  try {
    const { job } = await api('POST', '/worker/claim', { json: {} });
    if (job) await renderJob(job);
    else await sleep(POLL); // claiming also tells the server this worker is online
  } catch (e) {
    log(`cannot reach the studio: ${e.message}`);
    await sleep(POLL * 3);
  }
}
