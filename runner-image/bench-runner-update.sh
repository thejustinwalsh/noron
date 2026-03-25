#!/bin/bash
set -euo pipefail

# bench-runner-update — rebuild the runner container image.
# Acquires the benchd lock for the duration of the rebuild so no benchmark
# can start while we're replacing the image. benchd stays running the whole
# time, so lock acquire/release is safe here.
#
# Usage: bench-runner-update [--force]
#   --force: skip lock (for initial setup before benchd is running)

SOCKET="/run/benchd/benchd.sock"
RUNNER_DIR="/opt/runner"
IMAGE_NAME="bench-runner"

die() { echo "error: $*" >&2; exit 1; }
info() { echo ":: $*"; }

ipc_request() {
    echo "$1" | socat - UNIX-CONNECT:"$SOCKET" 2>/dev/null || echo '{}'
}

JOB_TOKEN=""
JOB_ID=""

# Release lock on exit (success or failure) — benchd is still running so this works.
cleanup() {
    if [[ -n "$JOB_TOKEN" ]] && [[ -S "$SOCKET" ]]; then
        info "Releasing benchmark lock..."
        ipc_request "{\"type\":\"lock.release\",\"requestId\":\"release-done\",\"jobToken\":\"${JOB_TOKEN}\",\"jobId\":\"${JOB_ID}\"}" >/dev/null
    fi
}
trap cleanup EXIT

# Acquire the lock (unless --force for initial setup before benchd is running)
if [[ "${1:-}" != "--force" ]] && [[ -S "$SOCKET" ]]; then
    JOB_ID="runner-update-$(date +%s)"
    REQUEST_ID="update-$(date +%s)"

    info "Acquiring benchmark lock..."
    LOCK_RESP=$(ipc_request "{\"type\":\"lock.acquire\",\"requestId\":\"${REQUEST_ID}\",\"jobId\":\"${JOB_ID}\",\"runId\":\"maintenance\",\"owner\":\"system/runner-update\"}")

    if echo "$LOCK_RESP" | grep -q '"type":"lock.acquired"'; then
        JOB_TOKEN=$(echo "$LOCK_RESP" | grep -o '"jobToken":"[^"]*"' | cut -d'"' -f4)
        info "Lock acquired"
    elif echo "$LOCK_RESP" | grep -q '"type":"lock.queued"'; then
        # A benchmark is running — don't wait, skip this update cycle.
        # The timer will try again next week.
        info "A benchmark is running — skipping runner image rebuild"
        exit 0
    else
        info "Could not acquire lock — skipping update"
        exit 0
    fi
fi

[[ -f "$RUNNER_DIR/Containerfile" ]] || die "Containerfile not found at $RUNNER_DIR"

# Detect architecture
ARCH=$(uname -m)
case "$ARCH" in
    aarch64|arm64) RUNNER_ARCH="arm64" ;;
    *)             RUNNER_ARCH="x64" ;;
esac

TARGETARCH="$(case "$RUNNER_ARCH" in arm64) echo arm64;; *) echo amd64;; esac)"

info "Rebuilding runner image (arch: $RUNNER_ARCH)..."
podman build \
    --build-arg RUNNER_ARCH="$RUNNER_ARCH" \
    --build-arg TARGETARCH="$TARGETARCH" \
    --pull=newer \
    --format=docker \
    --log-level=info \
    -t "$IMAGE_NAME" \
    "$RUNNER_DIR/" 2>&1

info "Runner image rebuilt successfully"
podman image prune -f >/dev/null 2>&1 || true
