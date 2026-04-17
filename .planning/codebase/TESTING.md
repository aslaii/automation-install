# Testing

## Framework

**No automated test framework.** The project has no test infrastructure:
- No test files
- No CI/CD pipeline
- No linting configuration
- No type checking

## Current Testing Approach

Testing is entirely manual:

### Installer Testing
- Run `install.sh` with various flag combinations
- Environment variable overrides for CI-like scenarios:
  - `AUTOMATION_INSTALLER_SKIP_DOCKER=1` — test scaffolding without Docker
  - `AUTOMATION_INSTALLER_NO_UI=1` — test without macOS folder picker
  - `AUTOMATION_INSTALLER_SKIP_OPEN=1` — test without opening browser
- `--target` flag for custom install directories

### Workflow Testing
- Manual trigger via n8n UI
- Each sub-workflow has `manualTrigger` node for standalone testing
- Orchestrator has `manualTrigger` for end-to-end test

## Test Coverage

No automated test coverage. Key untested areas:

| Area | Risk |
|------|------|
| Port detection/fallback | Could fail on different macOS versions |
| Homebrew install flow | Requires clean machine to test |
| Docker Desktop install | Requires macOS without Docker |
| Workflow import | Depends on running n8n container |
| API token minting | Requires valid credentials |
| Report polling loops | Depends on external API state |
| Google Sheets write | Depends on valid spreadsheet + credentials |

## Recommended Testing Improvements

1. **ShellCheck** for `install.sh` static analysis
2. **BATS** (Bash Automated Testing System) for installer unit tests
3. **n8n test executions** via API for workflow validation
4. **GitHub Actions** CI for at minimum ShellCheck + scaffold-only install test
