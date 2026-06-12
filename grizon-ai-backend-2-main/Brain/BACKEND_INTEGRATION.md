# Brain-0 Backend Integration Guide

**API version:** v2-mvp  
**Document generated:** 2026-05-01  
**Base URL:** set by `BRAIN0_PUBLIC_BASE_URL` in `.env` (currently `http://127.0.0.1:8081`)

---

## 1. Quickstart

Three commands to verify connectivity before writing any code.

```bash
export BRAIN0_BASE=http://127.0.0.1:8081
export BRAIN0_API_KEY=a731460fa4cd9634913387509b69775159c1ecdc012a8b54186a8c289b6544b7

# 1. Liveness check (no auth)
curl -s ${BRAIN0_BASE}/healthz
# → {"status":"ok","queue_depth":0,"worker_busy":false,"sandbox_dirty":false,"current_job_id":null}

# 2. Submit a job
curl -s -X POST ${BRAIN0_BASE}/jobs \
  -H "x-api-key: ${BRAIN0_API_KEY}" \
  -H "content-type: application/json" \
  -d '{"repo_url":"https://github.com/langchain-ai/deepagents",
       "user_intent":"extract orchestration and agent communication patterns",
       "job_id_external":"your-backend-ref-123"}' | tee /tmp/job.json

# 3. Poll status
JOB_ID=$(jq -r .job_id /tmp/job.json)
curl -s ${BRAIN0_BASE}/jobs/${JOB_ID} -H "x-api-key: ${BRAIN0_API_KEY}" | jq .status
```

---

## 2. Auth Model

All HTTP endpoints except `/healthz` require the header `x-api-key: <key>`, where the key is the value of `BRAIN0_API_KEY` in `.env`. This key is a server-side secret — **never send it to a browser**.

WebSocket streams use a separate short-lived stream token. When your backend calls `POST /jobs`, the response includes `stream_token` (TTL: 10 minutes) and `stream_url` (the full WS URL with the token already embedded). Your backend passes `stream_url` and `stream_token` to the browser. The browser connects to the WebSocket directly using the token in the query string. The API key never leaves your backend.

Stream tokens are job-bound: a token issued for job A is cryptographically rejected for job B. Token format: `{expiry_unix_int}.{hmac_sha256_hex}` where the HMAC covers `"{job_id}|{expiry}"`.

---

## 3. Primary Endpoints

### POST /jobs

Submit a job. Returns immediately; the job is queued for execution.

**Headers:** `x-api-key`, `content-type: application/json`

**Request body** (`JobRequest`):

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `repo_url` | string (HTTP URL) | yes | Public git repo to analyse |
| `user_intent` | string (10–4000 chars) | yes | Instructions for the extractor |
| `callback_url` | string (HTTP URL) | no | Brain-0 POSTs result here on completion |
| `job_id_external` | string | no | Your own reference ID, echoed back verbatim |

**Responses:**

`202 Accepted` — job enqueued:
```json
{
  "job_id": "j-1777653728-3d819702",
  "status": "queued",
  "queue_position": 1,
  "stream_token": "1777654328.bf8387cef8950b2cf3ae...",
  "stream_url": "ws://127.0.0.1:8081/jobs/j-1777653728-3d819702/stream?token=1777654328.bf...",
  "artifact_url": "http://127.0.0.1:8081/jobs/j-1777653728-3d819702/artifact",
  "status_url": "http://127.0.0.1:8081/jobs/j-1777653728-3d819702"
}
```

`401` — missing or wrong API key  
`422` — request body failed validation (invalid URL, intent too short, etc.)  
`503` — queue is full (50-job limit); retry after the current job completes

---

### GET /jobs/{job_id}

Fetch the current state of a job.

**Headers:** `x-api-key`

**Response** (`JobRecord`), `200 OK`:

