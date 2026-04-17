# Stack

## Languages

| Language | Usage | Files |
|----------|-------|-------|
| **Bash** | Primary — installer script | `install.sh` |
| **JSON** | n8n workflow definitions | `workflows/*.json` |
| **JavaScript (embedded)** | Logic inside n8n Code nodes | Embedded in workflow JSONs |

## Runtime

- **Docker** — Container runtime for n8n
  - Base image: `n8nio/n8n:2.15.1`
  - Multi-stage build: `alpine:3.22` for poppler-utils (PDF support)
  - Orchestrated via `docker-compose.yml`
- **n8n** — Workflow automation platform, pinned to v2.15.1
  - Runs inside Docker on port `5678` (fallback `5679`)
  - Task runners enabled (`N8N_RUNNERS_ENABLED=true`, internal mode)
  - `NODE_FUNCTION_ALLOW_BUILTIN=crypto` — allows crypto module in Code nodes

## Frameworks / Tools

| Tool | Version | Purpose |
|------|---------|---------|
| n8n | 2.15.1 | Workflow automation engine |
| Docker Compose | Latest | Container orchestration |
| Homebrew | Latest | macOS package manager (installed if missing) |
| Docker Desktop | Latest (via `brew install --cask docker-desktop`) | Docker runtime for macOS |
| poppler-utils | Alpine 3.22 | PDF rendering (`pdftoppm`) for PDF-to-image conversion |

## Dependencies

**System-level (installed by `install.sh`):**
- Homebrew (auto-installed if missing)
- Docker Desktop (auto-installed via Homebrew Cask if missing)

**No application-level package manager** — no `package.json`, `requirements.txt`, `go.mod`, etc. The project is a pure Bash installer + n8n workflow bundle.

## Configuration

| Config | Location | Purpose |
|--------|----------|---------|
| `.env.example` | Generated at install target | Amazon Ads/SP OAuth credentials template |
| `docker-compose.yml` | Generated at install target | Docker service definition (port, volumes, env vars) |
| `Dockerfile` | Generated at install target | n8n image build with poppler |
| `.automation/install-state.json` | Generated at install target | Install metadata (date, source, port, files) |
| `workflows/manifest.txt` | Repo root | URL-encoded list of workflow JSONs to import |

**Environment variables consumed by `install.sh`:**

| Variable | Default | Purpose |
|----------|---------|---------|
| `AUTOMATION_INSTALLER_SKIP_DOCKER` | `0` | Scaffold files only, skip Docker |
| `AUTOMATION_INSTALLER_SKIP_OPEN` | `0` | Don't open browser after start |
| `AUTOMATION_INSTALLER_ASSUME_YES` | `1` | Non-interactive prerequisite install |
| `AUTOMATION_INSTALLER_NO_UI` | `0` | Skip macOS folder picker |
| `AUTOMATION_INSTALLER_REIMPORT_WORKFLOWS` | `0` | Force re-import of workflows |
| `AUTOMATION_INSTALLER_SOURCE` | GitHub raw URL | Source URL for remote install |

## Build & Deploy

- **No build step** — Bash script runs directly
- **Distribution:** `curl | bash` pattern from GitHub raw URL
- **Install flow:** Parse args → folder picker → port selection → scaffold files → ensure Docker → start stack → import workflows → open browser
