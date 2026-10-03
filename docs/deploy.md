# Deploying Luma Studio

One container (`luma-studio`) runs the API, the SPA, the agent runner and the renderer. Caddy in front
terminates TLS for two hostnames. Nothing else is needed: SQLite and the project files live on one volume.

> The Dockerfile and compose file were written and reviewed, but **have not been built on a machine with a Docker
> daemon yet** (the development sandbox has none). Do a first `docker compose build` on the target host and run
> the smoke checklist at the bottom before inviting students.

## 1. Host

- Linux, 4+ cores. Software WebGL is CPU-bound: a 30 s Final 1080p60 takes ≈ 22 min on 4 cores, a Draft ≈ 5 min (see
  `rendering.md`). A GPU host or more cores shortens that; plan about **one concurrent Final render per 4 cores**.
- RAM: 2 GB per concurrent render (Chromium) + 1 GB for the app. `MEM_LIMIT` caps the container.
- Disk: 5 GB per student quota is a cap, not a reservation. Start with 200 GB.
- Docker with Compose v2. The kernel must allow unprivileged user namespaces for bubblewrap; if it does not,
  set `SANDBOX=uid` (per-project unix users still isolate students, bubblewrap only adds mount isolation).

## 2. DNS and TLS

Two hostnames pointing at the host, e.g. `studio.example.com` and `preview.example.com`. They **must be different
hosts**: the preview host serves student JavaScript and must never share cookies with the app. Caddy gets the
certificates automatically (ports 80 and 443 open).

## 3. Configure

```
cp .env.example .env
openssl rand -base64 32     # → MASTER_KEY   (encrypts students' API keys; losing it makes them unreadable)
openssl rand -base64 32     # → SESSION_SECRET
```

Set `NODE_ENV=production`, `APP_ORIGIN=https://studio.example.com`, `PREVIEW_ORIGIN=https://preview.example.com`,
`APP_HOST`, `PREVIEW_HOST`, `CPUS` (≈ 0.9 × cores) and `MEM_LIMIT`. Optional: `HCAPTCHA_SITEKEY/SECRET`,
`METRICS_TOKEN`, `ERROR_TRACKING_DSN`, `SIGNUP_ENABLED=0` for a closed beta. Keep `.env` out of git and back
`MASTER_KEY` up somewhere other than the server.

```
docker compose up -d --build
docker compose logs -f luma-studio     # "egress blocklist active …" and "cpu budget started" should appear
```

## 4. What protects what

| Layer | How |
|---|---|
| Student commands | run as a per-project unix user (uid ≥ 100000), inside bubblewrap when available, clean environment, `prlimit`/`nice`, process-group kill on timeout |
| Network from student commands | `docker/egress.sh` rejects private ranges, link-local and cloud metadata for those uids (needs `NET_ADMIN`; the log says when it is missing) |
| Data | `/data` is `711` (traversable, not listable); the database, `.dev-secrets`, backups are root-only |
| Secrets | AES-256-GCM with `MASTER_KEY`; never in env of student processes, never in logs or events |
| Preview | separate origin, HMAC-signed short-lived path token, `Referrer-Policy: no-referrer`, per-IP rate limit |
| CPU | heavy jobs start only while total CPU < `CPU_BUDGET` (0.9); `docker` `cpus:` is the hard cap |

## 5. Limits (all in `.env`)

One running agent and one render per student; `USER_QUOTA_MB` storage (default 5120); `RENDER_MINUTES_PER_DAY` (60);
`RENDER_TIMEOUT_MIN` (90); `UPLOAD_MAX_MB`; deleted projects are purged after `PURGE_AFTER_DAYS` (7). Students see
their allowance in Settings → Account.

## 6. Operations

```
docker compose exec luma-studio node dist/admin.js users
docker compose exec luma-studio node dist/admin.js ban someone@example.com     # also signs them out
docker compose exec luma-studio node dist/admin.js unban someone@example.com
docker compose exec luma-studio node dist/admin.js purge --days 0              # purge deleted projects now
docker compose exec luma-studio node dist/admin.js backup
```

**Backups.** A consistent SQLite copy is written nightly after `BACKUP_HOUR` (UTC) to `/data/backups`
(`luma-YYYYMMDD-HHMMSS.db`, newest `BACKUP_KEEP` kept) using SQLite's online backup, safe while running. The
volume also holds the project files: snapshot the whole `data` volume off-host (host LVM/ZFS snapshot, or
`restic`/`rclone` of `/var/lib/docker/volumes/<project>_data`). Restore: stop the container, copy a backup over
`/data/luma.db` (delete `luma.db-wal`/`-shm`), start.

**Rotate `MASTER_KEY`.** `docker compose exec -e OLD_MASTER_KEY=<old> -e MASTER_KEY=<new> luma-studio node dist/admin.js rotate-key`
re-encrypts every stored model/voice key in one transaction (nothing changes if the old key is wrong), then set
the new value in `.env` and `docker compose up -d`. Rotating `SESSION_SECRET` only invalidates open preview links.

**Metrics.** With `METRICS_TOKEN` set, `GET /api/metrics` (bearer token) serves Prometheus text: runs by outcome,
tokens, tool calls and failures, renders by outcome, render-time histogram, CPU use, queue depth. Logs are JSON on
stdout (pino); unhandled errors also go to `ERROR_TRACKING_DSN` (Sentry or self-hosted GlitchTip) with secrets scrubbed.

**Update.** `git pull && docker compose up -d --build`. Migrations run at start. Renders interrupted by the restart
go back to the queue.

## 7. Smoke checklist after the first deploy

1. `https://<app>/api/health` is `ok`; `https://<preview>/` answers 404 (and the app host does not serve `/p/…`).
2. Sign up, add a model, create a project, send "make a 10 second video about coffee" with a placeholder voice.
3. The preview plays; a Draft render completes and downloads; `docker compose logs` shows no errors.
4. From a project terminal run `curl -m 3 http://169.254.169.254/` and `curl -m 3 http://10.0.0.1/`: both must be refused immediately.
5. `ls /data` from a project terminal must be denied.
