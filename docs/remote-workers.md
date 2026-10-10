# Fast render hours and remote render workers

Students have two render quotas (details and the payment flow: `docs/payments.md`):

- **Free:** `RENDER_MINUTES_PER_DAY` (default 300 = 5 hours) of rendering on the Studio server in any rolling
  24 hours.
- **Fast:** paid hours (`RENDER_HOUR_PRICE_BDT`, default 100 BDT per hour, bought online, any number of
  hours per order up to `RENDER_HOURS_MAX_PER_ORDER`). They never expire. Jobs using them render on the **remote
  render workers** and are billed by wall-clock render time, oldest pack first. If no worker is online, a fast job
  renders here instead (still billed to the fast hours) so nobody waits on a missing machine.

When a student has both, the agent asks which one to use (`render_video` `mode: "free" | "fast"`).

Operators can still hand out hours: `boost-grant <email> [minutes]`, or `boost-paid <id>` for a purchase paid
by hand; `payment-check <invoice>` re-checks a payment by its merchantTransactionId.

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