```json
{
  "job_id": "j-1777653728-3d819702",
  "status": "extracting",
  "repo_url": "https://github.com/langchain-ai/deepagents",
  "user_intent": "extract orchestration and agent communication patterns",
  "callback_url": null,
  "job_id_external": "your-backend-ref-123",
  "created_at": "2026-05-01T16:31:06.426940Z",
  "started_at": "2026-05-01T16:31:08.123456Z",
  "finished_at": null,
  "cost_usd": null,
  "num_turns": null,
  "feature_count": null,
  "tarball_bytes": null,
  "error": null,
  "queue_position": 0
}
```

`queue_position` is live: `0` = currently running, `1+` = waiting in queue, `null` = terminal (done or never queued).

`404` — job_id not found

---

### GET /jobs/{job_id}/artifact

Download the result tarball. Only available after `status == "succeeded"`.

**Headers:** `x-api-key`

`200 OK` — `Content-Type: application/gzip`, streaming file response  
`409 Conflict` — job exists but hasn't succeeded yet:
```json
{"detail": "Artifact not ready", "status": "extracting"}
```
`404` — job not found, or job succeeded but tarball file is missing on disk

```bash
curl -s -o result.tar.gz \
  -H "x-api-key: ${BRAIN0_API_KEY}" \
  ${BRAIN0_BASE}/jobs/${JOB_ID}/artifact
tar -tzvf result.tar.gz
```

---

### WS /jobs/{job_id}/stream

Live event stream for a job. Pass the `stream_token` from `POST /jobs` as a query parameter.

**URL:** `ws://{host}/jobs/{job_id}/stream?token={stream_token}`  
**No `x-api-key` header** — token in query string only.

On connect, the server replays all events buffered since job creation (up to 1000), then streams live events as they occur. After the `done` event is sent, the server holds the connection open 30 seconds then closes with code `1000`.

**Close codes:**  
`4401` — token missing, expired, or does not match this job_id  
`1000` — normal close after `done` + 30s grace  

Frame format: see **Section 6** for all event types.

---

## 4. Optional Endpoints

**GET /jobs** `[x-api-key]`  
Returns an array of recent `JobRecord` objects, newest first. Query param `limit` (1–200, default 50). Useful for operator dashboards.

**GET /jobs/{job_id}/events** `[x-api-key]`  
Returns the full event history for a job as a JSON array (same frames the WebSocket would stream). Use this if you prefer polling over WebSockets — poll every few seconds after `started_at` is set, call once more after status is terminal to get the `summary` event.

**GET /healthz** `[no auth]`  
Liveness probe. Check `sandbox_dirty` — if `true`, queued jobs will not progress until an operator deletes `.sandbox-dirty` on the server.

---

## 5. Job Lifecycle

```
                          ┌─────────┐
                          │ queued  │  Job record written to disk; waiting in queue.
                          └────┬────┘
                               │
                          ┌────▼────┐
                          │starting │  Worker picked up the job; record marked starting.
                          └────┬────┘
                               │
                         ┌─────▼──────┐
                         │ resetting  │  Sandbox workspace wiped from previous run.
                         └─────┬──────┘
                               │
                         ┌─────▼──────┐
                         │ uploading  │  CLAUDE.md with user_intent uploaded to sandbox.
                         └─────┬──────┘
                               │
                          ┌────▼─────┐
                          │ cloning  │  `git clone --depth 1` of repo_url into sandbox.
                          └────┬─────┘
                               │
                         ┌─────▼──────┐
                         │ preparing  │  Output directories created inside sandbox.
                         └─────┬──────┘
                               │
                        ┌──────▼───────┐
                        │ extracting   │  Claude runs inside sandbox; reads repo, writes
                        │              │  feature specs to /sandbox/reports/.
                        └──────┬───────┘
                               │
                        ┌──────▼───────┐
                        │ packaging    │  Reports downloaded; tarball assembled with
                        │              │  reports/ and _meta/ directories.
                        └──────┬───────┘
                               │
                        ┌──────▼───────┐
                        │  succeeded   │  Tarball on disk. cost_usd, num_turns,
                        └──────────────┘  feature_count, tarball_bytes all set.

Any phase → failed      Exception raised; error field contains the message.
Any phase → timed_out   Job exceeded JOB_TIMEOUT_SECONDS (default 1800s).
```

