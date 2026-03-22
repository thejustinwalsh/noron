#!/bin/bash
set -euo pipefail

# Build an SBC image for local dev.
# Env vars (loaded by bun from .env/.env.local):
#   BOARD           - board target (default: rpi4b)
#   NORON_COMPRESS  - compression mode (default: img for dev)

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
DIST_DIR="${ROOT_DIR}/packages/iso/dist"
BOARD="${BOARD:-rpi4b}"
export ARMBIAN_DIR="${ARMBIAN_DIR:-${SCRIPT_DIR}/.armbian}"
export BUN_TARGET="${BUN_TARGET:-bun-linux-arm64}"

# Build all upstream packages via turbo (same as bun run collect-dist)
echo "=== Building packages (BUN_TARGET=${BUN_TARGET}) ==="
cd "$ROOT_DIR"
turbo run build --filter=@noron/iso...

# Clear the Armbian rootfs cache so customize-image.sh re-runs with our
# latest binaries and config. Other caches (kernel, apt, ccache) are safe
# to keep — they don't contain our code and speed up rebuilds significantly.
echo "=== Clearing Armbian rootfs cache ==="
docker volume rm armbian-cache-rootfs 2>/dev/null || true

# Clear stale images and boot cache from previous builds
rm -f "${DIST_DIR}/noron-${BOARD}.img" "${DIST_DIR}/noron-${BOARD}.img.xz"
rm -rf "${SCRIPT_DIR}/.images/boot"

echo "=== Building SBC image (${BOARD}) ==="
"${ROOT_DIR}/provisioning/sbc/build-sbc-image.sh" "$BOARD" "$DIST_DIR" "$DIST_DIR"
