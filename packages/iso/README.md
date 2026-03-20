# @noron/iso — Benchmark Appliance Images

Builds bootable images for the Noron benchmark appliance: board-specific `.img` files for SBCs via Armbian, and generic `.iso` files for x86_64 and ARM64 servers via Debian live-build. These are the deployment artifacts — flash one to an SD card or SSD and boot into a fully configured benchmark runner.

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

- An SBC (Orange Pi 5 Plus, Raspberry Pi 4/5) or x86_64 machine
- MicroSD card (16GB+) or SSD/eMMC
- Ethernet connection (wired recommended for consistent benchmarks)
- A GitHub OAuth App ([create one](https://github.com/settings/developers))

### 1. Flash the image

Download from the [latest release](https://github.com/thejustinwalsh/noron/releases).

**SBC users** — grab the board-specific `.img`:

| Board | Image | Architecture |
|-------|-------|-------------|
| Orange Pi 5 Plus | `noron-orangepi5-plus.img` | ARM64 (RK3588) |
| Raspberry Pi 4/5 | `noron-rpi4b.img` | ARM64 |

**x86_64 / generic ARM64** — grab the `.iso`:

| Platform | Image |
|----------|-------|
| PC / server / cloud VM | `noron-x64.iso` |
| ARM64 server (generic) | `noron-arm64.iso` |

Flash with [balenaEtcher](https://etcher.balena.io/) (recommended) or the command line:

```bash
# SBC image
sudo dd if=noron-orangepi5-plus.img of=/dev/sdX bs=4M status=progress
sync

# Or ISO
sudo dd if=noron-x64.iso of=/dev/sdX bs=4M status=progress
sync
```

Replace `/dev/sdX` with your SD card or drive (use `lsblk` to find it).

For cloud VMs, upload the ISO as a custom image and boot from it. Dedicated/metal instances are recommended — VMs with shared CPU cores won't achieve the same isolation as bare metal.

### 2. First boot

1. Insert the SD card (or boot from SSD/NVMe) and power on
2. Connect via HDMI + keyboard, or SSH in (if your network assigns DHCP):
   ```bash
   ssh user@<ip-address>
   ```
3. The **setup wizard** runs automatically on first boot

### 3. Setup wizard

The wizard detects your hardware and walks you through configuration:

| Step | What happens |
|------|-------------|
| **Welcome** | Detects CPU cores, memory, thermal zones, network interfaces |
| **Cores** | Review and adjust the core split. Detects big.LITTLE on ARM SBCs |
| **OAuth** | Paste your GitHub OAuth App Client ID and Secret |
| **Network** | Set hostname, optionally configure Tailscale VPN |
| **Label** | Set the GitHub Actions runner label (default: `noron`) |
| **Review** | Confirm all settings |
| **Install** | Installs kernel params, builds runner container, starts services |
| **Done** | Shows your dashboard URL and admin invite link (7-day expiry) |

After setup, **reboot** to apply kernel parameters (`isolcpus`, `nohz_full`, etc.).

### 4. Access the dashboard

1. Open the admin invite link shown on the Done screen
2. Sign in with GitHub — you become the first admin
3. From the dashboard, generate invite links for your team

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

The appliance updates itself automatically from GitHub Releases. Configure in `/etc/benchd/config.toml`:

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
- Downloads the update archive, then waits for the lock to be idle
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

### Building ISOs (x86_64, generic ARM64)

ISOs are built with Debian `live-build` and must run on a Debian-based system (or inside Docker):

```bash
# Direct (on Debian/Ubuntu with live-build installed)
./provisioning/iso/build-iso.sh packages/iso/dist/ amd64 artifacts/
./provisioning/iso/build-iso.sh packages/iso/dist/ arm64 artifacts/

# Via Docker (from any platform)
docker run --rm --privileged \
  -v "$(pwd):/work" -w /work \
  debian:bookworm bash -c "
    apt-get update && apt-get install -y live-build &&
    ./provisioning/iso/build-iso.sh packages/iso/dist/ amd64 artifacts/
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
2. **build-iso** — Matrix build: x64 on `ubuntu-latest`, arm64 on `ubuntu-24.04-arm`
3. **build-sbc** — Matrix build: Orange Pi 5 Plus and RPi 4/5 on `ubuntu-24.04-arm`
4. **github-release** — Collects all 6 artifacts (2 ISOs + 2 update archives + 2 SBC images) into a GitHub Release

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
