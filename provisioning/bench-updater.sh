#!/usr/bin/env bash
# bench-updater — atomic binary replacement and service restarts for the Noron
# benchmark appliance self-update system.
#
# This is a plain bash script (not a compiled binary) so it survives being
# replaced mid-update: bash reads the entire script into memory before
# executing it.

set -euo pipefail

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

BINARIES=(benchd bench-exec bench-web bench-setup bench runner-ctld)
BIN_DIR="/usr/local/bin"
HOOKS_DIR="/usr/local/lib/benchd/hooks"
HOOKS=(job-started job-completed)
DASHBOARD_DIR="/var/lib/bench/dashboard"
RUNNER_DIR="/opt/runner"
RUNNER_FILES=(Containerfile start.sh bench-runner-update.sh)
VERSION_FILE="/var/lib/bench/version"
UPDATES_DIR="/var/lib/bench/updates"
SYSTEMD_DIR="/etc/systemd/system"
STATIC_SERVICES=(benchd.service runner-ctld.service)
SELF_NAME="bench-updater"
SOCKET="/run/benchd/benchd.sock"
RUNNER_CTLD_SERVICE="/etc/systemd/system/runner-ctld.service"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

die() {
	echo "error: $*" >&2
	exit 1
}

info() {
	echo ":: $*"
}

require_root() {
	[[ $(id -u) -eq 0 ]] || die "must be run as root"
}

read_version() {
	[[ -f "$VERSION_FILE" ]] || die "version file not found: $VERSION_FILE"
	cat "$VERSION_FILE"
}

ipc_request() {
	echo "$1" | socat - UNIX-CONNECT:"$SOCKET" 2>/dev/null || echo '{}'
}

# Check that no benchmark is running. Refuses to proceed if the lock is held.
ensure_idle() {
	if [[ ! -S "$SOCKET" ]]; then
		info "benchd socket not found — assuming idle (service may be stopped)"
		return 0
	fi

	local resp
	resp=$(ipc_request "{\"type\":\"lock.status\",\"requestId\":\"idle-check\"}")

	if echo "$resp" | grep -q '"held":true'; then
		die "A benchmark is currently running. Cannot update while the lock is held. Try again later."
	fi

	info "No benchmark running — safe to proceed"
}

stop_service() {
	local svc="$1"
	info "stopping $svc"
	if ! timeout 10 systemctl stop "$svc" 2>/dev/null; then
		info "$svc did not stop in time — killing"
		systemctl kill -s KILL "$svc" 2>/dev/null || true
		# Wait briefly for systemd to process the kill
		timeout 5 systemctl stop "$svc" 2>/dev/null || true
	fi
}

stop_services() {
	stop_service bench-web.service
	stop_service runner-ctld.service
	stop_service benchd.service
}

start_services() {
	# Ensure tmpfs mount is active before starting services —
	# the mount unit may have been disabled or stopped during the update.
	local tmpfs_unit
	tmpfs_unit=$(systemctl list-unit-files --type=mount --no-legend \
		| awk '/bench.*tmpfs/ {print $1}' | head -n1)
	if [[ -n "$tmpfs_unit" ]]; then
		info "ensuring tmpfs mount: $tmpfs_unit"
		systemctl enable --now "$tmpfs_unit" 2>/dev/null || info "tmpfs mount failed (non-fatal)"
	fi

	info "starting benchd.service"
	systemctl start benchd.service
	info "starting runner-ctld.service"
	systemctl start runner-ctld.service
	info "starting bench-web.service"
	systemctl start bench-web.service

	# Rebuild runner container image if Containerfile was updated
	if [[ -d "$RUNNER_DIR" ]] && command -v podman &>/dev/null; then
		info "rebuilding runner container image"
		podman build -t bench-runner "$RUNNER_DIR" || info "image rebuild failed (non-fatal)"
	fi

	# Stop runner containers so they pick up new image + fresh benchd socket.
	# Containers use --rm so they're auto-removed on stop. The health check will
	# detect them as offline and trigger heal workflows to reprovision them.
	local containers
	containers=$(podman ps -q --filter "name=bench-" 2>/dev/null || true)
	if [[ -n "$containers" ]]; then
		info "stopping runner containers (heal will reprovision with new image)"
		podman stop -t 10 $containers 2>/dev/null || podman kill $containers 2>/dev/null || true
	fi
}

