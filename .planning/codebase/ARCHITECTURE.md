# Architecture

## System Pattern

**Hub-and-spoke workflow orchestration**

The system follows a hub-and-spoke pattern:
- **Hub:** `Unified Amazon Metrics Orchestrator` (71 nodes) — centralizes auth, dispatches sub-workflows, aggregates results
- **Spokes:** 12 individual metric-fetching workflows, each a self-contained pipeline
- **Installer:** Standalone Bash script that bootstraps the entire runtime environment

```
┌─────────────────────────────────────────────────────────────┐
│                     install.sh                               │
│  (scaffolds Docker + n8n + imports workflows)                │
└─────────────────────────┬───────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                  Docker (n8n:2.15.1)                          │
│                                                              │
│  ┌───────────────────────────────────────────────────┐       │
│  │   Unified Amazon Metrics Orchestrator             │       │
│  │                                                   │       │
│  │  1. Mint tokens (Ads, SP-API, Google)             │       │
│  │  2. Build auth bundle                             │       │
│  │  3. Dispatch sub-workflows sequentially           │       │
│  │  4. Record results / skip decisions              │       │
│  │  5. Final summary                                │       │
│  └─┬──┬──┬──┬──┬──┬──┬──┬──┬──┬──┬──┬──────────────┘       │
│    │  │  │  │  │  │  │  │  │  │  │  │                       │
│    ▼  ▼  ▼  ▼  ▼  ▼  ▼  ▼  ▼  ▼  ▼  ▼                     │
│  ┌──┐┌──┐┌──┐┌──┐┌──┐┌──┐┌──┐┌──┐┌──┐┌──┐┌──┐┌──┐         │
│  │BS││Ad││CT││Cl││SP││UP││SO││UO││RF││RR││FS││FF│         │
│  │R ││$ ││R ││ck││PC││PC││rg││rg││nd││im││tk││ee│         │
│  └──┘└──┘└──┘└──┘└──┘└──┘└──┘└──┘└──┘└──┘└──┘└──┘         │
│                                                              │
│  Each spoke: receive auth → fetch report → write Sheets     │
└─────────────────────────────────────────────────────────────┘
```

## Layers

| Layer | Components | Purpose |
|-------|-----------|---------|
| **Distribution** | `install.sh`, `README.md`, `manifest.txt` | `curl \| bash` installer, remote workflow download |
| **Runtime** | `Dockerfile`, `docker-compose.yml` | Container build & orchestration |
| **Orchestration** | Unified Orchestrator workflow | Token minting, workflow dispatch, result aggregation |
| **Data Pipelines** | 12 sub-workflows | Individual metric extraction and Google Sheets writing |

## Data Flow

1. **Orchestrator** mints 3 OAuth tokens (Amazon Ads, SP-API, Google)
2. Packages tokens + config into an **auth bundle**
3. For each metric type: dispatches sub-workflow via `executeWorkflow`
4. Each sub-workflow:
   - Receives auth bundle via `executeWorkflowTrigger`
   - Creates async report request (Amazon API)
   - Polls for completion (`Wait` + `If` loop)
   - Downloads report data (gzipped/raw)
   - Decompresses + parses (CSV/TSV)
   - Aggregates by SKU
   - Reads current Google Sheet state
   - Writes updated values via batch update
5. Orchestrator records each result (success/skip/fail)
6. Produces final summary

## Entry Points

| Entry Point | Type | Description |
|-------------|------|-------------|
| `install.sh` | CLI | Main installer — `bash ./install.sh [--target <path>]` |
| `main()` function | Bash | `install.sh` entry at line 572 |
| n8n UI | Web | `http://localhost:5678` — manual trigger for orchestrator |
| Each sub-workflow | n8n trigger | Has `manualTrigger` + `executeWorkflowTrigger` for standalone/orchestrated use |

## Key Abstractions

- **Auth Bundle:** Single JSON blob containing all API tokens and config, passed to sub-workflows
- **Workflow Registry:** Code node that catalogs all sub-workflow IDs and names for dispatch
- **Report polling loop:** Shared pattern across sub-workflows (create → poll → download → parse)
- **Install state:** `.automation/install-state.json` tracks install metadata
