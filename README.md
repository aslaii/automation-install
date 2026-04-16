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

## Optional Environment Flags

```bash
AUTOMATION_INSTALLER_SKIP_DOCKER=1 curl -fsSL https://raw.githubusercontent.com/aslaii/automation-install/main/install.sh | bash -s -- --target "/tmp/Automation"
AUTOMATION_INSTALLER_SKIP_OPEN=1 curl -fsSL https://raw.githubusercontent.com/aslaii/automation-install/main/install.sh | bash -s -- --target "/tmp/Automation"
AUTOMATION_INSTALLER_NO_UI=1 curl -fsSL https://raw.githubusercontent.com/aslaii/automation-install/main/install.sh | bash
```

## Notes

- macOS only
- Docker/Homebrew installation can still trigger permission, license, or admin prompts
- If port `5678` is already in use, the installer stops and tells you to free it
