#!/bin/bash
# Armbian customize-image.sh — runs inside chroot during image build.
# Receives: $RELEASE, $LINUXFAMILY, $BOARD, $BUILD_DESKTOP, $ARCH
# Files from overlay/ are available at /tmp/overlay/

set -e

echo "=== Noron Benchmark Appliance customization ==="
echo "Board: ${BOARD}, Family: ${LINUXFAMILY}, Release: ${RELEASE}"

# Copy binaries from overlay
cp /tmp/overlay/usr/local/bin/* /usr/local/bin/
chmod +x /usr/local/bin/benchd /usr/local/bin/bench-exec /usr/local/bin/bench-web \
         /usr/local/bin/bench-setup /usr/local/bin/bench /usr/local/bin/bench-updater

# Copy dashboard assets
mkdir -p /usr/local/share/bench/dashboard
cp -r /tmp/overlay/usr/local/share/bench/dashboard/* /usr/local/share/bench/dashboard/

# Copy hook binaries
mkdir -p /usr/local/share/bench/hooks
cp /tmp/overlay/usr/local/share/bench/hooks/* /usr/local/share/bench/hooks/
chmod +x /usr/local/share/bench/hooks/*

# Copy runner image assets
mkdir -p /usr/local/share/bench/runner
cp /tmp/overlay/usr/local/share/bench/runner/* /usr/local/share/bench/runner/
cp /tmp/overlay/usr/local/share/bench/runner-ctl.sh /usr/local/share/bench/

# Install first-boot service
cp /tmp/overlay/etc/systemd/system/first-boot.service /etc/systemd/system/
mkdir -p /etc/systemd/system/multi-user.target.wants
ln -sf /etc/systemd/system/first-boot.service \
    /etc/systemd/system/multi-user.target.wants/first-boot.service

# Enable SSH
systemctl enable ssh

echo "=== Noron customization complete ==="
