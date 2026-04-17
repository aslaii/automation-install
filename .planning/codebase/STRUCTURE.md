# Structure

## Directory Layout

```
automation-install/
├── .git/                          # Git repository
├── .gitignore                     # Ignores .DS_Store
├── README.md                      # Usage docs (54 lines)
├── install.sh                     # Main installer script (606 lines)
└── workflows/                     # n8n workflow JSON bundles
    ├── manifest.txt               # URL-encoded list of workflows to import
    ├── Get Ad Spend.json          # Amazon Ads: ad spend metrics
    ├── Get BSR.json               # SP-API: Best Sellers Rank
    ├── Get CTR.json               # Amazon Ads: click-through rate
    ├── Get Clicks.json            # Amazon Ads: click counts
    ├── Get FBAPerUnitFulfillmentFee.json  # SP-API: FBA fees
    ├── Get FBA_FBM Stock.json     # SP-API: inventory levels
    ├── Get Refund.json            # SP-API: refund amounts
    ├── Get Reversal Reimbursement.json    # SP-API: reimbursements
    ├── Get Sales Organic.json     # SP-API: organic sales
    ├── Get Sales PPC.json         # Amazon Ads: PPC sales
    ├── Get Units Organic.json     # SP-API: organic units sold
    ├── Get Units PPC.json         # Amazon Ads: PPC units sold
    └── Unified Amazon Metrics Orchestrator (Apr 16 at 05_30_45).json  # Main orchestrator
```

## Key Locations

| Path | Purpose |
|------|---------|
| `install.sh` | **The entire installer** — all logic in one file |
| `workflows/` | Pre-built n8n workflow JSON definitions |
| `workflows/manifest.txt` | Controls which workflows are imported during install |

## Generated at Install Target

The installer creates this structure at the target directory:

```
<target>/
├── Dockerfile           # n8n + poppler multi-stage build
├── docker-compose.yml   # Service definition
├── .env.example         # Credential template
├── INSTALLER.md         # Post-install instructions
├── n8n_data/            # n8n persistent data volume
├── workflows/           # Downloaded workflow JSONs (from manifest)
└── .automation/
    ├── install-state.json       # Install metadata
    ├── workflows-manifest.txt   # Downloaded manifest
    └── workflows-imported       # Timestamp marker
```

## File Size Summary

| File | Lines | Bytes |
|------|-------|-------|
| `install.sh` | 606 | 15,139 |
| `README.md` | 54 | 2,173 |
| Orchestrator JSON | — | 96,057 |
| Sub-workflow JSONs | — | ~22K–37K each |
| `manifest.txt` | 14 | 367 |

## Naming Conventions

- **Workflows:** Descriptive verb-noun format: `Get [Metric Name]`
- **Orchestrator:** Full name with timestamp: `Unified Amazon Metrics Orchestrator (Apr 16 at 05:30:45)`
- **Bash functions:** `snake_case` (e.g., `ensure_docker_desktop_ready`, `choose_app_port`)
- **Environment variables:** `SCREAMING_SNAKE_CASE` with `AUTOMATION_INSTALLER_` prefix
- **n8n nodes:** Title Case (e.g., `Set Credentials`, `Mint Amazon Access Token`)