---

## 6. WebSocket Frame Format

Every frame is a JSON object matching `EventEnvelope`:

```json
{"ts": "2026-05-01T16:31:08.123Z", "job_id": "j-...", "type": "<type>", "data": {...}}
```

| `type` | When it fires | `data` shape |
|--------|--------------|--------------|
| `status` | Every phase transition (queued→starting→resetting→…→succeeded/failed/timed_out). Also fired when the queue is blocked by a dirty sentinel. | `{"status": "cloning"}` or `{"status": "queued", "queue_blocked": true, "reason": "sandbox dirty, operator intervention required"}` |
| `log` | Every line of stdout/stderr from each subprocess (git clone, claude, upload, download, reset) | `{"source": "claude", "stream": "stdout", "line": "<raw line>"}` |
| `step` | Not currently emitted by the runner (reserved) | `{"message": "..."}` |
| `summary` | Once, immediately after `status:succeeded`. Contains final cost and output statistics. | `{"job_id": "j-...", "status": "succeeded", "cost_usd": 0.424, "num_turns": 45, "features": 10, "tarball_bytes": 135366, "elapsed_s": 444.8}` |
| `error` | On failure or timeout, before `done`. | `{"message": "git clone failed: ..."}` |
| `done` | Always last. Signals stream end. | `{"outcome": "succeeded"}` or `{"outcome": "failed"}` or `{"outcome": "timed_out"}` |

The `done` event is always the final frame. After receiving it, close the WebSocket or wait for the server to close it (it will within 30 seconds).

---

## 7. Tarball Structure

```
{job_id}.tar.gz
├── reports/
│   ├── manifest.json          Feature index; array of {id, title, file} objects
│   ├── overview.md            One-page summary of the repo's architecture
│   └── features/
│       ├── 01-<slug>.md       Full spec for feature 1
│       ├── 02-<slug>.md       Full spec for feature 2
│       └── ...                One file per extracted feature
└── _meta/
    ├── job.json               Canonical record: job_id, repo_url, status, cost_usd,
    │                          num_turns, features, elapsed_s, ts_start, ts_end
    ├── CLAUDE.md              The exact instructions sent to Claude (rendered with
    │                          user_intent interpolated)
    └── claude-stream.jsonl    Raw stream-json output from the Claude subprocess,
                               one JSON object per line, untouched
```

`_meta/job.json` is the authoritative source of cost, turn count, and timing — use it for billing and audit logs. `reports/manifest.json` lists every feature file with its title for building an index.

---

## 8. Webhook Callback (Optional)

If `callback_url` is set in `POST /jobs`, Brain-0 POSTs a JSON body to that URL when the job reaches a terminal state.

**Header sent:** `x-brain0-secret: <WEBHOOK_SHARED_SECRET from .env>`

**POST body:**

```json
{
  "job_id": "j-1777653728-3d819702",
  "job_id_external": "your-backend-ref-123",
  "status": "succeeded",
  "cost_usd": 0.42418615,
  "num_turns": 45,
  "feature_count": 10,
  "tarball_bytes": 135366,
  "elapsed_s": 444.8,
  "error": null,
  "artifact_url": "http://127.0.0.1:8081/jobs/j-1777653728-3d819702/artifact"
}
```

**Retry behavior:** 3 attempts. After attempt 1: wait 2s. After attempt 2: wait 4s. Attempt 3 is final. Any non-2xx response counts as a failure. Network errors also trigger retry. After all attempts fail, the failure is logged and Brain-0 moves on.

**The artifact is always fetchable via `artifact_url`** in the webhook body, regardless of webhook delivery outcome. If your webhook endpoint was down, use that URL to download once it recovers.

