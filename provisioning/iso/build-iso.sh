#!/bin/bash
set -euo pipefail

# Build a bootable Debian 12 ISO with bench-setup embedded
# Requires: live-build, debootstrap (apt install live-build)
# For cross-arch (e.g. arm64 on x64): also needs qemu-user-static
#
# Usage: ./build-iso.sh [dist-dir] [arch] [output-dir]
#   dist-dir:   path to packages/iso/dist/ (default: ../../packages/iso/dist)
#   arch:       target architecture: amd64 or arm64 (default: host arch)
#   output-dir: where to write the ISO (default: dist-dir)
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
BUILD_DIR="${ISO_BUILD_DIR:-/tmp/bench-iso-build}"

# Resolve OUTPUT_DIR to absolute path before we cd to BUILD_DIR
if [ -n "${3:-}" ]; then
    mkdir -p "${3}"
    OUTPUT_DIR="$(cd "${3}" && pwd)"
else
    OUTPUT_DIR="${DIST_DIR}"
fi

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

# Clean previous build (preserve cache/ if it's a mount point)
if [ -d "$BUILD_DIR" ]; then
    find "$BUILD_DIR" -mindepth 1 -maxdepth 1 ! -name cache -exec rm -rf {} +
else
    mkdir -p "$BUILD_DIR"
fi
cd "$BUILD_DIR"

# Set bootloader based on architecture
case "${ARCH}" in
    amd64)  BOOTLOADERS="syslinux,grub-efi" ;;
    arm64)  BOOTLOADERS="grub-efi" ;;
    *)      BOOTLOADERS="grub-efi" ;;
esac

# Initialize live-build — no mirror overrides needed when running on Debian
lb config \
    --distribution bookworm \
    --architectures "${ARCH}" \
    --archive-areas "main contrib non-free non-free-firmware" \
    --bootloaders "${BOOTLOADERS}" \
    --debian-installer none \
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

# Install profile script to launch setup wizard on SSH login
mkdir -p config/includes.chroot/etc/profile.d
cp "${SCRIPT_DIR}/../profile.d/bench-setup.sh" config/includes.chroot/etc/profile.d/

# Add hook to create bench user, set locale, and enable SSH
mkdir -p config/hooks/normal
cat > config/hooks/normal/0100-setup-users.hook.chroot <<'HOOKEOF'
#!/bin/bash
set -e

# Create bench user (non-root admin account)
if ! id bench &>/dev/null; then
    adduser --disabled-password --gecos "Noron Benchmark" bench
    usermod -aG sudo bench
fi
# Set a default password so SSH works on first boot.
# The setup wizard forces the user to change it during the Password step.
echo "bench:noron" | chpasswd

# Sudoers for bench user
mkdir -p /etc/sudoers.d
echo "bench ALL=(root) NOPASSWD: /usr/local/bin/bench-setup" > /etc/sudoers.d/bench-setup
echo "bench ALL=(root) NOPASSWD: /usr/local/bin/bench-updater" >> /etc/sudoers.d/bench-setup
chmod 440 /etc/sudoers.d/bench-setup

# Set default locale
sed -i 's/^# *en_US.UTF-8/en_US.UTF-8/' /etc/locale.gen 2>/dev/null || true
locale-gen en_US.UTF-8 2>/dev/null || true
echo 'LANG=en_US.UTF-8' > /etc/default/locale

# Auto-login as root on tty1 for first-boot (profile.d script launches wizard)
mkdir -p /etc/systemd/system/getty@tty1.service.d
cat > /etc/systemd/system/getty@tty1.service.d/override.conf <<INNER
[Service]
ExecStart=
ExecStart=-/sbin/agetty --autologin root --noclear %I \$TERM
INNER

# Create config and data directories with correct ownership
mkdir -p /etc/benchd
chown root:bench /etc/benchd
chmod 770 /etc/benchd
mkdir -p /var/lib/bench
chown bench:bench /var/lib/bench

systemctl enable ssh
HOOKEOF
chmod +x config/hooks/normal/0100-setup-users.hook.chroot

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
    ISO_PATH="${OUTPUT_DIR}/noron-${ARCH_LABEL}.iso"
    OUTPUT="${ISO_PATH}.xz"
    mv "$ISO_FILE" "$ISO_PATH"
    echo "Compressing ISO with xz (this may take a while)..."
    xz -T0 -6 "$ISO_PATH"
    echo ""
    echo "ISO built successfully: ${OUTPUT}"
    echo "Size: $(du -h "$OUTPUT" | cut -f1)"
    echo ""
    echo "Write to USB/SD: xzcat ${OUTPUT} | sudo dd of=/dev/sdX bs=4M status=progress"
    echo "Or use balenaEtcher which handles .iso.xz directly"
else
    echo "Error: ISO build failed"
    exit 1
fi

# Cleanup (preserve cache/ if it's a mount point)
find "$BUILD_DIR" -mindepth 1 -maxdepth 1 ! -name cache -exec rm -rf {} +
