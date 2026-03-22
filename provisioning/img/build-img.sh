#!/bin/bash
set -euo pipefail

# Build a bootable disk image for x86_64 or arm64 servers using debootstrap.
# Produces a raw .img file flashable via dd or uploadable to cloud providers.
#
# Usage: ./build-img.sh <arch> <dist-dir> [output-dir] [revision]
#   arch:       target architecture (amd64 or arm64)
#   dist-dir:   path to packages/iso/dist/ with collected binaries
#   output-dir: where to write the .img (default: dist-dir)
#   revision:   version string (default: 0.0.0)
#
# Requires: root, debootstrap, qemu-user-static (for cross-arch)

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ARCH="${1:?Usage: $0 <amd64|arm64> <dist-dir> [output-dir] [revision]}"
DIST_DIR="$(cd "${2:?Usage: $0 <amd64|arm64> <dist-dir> [output-dir] [revision]}" && pwd)"
REVISION="${4:-0.0.0}"

if [ -n "${3:-}" ]; then
    mkdir -p "${3}"
    OUTPUT_DIR="$(cd "${3}" && pwd)"
else
    OUTPUT_DIR="${DIST_DIR}"
fi

# Map arch to filename label
case "${ARCH}" in
    amd64|x86_64) ARCH_LABEL="x64"; DEB_ARCH="amd64" ;;
    arm64|aarch64) ARCH_LABEL="arm64"; DEB_ARCH="arm64" ;;
    *) echo "Error: Unsupported arch '${ARCH}'. Use amd64 or arm64"; exit 1 ;;
esac

IMAGE_SIZE="4G"
WORK_DIR="/tmp/noron-img-build"
IMG="${WORK_DIR}/noron-${ARCH_LABEL}.img"
MNT="${WORK_DIR}/mnt"

echo "=== Building Noron disk image (${ARCH_LABEL}) ==="
echo "Dist from: ${DIST_DIR}"

# Verify required assets
for bin in benchd/benchd bench-exec/bench-exec web/bench-web setup/bench-setup cli/bench; do
    if [ ! -f "${DIST_DIR}/${bin}" ]; then
        echo "Error: Missing binary: ${DIST_DIR}/${bin}"
        exit 1
    fi
done

# Clean previous build
rm -rf "${WORK_DIR}"
mkdir -p "${WORK_DIR}" "${MNT}"

# Create raw disk image
echo "Creating ${IMAGE_SIZE} disk image..."
truncate -s "${IMAGE_SIZE}" "${IMG}"

# Partition: GPT with EFI System Partition + root
echo "Partitioning..."
parted -s "${IMG}" mklabel gpt
parted -s "${IMG}" mkpart ESP fat32 1MiB 256MiB
parted -s "${IMG}" set 1 esp on
parted -s "${IMG}" mkpart root ext4 256MiB 100%

# Set up loop device with partition scanning.
# In Docker, udev isn't running so --partscan may not create /dev/loopXpN.
# Use kpartx to create device mappings reliably.
LOOP=$(losetup --find --show "${IMG}")
echo "Loop device: ${LOOP}"
kpartx -a "${LOOP}"

# kpartx creates /dev/mapper/loopXp1, /dev/mapper/loopXp2
LOOP_NAME=$(basename "${LOOP}")
PART1="/dev/mapper/${LOOP_NAME}p1"
PART2="/dev/mapper/${LOOP_NAME}p2"

# Wait for device nodes
for i in $(seq 1 10); do
    [ -e "$PART1" ] && [ -e "$PART2" ] && break
    sleep 0.5
done

if [ ! -e "$PART1" ] || [ ! -e "$PART2" ]; then
    echo "Error: Partition devices not found: $PART1, $PART2"
    exit 1
fi

cleanup() {
    echo "Cleaning up..."
    umount -R "${MNT}" 2>/dev/null || true
    kpartx -d "${LOOP}" 2>/dev/null || true
    losetup -d "${LOOP}" 2>/dev/null || true
}
trap cleanup EXIT

# Format partitions
echo "Formatting..."
mkfs.fat -F32 "${PART1}"
mkfs.ext4 -q -L noron-root "${PART2}"

# Mount root
mount "${PART2}" "${MNT}"
mkdir -p "${MNT}/boot/efi"
mount "${PART1}" "${MNT}/boot/efi"

# Debootstrap Debian 12
echo "Debootstrapping Debian 12 (bookworm) for ${DEB_ARCH}..."
debootstrap --arch="${DEB_ARCH}" bookworm "${MNT}" http://deb.debian.org/debian

# Mount virtual filesystems for chroot
mount --bind /dev "${MNT}/dev"
mount --bind /dev/pts "${MNT}/dev/pts"
mount -t proc proc "${MNT}/proc"
mount -t sysfs sysfs "${MNT}/sys"

# Configure the system inside chroot
echo "Configuring system..."
cat > "${MNT}/etc/fstab" <<FSTAB
LABEL=noron-root /         ext4 defaults,noatime 0 1
UUID=$(blkid -s UUID -o value "${PART1}") /boot/efi vfat defaults 0 2
FSTAB

# Set hostname
echo "noron" > "${MNT}/etc/hostname"
cat > "${MNT}/etc/hosts" <<HOSTS
127.0.0.1 localhost
127.0.1.1 noron
HOSTS

# Enable network via DHCP
cat > "${MNT}/etc/network/interfaces" <<NET
auto lo
iface lo inet loopback

auto eth0
iface eth0 inet dhcp
NET

# Configure apt sources
cat > "${MNT}/etc/apt/sources.list" <<APT
deb http://deb.debian.org/debian bookworm main contrib non-free non-free-firmware
deb http://deb.debian.org/debian-security bookworm-security main contrib non-free non-free-firmware
deb http://deb.debian.org/debian bookworm-updates main contrib non-free non-free-firmware
APT

