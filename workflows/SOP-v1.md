# SOP — Unified Amazon Metrics Orchestrator (Version 1)

**Status:** Stabilization in progress
**Owner:** Automation team
**Last updated:** 2026-04-21
**n8n version:** 2.15.1 (Self Hosted)

---

## 1. Purpose

This document is the single source of truth for the team working on the Unified Amazon Metrics Orchestrator and its 12 child workflows. It captures the current state of version 1 — what works, what's broken, what we've already tried — so anyone picking up the work can get productive without re-investigating.

---

## 2. Scope of Version 1

The orchestrator runs 12 metric workflows end-to-end and writes results to the reporting sheet:

| # | Workflow | Source |
|---|---|---|
| 1 | Get Sales Organic | SP-API |
| 2 | Get Sales PPC | Ads API |
| 3 | Get Units Organic | SP-API |
| 4 | Get Units PPC | Ads API |
| 5 | Get BSR | SP-API |
| 6 | Get CTR | Ads API |
| 7 | Get Clicks | Ads API |
| 8 | Get Ad Spend | Ads API |
| 9 | Get Refund | SP-API |
| 10 | Get Reversal Reimbursement | SP-API |
| 11 | Get FBA/FBM Stock | SP-API |
| 12 | Get FBA Per-Unit Fulfillment Fee | SP-API |

Plus: **Retry Failed Amazon Metrics** (reruns any child that errored).

Expected orchestrator runtime: **40–60 minutes** (5 SP-API poll loops of 5–10 min each, sequential).

---

## 3. What Is Working

1. **All 12 workflows are 100% functional** when n8n and Amazon APIs are both healthy. No logic defects known in version 1.
2. **Data accuracy is acceptable** — both the transformation logic and the numbers produced match expectations for the metrics we've spot-checked.
3. **Individual workflow runs succeed** (see exec IDs 754, 752, 750, 745 in the screenshot — orchestrator success in 2–3 minutes when reports are already cached).
4. **Retry Failed Amazon Metrics** ran clean at exec ID 749 (8.5s). The "re-request a new SP report on CANCELLED/FATAL" flow is already wired inside `workflows/Get Refund.json` (`Refresh Amazon Token` → `Mint SP Access Token` path).
5. **Slack + Telegram final-report delivery is 100% working.** Those workflows are now in the repo and are not part of the instability we're chasing.

> The system is not architecturally broken. The two issues below are infrastructure/runtime problems, not workflow-logic problems.

---

## 4. Issues Being Fixed

### Issue #1 — Access token expires mid-run, retries reuse the stale token

**Symptom:**
`Error: SP report CANCELLED: 2026-04-17T10:45:24+00:00`
Thrown from the Normalize Poll Status Code node after a long orchestrator run.

**Where it happens:** Any SP-API child workflow that sits in a poll loop past the 1-hour LWA access-token TTL (Get Refund is the clearest reproducer — exec IDs 758, 755, 753, 751, 748, 746).

**Root cause — corrected:**
The "request a fresh SP report on `CANCELLED` / `FATAL`" retry path is **already implemented** in `workflows/Get Refund.json` (`Refresh Amazon Token` → `Mint SP Access Token` nodes are wired). That is not the bug.

The real bug: after the first mint, downstream HTTP nodes read the token via
`$('Set Credentials').first().json.AMAZON_ACCESS_TOKEN` — i.e. they pull from the **initial** `Set Credentials` output, which is cached for the whole run. When the orchestrator takes ~1h and a retry fires past the LWA 60-minute TTL, every retry call goes out with the **expired** access token. Amazon kills the report, we see `CANCELLED`, and the retry loop spins on the same dead token until it gives up.

**What we're doing:**
Revise every SP-API child so each retry mints a **new** access token before the create-report / poll / download HTTP calls, instead of reusing the one cached at the start of the run. Concretely:

