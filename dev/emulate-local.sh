#!/bin/bash
set -euo pipefail

# Find and boot a locally-built image. Handles both .img and .img.xz.
# Usage: ./emulate-local.sh [--persist] [--headless] <board|arch> [iso]

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DIST_DIR="${SCRIPT_DIR}/../packages/iso/dist"

# Collect flags to pass through to emulate.sh
FLAGS=()
while [[ "${1:-}" == --* ]]; do
    FLAGS+=("$1")
    shift
done

TARGET="${1:?Usage: $0 [--persist] [--headless] <board|arch> [iso]}"
TYPE="${2:-img}"

if [ "$TYPE" = "iso" ]; then
    EXTS=("iso" "iso.xz")
else
    EXTS=("img" "img.xz")
fi

IMAGE=""
for ext in "${EXTS[@]}"; do
    candidate="${DIST_DIR}/noron-${TARGET}.${ext}"
    if [ -f "$candidate" ]; then
        IMAGE="$candidate"
        break
    fi
done

if [ -z "$IMAGE" ]; then
    echo "Error: No image found for noron-${TARGET} in ${DIST_DIR}"
    echo "Tried: ${EXTS[*]}"
    ls "${DIST_DIR}"/noron-${TARGET}.* 2>/dev/null || echo "No matching files"
    exit 1
fi

exec "${SCRIPT_DIR}/emulate.sh" ${FLAGS[@]+"${FLAGS[@]}"} "$IMAGE"
