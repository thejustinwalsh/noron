#!/bin/bash
set -euo pipefail

# Build a bootable Debian 12 ISO with bench-setup embedded
# Requires: live-build, debootstrap (apt install live-build)
# For cross-arch (e.g. arm64 on x64): also needs qemu-user-static
#
# Usage: ./build-iso.sh [dist-dir] [arch]
#   dist-dir: path to packages/iso/dist/ (default: ../../packages/iso/dist)
#   arch:     target architecture: amd64 or arm64 (default: host arch)
#
# Expected dist layout (produced by @noron/iso collect.ts):
#   dist/benchd/benchd              dist/benchd/hooks/job-started
#   dist/bench-exec/bench-exec      dist/benchd/hooks/job-completed
#   dist/web/bench-web              dist/dashboard/...
#   dist/setup/bench-setup          dist/runner-image/Containerfile
#   dist/cli/bench                  dist/runner-image/start.sh
#   dist/shared/...                 dist/runner-image/runner-ctl.sh

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DIST_DIR="$(cd "${1:-${SCRIPT_DIR}/../../packages/iso/dist}" && pwd)"
ARCH="${2:-$(dpkg --print-architecture 2>/dev/null || uname -m | sed 's/x86_64/amd64/;s/aarch64/arm64/')}"
BUILD_DIR="/tmp/bench-iso-build"

echo "=== Building Benchmark Appliance ISO (${ARCH}) ==="
echo "Dist from: ${DIST_DIR}"

# Verify required assets exist
for bin in benchd/benchd bench-exec/bench-exec web/bench-web setup/bench-setup cli/bench; do
    if [ ! -f "${DIST_DIR}/${bin}" ]; then
        echo "Error: Missing binary: ${DIST_DIR}/${bin}"
        echo "Run: BUN_TARGET=... turbo run build --filter=@noron/iso..."
        exit 1
    fi
done

for asset in dashboard/index.html benchd/hooks/job-started benchd/hooks/job-completed \
             runner-image/Containerfile runner-image/start.sh runner-image/runner-ctl.sh; do
    if [ ! -e "${DIST_DIR}/${asset}" ]; then
        echo "Error: Missing asset: ${DIST_DIR}/${asset}"
        echo "Run: BUN_TARGET=... turbo run build --filter=@noron/iso..."
        exit 1
    fi
done

# Clean previous build
rm -rf "$BUILD_DIR"
mkdir -p "$BUILD_DIR"
cd "$BUILD_DIR"

# Initialize live-build
lb config \
    --mode debian \
    --distribution bookworm \
    --architectures "${ARCH}" \
    --archive-areas "main contrib non-free non-free-firmware" \
    --mirror-bootstrap "http://deb.debian.org/debian" \
    --mirror-chroot "http://deb.debian.org/debian" \
    --mirror-binary "http://deb.debian.org/debian" \
    --debootstrap-options "--keyring=/usr/share/keyrings/debian-archive-keyring.gpg" \
    --debian-installer false \
    --memtest none \
    --iso-application "Benchmark Appliance" \
    --iso-volume "BENCH" \
    --apt-recommends false

# Add packages to install in the live system
mkdir -p config/package-lists
cat > config/package-lists/bench.list.chroot <<EOF
podman
sqlite3
lm-sensors
cpufrequtils
util-linux
sudo
curl
ca-certificates
systemd-sysv
openssh-server
htop
EOF

# Copy binaries into the ISO
mkdir -p config/includes.chroot/usr/local/bin
cp "${DIST_DIR}/benchd/benchd"          config/includes.chroot/usr/local/bin/benchd
cp "${DIST_DIR}/bench-exec/bench-exec"  config/includes.chroot/usr/local/bin/bench-exec
cp "${DIST_DIR}/web/bench-web"          config/includes.chroot/usr/local/bin/bench-web
cp "${DIST_DIR}/setup/bench-setup"      config/includes.chroot/usr/local/bin/bench-setup
cp "${DIST_DIR}/cli/bench"              config/includes.chroot/usr/local/bin/bench
cp "${SCRIPT_DIR}/../bench-updater.sh" config/includes.chroot/usr/local/bin/bench-updater
chmod +x config/includes.chroot/usr/local/bin/*

# Copy dashboard assets
mkdir -p config/includes.chroot/usr/local/share/bench/dashboard
cp -r "${DIST_DIR}/dashboard/"* config/includes.chroot/usr/local/share/bench/dashboard/

# Copy hook binaries (lock acquire/release for GitHub Actions jobs)
mkdir -p config/includes.chroot/usr/local/share/bench/hooks
cp "${DIST_DIR}/benchd/hooks/job-started" config/includes.chroot/usr/local/share/bench/hooks/
cp "${DIST_DIR}/benchd/hooks/job-completed" config/includes.chroot/usr/local/share/bench/hooks/
chmod +x config/includes.chroot/usr/local/share/bench/hooks/*

# Copy runner image assets (Containerfile, start.sh, runner-ctl)
mkdir -p config/includes.chroot/usr/local/share/bench/runner
cp "${DIST_DIR}/runner-image/Containerfile" config/includes.chroot/usr/local/share/bench/runner/
cp "${DIST_DIR}/runner-image/start.sh" config/includes.chroot/usr/local/share/bench/runner/
cp "${DIST_DIR}/runner-image/runner-ctl.sh" config/includes.chroot/usr/local/share/bench/

# Copy first-boot service
mkdir -p config/includes.chroot/etc/systemd/system
cp "${SCRIPT_DIR}/first-boot.service" config/includes.chroot/etc/systemd/system/

# Enable first-boot service
mkdir -p config/includes.chroot/etc/systemd/system/multi-user.target.wants
ln -sf /etc/systemd/system/first-boot.service \
    config/includes.chroot/etc/systemd/system/multi-user.target.wants/first-boot.service

# Add hook to enable SSH
mkdir -p config/hooks/normal
cat > config/hooks/normal/0100-enable-ssh.hook.chroot <<'HOOKEOF'
#!/bin/bash
systemctl enable ssh
HOOKEOF
chmod +x config/hooks/normal/0100-enable-ssh.hook.chroot

# Build the ISO
echo "Building ISO (this may take a while)..."
lb build

# Move output
ISO_FILE=$(ls -1 *.iso 2>/dev/null | head -1)
if [ -n "$ISO_FILE" ]; then
    # Normalize arch label for filename
    case "${ARCH}" in
        arm64|aarch64) ARCH_LABEL="arm64" ;;
        amd64|x86_64)  ARCH_LABEL="x64" ;;
        *)             ARCH_LABEL="${ARCH}" ;;
    esac
    OUTPUT="${DIST_DIR}/benchmark-appliance-${ARCH_LABEL}.iso"
    mv "$ISO_FILE" "$OUTPUT"
    echo ""
    echo "ISO built successfully: ${OUTPUT}"
    echo "Size: $(du -h "$OUTPUT" | cut -f1)"
    echo ""
    echo "Write to USB/SD: sudo dd if=${OUTPUT} of=/dev/sdX bs=4M status=progress"
else
    echo "Error: ISO build failed"
    exit 1
fi

# Cleanup
rm -rf "$BUILD_DIR"
