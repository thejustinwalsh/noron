#!/bin/bash
set -euo pipefail

# Build a bootable Debian 12 ISO inside an OrbStack VM.
# Adapted from provisioning/iso/build-iso.sh for cross-build from macOS.
#
# Runs on VM-local /tmp for fast I/O, reads binaries from Mac shared mount,
# writes ISO back to Mac mount.
#
# Usage: build-iso-vm.sh <binaries-dir> <iso-scripts-dir> <arch> <output-dir>
#   binaries-dir:    path to compiled binaries (bench-setup, benchd, etc.) and dashboard/
#   iso-scripts-dir: path to provisioning/iso/ (contains first-boot.service)
#   arch:            target architecture (arm64 or amd64)
#   output-dir:      where to write the final ISO

BINARIES_DIR="${1:?Usage: build-iso-vm.sh <binaries-dir> <iso-scripts-dir> <arch> <output-dir>}"
ISO_SCRIPTS_DIR="${2:?Missing iso-scripts-dir}"
ARCH="${3:?Missing arch (arm64 or amd64)}"
OUTPUT_DIR="${4:?Missing output-dir}"

BUILD_DIR="/tmp/bench-iso-build"

echo "=== Building Benchmark Appliance ISO (${ARCH}) ==="
echo "Binaries from: ${BINARIES_DIR}"
echo "ISO scripts:   ${ISO_SCRIPTS_DIR}"
echo "Output:        ${OUTPUT_DIR}"

# Verify required assets exist
for bin in bench-setup benchd bench-web bench-exec; do
    if [ ! -f "${BINARIES_DIR}/${bin}" ]; then
        echo "Error: Missing binary: ${BINARIES_DIR}/${bin}"
        echo "Run: make collect-dist"
        exit 1
    fi
done

for asset in dashboard/index.html hooks/job-started hooks/job-completed \
             runner-image/Containerfile runner-image/start.sh runner-image/runner-ctl.sh; do
    if [ ! -e "${BINARIES_DIR}/${asset}" ]; then
        echo "Error: Missing asset: ${BINARIES_DIR}/${asset}"
        echo "Run: make collect-dist"
        exit 1
    fi
done

# Clean previous build
rm -rf "$BUILD_DIR"
mkdir -p "$BUILD_DIR"
cd "$BUILD_DIR"

# Initialize live-build
lb config \
    --distribution bookworm \
    --architectures "${ARCH}" \
    --archive-areas "main contrib non-free non-free-firmware" \
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
for bin in bench-setup benchd bench-web bench-exec; do
    cp "${BINARIES_DIR}/${bin}" config/includes.chroot/usr/local/bin/
    chmod +x "config/includes.chroot/usr/local/bin/${bin}"
done

# Copy dashboard assets
mkdir -p config/includes.chroot/usr/local/share/bench/dashboard
cp -r "${BINARIES_DIR}/dashboard/"* config/includes.chroot/usr/local/share/bench/dashboard/

# Copy hook binaries (lock acquire/release for GitHub Actions jobs)
mkdir -p config/includes.chroot/usr/local/share/bench/hooks
cp "${BINARIES_DIR}/hooks/job-started" config/includes.chroot/usr/local/share/bench/hooks/
cp "${BINARIES_DIR}/hooks/job-completed" config/includes.chroot/usr/local/share/bench/hooks/
chmod +x config/includes.chroot/usr/local/share/bench/hooks/*

# Copy runner image assets (Containerfile, start.sh, runner-ctl)
mkdir -p config/includes.chroot/usr/local/share/bench/runner
cp "${BINARIES_DIR}/runner-image/Containerfile" config/includes.chroot/usr/local/share/bench/runner/
cp "${BINARIES_DIR}/runner-image/start.sh" config/includes.chroot/usr/local/share/bench/runner/
cp "${BINARIES_DIR}/runner-image/runner-ctl.sh" config/includes.chroot/usr/local/share/bench/

# Copy first-boot service
mkdir -p config/includes.chroot/etc/systemd/system
cp "${ISO_SCRIPTS_DIR}/first-boot.service" config/includes.chroot/etc/systemd/system/

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

# Copy output (cp not mv — cross-filesystem between VM tmpfs and Mac mount)
ISO_FILE=$(ls -1 *.iso 2>/dev/null | head -1)
if [ -n "$ISO_FILE" ]; then
    # Map arch back to the ARCH variable used by Makefile
    case "${ARCH}" in
        arm64) ARCH_LABEL="arm64" ;;
        amd64) ARCH_LABEL="x64" ;;
        *)     ARCH_LABEL="${ARCH}" ;;
    esac
    OUTPUT="${OUTPUT_DIR}/noron-${ARCH_LABEL}.iso"
    cp "$ISO_FILE" "$OUTPUT"
    echo ""
    echo "ISO built successfully: ${OUTPUT}"
    echo "Size: $(du -h "$OUTPUT" | cut -f1)"
else
    echo "Error: ISO build failed — no .iso file produced"
    exit 1
fi

# Cleanup
rm -rf "$BUILD_DIR"
