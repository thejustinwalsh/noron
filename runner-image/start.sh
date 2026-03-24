#!/bin/bash
set -euo pipefail

# Register runner with GitHub (if not already configured)
if [ ! -f .runner ]; then
    # Support per-repo registration (GITHUB_REPO) or org-level (GITHUB_ORG)
    if [ -n "${GITHUB_REPO:-}" ]; then
        URL="https://github.com/${GITHUB_REPO}"
    elif [ -n "${GITHUB_ORG:-}" ]; then
        URL="https://github.com/${GITHUB_ORG}"
    else
        echo "ERROR: Set GITHUB_REPO (owner/repo) or GITHUB_ORG" >&2
        exit 1
    fi

    ./config.sh \
        --url "$URL" \
        --token "${RUNNER_TOKEN}" \
        --name "${RUNNER_NAME:-bench-runner}" \
        --labels "noron,${RUNNER_LABELS:-noron}" \
        --unattended \
        --replace

    # Notify bench-web that registration succeeded (fire-and-forget)
    if [ -n "${BENCH_CALLBACK_URL:-}" ] && [ -n "${BENCH_CALLBACK_TOKEN:-}" ]; then
        curl -sS -X POST "$BENCH_CALLBACK_URL" \
            -H "Content-Type: application/json" \
            -d "{\"token\":\"$BENCH_CALLBACK_TOKEN\"}" \
            --max-time 5 || true
    fi
fi

# Start the runner pinned to housekeeping core (core 0) — polls GitHub for jobs.
# bench-exec handles its own CPU affinity to isolated cores for benchmarks.
exec taskset -c 0 ./run.sh
