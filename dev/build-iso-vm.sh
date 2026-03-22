#!/bin/bash
set -euo pipefail

# Build the ISO inside an OrbStack VM. Delegates to the production build-iso.sh.
#
# Usage: build-iso-vm.sh <dist-dir> <iso-scripts-dir> <arch> <output-dir>
#   Called by the Makefile `iso` target via orbctl.

DIST_DIR="${1:?Usage: build-iso-vm.sh <dist-dir> <iso-scripts-dir> <arch> <output-dir>}"
ISO_SCRIPTS_DIR="${2:?Missing iso-scripts-dir}"
ARCH="${3:?Missing arch (arm64 or amd64)}"
OUTPUT_DIR="${4:?Missing output-dir}"

# Install live-build if needed
if ! command -v lb &>/dev/null; then
    apt-get update -qq
    apt-get install -y -qq live-build debootstrap
fi

# Build on the VM's native filesystem — Mac mount doesn't support mknod,
# and /tmp may have nodev. /var/tmp is on the root filesystem with full perms.
export ISO_BUILD_DIR="/var/tmp/bench-iso-build"

# Delegate to the production build script
exec "${ISO_SCRIPTS_DIR}/build-iso.sh" "$DIST_DIR" "$ARCH" "$OUTPUT_DIR"
