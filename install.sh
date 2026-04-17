#!/usr/bin/env bash

set -euo pipefail

DEFAULT_PORT="5678"
FALLBACK_PORT="5679"
DEFAULT_TARGET="$HOME/Automation"
TARGET_ARG=""
TARGET_DIR=""
STATE_DIR=""
APP_PORT=""
BREW_BIN=""
UPDATE_SETTINGS_ONLY="0"
SKIP_DOCKER="${AUTOMATION_INSTALLER_SKIP_DOCKER:-0}"
SKIP_OPEN="${AUTOMATION_INSTALLER_SKIP_OPEN:-0}"
ASSUME_YES="${AUTOMATION_INSTALLER_ASSUME_YES:-1}"
NO_UI="${AUTOMATION_INSTALLER_NO_UI:-0}"
REIMPORT_WORKFLOWS="${AUTOMATION_INSTALLER_REIMPORT_WORKFLOWS:-0}"
INSTALL_SOURCE="${AUTOMATION_INSTALLER_SOURCE:-https://raw.githubusercontent.com/aslaii/automation-install/main/install.sh}"

log() {
	printf '[Automation] %s\n' "$*" >&2
}

step() {
	printf '\n[Automation] Step %s: %s\n' "$1" "$2" >&2
}

fail() {
	printf '[Automation] %s\n' "$*" >&2
	exit 1
}

usage() {
	cat <<'EOF'
Usage: bash ./install.sh [--target <path>] [--update-settings]

Options:
  --target <path>   Install runtime into this folder (default: ~/Automation)
  --update-settings Rewrite runtime files and rebuild n8n without reimporting workflows
  --help            Show this help message

Environment:
  AUTOMATION_INSTALLER_SKIP_DOCKER=1  Scaffold files only
  AUTOMATION_INSTALLER_SKIP_OPEN=1    Do not open localhost after startup
  AUTOMATION_INSTALLER_ASSUME_YES=1   Install prerequisites non-interactively
  AUTOMATION_INSTALLER_NO_UI=1        Skip macOS folder picker and use defaults
  AUTOMATION_INSTALLER_REIMPORT_WORKFLOWS=1  Reimport workflows even if already imported once
EOF
}

parse_args() {
	while [[ $# -gt 0 ]]; do
		case "$1" in
		--target)
			[[ $# -ge 2 ]] || fail "Missing value for --target."
			TARGET_ARG="$2"
			shift 2
			;;
		--update-settings)
			UPDATE_SETTINGS_ONLY="1"
			shift
			;;
		--help | -h)
			usage
			exit 0
			;;
		*)
			fail "Unknown argument: $1"
			;;
		esac
	done
}