Verify webhooks by checking `x-brain0-secret` matches your configured `WEBHOOK_SHARED_SECRET`.

---

## 9. Worked Examples (Python)

### Polling mode

```python
import time, requests, tarfile, pathlib

BASE = "http://127.0.0.1:8081"
KEY  = "a731460fa4cd9634913387509b69775159c1ecdc012a8b54186a8c289b6544b7"
HEADERS = {"x-api-key": KEY}

# Submit
resp = requests.post(f"{BASE}/jobs", headers=HEADERS, json={
    "repo_url": "https://github.com/langchain-ai/deepagents",
    "user_intent": "extract orchestration and agent communication patterns",
    "job_id_external": "my-ref-001",
})
resp.raise_for_status()
data = resp.json()
job_id = data["job_id"]
print(f"Submitted: {job_id}, queue_position={data['queue_position']}")

# Poll until terminal
while True:
    time.sleep(30)
    rec = requests.get(f"{BASE}/jobs/{job_id}", headers=HEADERS).json()
    print(f"  status={rec['status']}")
    if rec["status"] in ("succeeded", "failed", "timed_out"):
        break

if rec["status"] != "succeeded":
    raise RuntimeError(f"Job failed: {rec.get('error')}")

# Download artifact
artifact = requests.get(f"{BASE}/jobs/{job_id}/artifact", headers=HEADERS)
artifact.raise_for_status()
dest = pathlib.Path(f"{job_id}.tar.gz")
dest.write_bytes(artifact.content)
print(f"Downloaded {len(artifact.content)} bytes to {dest}")

# Inspect
with tarfile.open(dest) as tf:
    tf.extractall("output/")
import json
meta = json.loads(pathlib.Path(f"output/_meta/job.json").read_text())
print(f"cost=${meta['cost_usd']:.4f}  turns={meta['num_turns']}  features={meta['features']}")
```

### Webhook mode

```python
# Backend: submit with callback_url
import requests
BASE = "http://127.0.0.1:8081"
KEY  = "a731460fa4cd9634913387509b69775159c1ecdc012a8b54186a8c289b6544b7"

resp = requests.post(f"{BASE}/jobs", headers={"x-api-key": KEY}, json={
    "repo_url": "https://github.com/langchain-ai/deepagents",
    "user_intent": "extract orchestration patterns",
    "callback_url": "https://your-backend.example.com/brain0-callback",
    "job_id_external": "my-ref-002",
})
job_id = resp.json()["job_id"]
print(f"Submitted {job_id} — waiting for webhook")

# Receiver (Flask):
import hmac, hashlib
from flask import Flask, request, jsonify

app = Flask(__name__)
WEBHOOK_SECRET = "b712b2bb89021a4f49f793f0ef07a4639f0a87dc8fa69969d45e4a238aadcffe"

@app.post("/brain0-callback")
def brain0_callback():
    if request.headers.get("x-brain0-secret") != WEBHOOK_SECRET:
        return jsonify({"error": "forbidden"}), 403
    payload = request.json
    job_id  = payload["job_id"]
    status  = payload["status"]
    print(f"Job {job_id} finished: {status}, cost=${payload['cost_usd']}")
    if status == "succeeded":
        # payload["artifact_url"] is always valid even if this webhook was delayed
        dl = requests.get(payload["artifact_url"], headers={"x-api-key": KEY})
        open(f"{job_id}.tar.gz", "wb").write(dl.content)
    return "", 204
```

---

## 10. Browser Live Stream (JavaScript)

The backend issues the stream token, hands it to the browser, and the browser opens the WebSocket directly. **The API key never reaches the browser.**

