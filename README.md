# automation-install

Self-contained macOS installer for the Docker-based `n8n` runtime.

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/aslaii/automation-install/main/install.sh | bash
```

On macOS, this opens a folder picker by default so the user can choose where to install.

## Install To A Custom Folder

```bash
curl -fsSL https://raw.githubusercontent.com/aslaii/automation-install/main/install.sh | bash -s -- --target "$HOME/Automation"
```

## Update n8n Settings Only

Picker-based update for an existing install:

```bash
curl -fsSL https://raw.githubusercontent.com/aslaii/automation-install/main/install.sh | bash -s -- --update-settings
```

Explicit target update:

```bash
curl -fsSL https://raw.githubusercontent.com/aslaii/automation-install/main/install.sh | bash -s -- --target "$HOME/Automation" --update-settings
```

This mode rewrites the runtime files, runs `docker compose down`, then `docker compose up -d --build`, and skips workflow reimport unless you also set `AUTOMATION_INSTALLER_REIMPORT_WORKFLOWS=1`.

## Safer Download-Then-Run

```bash
curl -fsSL https://raw.githubusercontent.com/aslaii/automation-install/main/install.sh -o install.sh
bash ./install.sh --target "$HOME/Automation"
```

## Behavior

- Opens a macOS folder picker by default
- Falls back to `~/Automation` when UI is disabled or unavailable
- Installs Homebrew if missing
- Installs Docker Desktop if missing
- Creates a runtime folder with `Dockerfile`, `docker-compose.yml`, `.env.example`, `n8n_data/`, and `.automation/install-state.json`
- Starts `n8n` on `http://localhost:5678`
- If `5678` is already busy, automatically falls back to `http://localhost:5679`
- Downloads and imports the workflow JSON files bundled in `workflows/` after n8n starts

## Optional Environment Flags

```bash
AUTOMATION_INSTALLER_SKIP_DOCKER=1 curl -fsSL https://raw.githubusercontent.com/aslaii/automation-install/main/install.sh | bash -s -- --target "/tmp/Automation"
AUTOMATION_INSTALLER_SKIP_OPEN=1 curl -fsSL https://raw.githubusercontent.com/aslaii/automation-install/main/install.sh | bash -s -- --target "/tmp/Automation"
AUTOMATION_INSTALLER_NO_UI=1 curl -fsSL https://raw.githubusercontent.com/aslaii/automation-install/main/install.sh | bash
AUTOMATION_INSTALLER_REIMPORT_WORKFLOWS=1 curl -fsSL https://raw.githubusercontent.com/aslaii/automation-install/main/install.sh | bash
```

- `AUTOMATION_INSTALLER_REIMPORT_WORKFLOWS=1` forces workflow import again on an existing install.

## After Install

The installer finishes by printing a short checklist:

- open n8n
- confirm imported workflows are present
- fill in credentials and secrets
- start with `Unified Amazon Metrics Orchestrator`
- activate workflows after credentials are ready

## Notes

- macOS only
- Docker/Homebrew installation can still trigger permission, license, or admin prompts
- If `5678` is already in use, the installer tries `5679`
- If both `5678` and `5679` are in use, the installer stops and tells you to free one
