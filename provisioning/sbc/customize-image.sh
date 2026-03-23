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
cp /tmp/overlay/usr/local/share/bench/bench-runner-update.sh /usr/local/share/bench/

# Disable Armbian's first-login wizard. It's triggered by /root/.not_logged_in_yet
# existing when profile.d/armbian-check-first-login.sh runs. Remove the flag file
# and Armbian's wizard never fires. Our profile.d/bench-setup.sh takes over instead.
rm -f /root/.not_logged_in_yet

# Create the bench user — non-root admin account for the appliance.
# Password is locked (--disabled-password) until the setup wizard runs.
# The wizard prompts the user to set a password on first boot.
if ! id bench &>/dev/null; then
    adduser --disabled-password --gecos "Noron Benchmark" bench
    usermod -aG sudo bench
fi
# Set a default password so SSH works on first boot.
# The setup wizard forces the user to change it during the Password step.
echo "bench:noron" | chpasswd

# Allow bench user to run setup wizard and bench-updater as root
mkdir -p /etc/sudoers.d
echo "bench ALL=(root) NOPASSWD: /usr/local/bin/bench-setup" > /etc/sudoers.d/bench-setup
echo "bench ALL=(root) NOPASSWD: /usr/local/bin/bench-updater" >> /etc/sudoers.d/bench-setup
chmod 440 /etc/sudoers.d/bench-setup

# Set default locale to en_US.UTF-8
sed -i 's/^# *en_US.UTF-8/en_US.UTF-8/' /etc/locale.gen 2>/dev/null || true
locale-gen en_US.UTF-8 2>/dev/null || true
echo 'LANG=en_US.UTF-8' > /etc/default/locale

# NOTE: Armbian overwrites getty autologin AFTER customize-image.sh runs,
# so we cannot set autologin here. The first-boot.service handles it at
# runtime with ExecStartPre before the setup wizard launches.

# Install our first-boot service
cp /tmp/overlay/etc/systemd/system/first-boot.service /etc/systemd/system/
mkdir -p /etc/systemd/system/multi-user.target.wants
ln -sf /etc/systemd/system/first-boot.service \
    /etc/systemd/system/multi-user.target.wants/first-boot.service

# Install profile script to launch setup wizard on SSH login
cp /tmp/overlay/etc/profile.d/bench-setup.sh /etc/profile.d/

# Create config and data directories with correct ownership
mkdir -p /etc/benchd
chown root:bench /etc/benchd
chmod 770 /etc/benchd

mkdir -p /var/lib/bench
chown bench:bench /var/lib/bench

# Write noron version
if [ -f /tmp/overlay/noron-version ]; then
    cp /tmp/overlay/noron-version /var/lib/bench/version
fi

# Enable SSH
systemctl enable ssh

echo "=== Noron customization complete ==="
