# Noron — Implementation Plan

## Context

Build a monorepo for a benchmark appliance that runs as a GitHub Actions self-hosted runner on a dedicated Chromebox. The core problem: shared infrastructure causes benchmark variance. The solution is hardware-level isolation (dedicated CPU cores, thermal gating, serial job execution) managed by a host daemon, exposed via a composite GitHub Action and monitored via a TUI CLI.

**Key constraints from review:**
- Only ONE job runs at a time (machine-wide lock via per-job hooks)
- Tokens are one-time use with expiration
- Composite action handles thermal stabilization + benchmark mode
- Host daemon (`benchd`) handles privileged ops via Unix socket IPC
- TypeScript/Bun everywhere; Podman for runner container isolation
- TUI-first monitoring via Ink; minimal web service for registration only

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│ Chromebox (Debian 12)                                       │
│ GRUB: isolcpus=1,2,3 nohz_full=1,2,3 rcu_nocbs=1,2,3 nosmt│
│                                                             │
│  ┌──────────┐   Unix Socket   ┌──────────────────────────┐  │
│  │  benchd   │◄──────────────►│  Podman Container        │  │
│  │ (daemon)  │                │  ┌────────────────────┐   │  │
│  │           │                │  │ GitHub Actions      │   │  │
│  │ • Lock    │                │  │ Runner              │   │  │
│  │ • Thermal │                │  │  ┌──────────────┐   │   │  │
│  │ • Cgroup  │                │  │  │ job-started  │───┼───┼──┤ acquires lock
│  │ • Status  │                │  │  │ hook         │   │   │  │
│  └─────┬─────┘                │  │  └──────────────┘   │   │  │
│        │                      │  │  ┌──────────────┐   │   │  │
│  ┌─────┴─────┐                │  │  │ bench-action │───┼───┼──┤ thermal wait + exec
│  │ bench-exec│◄───────────────┼──┤  │ (composite)  │   │   │  │
│  │ (setuid)  │                │  │  └──────────────┘   │   │  │
│  └───────────┘                │  │  ┌──────────────┐   │   │  │
│                               │  │  │ job-completed│───┼───┼──┤ releases lock
│  ┌───────────┐                │  │  │ hook         │   │   │  │
│  │ bench-web │ ←Tailscale     │  │  └──────────────┘   │   │  │
│  │ (reg svc) │  Funnel        │  └────────────────────┘   │  │
│  └───────────┘                └──────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘

Remote user: npx @bench/cli monitor → connects to benchd for live TUI
```

---

## Monorepo Structure

```
noron/
├── packages/
│   ├── shared/        # IPC protocol types, constants, socket client, thermal utils
│   ├── benchd/        # Host daemon — lock, thermal, cgroup, status broadcast
│   │   └── src/hooks/ # job-started.ts, job-completed.ts (compiled, installed on host)
│   ├── bench-exec/    # Privileged executor — taskset, nice, ionice via Bun FFI
│   ├── action/        # Composite GitHub Action — thermal wait + exec orchestration
│   ├── cli/           # TUI CLI — Ink-based dashboard, login, status, runners
│   └── web/           # Registration web service — Hono, GitHub OAuth, invites
├── provisioning/
│   ├── ansible/       # Playbook + roles: base, bun, benchd, runner, tailscale
│   ├── sysctl.d/      # 99-benchmark.conf (disable THP, watchdog, tune VM)
│   └── systemd/       # benchd.service, benchmark.slice, bench-web.service
├── runner-image/
│   └── Containerfile  # Podman image: Debian 12 + GitHub runner + Node + Bun
├── tests/
│   ├── integration/   # Lock lifecycle, thermal wait, full job simulation
│   └── e2e/           # On-hardware tests
├── package.json       # Bun workspace root
├── bunfig.toml
└── tsconfig.base.json
```

---

## Implementation Phases

### Phase 0: Monorepo Scaffolding
**Files:** `package.json`, `bunfig.toml`, `tsconfig.base.json`, `biome.json`, `.gitignore`, `.github/workflows/ci.yml`
**Verify:** `bun install` succeeds, `bun run typecheck` passes

### Phase 1: Shared Package (`packages/shared/`)
The foundation — every other package imports from here.

| File | Purpose |
|------|---------|
| `src/protocol.ts` | All IPC message types (lock.acquire/release, thermal.wait/status, exec.prepare/validate, status.subscribe) |
| `src/constants.ts` | Socket path, cores, temp thresholds, cgroup paths, timing constants |
| `src/ipc-client.ts` | `BenchdClient` class — Unix socket, line-delimited JSON, request/response correlation via `requestId`, subscription support |
| `src/thermal.ts` | `ThermalRingBuffer` (Float32Array ring buffer), `readCpuTemp()` (sysfs on Linux, mock on macOS) |
| `src/errors.ts` | Typed errors: `LockContendedError`, `ThermalTimeoutError`, `SessionNotFoundError` |
| `src/validation.ts` | Runtime message validation (lightweight, no Zod — use TypeBox or hand-rolled) |

**Verify:** `bun test` passes — protocol round-trips, ring buffer edge cases, validation

### Phase 2: Host Daemon (`packages/benchd/`)
The heart of the system. Runs as root with `CAP_SYS_NICE` + `CAP_SYS_ADMIN`.

| File | Purpose |
|------|---------|
| `src/main.ts` | Entry point — parse flags, create server, signal handlers, PID file |
| `src/server.ts` | `BenchdServer` — Unix socket listener via `Bun.listen({ unix })`, routes messages to managers |
| `src/connection.ts` | `ClientConnection` — line-delimited JSON framing, send/receive, tracks subscriptions |
| `src/lock.ts` | `LockManager` — FIFO queue, one holder at a time, auto-release on disconnect (5s grace), heartbeat monitoring |
| `src/thermal.ts` | `ThermalMonitor` — 1Hz polling, ring buffer history, `thermal.wait` with timeout, push to subscribers |
| `src/cgroup.ts` | `CgroupManager` — creates `benchmark.slice/job-{id}` cgroups, sets `cpuset.cpus`, cleanup |
| `src/logger.ts` | Structured JSON logging to stderr |
| `src/hooks/job-started.ts` | Compiled standalone — connects to benchd, sends `lock.acquire`, blocks until granted |
| `src/hooks/job-completed.ts` | Compiled standalone — connects to benchd, sends `lock.release` |

**Build:** `bun build --compile --target bun-linux-x64` → standalone `benchd`, `job-started`, `job-completed` binaries
**Verify:** `bun run dev` starts daemon on temp socket. Test client acquires/releases lock. Integration test exercises full protocol.

### Phase 3: Privileged Executor (`packages/bench-exec/`)
Small compiled binary with sudoers rule. Called by the composite action.

| File | Purpose |
|------|---------|
| `src/main.ts` | Parse args (`--cores 1,2,3 --nice -20 --ionice 1 -- <cmd>`), validate with benchd, apply settings, drop privs, exec |
| `src/syscalls.ts` | `bun:ffi` bindings for `sched_setaffinity`, `setpriority`, `ioprio_set`, `setuid`/`setgid`. Falls back to spawning `taskset`/`nice` for initial impl. |

**Sudoers:** `runner ALL=(root) NOPASSWD: /usr/local/bin/bench-exec`
**Verify:** Argument parsing tests. Integration test on Linux validates CPU affinity actually applied.

### Phase 4: Composite GitHub Action (`packages/action/`)

| File | Purpose |
|------|---------|
| `action.yml` | Composite action definition — inputs: `command`, `target-temp`, `cores`, `timeout` |
| `src/index.ts` | Orchestration: connect to benchd → `thermal.wait` → `exec.prepare` → spawn `sudo bench-exec -- <cmd>` → report exit code |

**Build:** `bun build --target node --bundle` → single `dist/index.js` (runner has Node built-in)
**User-facing workflow:**
```yaml
- uses: thejustinwalsh/noron/packages/action@v1
  with:
    command: node ./bench/main.js
    target-temp: 45