expand_home() {
	local value="$1"
	case "$value" in
	"~") printf '%s\n' "$HOME" ;;
	~/*) printf '%s/%s\n' "$HOME" "${value#~/}" ;;
	*) printf '%s\n' "$value" ;;
	esac
}

normalize_target() {
	local raw_target
	local chosen_target
	if [[ -z "$TARGET_ARG" ]]; then
		chosen_target="$(choose_target_arg)"
		TARGET_ARG="$(printf '%s\n' "$chosen_target" | sed 's/\r$//' | awk 'NF { value = $0 } END { print value }')"
	fi

	raw_target="$(expand_home "${TARGET_ARG:-$DEFAULT_TARGET}")"
	raw_target="$(printf '%s' "$raw_target" | tr -d '\r')"
	[[ -n "$raw_target" ]] || fail "Install target cannot be empty."
	[[ "$raw_target" != *$'\n'* ]] || fail "Install target cannot contain newlines."

	mkdir -p "$raw_target"
	TARGET_DIR="$(cd "$raw_target" && pwd)"
	STATE_DIR="$TARGET_DIR/.automation"
}

choose_target_arg() {
	if [[ "$NO_UI" == "1" ]]; then
		log "UI disabled. Using default install folder ${DEFAULT_TARGET}."
		printf '%s\n' "$DEFAULT_TARGET"
		return 0
	fi

	if [[ "$(uname -s)" != "Darwin" ]] || ! command_exists osascript; then
		log "macOS folder picker is unavailable. Using default install folder ${DEFAULT_TARGET}."
		printf '%s\n' "$DEFAULT_TARGET"
		return 0
	fi

	log "Opening macOS folder picker..."

	local selected
	selected="$(
		osascript <<'APPLESCRIPT'
try
	set selectedFolder to choose folder with prompt "Choose where to install Automation:"
	return POSIX path of selectedFolder
on error number -128
	return ""
end try
APPLESCRIPT
	)"

	if [[ -n "$selected" ]]; then
		log "Folder selected: ${selected%/}"
		printf '%s\n' "${selected%/}"
		return 0
	fi

	log "Folder picker was cancelled. Using default install folder ${DEFAULT_TARGET}."
	printf '%s\n' "$DEFAULT_TARGET"
}

command_exists() {
	command -v "$1" >/dev/null 2>&1
}

run_cmd() {
	local label="$1"
	shift
	log "$label"
	"$@"
}

print_intro() {
	log "Do not run this installer with 'sudo bash'."
	log "The installer will request admin access only when it is actually needed."
	if [[ "$UPDATE_SETTINGS_ONLY" == "1" ]]; then
		log "Update mode enabled: runtime settings will be refreshed and n8n will be rebuilt."
	fi
}

source_base_url() {
	printf '%s\n' "${INSTALL_SOURCE%/install.sh}"
}

write_dockerfile() {
	cat >"$TARGET_DIR/Dockerfile" <<'EOF'
FROM alpine:3.22 AS poppler

RUN apk add --no-cache poppler-utils

FROM n8nio/n8n:2.15.1

USER root

COPY --from=poppler /usr/bin/pdftoppm /usr/bin/pdftoppm
COPY --from=poppler /usr/lib/ /usr/lib/
COPY --from=poppler /lib/ /lib/

USER node
EOF
}

write_docker_compose() {
	cat >"$TARGET_DIR/docker-compose.yml" <<'EOF'
services:
  n8n:
    build:
      context: .
      dockerfile: Dockerfile
    ports:
      - "__APP_PORT__:5678"
    environment:
      - N8N_HOST=localhost
      - N8N_PORT=5678
      - N8N_PROTOCOL=http
      - N8N_SECURE_COOKIE=false
      - TZ=${TZ:-Asia/Manila}
      - GENERIC_TIMEZONE=${TZ:-Asia/Manila}
      - N8N_RUNNERS_ENABLED=true
      - N8N_RUNNERS_MODE=internal
      - NODE_FUNCTION_ALLOW_BUILTIN=crypto
      - NODES_EXCLUDE=[]
    volumes:
      - ./n8n_data:/home/node/.n8n
    restart: unless-stopped
EOF
	sed -i '' "s/__APP_PORT__/${APP_PORT}/g" "$TARGET_DIR/docker-compose.yml"
}

write_env_example() {
	cat >"$TARGET_DIR/.env.example" <<'EOF'
# Amazon Ads OAuth
AMAZON_ADS_CLIENT_ID=
AMAZON_ADS_CLIENT_SECRET=
AMAZON_ADS_REFRESH_TOKEN=
AMAZON_ADS_PROFILE_ID=

# Amazon Selling Partner OAuth
AMAZON_SP_CLIENT_ID=
AMAZON_SP_CLIENT_SECRET=
AMAZON_SP_REFRESH_TOKEN=

# Optional (defaults shown)
AMAZON_ADS_COLUMNS=cost,clicks,impressions,advertisedAsin,advertisedSku
EOF
}

write_install_guide() {
	cat >"$TARGET_DIR/INSTALLER.md" <<'EOF'
# Automation Installer

This folder was created by the self-contained `install.sh` installer.

## What Was Installed

- `Dockerfile`
- `docker-compose.yml`
- `.env.example`
- `n8n_data/`
- `.automation/install-state.json`
- `workflows/`

## Start Or Restart n8n

```bash
docker compose up -d --build
```

## Stop n8n

```bash
docker compose down
```

## Open n8n

Visit `http://localhost:5678`

## Workflow Import

The installer imports the workflow JSON files from the bundled `workflows/` folder after n8n starts.

If you need to import them again later, rerun the installer with:

```bash
AUTOMATION_INSTALLER_REIMPORT_WORKFLOWS=1 bash ./install.sh --target "$(pwd)"
```
EOF
	sed -i '' "s/5678/${APP_PORT}/g" "$TARGET_DIR/INSTALLER.md"
}

detect_existing_target_port() {
	local compose_file="$TARGET_DIR/docker-compose.yml"
	if [[ ! -f "$compose_file" ]]; then
		return 1
	fi

	local detected
	detected="$(grep -E '^[[:space:]]*-[[:space:]]*"[0-9]+:5678"' "$compose_file" | sed -E 's/.*"([0-9]+):5678".*/\1/' | head -n 1)"
	if [[ -n "$detected" ]]; then
		printf '%s\n' "$detected"
		return 0
	fi

	return 1
}

