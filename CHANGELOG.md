# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.1.0] - 2026-03-16

Initial release to trusted partners.

### Added

- **Monorepo scaffolding** (Phase 0): Bun workspace with 8 packages, Biome linting, TypeScript strict mode, CI pipeline with GitHub Actions.
- **Shared library** (`packages/shared`): IPC protocol types, `BenchdClient` Unix socket client with request/response correlation, `ThermalRingBuffer` (Float32Array), CPU topology auto-detection, TOML config parser (no external deps), runtime message validation.
- **Host daemon** (`packages/benchd`): Machine-wide FIFO lock manager with auto-release on disconnect, thermal monitor with 1Hz polling and trend detection, cgroup v2 manager for CPU isolation (`benchmark.slice`), status broadcasting via `status.subscribe`, structured JSON logging. Compiles to standalone binary via `bun build --compile`.
- **Privileged executor** (`packages/bench-exec`): Sets CPU affinity (`sched_setaffinity`), nice priority (-20), and realtime I/O scheduling via Bun FFI. Validates session with benchd before applying privileges. Drops to unprivileged user before exec'ing the benchmark command. Scoped sudoers rule: `runner ALL=(root) NOPASSWD: /usr/local/bin/bench-exec`.
- **Composite GitHub Action** (`packages/action`): Orchestrates thermal wait, cgroup preparation, and benchmark execution. Inputs: `command`, `target-temp`, `cores`, `timeout`. Builds to single `dist/index.js` targeting Node (for GitHub runner compatibility).
- **CLI tool** (`packages/cli`): Clipanion command router with `login` (GitHub device auth flow), `status` (one-shot query), `monitor` (live Ink TUI with thermal chart, lock status, queue depth), and `runners` (list registered runners).
- **Web service** (`packages/web`): Hono API serving dashboard, GitHub OAuth (device auth + browser flows), invite system (single-use, 24h expiry), runner provisioning via `runner-ctl`, WebSocket proxy for live status, workflow run tracking. Runs as unprivileged `bench` user.
- **Dashboard** (`packages/dashboard`): React SPA with Web Awesome components, real-time thermal chart, lock status display, runner management, admin panel for invites and user management. Built with Vite, served statically from Hono.
- **Setup wizard** (`packages/setup`): Ink TUI for first-boot appliance configuration. Auto-detects CPU cores, memory, thermal zones, and network interfaces. Generates benchd config (TOML), systemd services, sysctl tuning, GRUB/cmdline.txt kernel parameters, sudoers rules, and IRQ pinning script. Supports x86 (GRUB) and ARM (cmdline.txt) boot configurations.
- **Runner container image** (`runner-image/`): Debian 12-slim with GitHub Actions runner, Node.js 20, and Bun. Multi-arch support (x64/arm64). Runs as unprivileged `runner` user. Job hooks (`job-started`, `job-completed`) acquire/release the machine-wide lock.
- **Container lifecycle management** (`runner-image/runner-ctl.sh`): Provision, deprovision, and status commands for Podman containers. Input validation against path traversal and env injection. Env files stored with restricted permissions.
- **Provisioning** (`provisioning/`): Ansible playbook with roles for base system, Bun, benchd, runner, and Tailscale. ISO builder for bootable appliance images. Cloud VM install script.
- **Performance tuning**: `isolcpus` + `nohz_full` + `rcu_nocbs` + `nosmt` kernel parameters, `performance` CPU governor, turbo boost disabled, THP disabled, ASLR disabled, IRQ pinning to housekeeping core, sysctl tuning (`nmi_watchdog=0`, `timer_migration=0`, `dirty_ratio=5`).
- **Multi-tenant model**: Admin invite system, GitHub OAuth registration, per-repo runners, per-user tokens, first-user auto-admin promotion, bootstrap invite on first startup.
- **IPC protocol**: Line-delimited JSON over Unix domain socket. Messages: `lock.acquire/release/status`, `thermal.wait/status`, `exec.prepare/validate`, `config.get`, `status.subscribe`. All requests correlated via `requestId` UUID.
- **Test suite**: 35 unit tests (shared package) and 4 integration tests covering lock lifecycle, thermal wait, and protocol round-trips.