```
**Verify:** Mock benchd client, test orchestration. On-hardware test runs actual benchmark.

### Phase 5: CLI Tool (`packages/cli/`)

| File | Purpose |
|------|---------|
| `src/main.ts` | Clipanion command router |
| `src/config.ts` | `~/.config/bench/credentials.json` management |
| `src/commands/login.ts` | GitHub device auth flow — open browser, poll for token |
| `src/commands/status.ts` | One-shot: query benchd, print lock/thermal/runner state |
| `src/commands/monitor.tsx` | Full Ink TUI — subscribes to `status.subscribe` for live updates |
| `src/commands/runners.ts` | List all runners registered to the authenticated user |

**Verify:** `bun run dev -- status` shows daemon state. `bun run dev -- monitor` renders TUI.

### Phase 6: Registration Web Service (`packages/web/`)

| File | Purpose |
|------|---------|
| `src/main.ts` | Hono app, binds to port 3000 |
| `src/db.ts` | `bun:sqlite` — tables: invites, users, runners, device_codes |
| `src/github-oauth.ts` | OAuth helpers: auth URL, token exchange, user info |
| `src/invite.ts` | Generate UUID invite (24h expiry, single use), validate, consume |
| `src/routes/invite.ts` | `GET /invite/:token` → validate → GitHub OAuth → register → "Run npx @bench/cli login" |
| `src/routes/auth.ts` | `GET /auth/callback`, `POST /auth/device`, `POST /auth/device/poll` |
| `src/routes/status.ts` | `GET /api/status` (public), `GET /api/runners` (authed) |
| `src/routes/ws-status.ts` | `GET /ws/status` WebSocket — proxies benchd status to browser clients |

**Key flows:**
1. Admin generates invite → UUID link via Tailscale Funnel
2. User clicks link → GitHub OAuth → sees "Run `npx @bench/cli login`"
3. Each repo needs a separate one-time link (invites are per-repo)
4. Runner tokens received once, used to register with GitHub, then discarded immediately

**Verify:** Create invite via seed script. Visit URL. OAuth flow completes. CLI login works.

### Phase 7: Provisioning & Container Image

**Ansible roles:**
- `base` — GRUB (`isolcpus=1,2,3 nohz_full=1,2,3 rcu_nocbs=1,2,3 nosmt`), sysctl (disable THP, watchdog, tune VM writeback), disable turbo boost, install podman/sqlite3/lm-sensors
- `bun` — install Bun runtime
- `benchd` — copy compiled binaries, install systemd units (benchd.service, benchmark.slice), sudoers for bench-exec
- `runner` — build Podman image, configure runner systemd unit with bind mounts (`benchd.sock`, `bench-exec`, hooks)
- `tailscale` — install, authenticate, enable Funnel for port 3000

**Systemd units:**
- `benchd.service` — `Type=simple`, `ProtectSystem=strict`, `AmbientCapabilities=CAP_SYS_NICE CAP_SYS_ADMIN`
- `benchmark.slice` — `AllowedCPUs=1,2,3`
- `bench-web.service` — runs as unprivileged `bench` user

**Containerfile:** Debian 12-slim + Node 20 + Bun + GitHub Actions runner. Sets `ACTIONS_RUNNER_HOOK_JOB_STARTED` and `ACTIONS_RUNNER_HOOK_JOB_COMPLETED` env vars. Runs as non-root `runner` user.

---

## IPC Protocol Summary

Transport: Unix socket, line-delimited JSON, correlated via `requestId` (UUID).

| Request | Response | Behavior |
|---------|----------|----------|
| `lock.acquire` | `lock.acquired` or `lock.queued` | Blocks until lock granted. Auto-release on disconnect. |
| `lock.release` | `lock.released` | Frees lock, grants to next in FIFO queue. |
| `thermal.wait` | `thermal.ready` or `thermal.timeout` | Blocks until temp <= target or timeout. |
| `thermal.status` | `thermal.status` | Returns current temp, history array, trend. |
| `exec.prepare` | `exec.ready` | Creates job cgroup, returns path + sessionId. |
| `exec.validate` | `exec.validated` or `exec.invalid` | bench-exec confirms active session before applying privs. |
| `status.subscribe` | `status.update` (streaming) | Push updates at 1Hz: lock state, thermal, queue depth. |

---

## Phase Dependencies

```
Phase 0 → Phase 1 → Phase 2 → Phase 3 → Phase 4
                         ├────→ Phase 5
                         └────→ Phase 6 → Phase 7