1. Move `Refresh Amazon Token` → `Mint SP Access Token` **inside** the retry loop, not before it.
2. Replace `$('Set Credentials').first().json.AMAZON_ACCESS_TOKEN` references in the retry path with a reference to the freshly-minted token (e.g. `$('Mint SP Access Token').last().json.access_token`).
3. Apply the same pattern to Ads-API children that use `✅AMAZON_ADS_REFRESH_TOKEN`.
4. Belt-and-braces: proactively re-mint if `Date.now() - tokenMintedAt > 50 * 60 * 1000` (50 min), so we never cut it close to the 60-min TTL.

Files to touch: every SP-API child workflow in `workflows/` (Get Refund, Get BSR, Get Sales Organic, Get Units Organic, Get Reversal Reimbursement, Get FBA_FBM Stock, Get FBAPerUnitFulfillmentFee).

---

### Issue #2 — n8n kills workflows running longer than ~5 minutes

**Symptom:**
Stack trace:
```
Error: SP report CANCELLED: 2026-04-17T10:45:24+00:00
  at VmCodeWrapper (evalmachine.<anonymous>:38:9)
  at evalmachine.<anonymous>:59:2
  at Script.runInContext (node:vm:149:12)
  at runInContext (node:vm:301:6)
  at result (/usr/local/lib/node_modules/n8n/node_modules/
    .pnpm/@n8n+task-runner@file+packages+@n8n+task-runner_...)
```

**Root cause (hypothesis):** n8n 2.15.1 runs Code nodes in an external **task runner** process. When a Code node sits in a long poll loop (SP-API reports take 5–10 min each), the task runner times out and kills the node — which surfaces as a `CANCELLED` error even when the Amazon report itself was fine.

**Evidence:**
- `VmCodeWrapper` / `@n8n+task-runner` in the stack trace points at the task runner, not Amazon.
- Shorter orchestrator runs (~3 min, exec IDs 745, 750, 752) succeed.
- Long orchestrator runs (1h 1m, exec ID 757) are where children fail.

---

## 5. Solutions Tried / Applied

### 5.1 Current `docker-compose.yml` (already deployed)

```yaml
services:
  n8n:
    build:
      context: .
      dockerfile: Dockerfile
    ports:
      - "5678:5678"
    environment:
      - N8N_HOST=localhost
      - N8N_PORT=5678
      - N8N_PROTOCOL=http
      - N8N_SECURE_COOKIE=false
      - TZ=${TZ:-Asia/Manila}
      - GENERIC_TIMEZONE=${TZ:-Asia/Manila}

      # Task runner — internal mode + long timeout (Fixes 1+2)
      - N8N_RUNNERS_ENABLED=true
      - N8N_RUNNERS_MODE=internal
      - N8N_RUNNERS_TASK_REQUEST_TIMEOUT=600

      - NODE_FUNCTION_ALLOW_BUILTIN=crypto,fs
      - N8N_CONCURRENCY_PRODUCTION_LIMIT=20
      - NODES_EXCLUDE=[]

      # Workflow execution timeout — 2 hours (Fix 3)
      - EXECUTIONS_TIMEOUT=7200
      - EXECUTIONS_TIMEOUT_MAX=7200

      # Binary data to disk, prevents OOM on large SP-API reports (Fix 5)
      - N8N_DEFAULT_BINARY_DATA_MODE=filesystem

      # Auto-prune old executions (Fix 10)
      - EXECUTIONS_DATA_PRUNE=true
      - EXECUTIONS_DATA_MAX_AGE=168
    volumes:
      - ./n8n_data:/home/node/.n8n
    restart: unless-stopped
```

### 5.2 Fix matrix — ranked by effort and impact

