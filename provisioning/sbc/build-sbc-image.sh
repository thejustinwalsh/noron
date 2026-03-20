#!/bin/bash
set -euo pipefail

# Build a bootable SBC disk image using the Armbian build framework.
# Produces a .img file flashable via balenaEtcher / dd.
#
# Usage: ./build-sbc-image.sh <board> <dist-dir>
#   board:    Armbian board identifier (orangepi5-plus, rpi4b)
#   dist-dir: path to packages/iso/dist/ with collected binaries
#
# Requires: Docker, ~30GB disk space

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BOARD="${1:?Usage: $0 <board> <dist-dir>}"
DIST_DIR="$(cd "${2:?Usage: $0 <board> <dist-dir>}" && pwd)"
ARMBIAN_DIR="/tmp/armbian-build"
ARMBIAN_VERSION="v25.11"

echo "=== Building SBC Image for ${BOARD} ==="
echo "Dist from: ${DIST_DIR}"

# Verify required assets exist
for bin in benchd/benchd bench-exec/bench-exec web/bench-web setup/bench-setup cli/bench; do
    if [ ! -f "${DIST_DIR}/${bin}" ]; then
        echo "Error: Missing binary: ${DIST_DIR}/${bin}"
        exit 1
    fi
done

for asset in dashboard/index.html benchd/hooks/job-started benchd/hooks/job-completed \
             runner-image/Containerfile runner-image/start.sh runner-image/runner-ctl.sh; do
    if [ ! -e "${DIST_DIR}/${asset}" ]; then
        echo "Error: Missing asset: ${DIST_DIR}/${asset}"
        exit 1
    fi
done

# Select kernel branch per board
case "${BOARD}" in
    orangepi5-plus)
        BRANCH="vendor"   # RK3588 vendor kernel 6.1 LTS — stable for benchmarking
        ;;
    rpi4b)
        BRANCH="current"  # RPi foundation kernel — covers Pi 4, Pi 5, CM4, CM5
        ;;
    *)
        echo "Error: Unknown board '${BOARD}'. Supported: orangepi5-plus, rpi4b (covers Pi 4/5)"
        exit 1
        ;;
esac

# Clone or update Armbian build framework
if [ -d "${ARMBIAN_DIR}" ]; then
    echo "Updating Armbian build framework..."
    cd "${ARMBIAN_DIR}"
    git fetch --depth=1 origin "refs/tags/${ARMBIAN_VERSION}"
    git checkout "${ARMBIAN_VERSION}"
else
    echo "Cloning Armbian build framework (${ARMBIAN_VERSION})..."
    git clone --depth=1 --branch="${ARMBIAN_VERSION}" https://github.com/armbian/build "${ARMBIAN_DIR}"
fi

cd "${ARMBIAN_DIR}"

# Set up userpatches overlay — files available at /tmp/overlay inside chroot
OVERLAY_DIR="${ARMBIAN_DIR}/userpatches/overlay"
rm -rf "${OVERLAY_DIR}"
mkdir -p "${OVERLAY_DIR}/usr/local/bin"
mkdir -p "${OVERLAY_DIR}/usr/local/share/bench/dashboard"
mkdir -p "${OVERLAY_DIR}/usr/local/share/bench/hooks"
mkdir -p "${OVERLAY_DIR}/usr/local/share/bench/runner"
mkdir -p "${OVERLAY_DIR}/etc/systemd/system"
mkdir -p "${OVERLAY_DIR}/etc/sysctl.d"

# Copy binaries
cp "${DIST_DIR}/benchd/benchd"          "${OVERLAY_DIR}/usr/local/bin/benchd"
cp "${DIST_DIR}/bench-exec/bench-exec"  "${OVERLAY_DIR}/usr/local/bin/bench-exec"
cp "${DIST_DIR}/web/bench-web"          "${OVERLAY_DIR}/usr/local/bin/bench-web"
cp "${DIST_DIR}/setup/bench-setup"      "${OVERLAY_DIR}/usr/local/bin/bench-setup"
cp "${DIST_DIR}/cli/bench"              "${OVERLAY_DIR}/usr/local/bin/bench"
cp "${SCRIPT_DIR}/../bench-updater.sh"  "${OVERLAY_DIR}/usr/local/bin/bench-updater"
chmod +x "${OVERLAY_DIR}/usr/local/bin/"*

# Copy dashboard assets
cp -r "${DIST_DIR}/dashboard/"* "${OVERLAY_DIR}/usr/local/share/bench/dashboard/"

# Copy hook binaries
cp "${DIST_DIR}/benchd/hooks/job-started"    "${OVERLAY_DIR}/usr/local/share/bench/hooks/"
cp "${DIST_DIR}/benchd/hooks/job-completed"  "${OVERLAY_DIR}/usr/local/share/bench/hooks/"
chmod +x "${OVERLAY_DIR}/usr/local/share/bench/hooks/"*

# Copy runner image assets
cp "${DIST_DIR}/runner-image/Containerfile"   "${OVERLAY_DIR}/usr/local/share/bench/runner/"
cp "${DIST_DIR}/runner-image/start.sh"        "${OVERLAY_DIR}/usr/local/share/bench/runner/"
cp "${DIST_DIR}/runner-image/runner-ctl.sh"   "${OVERLAY_DIR}/usr/local/share/bench/"

# Copy first-boot service
cp "${SCRIPT_DIR}/../iso/first-boot.service" "${OVERLAY_DIR}/etc/systemd/system/"

# Copy customize script
cp "${SCRIPT_DIR}/customize-image.sh" "${ARMBIAN_DIR}/userpatches/customize-image.sh"

# Build the image — let Armbian manage its own Docker container
# Unset COLUMNS to work around Armbian patching.py crash when COLUMNS="" in CI
unset COLUMNS
echo "Building ${BOARD} image (this may take a while)..."
./compile.sh \
    BOARD="${BOARD}" \
    BRANCH="${BRANCH}" \
    RELEASE=bookworm \
    BUILD_MINIMAL=yes \
    BUILD_DESKTOP=no \
    KERNEL_CONFIGURE=no \
    COMPRESS_OUTPUTIMAGE=img,sha \
    EXTRA_PACKAGES="podman sqlite3 lm-sensors cpufrequtils util-linux sudo curl ca-certificates openssh-server htop"

# Find and move the output image
OUTPUT_IMG=$(find "${ARMBIAN_DIR}/output/images/" -name "*.img" -type f | head -1)
if [ -z "${OUTPUT_IMG}" ]; then
    echo "Error: No image produced"
    exit 1
fi

FINAL_OUTPUT="${DIST_DIR}/benchmark-appliance-${BOARD}.img"
mv "${OUTPUT_IMG}" "${FINAL_OUTPUT}"

echo ""
echo "SBC image built successfully: ${FINAL_OUTPUT}"
echo "Size: $(du -h "${FINAL_OUTPUT}" | cut -f1)"
echo ""
echo "Flash with: balenaEtcher or dd if=${FINAL_OUTPUT} of=/dev/sdX bs=4M status=progress"