```javascript
// Backend: include stream_url and stream_token in your page/API response.
// Browser:

async function streamJob(streamUrl) {
  const ws = new WebSocket(streamUrl);  // token already in the URL from POST /jobs

  ws.onopen = () => console.log("connected");

  ws.onmessage = (event) => {
    const frame = JSON.parse(event.data);
    switch (frame.type) {
      case "status":
        document.getElementById("status").textContent = frame.data.status;
        break;
      case "log":
        appendLog(`[${frame.data.source}] ${frame.data.line}`);
        break;
      case "summary":
        showSummary(frame.data);   // cost_usd, num_turns, features, elapsed_s
        break;
      case "done":
        document.getElementById("status").textContent = frame.data.outcome;
        ws.close();
        break;
      case "error":
        showError(frame.data.message);
        break;
    }
  };

  ws.onclose = (e) => {
    if (e.code === 4401) showError("Stream token invalid or expired.");
    else console.log("stream closed", e.code);
  };
}

// Usage: streamJob(jobResponse.stream_url);
// The stream_url from POST /jobs already contains the token as a query parameter.
// Token expires 10 minutes after job submission — start the stream promptly.
```

---

## 11. Error Reference

| Status | When | Backend action |
|--------|------|----------------|
| `401 Unauthorized` | Missing or wrong `x-api-key` header | Check `BRAIN0_API_KEY` in your config |
| `404 Not Found` | job_id doesn't exist, or artifact file missing after succeeded | Verify job_id; if artifact missing, contact operator |
| `409 Conflict` | `GET /artifact` called before job succeeds | Poll `GET /jobs/{id}` until `status == "succeeded"`, then retry |
| `422 Unprocessable Entity` | Request body validation failed (bad URL, intent too short, etc.) | Fix the request; body contains Pydantic error detail |
| `503 Service Unavailable` | Job queue is at capacity (50 jobs) | Retry after a delay; implement exponential backoff |
| WS close `4401` | Stream token expired, malformed, or for a different job_id | Re-call `POST /jobs` to get a fresh token (if the original token expired), or verify you're using the token for the correct job |

---

## 12. Operational Notes

**Concurrency is 1.** Jobs run strictly sequentially. If `queue_depth` is N and `worker_busy` is true, the next job won't start until the current one finishes. Poll `GET /jobs/{id}` and use `queue_position` to estimate wait time.

**Sentinel state.** If `GET /healthz` returns `sandbox_dirty: true`, queued jobs will not progress. The worker is paused until an operator inspects the sandbox and deletes `.sandbox-dirty` on the server. If your job is in `queued` status and not moving, check `/healthz` first. You'll also see a `status` event on the WebSocket stream with `queue_blocked: true` and a reason.

**No TLS yet.** `BRAIN0_PUBLIC_BASE_URL` in `.env` uses `http://`. The `stream_url` will use `ws://` accordingly. v3 will add TLS via nginx; at that point update `BRAIN0_PUBLIC_BASE_URL` to `https://` and stream URLs will automatically switch to `wss://`. Do not hardcode the scheme.

---

## Appendix: JobRecord Field Reference

All fields from `GET /jobs/{id}` and the webhook body, sourced from `src/api/models.py`:

| Field | Type | Set when |
|-------|------|----------|
| `job_id` | string | Always. Format: `j-{unix_ts}-{hex8}` |
| `status` | string | Always. See lifecycle above. |
| `repo_url` | string | Always |
| `user_intent` | string | Always |
| `callback_url` | string\|null | If provided at submission |
| `job_id_external` | string\|null | If provided at submission |
| `created_at` | ISO 8601 datetime | Always |
| `started_at` | ISO 8601 datetime\|null | When worker picks up the job |
| `finished_at` | ISO 8601 datetime\|null | On terminal state |
| `cost_usd` | float\|null | On succeeded (from Claude usage) |
| `num_turns` | int\|null | On succeeded (Claude conversation turns) |
| `feature_count` | int\|null | On succeeded (number of features extracted) |
| `tarball_bytes` | int\|null | On succeeded (size of the .tar.gz) |
| `error` | string\|null | On failed or timed_out |
| `queue_position` | int\|null | Live: 0=running, 1+=queued, null=terminal |
