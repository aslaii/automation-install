#!/usr/bin/env bash

set -euo pipefail

DEFAULT_PORT="5678"
FALLBACK_PORT="5679"
DEFAULT_TARGET="$HOME/Automation"
TARGET_ARG=""
TARGET_DIR=""
STATE_DIR=""
APP_PORT=""
SKIP_DOCKER="${AUTOMATION_INSTALLER_SKIP_DOCKER:-0}"
SKIP_OPEN="${AUTOMATION_INSTALLER_SKIP_OPEN:-0}"
ASSUME_YES="${AUTOMATION_INSTALLER_ASSUME_YES:-1}"
NO_UI="${AUTOMATION_INSTALLER_NO_UI:-0}"
INSTALL_SOURCE="${AUTOMATION_INSTALLER_SOURCE:-https://raw.githubusercontent.com/aslaii/automation-install/main/install.sh}"

log() {
	printf '[Automation] %s\n' "$*"
}

fail() {
	printf '[Automation] %s\n' "$*" >&2
	exit 1
}

usage() {
	cat <<'EOF'
Usage: bash ./install.sh [--target <path>]

Options:
  --target <path>   Install runtime into this folder (default: ~/Automation)
  --help            Show this help message

Environment:
  AUTOMATION_INSTALLER_SKIP_DOCKER=1  Scaffold files only
  AUTOMATION_INSTALLER_SKIP_OPEN=1    Do not open localhost after startup
  AUTOMATION_INSTALLER_ASSUME_YES=1   Install prerequisites non-interactively
  AUTOMATION_INSTALLER_NO_UI=1        Skip macOS folder picker and use defaults
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
	if [[ -z "$TARGET_ARG" ]]; then
		TARGET_ARG="$(choose_target_arg)"
	fi

	raw_target="$(expand_home "${TARGET_ARG:-$DEFAULT_TARGET}")"
	[[ -n "$raw_target" ]] || fail "Install target cannot be empty."
	[[ "$raw_target" != *$'\n'* ]] || fail "Install target cannot contain newlines."

	mkdir -p "$raw_target"
	TARGET_DIR="$(cd "$raw_target" && pwd)"
	STATE_DIR="$TARGET_DIR/.automation"
}

choose_target_arg() {
	if [[ "$NO_UI" == "1" ]]; then
		printf '%s\n' "$DEFAULT_TARGET"
		return 0
	fi

	if [[ "$(uname -s)" != "Darwin" ]] || ! command_exists osascript; then
		printf '%s\n' "$DEFAULT_TARGET"
		return 0
	fi

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
		printf '%s\n' "${selected%/}"
		return 0
	fi

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
		return 0
	fi

	if ! port_is_listening "$DEFAULT_PORT"; then
		APP_PORT="$DEFAULT_PORT"
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
	mkdir -p "$TARGET_DIR" "$TARGET_DIR/n8n_data" "$STATE_DIR"

	write_dockerfile
	write_docker_compose
	write_env_example
	write_install_guide
}

write_install_state() {
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

ensure_homebrew_available() {
	local brew_bin=""
	if brew_bin="$(find_brew_binary 2>/dev/null)"; then
		log "Homebrew detected at $brew_bin."
		printf '%s\n' "$brew_bin"
		return 0
	fi

	if [[ "$ASSUME_YES" != "1" ]]; then
		fail "Homebrew is required. Re-run with AUTOMATION_INSTALLER_ASSUME_YES=1 to install it automatically."
	fi

	run_cmd "Installing Homebrew..." /bin/bash -c "NONINTERACTIVE=1 /bin/bash -c \"\$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)\""

	if ! brew_bin="$(find_brew_binary 2>/dev/null)"; then
		fail "Homebrew installation completed but brew was not found on disk."
	fi

	printf '%s\n' "$brew_bin"
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

	local brew_bin
	brew_bin="$(ensure_homebrew_available)"
	run_cmd "Installing Docker Desktop with Homebrew..." "$brew_bin" install --cask docker-desktop
}

install_docker_desktop_for_current_user() {
	local app_path install_binary current_user
	app_path="$(find_docker_desktop_app)" || fail "Docker Desktop could not be located after installation."
	install_binary="$app_path/Contents/MacOS/install"
	[[ -x "$install_binary" ]] || fail "Docker Desktop install helper is missing."
	current_user="${USER:-$(id -un)}"
	run_cmd "Running Docker Desktop installer for ${current_user}..." "$install_binary" --accept-license "--user=${current_user}"
}

start_docker_desktop() {
	local app_path
	app_path="$(find_docker_desktop_app)" || fail "Docker Desktop could not be located after installation."
	run_cmd "Launching Docker Desktop..." open -a "$app_path"
}

wait_for_docker_ready() {
	local attempt
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

open_n8n() {
	if [[ "$SKIP_OPEN" == "1" ]]; then
		log "Skipping browser launch because AUTOMATION_INSTALLER_SKIP_OPEN=1."
		return 0
	fi

	run_cmd "Opening n8n..." open "http://localhost:${APP_PORT}"
}

main() {
	parse_args "$@"
	normalize_target
	choose_app_port

	log "Installing into $TARGET_DIR"
	log "Using localhost:${APP_PORT}"
	scaffold_install_dir
	write_install_state

	if [[ "$SKIP_DOCKER" == "1" ]]; then
		log "Skipping Docker bootstrap/startup because AUTOMATION_INSTALLER_SKIP_DOCKER=1."
		return 0
	fi

	ensure_docker_desktop_ready
	ensure_install_port_available
	start_stack
	open_n8n
	log "Automation is ready in $TARGET_DIR"
}

main "$@"
