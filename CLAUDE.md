# Noron

Bun/TypeScript monorepo for a benchmark appliance — dedicated hardware that runs GitHub Actions benchmarks with ~1.6% median variance (as low as 0.08%) via hardware-level CPU isolation.

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

## Security Conventions

- All OAuth flows use random nonces as state + PKCE code challenges — never pass user data as OAuth state
- Auth error messages must be generic — never reveal whether a user/account exists
- All privileged IPC ops require valid job tokens — socket permissions are defense-in-depth, not the access control boundary
- GitHub tokens and PATs encrypted at rest with AES-256-GCM (`packages/web/src/crypto.ts`)
- Self-update archives require SHA-256 verification against published checksums
- Session cookies: `HttpOnly; SameSite=Strict; Secure` (when HTTPS)
- Container capabilities: `SYS_NICE` + `CAP_PERFMON` + `SYS_ADMIN` (ARM64 PMU drivers require `SYS_ADMIN` for `perf stat`)
- Socket creation uses umask(0o007) before listen() to prevent TOCTOU permission races
- Admin actions are audit-logged via `logAudit()` from `packages/web/src/db.ts`

## Development Rules

### Testing
- Write tests for new features — focus on edge cases and real-world scenarios, not happy paths that are obvious from the types
- Don't test built-in or third-party code (Bun APIs, Hono routing, etc.)
- Don't duplicate existing test coverage; check `__tests__/` and `tests/` first
- Place unit tests in `packages/<pkg>/src/__tests__/`, integration/e2e in `tests/`

### Verification
- When a feature is complete, run `bun run typecheck`, `bun run lint`, and `bun run build` before declaring it done
- Run relevant tests (`bun test packages/<pkg>/` or `bun test tests/`) for any changed package
- This applies to completed features, not every individual edit

### Documentation
- When changing public APIs, IPC messages, config keys, CLI commands, action inputs, or build artifacts: update the relevant README, CLAUDE.md, and any planning docs in `planning/`
- This includes adding, renaming, or removing features that cross package boundaries
- Don't update docs for internal refactors that don't change external contracts
