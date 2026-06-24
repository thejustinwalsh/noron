# @noron/iso — Benchmark Appliance Images

Builds bootable disk images for the Noron benchmark appliance. Public GitHub
releases publish only board-specific Armbian `.img` files for supported SBCs.
Generic x86_64 and ARM64 server images may be built locally for private use, but
they are not public release artifacts.

## What's inside

Every image ships with a complete, pre-installed benchmark appliance:

- **benchd** — host daemon managing locks, thermals, and cgroups
- **bench-exec** — privileged executor with CPU pinning and priority
- **bench-web** — dashboard API server with GitHub OAuth
- **bench-setup** — interactive first-boot setup wizard
- **bench** — remote CLI for monitoring and management
- **bench-updater** — self-update script with rollback support
- **dashboard** — React SPA served by bench-web
- **hooks** — GitHub Actions job lifecycle hooks (lock acquire/release)
- **runner container** — Podman image with GitHub Actions runner

## Quick start

### What you need

- An SBC (Orange Pi 5 Plus, Raspberry Pi 4/5)
- MicroSD card (16GB+) or SSD/eMMC
- Ethernet connection (wired recommended for consistent benchmarks)
- A GitHub OAuth App ([create one](https://github.com/settings/developers))

### 1. Flash the image

Download from the [latest release](https://github.com/thejustinwalsh/noron/releases).

Grab the board-specific Armbian `.img`:

| Board | Image | Architecture |
|-------|-------|-------------|
| Orange Pi 5 Plus | `noron-orangepi5-plus.img.xz` | ARM64 (RK3588) |
| Raspberry Pi 4/5 | `noron-rpi4b.img.xz` | ARM64 |

Flash with [balenaEtcher](https://etcher.balena.io/) or the command line:

```bash
# SBC (SD card / eMMC)
xzcat noron-orangepi5-plus.img.xz | sudo dd of=/dev/sdX bs=4M status=progress
```

Replace `/dev/sdX` with your target drive (use `lsblk` to find it).

### 2. First boot

1. Insert the SD card (or boot from SSD/NVMe) and power on
2. Connect via HDMI + keyboard, or SSH in (if your network assigns DHCP):
   ```bash
   ssh bench@<ip-address>    # default password: noron
   ```
3. The **setup wizard** runs automatically on first login and prompts you to change the password

### 3. Setup wizard

The wizard detects your hardware and walks you through configuration:

| Step | What happens |
|------|-------------|
| **Welcome** | Detects CPU cores, memory, thermal zones, network interfaces |
| **Password** | Set the `bench` user account password (first boot only) |
| **Timezone** | Select your timezone (first boot only) |
| **Cores** | Review and adjust the core split. Detects big.LITTLE on ARM SBCs |
| **OAuth** | Paste your GitHub OAuth App Client ID and Secret |
| **Network** | Set hostname, optionally configure Tailscale VPN |
| **Label** | Set the GitHub Actions runner label (default: `noron`) |
| **Review** | Confirm all settings |
| **Install** | Updates packages, writes config, builds runner container, starts services |
| **Done** | Shows your dashboard URL and admin invite link, prompts to reboot |

To re-run the wizard later: `sudo bench-setup --reconfigure` (skips password and timezone).

### 4. Access the dashboard

1. **Reboot** when prompted (kernel parameters require a reboot)
2. Log in as **bench** (the password you set during the wizard)
3. Open the admin invite link shown on the Done screen
4. Sign in with GitHub — you become the first admin
5. From the dashboard, generate invite links for your team

### 5. Register a repo

From the dashboard:
1. Click "Add Runner"
2. Enter the GitHub repo (e.g., `myorg/my-project`)
3. The appliance provisions a containerized GitHub Actions runner for that repo

### 6. Use in your workflow

```yaml
# .github/workflows/benchmark.yml
jobs:
  benchmark:
    runs-on: [self-hosted, noron]
    steps:
      - uses: actions/checkout@v4
      - uses: thejustinwalsh/noron/packages/action@v0.1.0
        with:
          command: node ./bench/run.js
```

The action handles thermal wait, CPU isolation, and lock acquisition automatically.

## Deploying with Ansible

For fleet management or automated provisioning of multiple appliances, see the [Ansible deployment guide](../../provisioning/ansible/README.md).

## Self-updates

Public GitHub Releases publish only Armbian SBC images. They do not publish update archives. Appliance self-updates are still supported when you provide private update artifacts and configure `/etc/benchd/config.toml`:

```toml
# GitHub repo to check for new releases
update_repo = "thejustinwalsh/noron"

# Auto-apply updates when no benchmark is running (default: true)
update_auto = true

# How often to check for updates in hours (default: 1)
update_check_interval_hours = 1
```

Updates are **safe by design**:
- Never runs during a benchmark (paused by the benchmark gate)
- Downloads the configured update archive, then waits for the lock to be idle
- Backs up current binaries before replacing
- Health-checks after restart — auto-rolls back if anything fails
- Rebuilds the runner container with new assets

Manual update via CLI:
```bash
bench update              # show current version and status
bench update check        # check for updates now
bench update apply        # apply available update
bench update history      # show past updates
```

## Building from source

### Collecting artifacts

All images start by building the workspace packages and collecting their outputs:

```bash
# Build all packages and collect into packages/iso/dist/
BUN_TARGET=bun-linux-arm64 bun run collect-dist   # ARM64
BUN_TARGET=bun-linux-x64 bun run collect-dist     # x64
```

Turbo handles the full dependency graph — `shared` builds first, then binaries in parallel, then the iso package collects everything.

### Building private server images (x86_64, generic ARM64)

Server images use debootstrap to create a minimal Debian 12 disk image with GRUB EFI boot. They are for local/private use and are not attached to public GitHub releases. Must run as root on a Linux system (or via Docker):

```bash
# Direct (requires root, debootstrap, parted)
sudo ./provisioning/img/build-img.sh amd64 packages/iso/dist/ artifacts/
sudo ./provisioning/img/build-img.sh arm64 packages/iso/dist/ artifacts/

# Via Docker (from any platform)
docker run --rm --privileged \
  -v "$(pwd):/work" -w /work \
  debian:bookworm bash -c "
    apt-get update && apt-get install -y debootstrap parted dosfstools e2fsprogs grub-efi-amd64-bin &&
    ./provisioning/img/build-img.sh amd64 packages/iso/dist/ artifacts/
  "
```

### Building SBC images (Armbian)

SBC images use the [Armbian build framework](https://github.com/armbian/build) (v26.2.1) to produce board-specific `.img` files with optimized kernels:

```bash
# Clone the Armbian framework
git clone --depth=1 --branch=v26.2.1 https://github.com/armbian/build /tmp/armbian-build

# Install host dependencies
sudo /tmp/armbian-build/compile.sh requirements BOARD=orangepi5-plus BRANCH=vendor RELEASE=bookworm

# Build the image
./provisioning/sbc/build-sbc-image.sh orangepi5-plus packages/iso/dist/ artifacts/
./provisioning/sbc/build-sbc-image.sh rpi4b packages/iso/dist/ artifacts/
```

Requires Docker and ~30GB disk space. Supported boards:

| Board | Armbian ID | Kernel branch | Notes |
|-------|-----------|---------------|-------|
| Orange Pi 5 Plus | `orangepi5-plus` | `vendor` | RK3588, 6.1 LTS kernel |
| Raspberry Pi 4/5 | `rpi4b` | `current` | RPi foundation kernel, covers Pi 4, Pi 5, CM4, CM5 |

### Release pipeline

The [release workflow](../../.github/workflows/release.yml) automates everything:

1. **release** — Changesets version bump, tag `@noron/iso@X.Y.Z`
2. **build-sbc** — Matrix build: Orange Pi 5 Plus and RPi 4/5 on `ubuntu-24.04-arm` (Armbian)
3. **github-release** — Publishes only the Armbian SBC images to GitHub Releases

## Architecture-specific notes

### Orange Pi 5 Plus (RK3588)

- 8 cores: 4x Cortex-A76 (big) + 4x Cortex-A55 (LITTLE)
- Recommended: pin benchmarks to the A76 cores for maximum consistency
- The setup wizard auto-detects the big.LITTLE topology and recommends the optimal split
- NVMe supported — after booting from SD, you can migrate to NVMe for better I/O
- Mali G610 GPU is available in the runner container for GPU-accelerated benchmarks

### Raspberry Pi 4 / 5

- 4 cores: all identical (Cortex-A72 on Pi 4, Cortex-A76 on Pi 5)
- Works well with 1 housekeeping + 3 benchmark cores
- Pi 5 recommended over Pi 4 for better single-core performance

### x86_64 bare metal

- Disable SMT (hyperthreading) in BIOS for best results, or use `nosmt` kernel param
- Disable turbo boost in BIOS, or let the appliance handle it via the `disable-turbo` service
- NUMA-aware systems: pin benchmarks to a single NUMA node for consistent memory latency