| # | Fix | Effort | Impact | Status |
|---|---|---|---|---|
| 1 | `N8N_RUNNERS_MODE=internal` — Code nodes run in main process, no external runner timeout | 2 min | Directly targets VmCodeWrapper | **Applied** |
| 2 | `N8N_RUNNERS_TASK_REQUEST_TIMEOUT=600` — task matching timeout to 10 min | 2 min | Prevents task-matching timeout | **Applied** |
| 3 | `EXECUTIONS_TIMEOUT=7200` — workflow timeout to 2 hours | 2 min | Stops n8n from killing orchestrator mid-run | **Applied** |
| 4 | Add `MAX_POLL_ATTEMPTS` guard to every Normalize Poll Status node (~11 nodes) | 15 min | Stops infinite polling when Amazon stalls | **To do** |
| 5 | `N8N_DEFAULT_BINARY_DATA_MODE=filesystem` — prevents OOM | 2 min | Large report safety | **Applied** |
| 6 | Pin n8n image to a known-good tag instead of `latest` | 5 min | Prevents surprise auto-update breakage | **To do** |
| 7 | Split into three workflows (Start Reports / Poll Pending / Process Report) — event-driven via cron | 2–4 hrs | Eliminates long-running workflow problem entirely | **Proposed, not started** |
| 8 | Run SP-API metrics in parallel instead of sequential in the orchestrator | 1–2 hrs | Cuts runtime from 40–60 min → ~15 min | **Proposed, not started** |
| 9 | Downgrade to n8n v1.x (removes task runner system) | 30 min | Nuclear option if 1–3 don't solve it | **Not attempted** |
| 10 | `EXECUTIONS_DATA_PRUNE=true` + memory limits | 5 min | Housekeeping, prevents slow degradation | **Applied** (prune only) |
| 11 | **Re-mint SP/Ads access token inside the retry loop** instead of reusing the one cached by `Set Credentials` | 30–60 min per child | **Directly fixes Issue #1** — kills the 1h-TTL expiry failure | **To do** |

### 5.3 Snippet to paste at the top of every Normalize Poll Status Code node (Fix #4)

```javascript
const MAX_POLL_ATTEMPTS = 20;
const previousAttempt = Number(input.pollAttempt || 0);
if (previousAttempt >= MAX_POLL_ATTEMPTS) {
  throw new Error(
    `Poll abandoned after ${MAX_POLL_ATTEMPTS} attempts. ` +
    `Last status: ${rawStatus || 'UNKNOWN'}.`
  );
}
```

Bound: 20 attempts × 300 s = ~100 min worst case, well under the 2 h `EXECUTIONS_TIMEOUT`.

### 5.4 Per-retry token refresh pattern (Fix #11 — the real fix for Issue #1)

Every SP-API child needs this shape so long runs do not outlive the LWA 60-min access-token TTL:

```
Loop Start
  └─► Refresh Amazon Token  (POST https://api.amazon.com/auth/o2/token)
        └─► Mint SP Access Token  (Set node — writes access_token + mintedAt)
              └─► Create Report / Poll Status / Download Report
                    └─► on CANCELLED/FATAL → back to Loop Start
```

In every HTTP node inside the loop, replace:

```
={{ $('Set Credentials').first().json.AMAZON_ACCESS_TOKEN }}
```

with:

```
={{ $('Mint SP Access Token').last().json.access_token }}
```

Optional proactive re-mint (belt-and-braces) — guard at the top of the loop body:

```javascript
const mintedAt = Number($('Mint SP Access Token').last().json.mintedAt || 0);
const ageMs = Date.now() - mintedAt;
if (ageMs > 50 * 60 * 1000) {
  // route back to Refresh Amazon Token to mint a fresh one
  return [{ json: { forceRemint: true } }];
}
```

Apply to: Get Refund, Get BSR, Get Sales Organic, Get Units Organic, Get Reversal Reimbursement, Get FBA_FBM Stock, Get FBAPerUnitFulfillmentFee. Same pattern for Ads-API children using `✅AMAZON_ADS_REFRESH_TOKEN`.

### 5.5 Deploying workflow changes — `REIMPORT_WORKFLOWS=1`

