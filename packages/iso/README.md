# @noron/iso — Benchmark Appliance Image

Builds the bootable Debian 12 ISO and collects all workspace package outputs for deployment. This is the deployment artifact for the Noron benchmark appliance.

## What's inside the ISO

The ISO is a live Debian 12 (bookworm) image with everything pre-installed:

- **benchd** — host daemon managing locks, thermals, and cgroups
- **bench-exec** — privileged executor with CPU pinning and priority
- **bench-web** — dashboard API server with GitHub OAuth
- **bench-setup** — interactive first-boot setup wizard
- **bench** — remote CLI for monitoring and management
- **bench-updater** — self-update script with rollback support
- **dashboard** — React SPA served by bench-web
- **hooks** — GitHub Actions job lifecycle hooks
- **runner container** — Podman image with GitHub Actions runner

## Deploying to an Orange Pi (or any ARM64 SBC)

### What you need

- Orange Pi 5, 5B, 5 Plus, or similar ARM64 board (4+ cores, 4GB+ RAM recommended)
- MicroSD card (16GB+ recommended) or eMMC module
- Ethernet connection (WiFi works but wired is more reliable for benchmarks)
- A GitHub OAuth App ([create one](https://github.com/settings/developers))

### Step 1: Flash the ISO

Download the ARM64 ISO from the [latest release](https://github.com/thejustinwalsh/noron/releases).

**Using balenaEtcher (recommended — works on Windows, macOS, Linux):**

1. Download [balenaEtcher](https://etcher.balena.io/)
2. Open Etcher, select the ISO, select your SD card, click "Flash!"

**Using the command line (macOS/Linux):**

```bash
sudo dd if=benchmark-appliance-arm64.iso of=/dev/sdX bs=4M status=progress
sync
```

Replace `/dev/sdX` with your SD card device (use `lsblk` to find it).

### Booting from NVMe (Orange Pi 5 / 5 Plus)

The Orange Pi 5 series can boot directly from NVMe for better I/O performance. The process depends on your board's bootloader:

1. **Flash the ISO to an SD card first** and boot from it normally
2. **Copy the running system to NVMe:**
   ```bash
   # Identify the NVMe device
   lsblk
   # Usually /dev/nvme0n1

   # Partition and format the NVMe
   sudo parted /dev/nvme0n1 mklabel gpt
   sudo parted /dev/nvme0n1 mkpart primary ext4 1MiB 100%
   sudo mkfs.ext4 /dev/nvme0n1p1

   # Copy the root filesystem
   sudo mount /dev/nvme0n1p1 /mnt
   sudo rsync -axHAWXS --numeric-ids --info=progress2 / /mnt/ --exclude={/mnt,/proc,/sys,/dev,/run,/tmp}
   sudo mkdir -p /mnt/{proc,sys,dev,run,tmp,mnt}

   # Update fstab on the NVMe copy
   sudo sed -i 's|ROOT_DEVICE|/dev/nvme0n1p1|g' /mnt/etc/fstab
   sudo umount /mnt
   ```
3. **Set NVMe as boot device** using your board's bootloader tool:
   - Orange Pi 5: use `orangepi-config` → System → Boot device
   - Or update U-Boot environment: `fw_setenv bootdev nvme`
4. **Remove the SD card** and reboot — the system should boot from NVMe

Consult your board's documentation for specific bootloader instructions, as these vary between Orange Pi models and firmware versions.

### Step 2: First boot

1. Insert the SD card (or boot from NVMe) and power on the Orange Pi
2. Connect via HDMI + keyboard, or SSH in (if your network assigns DHCP):
   ```bash
   ssh user@<ip-address>    # default user/password from Debian live
   ```
3. The **setup wizard** runs automatically on first boot

### Step 3: Setup wizard

The wizard detects your hardware and walks you through configuration:

| Step | What happens |
|------|-------------|
| **Welcome** | Detects CPU cores (e.g., Orange Pi 5: 8 cores → 1 housekeeping + 7 benchmark) |
| **Cores** | Review and adjust the core split |
| **OAuth** | Paste your GitHub OAuth App Client ID and Secret |
| **Network** | Set hostname, optionally configure Tailscale VPN |
| **Review** | Confirm all settings |
| **Install** | Installs kernel params, builds runner container, starts services |
| **Done** | Shows your dashboard URL and admin invite link |

After setup, **reboot** to apply kernel parameters (`isolcpus`, `nohz_full`, etc.).

### Step 4: Access the dashboard

1. Open the admin invite link shown on the Done screen
2. Sign in with GitHub — you become the first admin
3. From the dashboard, generate invite links for your team

### Step 5: Register a repo

From the dashboard:
1. Click "Add Runner"
2. Enter the GitHub repo (e.g., `myorg/my-project`)
3. The appliance provisions a containerized GitHub Actions runner for that repo

### Step 6: Use in your workflow

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

## Deploying to x86_64 (PC, server, cloud VM)

Same process as ARM64, but download the x64 ISO instead. Use balenaEtcher or:

```bash
sudo dd if=benchmark-appliance-x64.iso of=/dev/sdX bs=4M status=progress
```

For cloud VMs, upload the ISO as a custom image and boot from it. Note that VMs with shared CPU cores won't achieve the same isolation as bare metal — dedicated/metal instances are recommended.

## Deploying with Ansible

For fleet management or automated provisioning of multiple appliances, see the [Ansible deployment guide](../../provisioning/ansible/README.md).

## Self-updates

The appliance can update itself automatically. Configure in `/etc/benchd/config.toml`:

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

Or via the dashboard admin panel.

## Building from source

```bash
# Build all packages (turbo handles dependency order)
BUN_TARGET=bun-linux-arm64 bun run build

# Collect all outputs into packages/iso/dist/
make collect-dist ARCH=arm64

# Build the ISO (requires live-build on Debian/Ubuntu)
make iso ARCH=arm64

# Or for x64:
make collect-dist ARCH=x64
make iso ARCH=x64
```

The ISO build uses Debian `live-build` and must run on a Debian-based system. On macOS, `make iso` runs the build inside an OrbStack VM automatically.

## Architecture-specific notes

### Orange Pi 5 / 5B / 5 Plus (RK3588)

- 8 cores: 4x Cortex-A76 (big) + 4x Cortex-A55 (LITTLE)
- Recommended: pin benchmarks to the A76 cores for maximum consistency
- The setup wizard auto-detects the big.LITTLE topology and recommends the optimal split
- Mali G610 GPU is available in the runner container for GPU-accelerated benchmarks (WebGPU via Playwright, compute shaders, etc.) — GPU benchmarks benefit from CPU isolation just as much since the driver submission path runs on the CPU

### Raspberry Pi 4 / 5

- 4 cores: all identical (Cortex-A72 on Pi 4, Cortex-A76 on Pi 5)
- Works well with 1 housekeeping + 3 benchmark cores
- Pi 5 recommended over Pi 4 for better single-core performance

### x86_64 bare metal

- Disable SMT (hyperthreading) in BIOS for best results, or use `nosmt` kernel param
- Disable turbo boost in BIOS, or let the appliance handle it via the `disable-turbo` service
- NUMA-aware systems: pin benchmarks to a single NUMA node for consistent memory latency
