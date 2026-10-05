# Luma Studio API

Make motion-graphics videos from your own code: create a project, send the agent a brief (and files), wait for it
to finish, render the MP4 and download it. The API is the same one the Studio app uses, signed in with an
**API key** instead of a browser session.

**Base URL:** `{BASE}` · **Format:** JSON (uploads are `multipart/form-data`) · **Auth:** `Authorization: Bearer lsk_…`

> API keys need the **Luma Studio API add-on** (Settings → Add-ons). Create and revoke keys in Settings → API.
> Keep keys on your server only: anyone with a key can use your account's projects, render time and models.

## Quick start

```bash
KEY=lsk_your_key
BASE={BASE}

# 1. a project (16:9 or 9:16)
PROJECT=$(curl -s -X POST $BASE/api/projects -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"title":"Course ad","aspect":"16:9"}' | jq -r .project.id)

# 2. brief the agent (it writes the script, records the voice, builds and checks every scene)
RUN=$(curl -s -X POST $BASE/api/projects/$PROJECT/runs -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"message":"A 20-second 16:9 ad for my AI course: strong hook, 3 benefits, end with Enrol now. English voice."}' | jq -r .runId)

# 3. wait until the run is finished
until [ "$(curl -s $BASE/api/projects/$PROJECT/runs/$RUN/events.json -H "Authorization: Bearer $KEY" | jq -r .run.status)" != "running" ]; do sleep 5; done

# 4. render (draft = fast 1080p30, final = 1080p60) and wait for the MP4
JOB=$(curl -s -X POST $BASE/api/projects/$PROJECT/renders -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"preset":"draft"}' | jq -r .jobId)
until [ "$(curl -s $BASE/api/projects/$PROJECT/render-jobs/$JOB -H "Authorization: Bearer $KEY" | jq -r .status)" = "done" ]; do sleep 10; done

# 5. download
URL=$(curl -s $BASE/api/projects/$PROJECT/render-jobs/$JOB -H "Authorization: Bearer $KEY" | jq -r .render.fileUrl)
curl -L -o video.mp4 "$BASE$URL" -H "Authorization: Bearer $KEY"
```

## Errors

Every error is `{ "error": { "code": "…", "message": "…" } }` with an HTTP status:

| Status | Meaning |
|---|---|
| 400 | Invalid request — the message says which field |
| 401 | Missing, invalid or revoked API key |
| 402 | The account no longer has the API add-on |
| 403 | Suspended account, or an endpoint keys can't use (account, billing, admin) |
| 404 | Not found (or not yours) |
| 409 | Busy — e.g. the agent is already working on this project, or a render is already running for it |
| 413 | A limit — storage full, render time used up (`code: render_limit`), choose a render type (`choose_render_mode`) |
| 429 | Too many requests — slow down |

## Account

| Method & path | What it does |
|---|---|
| `GET /api/auth/me` | The account the key belongs to: `{ user: { id, email } }` |
| `GET /api/usage` | Storage and render time: `{ usage: { diskBytes, diskLimitBytes, freeRender: { secondsPerDay, secondsLeft }, fastRender: { secondsLeft, … } } }` |
| `GET /api/settings/models` | Your saved AI models: `{ models: [{ id, name, model, isDefault, … }] }` — pass an `id` as `providerId` to choose one |

## Projects

| Method & path | Body / query | Returns |
|---|---|---|
| `GET /api/projects` | | `{ projects: [...] }` |
| `POST /api/projects` | `{ title, aspect: "16:9" \| "9:16" }` | `201 { project: { id, title, aspect, … } }` |
| `GET /api/projects/:id` | | `{ project }` with `content: { scenes, script, voice }` |
| `PATCH /api/projects/:id` | `{ title }` | `{ project }` |
| `DELETE /api/projects/:id` | | `{ ok: true }` |

## Files you give the agent

`POST /api/projects/:id/uploads` — `multipart/form-data`, one or more `file` parts (SVG, PNG, JPG, WEBP, PDF).
Returns `201 { uploads: [{ id, path, mime, size }] }`. Pass the ids as `attachmentIds` when you start a run, and
mention them in the brief ("animate the attached logo", "use the PDF as the script").

```bash
curl -X POST $BASE/api/projects/$PROJECT/uploads -H "Authorization: Bearer $KEY" -F "file=@logo.svg"
```

## The agent

| Method & path | Body / query | Returns |
|---|---|---|
| `POST /api/projects/:id/runs` | `{ message, attachmentIds?, providerId? }` | `202 { runId, messageId }` — the agent starts working |
| `GET /api/projects/:id/runs/:runId/events.json` | `?after=<event id>` | `{ run: { id, status, … }, events: [...] }` — poll this; `status` is `running` until it ends (`finished`, `stopped`, `error`) |
| `GET /api/projects/:id/runs/:runId/events` | `?after=` | The same events as a live stream (Server-Sent Events) |
| `POST /api/projects/:id/runs/:runId/answer` | `{ answer }` | Answers the agent's question (an `ask_user` event) |
| `POST /api/projects/:id/runs/:runId/stop` | | Stops the run |
| `GET /api/projects/:id/active-run` | | `{ run: { id, awaitingAnswer } \| null }` |
| `GET /api/projects/:id/runs` | | The project's runs, newest first |
| `GET /api/projects/:id/messages` | | The conversation: your messages and the agent's replies |

**Events** you'll care about (each has `id`, `type`, `ts`, `data`): `message.delta` (the agent's reply text, in
pieces), `tool.call` / `tool.result` (what it is doing), `ask_user` (it needs an answer — reply with `/answer`),
`billing.offer` (render time used up), `render.done`, `run.error`, and `run.finished` (with `stopReason`).
Send follow-up briefs ("make the hook faster", "change the price to ৳999") as new runs on the same project.

## Rendering

| Method & path | Body | Returns |
|---|---|---|
| `POST /api/projects/:id/renders` | `{ preset: "draft" \| "final", mode?: "free" \| "fast" }` | `202 { jobId, position }` |
| `GET /api/projects/:id/render-jobs/:jobId` | | `{ status: queued \| running \| done \| error, progress, position, error, render: { id, fileUrl, sheetUrl, durationMs, size } }` |
| `GET /api/projects/:id/renders` | | All finished renders: `{ renders: [{ id, url, contactSheetUrl, … }] }` |
| `GET /api/projects/:id/renders/:renderId/file` | | The MP4 (supports `Range`) |
| `GET /api/projects/:id/renders/:renderId/sheet` | | A 2×2 contact sheet JPG |
| `DELETE /api/projects/:id/renders/:renderId` | | Deletes a render |

`mode`: **free** uses the daily free render time, **fast** uses your paid fast render hours. Leave it out when you
only have one of them; with both you get `413 choose_render_mode` and must pick. A project renders one job at a
time. You can also just ask the agent to render in the brief.

## Project files and preview

| Method & path | Query | Returns |
|---|---|---|
| `GET /api/projects/:id/tree` | `?path=.&depth=4` | `{ entries: [{ path, type, size }] }` |
| `GET /api/projects/:id/file` | `?path=script.json` | A text file's content (or what kind of file it is) |
| `GET /api/projects/:id/raw` | `?path=…` | The file's bytes |
| `POST /api/projects/:id/preview-token` | | `{ url, expiresAt }` — a link to watch the live preview in a browser |

## Limits

Your account's normal limits apply: storage, daily free render time, fast render hours, and up to 4 agent runs
at once (one per project). Agent runs use **your own AI model keys** from Settings → Models.