port_is_listening() {
	local port="$1"
	lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1
}

choose_app_port() {
	local existing_port=""
	if existing_port="$(detect_existing_target_port 2>/dev/null)"; then
		APP_PORT="$existing_port"
		log "Existing install already uses localhost:${APP_PORT}. Reusing that port."
		return 0
	fi

	if ! port_is_listening "$DEFAULT_PORT"; then
		APP_PORT="$DEFAULT_PORT"
		log "Using default port ${DEFAULT_PORT}."
		return 0
	fi

	if ! port_is_listening "$FALLBACK_PORT"; then
		APP_PORT="$FALLBACK_PORT"
		log "Port ${DEFAULT_PORT} is busy. Using ${FALLBACK_PORT} instead."
		return 0
	fi

	fail "Ports ${DEFAULT_PORT} and ${FALLBACK_PORT} are both in use. Free one of them and rerun the installer."
}

scaffold_install_dir() {
	log "Writing runtime files into ${TARGET_DIR}..."
	mkdir -p "$TARGET_DIR" "$TARGET_DIR/n8n_data" "$STATE_DIR"

	write_dockerfile
	write_docker_compose
	write_env_example
	write_install_guide
}

write_install_state() {
	log "Recording install state..."
	cat >"$STATE_DIR/install-state.json" <<EOF
{
  "installedAt": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "source": "${INSTALL_SOURCE}",
  "installRoot": "${TARGET_DIR}",
  "appPort": "${APP_PORT}",
  "runtimeFiles": [
    "Dockerfile",
    "docker-compose.yml",
    ".env.example",
    "INSTALLER.md"
  ]
}
EOF
}

find_brew_binary() {
	if command_exists brew; then
		command -v brew
		return 0
	fi

	local candidate
	for candidate in /opt/homebrew/bin/brew /usr/local/bin/brew; do
		if [[ -x "$candidate" ]]; then
			printf '%s\n' "$candidate"
			return 0
		fi
	done

	return 1
}

ensure_admin_access() {
	if [[ "$(uname -s)" != "Darwin" ]]; then
		return 0
	fi

	if ! command_exists sudo; then
		fail "sudo is required to install Homebrew and Docker Desktop on macOS."
	fi

	log "Administrator access is required. macOS may prompt for your password now."
	if ! sudo -v; then
		fail "Administrator privileges were not granted. Please rerun from an admin account or preinstall Homebrew and Docker Desktop."
	fi
}

ensure_homebrew_available() {
	BREW_BIN=""
	if BREW_BIN="$(find_brew_binary 2>/dev/null)"; then
		log "Homebrew detected at $BREW_BIN."
		return 0
	fi

	if [[ "$ASSUME_YES" != "1" ]]; then
		fail "Homebrew is required. Re-run with AUTOMATION_INSTALLER_ASSUME_YES=1 to install it automatically."
	fi

	log "Homebrew is not installed. Installing it now..."
	ensure_admin_access
	log "Homebrew may take a few minutes to install. You should see Homebrew output below."
	run_cmd "Installing Homebrew..." /bin/bash -c "NONINTERACTIVE=1 /bin/bash -c \"\$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)\""

	if ! BREW_BIN="$(find_brew_binary 2>/dev/null)"; then
		fail "Homebrew installation completed but brew was not found on disk."
	fi

	log "Homebrew installed successfully at $BREW_BIN."
}

