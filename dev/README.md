# Local Development

Tools for developing, testing, and building Noron locally. Includes a simulated benchmark environment, QEMU emulation for SBC images, OrbStack VM testing for server images, and image building.

## Quick start

```bash
bun install
cd packages/dashboard && bun run build && cd ../..
bun --filter @noron/dev local-test
```

Starts benchd + bench-web, runs a simulated benchmark job, and shuts down.
Open http://localhost:9216/dashboard/ to watch the lock state and thermal chart update.

## Scripts

| Script | Description |
|--------|-------------|
| `local-test` | One-shot: start services, run benchmark, shut down |
| `local-test:serve` | Start services and keep running (use with `local-test:bench`) |
| `local-test:bench` | Run a benchmark against already-running services |
| `iso` | Build arm64 ISO via OrbStack VM |
| `iso:x64` | Build x64 ISO via OrbStack VM |
| `vm:clean` | Destroy build and test VMs |
| `clean` | Remove all dist/ dirs and turbo cache |

Run any script with `bun --filter @noron/dev <script>`.

## QEMU emulation (SBC images)

Test SBC images locally before flashing to hardware. Requires `brew install qemu mtools`.

```bash
# Build + boot (default: rpi4b from .env.local BOARD)
bun run dev:emulate

# Boot existing image without rebuilding
bun run dev:emulate:boot

# Fetch latest release from GitHub and boot
bun run dev:emulate:fetch

# Persistent mode (changes survive reboot)
bun run dev:emulate:persist

# Or boot a specific image directly
./dev/emulate.sh path/to/noron-rpi4b.img
```

SBC images boot via QEMU `raspi3b` with kernel/dtb extracted from the image automatically.

After boot:
- **SSH:** `ssh -p 2222 bench@localhost` (password: `noron`)
- **Web:** `http://localhost:9216` (after setup)
- **Quit:** Close the QEMU window

## OrbStack VM testing (server images)

Test the real disk image artifact in an OrbStack VM. Builds the image, imports the rootfs, and launches the setup wizard.

```bash
# Full flow: build image + import to VM + run wizard
bun run dev:test:img

# Re-import without rebuilding (uses existing image)
bun run dev:test:img:quick

# Shell into the running VM
orbctl run -m bench-test bash
```

After setup:
- **Dashboard:** `http://bench-test.orb.local:9216`
- **SSH:** `ssh bench@bench-test.orb.local`
- **Cleanup:** `orbctl delete -f bench-test`

## Building images

### SBC images (Armbian)

```bash
bun run dev:sbc                          # rpi4b (default)
BOARD=orangepi5-plus bun run dev:sbc     # Orange Pi 5 Plus
```

Output: `packages/iso/dist/noron-<board>.img`

### Server images (debootstrap)

```bash
# Via Docker (from any platform)
docker run --rm --privileged -v "$(pwd):/work" -w /work debian:bookworm bash -c "
    apt-get update -qq &&
    apt-get install -y -qq debootstrap parted dosfstools e2fsprogs kpartx grub-efi-arm64-bin &&
    ./provisioning/img/build-img.sh arm64 packages/iso/dist/ artifacts/
"
```

### ISOs (dev only, via OrbStack)

```bash
bun --filter @noron/dev iso              # arm64 (default)
bun --filter @noron/dev iso ARCH=x64     # x64
```

Dev builds output uncompressed files for fast iteration. Release builds compress to `.img.xz` automatically.

## Local test options

| Flag | Default | Description |
|------|---------|-------------|
| `--serve` | false | Keep services running after start |
| `--bench-only` | false | Run a benchmark against already-running services |
| `--port <n>` | 9216 | HTTP port for bench-web |
| `--socket <path>` | `/tmp/benchd-dev.sock` | Unix socket for benchd |

## What happens during a benchmark

1. **Lock acquire** — simulates the `job-started` hook
2. **Thermal wait** — waits for CPU temp to stabilize (times out immediately on macOS)
3. **Benchmark run** — executes `tests/e2e/fixtures/bench-sample.ts` (fibonacci)
4. **Hold** — keeps the lock for 3 seconds so you can see it in the dashboard
5. **Lock release** — simulates the `job-completed` hook

## Troubleshooting

**"Dashboard not built"** — Run `cd packages/dashboard && bun run build`

**Port already in use** — Use `--port 9217` or kill the existing process. Check with `lsof -i :9216`.

**Socket file left behind** — The script cleans it up on Ctrl+C, but if it crashed:
```bash
rm /tmp/benchd-dev.sock
```

**QEMU slow** — The `raspi3b` machine uses software emulation (TCG), not hardware virtualization. This is expected and unavoidable for SBC images. Use OrbStack VM testing (`bun run dev:test:img`) for faster iteration on non-SBC-specific features.
