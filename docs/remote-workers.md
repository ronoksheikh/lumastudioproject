# Fast render hours and remote render workers

Every student renders on the Studio server itself, within a daily allowance (`RENDER_MINUTES_PER_DAY`, default 60
minutes in a rolling 24 hours). The minutes are not shown in the UI. When they are used up, `render_video` says
so and offers **fast render hours**: 1 hour (`RENDER_BOOST_MINUTES`) for 100 BDT (`RENDER_BOOST_PRICE_BDT`).

A paid pack:
- resets the daily allowance on this server (the window restarts at the moment it was paid), and
- sends the student's renders to the **remote render workers** until the hour is used (billed by wall-clock
  render time per job). If no worker is online, the job renders here instead (still billed to the pack, not the
  allowance) so nobody waits on a missing machine.

## Payments (not built yet)

Settings → Account → Fast render hours → "Buy 1 hour" creates a `pending` purchase (`POST /api/billing/render-boost`).
Until the payment gateway exists, an operator activates it:

```
node dist/admin.js boosts pending          # list requests (id, email)
node dist/admin.js boost-paid <id> [ref]   # mark paid → active immediately
node dist/admin.js boost-grant <email> 60  # give minutes without a purchase
```

The gateway's callback should do exactly what `markBoostPaid` in `apps/api/src/cli/commands.ts` does.

## Running a worker

A worker is any machine with Node 22, ffmpeg and Chrome/Chromium that can reach the Studio over HTTPS. It
needs no inbound ports.

```
# on the Studio server
docker compose exec luma-studio node dist/admin.js worker-add vps-1     # prints the token once

# on the worker machine
git clone <this repo> luma && cd luma
(cd template && npm install)
LUMA_URL=https://studio.example.com LUMA_WORKER_TOKEN=lw_… CHROME_PATH=/usr/bin/chromium node worker/luma-worker.mjs
```

Optional env: `LUMA_RENDER_WORKERS` (parallel Chromium chunks, default half the CPUs), `LUMA_WORK_DIR`,
`LUMA_POLL_S`. Run several workers for more throughput; each takes one job at a time. Keep the checkout on the
same version as the server so the engine matches. A GPU makes WebGL much faster (otherwise SwiftShader).

Manage them with `workers`, `worker-disable <name>`, `worker-enable <name>`, `worker-remove <name>`.

## Protocol

All calls carry `Authorization: Bearer <token>` (stored as a SHA-256 hash in `render_workers`).

| Call | Purpose |
|---|---|
| `POST /api/worker/claim` | heartbeat + take the oldest queued remote job: `{job: {id, projectId, preset, aspect}}` or `{job: null}` |
| `GET /api/worker/jobs/:id/bundle` | the project as tar.gz (regular files only; no `export/`, `node_modules/`, `.git/`) |
| `POST /api/worker/jobs/:id/progress` | `{frame, total, eta}`; renews the lease (`WORKER_LEASE_S`, 120 s). 409 = cancelled, stop |
| `PUT /api/worker/jobs/:id/file?kind=mp4\|jpg` | raw bytes into `<project>/export/<job>-remote.*` (owned by the project uid) |
| `POST /api/worker/jobs/:id/done` | `{result}` = render.mjs's JSON line → the render appears in the Renders tab |
| `POST /api/worker/jobs/:id/fail` | `{message}` |

A job whose worker stops reporting for longer than the lease goes back to the queue. A worker is "online" if it
called in during the last `WORKER_ONLINE_S` (90 s). The project's own `node_modules` is not shipped: packages the
agent installed into a project are not available on workers (the engine's are).