# Install packages inside chroot
chroot "${MNT}" bash -c "
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -qq
    apt-get install -y -qq \
        linux-image-${DEB_ARCH} grub-efi-${DEB_ARCH} \
        podman sqlite3 lm-sensors cpufrequtils util-linux \
        sudo curl ca-certificates openssh-server htop \
        systemd-sysv locales

    # Set locale
    sed -i 's/^# *en_US.UTF-8/en_US.UTF-8/' /etc/locale.gen
    locale-gen en_US.UTF-8
    echo 'LANG=en_US.UTF-8' > /etc/default/locale

    # Install GRUB
    grub-install --target=${DEB_ARCH}-efi --efi-directory=/boot/efi --removable --no-nvram 2>/dev/null || true
    update-grub

    # Enable SSH
    systemctl enable ssh
"

# Create bench user
chroot "${MNT}" bash -c "
    adduser --disabled-password --gecos 'Noron Benchmark' bench
    usermod -aG sudo bench
    echo 'bench:noron' | chpasswd
"

# Install sudoers
mkdir -p "${MNT}/etc/sudoers.d"
cat > "${MNT}/etc/sudoers.d/bench-setup" <<SUDOERS
bench ALL=(root) NOPASSWD: /usr/local/bin/bench-setup
bench ALL=(root) NOPASSWD: /usr/local/bin/bench-updater
SUDOERS
chmod 440 "${MNT}/etc/sudoers.d/bench-setup"

# Copy binaries
echo "Installing Noron binaries..."
cp "${DIST_DIR}/benchd/benchd"          "${MNT}/usr/local/bin/benchd"
cp "${DIST_DIR}/bench-exec/bench-exec"  "${MNT}/usr/local/bin/bench-exec"
cp "${DIST_DIR}/web/bench-web"          "${MNT}/usr/local/bin/bench-web"
cp "${DIST_DIR}/setup/bench-setup"      "${MNT}/usr/local/bin/bench-setup"
cp "${DIST_DIR}/cli/bench"              "${MNT}/usr/local/bin/bench"
cp "${SCRIPT_DIR}/../bench-updater.sh"  "${MNT}/usr/local/bin/bench-updater"
chmod +x "${MNT}/usr/local/bin/"*

# Copy dashboard
mkdir -p "${MNT}/usr/local/share/bench/dashboard"
cp -r "${DIST_DIR}/dashboard/"* "${MNT}/usr/local/share/bench/dashboard/"

# Copy hooks
mkdir -p "${MNT}/usr/local/share/bench/hooks"
cp "${DIST_DIR}/benchd/hooks/job-started"    "${MNT}/usr/local/share/bench/hooks/"
cp "${DIST_DIR}/benchd/hooks/job-completed"  "${MNT}/usr/local/share/bench/hooks/"
chmod +x "${MNT}/usr/local/share/bench/hooks/"*

# Copy runner image assets
mkdir -p "${MNT}/usr/local/share/bench/runner"
cp "${DIST_DIR}/runner-image/Containerfile"   "${MNT}/usr/local/share/bench/runner/"
cp "${DIST_DIR}/runner-image/start.sh"        "${MNT}/usr/local/share/bench/runner/"
cp "${DIST_DIR}/runner-image/runner-ctl.sh"   "${MNT}/usr/local/share/bench/"

# Install first-boot service
cp "${SCRIPT_DIR}/../iso/first-boot.service" "${MNT}/etc/systemd/system/"
mkdir -p "${MNT}/etc/systemd/system/multi-user.target.wants"
ln -sf /etc/systemd/system/first-boot.service \
    "${MNT}/etc/systemd/system/multi-user.target.wants/first-boot.service"

# Install profile.d script for SSH setup wizard
cp "${SCRIPT_DIR}/../profile.d/bench-setup.sh" "${MNT}/etc/profile.d/"

# Create config and data directories with correct ownership
mkdir -p "${MNT}/etc/benchd"
chroot "${MNT}" chown root:bench /etc/benchd
chroot "${MNT}" chmod 770 /etc/benchd

mkdir -p "${MNT}/var/lib/bench"
echo "${REVISION}" > "${MNT}/var/lib/bench/version"
chroot "${MNT}" chown -R bench:bench /var/lib/bench

# Enable console autologin for first boot (wizard runs here)
mkdir -p "${MNT}/etc/systemd/system/getty@tty1.service.d"
cat > "${MNT}/etc/systemd/system/getty@tty1.service.d/override.conf" <<AUTOLOGIN
[Service]
ExecStart=
ExecStart=-/sbin/agetty --autologin root --noclear %I \$TERM
AUTOLOGIN

echo "Unmounting..."
umount -R "${MNT}"
kpartx -d "${LOOP}" 2>/dev/null || true
losetup -d "${LOOP}"
trap - EXIT

# Output
FINAL="${OUTPUT_DIR}/noron-${ARCH_LABEL}.img"
mv "${IMG}" "${FINAL}"

if [ "${NORON_COMPRESS:-xz}" = "img" ]; then
    echo ""
    echo "Image built successfully: ${FINAL}"
    echo "Size: $(du -h "${FINAL}" | cut -f1)"
else
    echo "Compressing with xz..."
    xz -T0 -6 "${FINAL}"
    FINAL="${FINAL}.xz"
    echo ""
    echo "Image built successfully: ${FINAL}"
    echo "Size: $(du -h "${FINAL}" | cut -f1)"
    echo ""
    echo "Flash to disk:   xzcat ${FINAL} | sudo dd of=/dev/sdX bs=4M status=progress"
    echo "Cloud upload:    unxz ${FINAL} and upload the raw .img"
fi