# Bootstrap runner-ctld systemd unit if not yet installed (pre-runner-ctld appliances)
ensure_runner_ctld_service() {
	if [[ -f "$RUNNER_CTLD_SERVICE" ]]; then
		return 0
	fi

	info "installing runner-ctld.service (first-time bootstrap)"
	cat > "$RUNNER_CTLD_SERVICE" <<'UNIT'
[Unit]
Description=Runner Container Lifecycle Daemon
After=network.target

[Service]
Type=simple
ExecStart=/usr/local/bin/runner-ctld
User=root
Group=root
Restart=on-failure
RestartSec=5

# Pin to housekeeping core — never steal benchmark CPU time
CPUAffinity=0

ExecStartPre=/bin/rm -f /var/run/runner-ctl.sock
Environment=RUNNER_CTL_SOCKET=/var/run/runner-ctl.sock

[Install]
WantedBy=multi-user.target
UNIT

	systemctl daemon-reload
	systemctl enable runner-ctld.service
}

# install_from_source <source_dir>
# Copies binaries, hooks, dashboard, and runner assets from a source directory
# that follows the archive layout produced by @noron/iso collect.ts.
install_from_source() {
	local src="$1"

	# --- binaries ---
	info "installing binaries to $BIN_DIR"
	install -m 0755 "$src/benchd/benchd"       "$BIN_DIR/benchd"
	install -m 0755 "$src/bench-exec/bench-exec" "$BIN_DIR/bench-exec"
	install -m 0755 "$src/web/bench-web"        "$BIN_DIR/bench-web"
	install -m 0755 "$src/setup/bench-setup"    "$BIN_DIR/bench-setup"
	install -m 0755 "$src/cli/bench"            "$BIN_DIR/bench"

	# --- runner-ctld ---
	info "installing runner-ctld to $BIN_DIR"
	install -m 0755 "$src/runner-ctl/runner-ctld" "$BIN_DIR/runner-ctld"
	ensure_runner_ctld_service

	# --- hooks ---
	info "installing hooks to $HOOKS_DIR"
	mkdir -p "$HOOKS_DIR"
	install -m 0755 "$src/benchd/hooks/job-started"   "$HOOKS_DIR/job-started"
	install -m 0755 "$src/benchd/hooks/job-completed"  "$HOOKS_DIR/job-completed"

	# --- dashboard ---
	info "replacing dashboard at $DASHBOARD_DIR"
	rm -rf "$DASHBOARD_DIR"
	mkdir -p "$DASHBOARD_DIR"
	cp -a "$src/dashboard/." "$DASHBOARD_DIR/"

	# --- runner assets ---
	info "replacing runner assets at $RUNNER_DIR"
	mkdir -p "$RUNNER_DIR"
	for f in "${RUNNER_FILES[@]}"; do
		if [[ -f "$src/runner-image/$f" ]]; then
			install -m 0755 "$src/runner-image/$f" "$RUNNER_DIR/$f"
		fi
	done

	# --- systemd units (static services only) ---
	if [[ -d "$src/systemd" ]]; then
		info "updating systemd service files"
		for svc in "${STATIC_SERVICES[@]}"; do
			if [[ -f "$src/systemd/$svc" ]]; then
				install -m 0644 "$src/systemd/$svc" "$SYSTEMD_DIR/$svc"
			fi
		done

		# Migrate known path changes in bench-web.service (config-dependent, not replaced)
		if [[ -f "$SYSTEMD_DIR/bench-web.service" ]]; then
			sed -i 's|/var/run/benchd\.sock|/run/benchd/benchd.sock|g' "$SYSTEMD_DIR/bench-web.service"
		fi

		systemctl daemon-reload
	fi

	# --- version ---
	if [[ -f "$src/version" ]]; then
		info "writing version file"
		cp "$src/version" "$VERSION_FILE"
	fi
}

# ---------------------------------------------------------------------------
# Subcommands
# ---------------------------------------------------------------------------

cmd_version() {
	read_version
}