Editing the `.json` files in `workflows/` does **not** push them into n8n. The n8n database has its own copy, and by default the installer only imports once (tracked via `workflows-imported` in the install state dir). After any edit to a workflow file you must force a reimport.

Canonical command (from the repo README — pulls the installer directly from GitHub `main`):

```bash
AUTOMATION_INSTALLER_REIMPORT_WORKFLOWS=1 curl -fsSL https://raw.githubusercontent.com/aslaii/automation-install/main/install.sh | bash
```

What that flag does (see `install.sh`):
1. Backs up the current `workflows/` directory.
2. Stops the n8n container.
3. Deletes the existing workflow rows from n8n's SQLite DB (requires `sqlite3` on host).
4. Brings n8n back up and runs `n8n import:workflow --separate --input=<workflows dir>` inside the container.
5. Stamps the install state with the new timestamp so subsequent plain runs skip reimport.

Without `AUTOMATION_INSTALLER_REIMPORT_WORKFLOWS=1`, the installer short-circuits on `workflow_import_already_done()` and your edits will not hit n8n.

> **Heads-up for the team:** the command above is self-contained — it fetches the latest `install.sh` from GitHub, which in turn pulls the latest `workflows/*.json` from the repo. No local `git pull` needed. Verify in the n8n UI (Executions → run the orchestrator once) that your change is live before closing the ticket.

#### 5.5.1 Don't want to run the command yourself? Ask the AI.

If you are working inside Claude Code (or any terminal-capable AI assistant) with terminal access, you can skip typing the command by giving the assistant this one-liner:

> **Prompt to paste:**
> "Reimport the n8n workflows by running `AUTOMATION_INSTALLER_REIMPORT_WORKFLOWS=1 curl -fsSL https://raw.githubusercontent.com/aslaii/automation-install/main/install.sh | bash`. Report back when the import completes and confirm n8n is healthy on http://localhost:5678."

The assistant will:
1. Execute the one-liner above (it will prompt for confirmation the first time — approve it).
2. Watch the installer output and tell you when `Importing workflows into n8n...` finishes cleanly.
3. Optionally hit `http://localhost:5678/healthz` to confirm n8n came back up.

If the assistant asks for permission to run `curl`, `docker`, `sqlite3`, or `bash`, **approve** — those are the exact commands the installer needs. Decline anything else.

### 5.6 One-time local provisioning — run the `Local Setup` workflow

Slack snapshot delivery (the part that converts the final PDF report into a PNG before posting it) needs local tooling inside the n8n container: two directories (`/home/node/.n8n/local-tools` and `/home/node/.n8n-files/snapshots`), a small `convert-first-page.js` helper, and the `pdftoppm` binary from `poppler-utils`.

`install.sh` already handles the binary via the Dockerfile (`FROM alpine:3.22 AS poppler` → `COPY --from=poppler /usr/bin/pdftoppm /usr/bin/pdftoppm`). The rest is handled by the `Local Setup` workflow (`workflows/Local Setup.json`), which must be run **once manually** after a fresh install or reimport.

**Steps:**
1. Open n8n → **Workflows** → **Local Setup**.
2. Click **Execute Workflow** (manual trigger).
3. Confirm all six nodes go green: `Manual Trigger` → `Set Local Config` → `Prepare Local Tooling` → `Verify PDF Renderer Package` → `Verify PDF Renderer` → `Build Setup Summary`.
4. The final `Build Setup Summary` node should return `status: "ready"` with a populated `rendererVersion` (e.g., `pdftoppm version 24.x`).

If `Verify PDF Renderer Package` fails with *"pdftoppm is missing. Rebuild the n8n image after updating Dockerfile"* — the container was not built from this repo's Dockerfile. Re-run `install.sh` (which rebuilds the image with poppler-utils baked in), then retry Local Setup.