```

Phases 3-6 are independent of each other (all depend on Phase 2). Phase 7 requires built binaries from all packages.

---

## LLVM Benchmarking Guidelines Applied

Reference: https://llvm.org/docs/Benchmarking.html — target is <0.1% variance.

| Guideline | Implementation |
|-----------|----------------|
| Disable frequency scaling | `performance` governor on all cores + turbo boost disabled via `intel_pstate/no_turbo` |
| CPU core isolation | `isolcpus=1,2,3 nohz_full=1,2,3 rcu_nocbs=1,2,3` in GRUB |
| Disable SMT | `nosmt` in GRUB |
| Disable ASLR | `kernel.randomize_va_space=0` in sysctl |
| Use tmpfs for I/O | `/mnt/bench-tmpfs` mounted as tmpfs |
| Disable THP | `transparent_hugepage/enabled=never` via systemd oneshot |
| Pin IRQs | All hardware interrupts pinned to core 0 |
| Reduce kernel jitter | `kernel.nmi_watchdog=0`, `kernel.timer_migration=0` |
| Reduce VM pressure | `vm.dirty_ratio=5`, `vm.dirty_background_ratio=1` |

---

## Design Decisions

| Decision | Rationale |
|----------|-----------|
| **Podman over Docker** | Rootless, daemonless, same OCI runtime. CPU overhead <1% for compute-bound benchmarks. |
| **Unix socket IPC** | Lightweight, secured by file permissions, no network overhead. |
| **Line-delimited JSON** | Simple framing, debuggable with `socat`, no binary protocol complexity. |
| **Bun FFI for syscalls** | Zero fork/exec overhead for `sched_setaffinity`, `setpriority`. Falls back to `taskset`/`renice` initially. |
| **Composite action (not JS action)** | More flexible, bundles to Node target, uses GitHub Actions log annotations. |
| **TUI + WebSocket web** | Monitoring should not consume benchmark resources. TUI uses zero server CPU. WebSocket fans out one benchd subscription to N browser clients. |
| **One job at a time** | Machine-wide `flock`-style lock via per-job hooks. Even non-benchmark jobs are serialized to eliminate all contention. |
| **One-time invite links** | 24h expiry, single use, per-repo. Runner tokens used immediately then discarded. |

---

## Verification

1. **Unit tests:** `bun test` in each package — protocol, lock FIFO, thermal ring buffer, invite lifecycle
2. **Integration:** Start benchd on temp socket → two clients exercise lock acquire/queue/release + thermal wait
3. **On-hardware:** Ansible provision a Chromebox → run a real GitHub Action workflow → verify cgroup CPU pinning, nice values, thermal gating actually applied
4. **CI pipeline:** typecheck → test → build → integration (all on `ubuntu-latest` with `oven-sh/setup-bun`)

---

## Current Status

All 8 original phases implemented, plus 3 additional phases:

- **Phase 8 (Config + Dynamic Cores):** CPU topology auto-detection, TOML config system, `config.get` IPC message. No more hardcoded core numbers.
- **Phase 9 (Web Dashboard):** React SPA with Web Awesome components, real-time thermal chart, lock status, runner list, admin panel. Built with Vite, served from Hono.
- **Phase 10 (Appliance Setup):** Ink TUI wizard for first-boot configuration, ISO builder, cloud VM install script. Auto-detects hardware, generates all configs, handles both x86 (GRUB) and ARM (cmdline.txt) boot parameters.

8 packages + provisioning + container image. 39 passing tests (35 unit + 4 integration).

### Multi-tenant model

- Admin generates invite links from the web dashboard
- Users sign up via GitHub OAuth and register repos
- Runner tokens are per-repo
- First user auto-promoted to admin
- Bootstrap invite generated on first bench-web startup

### Resource isolation

- All services (benchd, bench-web) pinned to housekeeping core via `CPUAffinity`
- IRQ pinning runs as systemd service on boot
- Turbo boost + THP disabled via systemd service on boot
- WAL checkpoint configured for SQLite to prevent unbounded growth
- ARM SBC support: writes to `/boot/firmware/cmdline.txt` instead of GRUB
