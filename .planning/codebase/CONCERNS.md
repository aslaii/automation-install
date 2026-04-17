# Concerns

## Security

### High Priority

1. **Hardcoded credential patterns in workflow JSONs**
   - `Set Credentials` nodes contain field names like `✅SPREADSHEET_ID` — if users hardcode values here instead of using env vars, secrets ship in version control
   - The `.env.example` mentions OAuth credentials but there's no `.env` handling in `docker-compose.yml` — it doesn't source `.env`
   - **Impact:** Credential exposure if users commit filled-in workflow JSONs

2. **`curl | bash` distribution**
   - `install.sh` is fetched and piped directly to bash from GitHub
   - If the repo is compromised, anyone curling the installer runs arbitrary code
   - No checksum verification, no GPG signing
   - **Mitigation:** README offers a safer download-then-run alternative

3. **`sudo` usage**
   - `ensure_admin_access()` calls `sudo -v` and caches credentials
   - Used for Homebrew and Docker Desktop installation
   - **Impact:** Risk of escalated privilege if installer logic has bugs

### Medium Priority

4. **JWT assertion in Code node**
   - `Build JWT Assertion` node (8523 chars) constructs JWTs in-line with crypto operations
   - Private key material must be stored somewhere accessible to n8n
   - No key rotation mechanism visible

5. **OAuth tokens minted on every run**
   - No token caching — new tokens minted every orchestrator execution
   - Rate limiting risk with frequent runs

## Technical Debt

### High

1. **Monolithic installer script (606 lines)**
   - All logic in one file: argument parsing, UI, package management, file generation, Docker management, workflow import
   - Hard to test individual parts in isolation
   - No modular decomposition into separate scripts

2. **Workflow JSON files are not human-editable**
   - ~22-96K JSON files with coordinate data, UI metadata, node IDs
   - Any modification requires n8n's UI
   - Version control diffs are meaningless for workflow changes
   - Orchestrator filename includes timestamp: `Unified Amazon Metrics Orchestrator (Apr 16 at 05_30_45).json`

3. **Hardcoded workflow IDs in orchestrator**
   - Each `executeWorkflow` node references imported workflow IDs (e.g., `zC5vJ22Tb7i4dli8`)
   - These IDs are assigned by n8n at import time and will differ per installation
   - Fresh installs may get different IDs, breaking the orchestrator's dispatch
   - `Build Workflow Registry` code node may handle this, but it's a fragile coupling

### Medium

4. **No versioning for workflows**
   - Workflow JSONs have no version metadata
   - No way to tell which version of a workflow is installed
   - `workflows-imported` marker is a simple timestamp, not a manifest hash

5. **Port detection uses `lsof`**
   - `port_is_listening()` uses `lsof -nP -iTCP:$port -sTCP:LISTEN`
   - Requires elevated permissions in some macOS configurations
   - Could give false results with VPNs or network namespaces

6. **Platform lock-in (macOS only)**
   - `README.md` explicitly states "macOS only"
   - AppleScript folder picker, `open` command, Homebrew
   - `sed -i ''` uses macOS BSD syntax (not GNU)
   - No Linux support despite Docker being cross-platform

## Fragile Areas

| Area | Why It's Fragile |
|------|------------------|
| `sed -i ''` in file generation | macOS-only syntax; breaks on Linux |
| Docker Desktop wait loop | 60 × 3s = 3 min timeout; slow machines may fail |
| n8n version pinning (`2.15.1`) | Security patches require manual Dockerfile update |
| Workflow IDs after import | IDs are auto-assigned; orchestrator hardcodes them |
| `manifest.txt` URL encoding | Filenames with special chars must be manually URL-encoded |
| Report polling `Wait` nodes | Fixed wait times; Amazon API latency varies widely |

## Performance

- **No performance concerns for installer** — runs once
- **Workflow execution time** depends on Amazon API response times (async report generation can take 30s–5min)
- **Google Sheets API** batch updates are efficient (single request per metric)
- **No caching** of previously fetched data — each run re-fetches everything
