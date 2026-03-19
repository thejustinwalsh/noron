# Noron

Bun/TypeScript monorepo for a benchmark appliance — dedicated hardware that runs GitHub Actions benchmarks with <0.1% variance via hardware-level CPU isolation.

## Packages

All packages live in `packages/`: **benchd** (root daemon, Unix socket IPC), **bench-exec** (privileged executor), **action** (GitHub Action, targets Node), **web** (Hono API + dashboard), **dashboard** (React SPA, Web Awesome), **setup** (Ink TUI wizard), **cli** (remote TUI), **shared** (IPC protocol, config, utils), **benchmark** (mitata benchmarks), **iso** (ISO image builder).

## Commands

```bash
bun install                    # install all workspace deps
bun run build                  # build all packages
bun run typecheck              # typecheck all packages
bun test packages/shared/      # shared package tests
bun test tests/integration/    # integration tests
```

## Conventions

- Bun runtime everywhere (except action → Node for GitHub runner compat)
- Biome linting: tabs, 100 char line width
- IPC: line-delimited JSON over Unix sockets, correlated via `requestId` UUID
- Config: TOML at `/etc/benchd/config.toml`, hand-rolled parser (no library)
- No external runtime deps for benchd
- Tests: Bun test runner, `__tests__/` dirs or `tests/` root
- Changesets: auto-generated on PRs via `thejustinwalsh/workflows/generate-changesets`

## Design Constraints

- ONE benchmark at a time (machine-wide FIFO lock)
- CPU split: core 0 = housekeeping, cores 1..N = benchmarks (isolcpus, nohz_full, nosmt)
- Thermal gating: wait for CPU temp to stabilize before running
- Job tokens (32-byte hex) gate privileged IPC ops; invalidated on lock release
