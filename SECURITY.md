# Security

## Trust model

Noron is designed for **trusted teams** sharing a dedicated benchmark machine. Users authenticate via GitHub OAuth and must be invited by an admin.

- **Admin** — full trust. Manages users, runners, and system configuration.
- **Invited user** — can register repos, trigger benchmarks, view status. Cannot access other users' tokens or admin functions.
- **Workflow code** — semi-trusted. Runs inside a Podman container with filesystem/PID isolation.
- **Unauthenticated** — can load the dashboard SPA and initiate OAuth login. Cannot access any API data.

There is no isolation between tenants at the benchmark execution layer. All benchmarks share the same physical CPU cores and run sequentially via a FIFO lock.

## Authentication

- **GitHub OAuth** (PKCE-protected). No local passwords.
- **Invite system** — single-use tokens with 24-hour expiry. Generic error for all invalid states (no token enumeration).
- **Session tokens** — HttpOnly cookies (SameSite=Strict, Secure when HTTPS), Bearer tokens for CLI/API. Sessions expire after 30 days.
- **Token storage** — GitHub OAuth tokens encrypted at rest (AES-256-GCM). Encryption key at `/etc/benchd/encryption.key` (mode 0600, root-only), inaccessible from runner containers.
- **Rate limiting** — auth (20 req/min), invites (10 req/min), runner creation (5 req/min), callbacks (10 req/min). All per-IP.

## Endpoint auth

All API and WebSocket endpoints require a valid session, except:

| Endpoint | Why |
|----------|-----|
| `GET /dashboard/*` | Static files (login screen must load) |
| `GET /auth/*` | OAuth login flow |
| `GET /invite/:token` | Invite landing (single-use, redirects to OAuth) |
| `POST /api/runners/:id/callback` | One-time callback token in POST body |

WebSocket connections are limited to 50 total / 5 per IP.

## Container boundaries

### Accessible from containers

| Resource | Mount | Risk |
|----------|-------|------|
| benchd socket dir | `/run/benchd/` (rw) | Directory mount — survives daemon restarts. See "IPC security" |
| bench-exec binary | `/usr/local/bin/bench-exec` (ro) | Requires job token + drops root before exec |
| Hook binaries | `/usr/local/lib/benchd/hooks/` (ro) | Read-only |
| Benchmark tmpfs | `/mnt/bench-tmpfs` (rw) | Cleaned on lock release |

### Container capabilities

| Capability | Reason |
|------------|--------|
| `SYS_NICE` | Set CPU affinity and real-time scheduling priority for benchmark isolation |
| `CAP_PERFMON` | Access hardware performance counters via `perf stat` |
| `SYS_ADMIN` | Required for `perf stat` hardware counter access — ARM64 PMU drivers do not honor `CAP_PERFMON` alone |

`SYS_ADMIN` is the broadest capability granted. It is mitigated by: the container runs as non-root user `runner`, sudoers is scoped to only `bench-exec` with `SETENV`, and `bench-exec` drops root before executing user code.

### Inaccessible from containers

Host filesystem (`/etc/benchd/`, SQLite database, encryption key, other runners' env files), host process table, other containers' filesystems.

## IPC security

Privileged IPC operations (lock release, thermal wait, cgroup setup, exec validation) require a **job token** — a 32-byte cryptographic hex token generated per lock acquisition, written to a file (mode 0600), passed via environment variable to bench-exec, and cleared before exec'ing user code.

A malicious workflow step with socket access can only read system metrics (CPU temp, core layout, lock holder) and queue a lock request. The lock auto-releases on container disconnect after a 5-second grace period, briefly delaying the next queued job. It cannot release another job's lock, trigger execution, or interfere with active benchmarks.

## Privilege model

The appliance uses a non-root `bench` user for administration (SSH, bench-web service). Sudoers rules are scoped to specific binaries:

| User | Rule | Purpose |
|------|------|---------|
| `runner` | `NOPASSWD: /usr/local/bin/bench-exec` | Execute benchmarks with CPU isolation |
| `bench` | `NOPASSWD: /usr/local/bin/runner-ctl` | Manage runner containers |
| `bench` | `NOPASSWD: /usr/local/bin/bench-updater` | Apply self-updates |
| `bench` | `NOPASSWD: /usr/local/bin/bench-setup` | Re-run setup wizard |

`bench-exec` runs via `sudo` inside the runner container. bench-exec validates its job token with benchd, applies CPU affinity/nice/ionice, then **drops root** before exec'ing the user's command. User code never runs as root.

`bench-runner-update` runs as root via a systemd timer (weekly). It is not exposed via sudoers — only systemd can invoke it.

The `bench` user is added to the `sudo` group during setup (for the wizard) and **removed after setup completes**. Post-setup, only the scoped rules above apply.

The benchd socket is owned by `root:bench` with mode `0770`. In container environments where `chown` fails, it falls back to `0777` — this is safe because all privileged IPC operations require valid job tokens regardless of socket permissions.

## Data isolation

- **Tokens** — per-user, encrypted at rest. API enforces user scoping.
- **Runners** — per-repo. Non-admins see only their own.
- **Env files** — per-runner, mode 0600 in directory mode 0700.
- **tmpfs** — cleaned between benchmark runs on lock release.

## Known limitations

- **ASLR disabled** (`kernel.randomize_va_space=0`) for benchmark determinism. Reduces exploit difficulty for memory corruption attacks.
- **Audit logging** covers admin actions (invite creation/revocation, PAT changes, manual rollbacks) via the `/api/audit-logs` endpoint and dashboard admin panel. Does not yet cover all mutation operations.
- **Unrestricted network** from runner containers (needed for repo cloning). Containers can exfiltrate data.
- **WebSocket auth in query string** — browser WebSocket API limitation. Mitigated by HTTPS and configuring the reverse proxy to not log query parameters.

## Reporting vulnerabilities

Report security issues via GitHub Issues on this repository.