find_docker_desktop_app() {
	local candidate
	for candidate in /Applications/Docker.app "$HOME/Applications/Docker.app"; do
		if [[ -d "$candidate" ]]; then
			printf '%s\n' "$candidate"
			return 0
		fi
	done

	return 1
}

docker_info_okay() {
	docker info >/dev/null 2>&1
}

ensure_docker_desktop_installed() {
	if find_docker_desktop_app >/dev/null 2>&1; then
		log "Docker Desktop app detected."
		return 0
	fi

	log "Docker Desktop is not installed. Installing it now..."
	ensure_homebrew_available
	log "Docker Desktop download/install may take a few minutes."
	run_cmd "Installing Docker Desktop with Homebrew..." "$BREW_BIN" install --cask docker-desktop
	log "Docker Desktop installation command finished."
}

install_docker_desktop_for_current_user() {
	local app_path install_binary current_user
	app_path="$(find_docker_desktop_app)" || fail "Docker Desktop could not be located after installation."
	install_binary="$app_path/Contents/MacOS/install"
	[[ -x "$install_binary" ]] || fail "Docker Desktop install helper is missing."
	current_user="${USER:-$(id -un)}"
	ensure_admin_access
	run_cmd "Running Docker Desktop installer for ${current_user}..." sudo "$install_binary" --accept-license "--user=${current_user}"
}

start_docker_desktop() {
	local app_path
	app_path="$(find_docker_desktop_app)" || fail "Docker Desktop could not be located after installation."
	run_cmd "Launching Docker Desktop..." open -a "$app_path"
}

wait_for_docker_ready() {
	local attempt
	log "Waiting for Docker Desktop to become ready..."
	for attempt in $(seq 1 60); do
		if docker_info_okay; then
			log "Docker Desktop is ready."
			return 0
		fi
		sleep 3
	done

	fail "Docker Desktop did not become ready within 3 minutes."
}

ensure_docker_desktop_ready() {
	if docker_info_okay; then
		log "Docker is already running."
		return 0
	fi

	ensure_docker_desktop_installed
	install_docker_desktop_for_current_user
	start_docker_desktop
	wait_for_docker_ready
}

current_target_owns_running_stack() {
	if ! docker compose -f "$TARGET_DIR/docker-compose.yml" ps --services --status running >/tmp/automation-install-ps.$$ 2>/dev/null; then
		rm -f /tmp/automation-install-ps.$$
		return 1
	fi

	if grep -qx 'n8n' /tmp/automation-install-ps.$$; then
		rm -f /tmp/automation-install-ps.$$
		return 0
	fi

	rm -f /tmp/automation-install-ps.$$
	return 1
}

ensure_install_port_available() {
	if current_target_owns_running_stack; then
		return 0
	fi

	if lsof -nP -iTCP:"$APP_PORT" -sTCP:LISTEN >/dev/null 2>&1; then
		fail "Port ${APP_PORT} is already in use. Stop the existing local stack on that port, or rerun against the target that already owns it."
	fi
}

start_stack() {
	run_cmd "Starting Automation stack..." docker compose -f "$TARGET_DIR/docker-compose.yml" up -d --build
}

stop_stack_if_present() {
	if docker compose -f "$TARGET_DIR/docker-compose.yml" ps >/dev/null 2>&1; then
		log "Stopping existing Automation stack before rebuild..."
		docker compose -f "$TARGET_DIR/docker-compose.yml" down || true
	fi
}

wait_for_n8n_http() {
	local attempt
	log "Waiting for n8n to respond on http://localhost:${APP_PORT} ..."
	for attempt in $(seq 1 60); do
		if curl -fsS "http://localhost:${APP_PORT}" >/dev/null 2>&1; then
			log "n8n is responding on http://localhost:${APP_PORT}."
			return 0
		fi
		sleep 2
	done

	fail "n8n did not become reachable on http://localhost:${APP_PORT} within 2 minutes."
}

workflow_import_already_done() {
	if [[ "$UPDATE_SETTINGS_ONLY" == "1" && "$REIMPORT_WORKFLOWS" != "1" ]]; then
		return 0
	fi
	[[ "$REIMPORT_WORKFLOWS" != "1" && -f "$STATE_DIR/workflows-imported" ]]
}

