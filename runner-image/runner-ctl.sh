#!/bin/bash
# runner-ctl — Runner container lifecycle management
# Installed at /usr/local/bin/runner-ctl, called via sudo from bench-web
set -euo pipefail

ENVDIR="/opt/runner/envs"
IMAGE="bench-runner"
SOCKET="/var/run/benchd.sock"
BENCH_EXEC="/usr/local/bin/bench-exec"
HOOKS_DIR="/usr/local/lib/benchd/hooks"
TMPFS="/mnt/bench-tmpfs"
# Housekeeping core — runner daemon runs here, NOT on isolated benchmark cores
HOUSEKEEPING_CORE="0"

usage() {
	cat >&2 <<-EOF
	Usage:
	  runner-ctl provision <name> <repo> <token> [callback_url] [callback_token] [label]
	  runner-ctl deprovision <name>
	  runner-ctl status <name>
	EOF
	exit 1
}

container_name() {
	echo "bench-${1}"
}

# Validate that a value contains no newlines, NULs, or shell metacharacters
# that could escape the env file format. Rejects path traversal in names.
validate_name() {
	local val="$1" label="$2"
	if [[ "$val" =~ [^a-zA-Z0-9._-] ]]; then
		echo "ERROR: ${label} contains invalid characters (allowed: a-z A-Z 0-9 . _ -)" >&2
		exit 1
	fi
}

validate_value() {
	local val="$1" label="$2"
	if [[ "$val" == *$'\n'* ]] || [[ "$val" == *$'\r'* ]] || [[ "$val" == *$'\0'* ]]; then
		echo "ERROR: ${label} contains newlines or NUL bytes" >&2
		exit 1
	fi
}

provision() {
	local name="$1" repo="$2" token="$3" callback_url="${4:-}" callback_token="${5:-}" label="${6:-noron}"

	# Input validation — prevent path traversal and env injection
	validate_name "$name" "name"
	validate_value "$repo" "repo"
	validate_value "$token" "token"
	validate_value "$callback_url" "callback_url"
	validate_value "$callback_token" "callback_token"
	validate_name "$label" "label"

	local cname
	cname=$(container_name "$name")
	local envfile="${ENVDIR}/${name}.env"

	# Create env directory if needed
	mkdir -p "$ENVDIR"
	chmod 700 "$ENVDIR"

	# Write env file (values validated above — no newline injection possible)
	cat > "$envfile" <<-ENV
	GITHUB_REPO=${repo}
	RUNNER_NAME=${name}
	RUNNER_LABELS=${label}
	RUNNER_TOKEN=${token}
	ENV

	# Pass callback URL and token so start.sh can notify bench-web when registered
	if [ -n "$callback_url" ]; then
		echo "BENCH_CALLBACK_URL=${callback_url}" >> "$envfile"
	fi
	if [ -n "$callback_token" ]; then
		echo "BENCH_CALLBACK_TOKEN=${callback_token}" >> "$envfile"
	fi

	chmod 600 "$envfile"

	# Stop existing container if present
	if podman container exists "$cname" 2>/dev/null; then
		podman stop "$cname" 2>/dev/null || true
		podman rm -f "$cname" 2>/dev/null || true
	fi

	# Start container with bind mounts matching Ansible service template
	podman run -d --rm \
		--name "$cname" \
		--env-file "$envfile" \
		--volume "${SOCKET}:${SOCKET}:rw" \
		--volume "${BENCH_EXEC}:${BENCH_EXEC}:ro" \
		--volume "${HOOKS_DIR}:${HOOKS_DIR}:ro" \
		--volume "${TMPFS}:${TMPFS}:rw" \
		--cpuset-cpus="${HOUSEKEEPING_CORE}" \
		"$IMAGE"

	echo '{"status":"started","container":"'"$cname"'"}'
}

deprovision() {
	local name="$1"
	validate_name "$name" "name"
	local cname
	cname=$(container_name "$name")
	local envfile="${ENVDIR}/${name}.env"

	# Stop and remove container
	if podman container exists "$cname" 2>/dev/null; then
		podman stop "$cname" 2>/dev/null || true
		podman rm -f "$cname" 2>/dev/null || true
	fi

	# Remove env file
	rm -f "$envfile"

	echo '{"status":"removed","container":"'"$cname"'"}'
}

status() {
	local name="$1"
	validate_name "$name" "name"
	local cname
	cname=$(container_name "$name")

	if ! podman container exists "$cname" 2>/dev/null; then
		echo '{"status":"not_found"}'
		return 0
	fi

	local state
	state=$(podman inspect --format '{{.State.Status}}' "$cname" 2>/dev/null || echo "unknown")

	if [ "$state" = "running" ]; then
		echo '{"status":"running"}'
	else
		echo '{"status":"stopped","state":"'"$state"'"}'
	fi
}

# --- Main ---

[ $# -lt 2 ] && usage

cmd="$1"
shift

case "$cmd" in
	provision)
		[ $# -lt 3 ] || [ $# -gt 6 ] && usage
		provision "$1" "$2" "$3" "${4:-}" "${5:-}" "${6:-noron}"
		;;
	deprovision)
		[ $# -ne 1 ] && usage
		deprovision "$1"
		;;
	status)
		[ $# -ne 1 ] && usage
		status "$1"
		;;
	*)
		usage
		;;
esac