**When to re-run it:**
- First install on a new machine.
- After any `docker compose down -v` (volume wipe clears `/home/node/.n8n-files`).
- After rebuilding the n8n image.
- After a REIMPORT if you notice Slack snapshots stop arriving.

#### 5.6.1 Ask the AI to do it for you

> **Prompt to paste:**
> "Trigger the `Local Setup` workflow in n8n at http://localhost:5678 and confirm all nodes complete successfully. The final node should return `status: 'ready'` with a populated `rendererVersion`. If `Verify PDF Renderer Package` fails, re-run `AUTOMATION_INSTALLER_REIMPORT_WORKFLOWS=1 curl -fsSL https://raw.githubusercontent.com/aslaii/automation-install/main/install.sh | bash` to rebuild the image, then retry."

The assistant can hit the n8n REST API to trigger the workflow and poll the execution status, or guide you through clicking through the UI — whichever it has permission for.

---

## 6. Evidence — Execution Log (Apr 21)

| Exec ID | Workflow | Status | Runtime | Notes |
|---|---|---|---|---|
| 758 | Get Refund | Error | 1h 1m 38s | Long-running kill — the main failure mode |
| 757 | Unified Amazon Metrics Orchestrator | Success | 1h 1m 40s | Parent completed but child #758 errored |
| 756 | Get Refund | Success | 103 ms | Cached-report path |
| 755, 753, 751, 748, 746 | Get Refund | Error | 700–750 ms | Fast failures — SP report CANCELLED on create |
| 754, 752, 750, 745 | Unified Amazon Metrics Orchestrator | Success | 2.7–3m 10s | Healthy runs when reports are cached |
| 749 | Retry Failed Amazon Metrics | Success | 8.583 s | Retry workflow itself is healthy |
| 747 | Unified Amazon Metrics Orchestrator | Error | 11.586 s | Early-stage failure |

**Pattern:** Long runs fail in a CANCELLED-shaped way. Short runs succeed. Consistent with task-runner timeout, not logic bugs.

---

## 7. How to Reproduce

1. Start orchestrator against a window where **no SP-API reports are cached** (fresh day).
2. Observe at least one SP-API child (Get Refund is the most reliable reproducer) sitting in the poll loop >5 min.
3. Expect `Error: SP report CANCELLED … at VmCodeWrapper` in the child's output.

To reproduce the cached-report healthy path: run the orchestrator twice in quick succession — the second run pulls cached reports and finishes in ~3 min.

---

## 8. Verification Checklist (Before Closing V1)

- [ ] Fixes 1–3, 5, 10 deployed (confirmed in `docker-compose.yml` above).
- [ ] Fix #4 (`MAX_POLL_ATTEMPTS` guard) rolled out to all ~11 Normalize Poll Status nodes.
- [ ] Fix #6 — n8n image pinned to a tested tag.
- [ ] **Fix #11 — per-retry token refresh applied to every SP-API and Ads-API child** (see 5.4).
- [ ] Workflows reimported after edits via `AUTOMATION_INSTALLER_REIMPORT_WORKFLOWS=1 curl -fsSL https://raw.githubusercontent.com/aslaii/automation-install/main/install.sh | bash` (see 5.5).
- [ ] **`Local Setup` workflow executed once** after fresh install / reimport — `Build Setup Summary` returns `status: "ready"` with a `rendererVersion` (see 5.6).
- [ ] Orchestrator runs to completion **5 times in a row**, including at least one fresh-report run that crosses the 60-min LWA TTL, with zero child errors.
- [ ] Retry Failed Amazon Metrics cleans up any outstanding failures in one pass.
- [ ] Slack + Telegram final-report deliveries arrive intact at the end of a full run.
- [ ] Output sheet values spot-checked against Amazon Seller Central for a known date range.

---

## 9. Parallel work — migrating off n8n to serverless functions (V2 direction)

While we keep V1 stable, I've already started porting the 12 metric workflows out of n8n into plain serverless functions (one function per metric + a lightweight orchestrator). This is not a scrap-and-rewrite — V1 keeps running — but it is the direction I expect us to converge on, and the team should know why.