download_workflows() {
	local base_url manifest_url manifest_file workflow_dir entry workflow_url local_name
	base_url="$(source_base_url)"
	manifest_url="${base_url}/workflows/manifest.txt"
	manifest_file="$STATE_DIR/workflows-manifest.txt"
	workflow_dir="$TARGET_DIR/workflows"

	if ! curl -fsSL "$manifest_url" -o "$manifest_file"; then
		log "No workflow manifest found at ${manifest_url}. Skipping workflow import."
		return 1
	fi

	rm -rf "$workflow_dir"
	mkdir -p "$workflow_dir"

	while IFS= read -r entry || [[ -n "$entry" ]]; do
		[[ -n "$entry" ]] || continue
		case "$entry" in
		\#*) continue ;;
		esac

		workflow_url="${base_url}/workflows/${entry}"
		local_name="$(basename "$entry")"
		log "Downloading workflow file ${local_name} ..."
		curl -fsSL "$workflow_url" -o "$workflow_dir/$local_name"
	done <"$manifest_file"

	return 0
}

import_workflows() {
	local container_id remote_dir

	if workflow_import_already_done; then
		log "Workflows were already imported for this install. Skipping import."
		return 0
	fi

	if ! download_workflows; then
		return 0
	fi

	container_id="$(docker compose -f "$TARGET_DIR/docker-compose.yml" ps -q n8n)"
	[[ -n "$container_id" ]] || fail "Could not find the running n8n container for workflow import."

	remote_dir="/tmp/automation-workflows"
	log "Copying workflow files into the n8n container..."
	docker exec "$container_id" rm -rf "$remote_dir"
	docker exec "$container_id" mkdir -p "$remote_dir"
	docker cp "$TARGET_DIR/workflows/." "$container_id:${remote_dir}/"

	log "Importing workflows into n8n..."
	docker exec "$container_id" n8n import:workflow --separate --input="$remote_dir"
	docker exec "$container_id" rm -rf "$remote_dir"
	date -u +"%Y-%m-%dT%H:%M:%SZ" >"$STATE_DIR/workflows-imported"
	log "Workflow import completed. Imported files are stored in $TARGET_DIR/workflows"
}

print_final_checklist() {
	printf '\n[Automation] Next steps\n' >&2
	printf '[Automation] 1. Open n8n at: http://localhost:%s\n' "$APP_PORT" >&2
	printf '[Automation] 2. Confirm the imported workflows are present in the Workflows list.\n' >&2
	printf '[Automation] 3. Fill in credentials and secrets inside n8n before running anything.\n' >&2
	printf '[Automation] 4. Start with: Unified Amazon Metrics Orchestrator\n' >&2
	printf '[Automation] 5. Imported workflows are inactive by default. Activate the ones you want after credentials are ready.\n' >&2
}

open_n8n() {
	if [[ "$SKIP_OPEN" == "1" ]]; then
		log "Skipping browser launch because AUTOMATION_INSTALLER_SKIP_OPEN=1."
		return 0
	fi

	run_cmd "Opening n8n..." open "http://localhost:${APP_PORT}"
}

main() {
	parse_args "$@"
	log "Starting Automation installer..."
	print_intro
	step "1/6" "Choose install folder"
	normalize_target
	step "2/6" "Choose port"
	choose_app_port

	log "Installing into $TARGET_DIR"
	log "Using localhost:${APP_PORT}"
	step "3/6" "Write runtime files"
	scaffold_install_dir
	write_install_state

	if [[ "$SKIP_DOCKER" == "1" ]]; then
		log "Skipping Docker bootstrap/startup because AUTOMATION_INSTALLER_SKIP_DOCKER=1."
		return 0
	fi

	step "4/6" "Check Docker and start n8n"
	ensure_docker_desktop_ready
	ensure_install_port_available
	stop_stack_if_present
	start_stack
	wait_for_n8n_http
	step "5/6" "Import workflows"
	import_workflows
	step "6/6" "Open n8n"
	open_n8n
	log "Open n8n at: http://localhost:${APP_PORT}"
	print_final_checklist
	log "Automation is ready in $TARGET_DIR"
}

main "$@"
