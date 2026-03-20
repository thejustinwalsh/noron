# Local Development

Tools for developing, testing, and building Noron locally. Includes a simulated benchmark environment, ISO/SBC image building via OrbStack VMs, and test VM provisioning.

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
| `test-vm` | Spin up a test VM with binaries and run setup wizard |
| `test-vm:x64` | Same as above, x64 |
| `vm:clean` | Destroy build and test VMs |
| `clean` | Remove all dist/ dirs and turbo cache |

Run any script with `bun --filter @noron/dev <script>`.

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

## Building images

Dev ISO builds are uncompressed for fast iteration. Release builds compress to `.iso.xz` / `.img.xz` automatically.

```bash
# Build arm64 ISO (uncompressed, via OrbStack VM)
bun --filter @noron/dev iso

# Build x64 ISO
bun --filter @noron/dev iso:x64
```

Output: `packages/iso/dist/noron-<arch>.iso`

For SBC images (Armbian), use the provisioning scripts directly — these require Docker and produce compressed `.img.xz` files:

```bash
./provisioning/sbc/build-sbc-image.sh orangepi5-plus packages/iso/dist/ artifacts/
./provisioning/sbc/build-sbc-image.sh rpi4b packages/iso/dist/ artifacts/
```

## Troubleshooting

**"Dashboard not built"** — Run `cd packages/dashboard && bun run build`

**Port already in use** — Use `--port 9217` or kill the existing process

**Socket file left behind** — The script cleans it up on Ctrl+C, but if it crashed:
```bash
rm /tmp/benchd-dev.sock
```
