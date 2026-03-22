#!/bin/bash
set -euo pipefail

# Build and test a Noron disk image using OrbStack.
# Tests the real artifact — same image CI produces.
#
# Usage: ./test-img.sh [--skip-build]

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
DIST_DIR="${ROOT_DIR}/packages/iso/dist"
VM_NAME="bench-test"
SKIP_BUILD=false

for arg in "$@"; do
    case "$arg" in
        --skip-build) SKIP_BUILD=true ;;
    esac
done

# Step 1: Build the image (same as CI)
if [ "$SKIP_BUILD" = false ]; then
    echo "=== Building packages ==="
    cd "$ROOT_DIR"
    BUN_TARGET=bun-linux-arm64 turbo run build --filter=@noron/iso...

    echo "=== Building disk image ==="
    docker run --rm --privileged \
        -v "${ROOT_DIR}:/work" -w /work \
        debian:bookworm bash -c "
            apt-get update -qq &&
            apt-get install -y -qq debootstrap parted dosfstools e2fsprogs grub-efi-arm64-bin kpartx &&
            NORON_COMPRESS=img ./provisioning/img/build-img.sh arm64 packages/iso/dist/ packages/iso/dist/
        "
fi

# Find the image
IMG=""
for candidate in "${DIST_DIR}/noron-arm64.img" "${DIST_DIR}/noron-arm64.img.xz"; do
    if [ -f "$candidate" ]; then
        IMG="$candidate"
        break
    fi
done

if [ -z "$IMG" ]; then
    echo "Error: No arm64 image found. Run without --skip-build."
    exit 1
fi

# Step 2: Create a fresh OrbStack VM and install the image contents
echo "=== Setting up OrbStack VM ==="
orbctl delete -f "$VM_NAME" 2>/dev/null || true
orbctl create debian:12 "$VM_NAME"

# Wait for VM
for i in $(seq 1 30); do
    orbctl run -m "$VM_NAME" true 2>/dev/null && break
    sleep 1
done

# Mount the image inside the VM (OrbStack VMs are real Linux, can mount ext4)
# The image is accessible via /mnt/mac mount
MAC_IMG="/mnt/mac${IMG}"

echo "=== Installing image contents into VM ==="
orbctl run -m "$VM_NAME" sudo bash -c "
    set -e
    apt-get update -qq
    apt-get install -y -qq kpartx rsync

    # Set up loop device for the image
    LOOP=\$(losetup --find --show '${MAC_IMG}')
    kpartx -a \$LOOP
    LOOP_NAME=\$(basename \$LOOP)

    # Wait for devices
    sleep 1

    # Mount the root partition from the image
    mkdir -p /mnt/img
    mount /dev/mapper/\${LOOP_NAME}p2 /mnt/img

    # Verify mount worked
    ls /mnt/img/usr/local/bin/bench-setup || { echo 'ERROR: Image mount failed or missing binaries'; exit 1; }

    # Sync image contents into the VM, preserving the VM's own system state
    rsync -aHAX \
        --exclude='/proc' --exclude='/sys' --exclude='/dev' \
        --exclude='/run' --exclude='/tmp' --exclude='/mnt' \
        --exclude='/etc/passwd' --exclude='/etc/passwd-' \
        --exclude='/etc/shadow' --exclude='/etc/shadow-' \
        --exclude='/etc/group' --exclude='/etc/group-' \
        --exclude='/etc/gshadow' --exclude='/etc/gshadow-' \
        --exclude='/etc/subuid' --exclude='/etc/subgid' \
        --exclude='/etc/hostname' --exclude='/etc/hosts' \
        --exclude='/etc/resolv.conf' --exclude='/etc/fstab' \
        --exclude='/etc/machine-id' \
        /mnt/img/ /

    # Ensure the bench user and groups exist (image created them, but we excluded passwd/group)
    id bench 2>/dev/null || {
        groupadd -g 1000 bench
        useradd -u 1000 -g bench -G sudo -m -s /bin/bash bench
        echo 'bench:noron' | chpasswd
    }

    # Install sudoers from image
    cp /mnt/img/etc/sudoers.d/* /etc/sudoers.d/ 2>/dev/null || true
    chmod 440 /etc/sudoers.d/* 2>/dev/null || true

    # Clean up mount
    umount /mnt/img
    kpartx -d \$LOOP
    losetup -d \$LOOP

    # Reload systemd to pick up new units
    systemctl daemon-reload
"

echo "=== Starting services ==="
orbctl run -m "$VM_NAME" sudo systemctl enable --now benchd bench-web 2>/dev/null || true

# Step 3: Launch the setup wizard
echo ""
echo "=== Launching setup wizard ==="
echo ""
orbctl run -m "$VM_NAME" sudo /usr/local/bin/bench-setup

# Restart services with new config
orbctl run -m "$VM_NAME" sudo systemctl restart benchd bench-web 2>/dev/null || true

echo ""
echo "=== Setup complete ==="
echo ""
echo "  Dashboard: http://${VM_NAME}.orb.local:9216"
echo "  SSH:       ssh bench@${VM_NAME}.orb.local"
echo "  Shell:     orbctl run -m ${VM_NAME} bash"
echo "  Cleanup:   orbctl delete -f ${VM_NAME}"
echo ""