**Why move off n8n:**

1. **The workflows outgrew n8n's model.** Every issue in Section 4 is structural: the task runner timeout, the 5-minute Code-node kill, the 1-hour token reuse, the "poll for 10 min inside one node" anti-pattern. None of these are bugs we can elegantly fix — they're symptoms of running long async jobs inside a UI-driven workflow engine designed for short request/response glue.

2. **Code nodes stopped being glue — they became the system.** Look at `Normalize Poll Status`, the retry logic, the token minting — the real behavior lives in JavaScript inside Code nodes. At that point the visual workflow is only holding wiring we already understand. We pay the n8n tax (task runner, DB, UI, upgrade risk) for almost no leverage.

3. **Operational footprint.** Running n8n means a Postgres/SQLite dependency, a Docker image we have to rebuild for `pdftoppm`, a `Local Setup` workflow that must be hand-triggered, execution-data pruning, memory tuning, version pinning. A serverless function has none of that. Deploy = push code.

4. **Long-running jobs belong in a different shape.** SP-API is a three-phase async protocol — request report, poll, download. The right fit is event-driven: one function creates reports and enqueues `reportId`s, one function polls queued reports on a cron, one function processes completed reports. Each function runs for seconds, not hours. No token-expiry problem because nothing runs long enough to expire. No task-runner kills because there's no task runner. Retries are just enqueues.

5. **Observability and local dev.** I can run a function locally with a single command, log to whatever we want, and test against a real Amazon sandbox without opening a browser. n8n's exec log is fine for triage but it's not a substitute for real observability, and there is no way to unit-test a Code node without the harness we already built under `scripts/` and `run-*-workflow-local.js`.

6. **Cost and scale.** At 12 metrics × daily runs we're well under any free tier on Lambda/Cloud Run/Workers. n8n needs a container running 24/7 whether we're using it or not.

**What the migration actually looks like:**

- `scripts/features/<metric>` already contains standalone implementations that do not depend on n8n — that's the foundation.
- Per-metric: one handler function. Inputs = date range + credentials. Output = rows written to the Google Sheet + a structured result object.
- Orchestrator: a cron-triggered handler that fans out to the per-metric handlers, collects results, writes summary, sends Slack/Telegram.
- Token management: mint per-invocation inside each handler. No sharing, no reuse, no 60-min surprise.
- Secrets: move out of `Set Credentials` nodes and into the serverless platform's secret manager (AWS Secrets Manager, GCP Secret Manager, Cloudflare secrets — decision pending).

**What this means for the team today:**

- Continue fixing V1. The stability fixes (#4, #11, Local Setup) are still required — V1 is our production path until V2 is verified in parallel.
- Don't build new metrics in n8n. New metrics should go into `scripts/features/` directly.
- Expect a future SOP replacing this one when V2 reaches parity.

---

## 10. Open Questions for the Team

1. Do we commit to Fix #7 (event-driven split inside n8n) for V2, or skip it and go straight to the serverless migration in Section 9?
2. Acceptable parallelism ceiling for Fix #8 given Amazon throttling? Current code handles 429s, but we haven't load-tested 5 concurrent report creates.
3. Which n8n version tag do we pin to? Need a version where internal-mode task runner + Code nodes are known-good.
4. Serverless platform for V2 — AWS Lambda, GCP Cloud Run, or Cloudflare Workers? Depends on how we want to handle cron + secrets + the Node runtime for `pdf-to-png-converter`.

---

## 11. Reference

- `workflows/manifest.txt` — canonical list of workflow files.
- Error location: `VmCodeWrapper (evalmachine.<anonymous>:38:9)` inside Normalize Poll Status nodes.
- n8n releases: https://github.com/n8n-io/n8n/releases
- n8n upgrade guide: https://docs.n8n.io/hosting/upgrading/
