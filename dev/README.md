# Local Development

## Quick Start

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

## Local Test Options

| Flag | Default | Description |
|------|---------|-------------|
| `--serve` | false | Keep services running after start |
| `--bench-only` | false | Run a benchmark against already-running services |
| `--port <n>` | 9216 | HTTP port for bench-web |
| `--socket <path>` | `/tmp/benchd-dev.sock` | Unix socket for benchd |

## What Happens During a Benchmark

1. **Lock acquire** — simulates the `job-started` hook
2. **Thermal wait** — waits for CPU temp to stabilize (times out immediately on macOS)
3. **Benchmark run** — executes `tests/e2e/fixtures/bench-sample.ts` (fibonacci)
4. **Hold** — keeps the lock for 3 seconds so you can see it in the dashboard
5. **Lock release** — simulates the `job-completed` hook

## Troubleshooting

**"Dashboard not built"** — Run `cd packages/dashboard && bun run build`

**Port already in use** — Use `--port 9217` or kill the existing process

**Socket file left behind** — The script cleans it up on Ctrl+C, but if it crashed:
```bash
rm /tmp/benchd-dev.sock
```
