# Conventions

## Code Style

### Bash (`install.sh`)

- **Strict mode:** `set -euo pipefail` at top
- **Functions:** `snake_case`, well-decomposed (30+ functions, avg ~15 lines each)
- **Logging:** Consistent `log()`, `step()`, `fail()` helpers — all output to stderr (`>&2`)
- **Step numbering:** `step "1/6" "Choose install folder"` — user-facing progress
- **Quoting:** Double-quoted variables throughout (`"$TARGET_DIR"`, `"$APP_PORT"`)
- **Heredocs:** `cat >file <<'EOF'` for multi-line file generation (single-quoted EOF for no expansion)
- **Error handling:** `fail()` exits with `exit 1`, all critical paths checked
- **Command existence:** `command_exists()` helper wraps `command -v`

### n8n Workflow JSON

- **Node naming:** Title Case descriptions (e.g., `Mint Amazon Access Token`, `Record BSR Result`)
- **Sticky notes:** Used for documentation within workflows
- **Code nodes:** JavaScript, typically 200-2700 chars, focused on data transformation
- **Credential parameters:** Stored in `Set Credentials` node with emoji prefix (`✅SPREADSHEET_ID`, `✅SHEET_NAME`)

### Embedded JavaScript (n8n Code nodes)

- **Style:** `const`/`let` declarations, template literals
- **n8n expressions:** `$json`, `$input`, `$node["Name"]`, `$if()`, `$('Node Name')`
- **Return format:** Always `return [{ json: { ... } }]`
- **Error handling:** Try/catch with descriptive error messages in some nodes

## Patterns

### Installer Patterns

- **Idempotent install:** Re-running re-scaffolds files; Docker containers restart gracefully
- **Port fallback:** Try 5678 → try 5679 → fail with message
- **Existing install detection:** Checks `docker-compose.yml` for previously used port
- **macOS folder picker:** AppleScript `choose folder` dialog, falls back to default path
- **Prerequisite chain:** Homebrew → Docker Desktop → install for user → start → wait for ready

### Workflow Patterns

- **Async report polling:** Create report → `Wait` node (loop) → check status → download when ready
- **Centralized auth:** Orchestrator mints all tokens, packages into auth bundle
- **Error recovery:** `Extract Report Id From Error` node handles Amazon's "duplicate report" response by extracting the existing report ID
- **Skip logic:** Each sub-workflow has `If` gates that check if the metric should be collected
- **Result recording:** Consistent `Record [Metric] Result` / `Record [Metric] Skipped` code nodes

## Error Handling

### Bash
- `set -euo pipefail` — exit on any error, undefined variable, or pipe failure
- `fail()` function for graceful error messages
- Retry/wait loops with fixed attempt limits (e.g., 60 attempts × 3s for Docker readiness)

### n8n Workflows
- Error branching via `If` nodes on HTTP response status
- Dedicated error extraction nodes (e.g., `Extract Report Id From Error`)
- No global error handler — errors propagate to n8n's built-in error handling