cmd_backup() {
	require_root

	local version
	version="$(read_version)"
	local backup_dir="$UPDATES_DIR/rollback-$version"

	if [[ -d "$backup_dir" ]]; then
		die "backup already exists: $backup_dir"
	fi

	info "backing up version $version to $backup_dir"
	mkdir -p "$backup_dir"

	# binaries (store in archive layout)
	mkdir -p "$backup_dir/benchd/hooks"
	mkdir -p "$backup_dir/bench-exec"
	mkdir -p "$backup_dir/web"
	mkdir -p "$backup_dir/setup"
	mkdir -p "$backup_dir/cli"

	cp "$BIN_DIR/benchd"      "$backup_dir/benchd/benchd"
	cp "$BIN_DIR/bench-exec"  "$backup_dir/bench-exec/bench-exec"
	cp "$BIN_DIR/bench-web"   "$backup_dir/web/bench-web"
	cp "$BIN_DIR/bench-setup" "$backup_dir/setup/bench-setup"
	cp "$BIN_DIR/bench"       "$backup_dir/cli/bench"

	# runner-ctld
	mkdir -p "$backup_dir/runner-ctl"
	cp "$BIN_DIR/runner-ctld" "$backup_dir/runner-ctl/runner-ctld"

	# hooks
	for hook in "${HOOKS[@]}"; do
		if [[ -f "$HOOKS_DIR/$hook" ]]; then
			cp "$HOOKS_DIR/$hook" "$backup_dir/benchd/hooks/$hook"
		fi
	done

	# dashboard
	mkdir -p "$backup_dir/dashboard"
	if [[ -d "$DASHBOARD_DIR" ]]; then
		cp -a "$DASHBOARD_DIR/." "$backup_dir/dashboard/"
	fi

	# runner assets
	mkdir -p "$backup_dir/runner-image"
	for f in "${RUNNER_FILES[@]}"; do
		if [[ -f "$RUNNER_DIR/$f" ]]; then
			cp "$RUNNER_DIR/$f" "$backup_dir/runner-image/$f"
		fi
	done

	# systemd units
	mkdir -p "$backup_dir/systemd"
	for svc in "${STATIC_SERVICES[@]}"; do
		if [[ -f "$SYSTEMD_DIR/$svc" ]]; then
			cp "$SYSTEMD_DIR/$svc" "$backup_dir/systemd/$svc"
		fi
	done

	# version
	cp "$VERSION_FILE" "$backup_dir/version"

	info "backup complete: $backup_dir"
}

cmd_apply() {
	local src="${1:-}"
	[[ -n "$src" ]] || die "usage: $SELF_NAME apply <dir>"
	[[ -d "$src" ]] || die "source directory does not exist: $src"

	require_root

	# Verify required files exist in source
	local required=(
		"benchd/benchd"
		"benchd/hooks/job-started"
		"benchd/hooks/job-completed"
		"bench-exec/bench-exec"
		"web/bench-web"
		"setup/bench-setup"
		"cli/bench"
		"runner-ctl/runner-ctld"
	)
	for f in "${required[@]}"; do
		[[ -f "$src/$f" ]] || die "missing required file in source: $f"
	done

	# Self-update: copy the new bench-updater from source if present.
	# Safe because bash has already loaded this entire script into memory.
	if [[ -f "$src/bench-updater.sh" ]]; then
		info "updating bench-updater in place"
		install -m 0755 "$src/bench-updater.sh" "$(readlink -f "$0")"
	fi

	# Refuse to update if a benchmark is running.
	ensure_idle

	stop_services
	install_from_source "$src"
	start_services

	info "apply complete"
}

cmd_rollback() {
	require_root

	# Find the latest rollback dir by sorting on version string
	local latest
	latest="$(find "$UPDATES_DIR" -maxdepth 1 -type d -name 'rollback-*' \
		| sort -V | tail -n 1)"

	[[ -n "$latest" ]] || die "no rollback backups found in $UPDATES_DIR"

	# Verify backup integrity before attempting rollback
	local required=(
		"benchd/benchd"
		"bench-exec/bench-exec"
		"web/bench-web"
		"cli/bench"
		"runner-ctl/runner-ctld"
	)
	for f in "${required[@]}"; do
		[[ -f "$latest/$f" ]] || die "backup corrupted: missing $f in $latest"
	done

	info "rolling back from $latest"

	ensure_idle

	stop_services
	install_from_source "$latest"
	start_services

	info "rollback complete"
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

cmd="${1:-}"
shift || true

case "$cmd" in
	backup)   cmd_backup "$@" ;;
	apply)    cmd_apply "$@" ;;
	rollback) cmd_rollback "$@" ;;
	version)  cmd_version "$@" ;;
	*)
		echo "usage: $SELF_NAME {backup|apply <dir>|rollback|version}" >&2
		exit 1
		;;
esac
