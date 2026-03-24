#!/bin/bash
set -euo pipefail

# Build a bootable SBC disk image using the Armbian build framework.
# Produces a .img file flashable via balenaEtcher / dd.
#
# Usage: ./build-sbc-image.sh <board> <dist-dir> [output-dir] [revision]
#   board:      Armbian board identifier (orangepi5-plus, rpi4b)
#   dist-dir:   path to packages/iso/dist/ with collected binaries
#   output-dir: where to write the .img (default: dist-dir)
#   revision:   version string for the image (default: 0.0.0)
#
# Requires: Docker, ~30GB disk space

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BOARD="${1:?Usage: $0 <board> <dist-dir> [output-dir] [revision]}"
DIST_DIR="$(cd "${2:?Usage: $0 <board> <dist-dir> [output-dir] [revision]}" && pwd)"
ARMBIAN_DIR="${ARMBIAN_DIR:-/tmp/armbian-build}"
REVISION="${4:-0.0.0}"

# Resolve OUTPUT_DIR to absolute path before we cd to ARMBIAN_DIR
if [ -n "${3:-}" ]; then
    mkdir -p "${3}"
    OUTPUT_DIR="$(cd "${3}" && pwd)"
else
    OUTPUT_DIR="${DIST_DIR}"
fi
ARMBIAN_VERSION="v26.2.1"
NORON_VERSION="${REVISION}"

echo "=== Building SBC Image for ${BOARD} ==="
echo "Dist from: ${DIST_DIR}"

# Verify required assets exist
for bin in benchd/benchd bench-exec/bench-exec web/bench-web setup/bench-setup cli/bench runner-ctl/runner-ctld; do
    if [ ! -f "${DIST_DIR}/${bin}" ]; then
        echo "Error: Missing binary: ${DIST_DIR}/${bin}"
        exit 1
    fi
done

for asset in dashboard/index.html benchd/hooks/job-started benchd/hooks/job-completed \
             runner-image/Containerfile runner-image/start.sh \
             runner-image/bench-runner-update.sh; do
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
mkdir -p "${OVERLAY_DIR}/etc/profile.d"

# Copy binaries
cp "${DIST_DIR}/benchd/benchd"          "${OVERLAY_DIR}/usr/local/bin/benchd"
cp "${DIST_DIR}/bench-exec/bench-exec"  "${OVERLAY_DIR}/usr/local/bin/bench-exec"
cp "${DIST_DIR}/web/bench-web"          "${OVERLAY_DIR}/usr/local/bin/bench-web"
cp "${DIST_DIR}/setup/bench-setup"      "${OVERLAY_DIR}/usr/local/bin/bench-setup"
cp "${DIST_DIR}/cli/bench"              "${OVERLAY_DIR}/usr/local/bin/bench"
cp "${DIST_DIR}/runner-ctl/runner-ctld" "${OVERLAY_DIR}/usr/local/bin/runner-ctld"
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
cp "${DIST_DIR}/runner-image/bench-runner-update.sh" "${OVERLAY_DIR}/usr/local/share/bench/"

# Copy first-boot service and SSH login profile
cp "${SCRIPT_DIR}/../iso/first-boot.service" "${OVERLAY_DIR}/etc/systemd/system/"
cp "${SCRIPT_DIR}/../profile.d/bench-setup.sh" "${OVERLAY_DIR}/etc/profile.d/"

# Write noron version for customize-image.sh to pick up
echo "${NORON_VERSION}" > "${OVERLAY_DIR}/noron-version"

# Copy customize script
cp "${SCRIPT_DIR}/customize-image.sh" "${ARMBIAN_DIR}/userpatches/customize-image.sh"

# Host dependencies are installed by the workflow (sudo compile.sh requirements)
# before this script runs — not done here to avoid root ownership issues.

# Build the image — let Armbian manage its own Docker container
# REVISION must use the Armbian version, not the noron version. Armbian embeds
# REVISION into the base-files package version. If REVISION < 12.4 (Debian's
# stock base-files), apt treats it as a downgrade and fails with
# "pkgProblemResolver::Resolve generated breaks". The noron version is written
# into the image separately via customize-image.sh.
echo "Building ${BOARD} image (this may take a while)..."
./compile.sh build \
    REVISION="${ARMBIAN_VERSION#v}" \
    BOARD="${BOARD}" \
    BRANCH="${BRANCH}" \
    RELEASE=bookworm \
    BUILD_MINIMAL=yes \
    BUILD_DESKTOP=no \
    EXPERT=yes \
    KERNEL_CONFIGURE=no \
    KERNEL_BTF=yes \
    INSTALL_HEADERS=no \
    WIREGUARD=no \
    SYNC_CLOCK=no \
    PREFER_DOCKER=yes \
    COMPRESS_OUTPUTIMAGE=${NORON_COMPRESS:-xz},sha \
    USE_TMPFS=no \
    EXTRA_PACKAGES="podman sqlite3 lm-sensors cpufrequtils util-linux sudo curl ca-certificates openssh-server htop linux-perf socat"

# Find and move the output image
if [ "${NORON_COMPRESS:-xz}" = "img" ]; then
    OUTPUT_IMG=$(find "${ARMBIAN_DIR}/output/images/" -name "*.img" -not -name "*.img.xz" -type f | head -1)
    EXT="img"
else
    OUTPUT_IMG=$(find "${ARMBIAN_DIR}/output/images/" -name "*.img.xz" -type f | head -1)
    EXT="img.xz"
fi

if [ -z "${OUTPUT_IMG}" ]; then
    echo "Error: No image produced"
    exit 1
fi

FINAL_OUTPUT="${OUTPUT_DIR}/noron-${BOARD}.${EXT}"
mv "${OUTPUT_IMG}" "${FINAL_OUTPUT}"

echo ""
echo "SBC image built successfully: ${FINAL_OUTPUT}"
echo "Size: $(du -h "${FINAL_OUTPUT}" | cut -f1)"
if [ "$EXT" = "img.xz" ]; then
    echo ""
    echo "Flash with: xzcat ${FINAL_OUTPUT} | sudo dd of=/dev/sdX bs=4M status=progress"
    echo "Or use balenaEtcher which handles .img.xz directly"
else
    echo ""
    echo "Flash with: sudo dd if=${FINAL_OUTPUT} of=/dev/sdX bs=4M status=progress"
fi
