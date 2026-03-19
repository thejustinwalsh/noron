# CLI Remote Benchmark Execution — Plan

## Concept

`bench run --repo owner/repo -- node bench/run.js`

A user authenticated via the CLI can submit a one-off benchmark to the appliance. The command is uploaded or referenced from a git ref, queued through the existing FIFO lock, executed on isolated cores with full thermal gating and CPU pinning, and results streamed back to the user's terminal.

No GitHub Actions runner involved. No workflow YAML. Just: authenticate → submit → wait → see results.

## Current State

### What exists

| Component | State | Notes |
|-----------|-------|-------|
| CLI auth | Done | GitHub device code flow → bearer token stored in `~/.config/bench/credentials.json` |
| CLI monitor | Done | `bench monitor` subscribes to benchd status over Unix socket |
| CLI status | Done | `bench status` queries lock + thermal one-shot |
| CLI runners | Done | `bench runners` lists runners via HTTP API |
| benchd IPC | Done | Unix socket, line-delimited JSON, jobToken auth on privileged ops |
| bench-exec | Done | Privileged executor: validates session → CPU affinity → nice → ionice → drop privs → exec |
| Job token flow | Done | lock.acquire → jobToken → action.checkin → exec.prepare → exec.validate → lock.release |
| Web API auth | Done | Bearer token validation via device_codes table, role-based access |
| Violation tracking | Done | 3-strike rule, action.checkin enforcement |

### What's missing for remote CLI benchmarks

1. **No way to submit a command remotely** — benchd only accepts IPC from local Unix socket callers
2. **No HTTP proxy for benchd lock/exec operations** — web API is read-only for benchd state
3. **No mechanism to get the benchmark command onto the appliance** — action uses `BENCH_COMMAND` env var set in workflow YAML
4. **No way to stream benchmark output back** — bench-exec inherits stdio locally, no remote transport
5. **CLI has no `run` command** — only monitor/status/login/runners

## Architecture

### How it works (end to end)

```
User's machine                          Appliance
─────────────                          ─────────
bench run \
  --repo owner/repo \
  -- node bench/run.js
       │
       │  POST /api/bench/submit
       │  Authorization: Bearer <token>
       │  { repo, command, targetTemp, ... }
       ├──────────────────────────►  bench-web
       │                               │
       │                               │ Validate user auth
       │                               │ Validate user owns repo (runner registered)
       │                               │ Connect to benchd socket
       │                               │
       │                               ├──► benchd: lock.acquire
       │                               │    ← jobToken
       │                               │
       │                               ├──► benchd: action.checkin (jobToken)
       │                               │
       │  WebSocket /ws/bench/<id>     │
       │  (upgrade, auth via token)    │
       ├──────────────────────────►    │
       │                               ├──► benchd: thermal.wait (jobToken)
       │  ◄─── status: "thermal_wait" │
       │  ◄─── status: "ready"        │
       │                               │
       │                               ├──► benchd: exec.prepare (jobToken)
       │                               │    ← sessionId
       │                               │
       │                               ├──► spawn bench-exec -- <command>
       │                               │    (on host, with BENCH_SESSION_ID + BENCH_JOB_TOKEN)
       │                               │
       │  ◄─── stdout lines           │◄── stdout pipe from bench-exec
       │  ◄─── stderr lines           │◄── stderr pipe from bench-exec
       │                               │
       │  ◄─── status: "completed"    │
       │       { exitCode, durationMs }│
       │                               │
       │                               ├──► benchd: lock.release (jobToken)
       │                               │
       │  WebSocket closes             │
       ▼                               ▼
```

### Key design decisions

1. **bench-web proxies everything** — the CLI never talks to benchd directly. The web server is the only remote-accessible surface. This means:
   - No need to expose the Unix socket over TCP
   - Auth is handled by the existing bearer token system
   - The web server can enforce authorization (user must own the repo/runner)
   - BenchGate coordination works naturally

2. **WebSocket for streaming output** — HTTP request/response can't stream stdout/stderr in real-time. A WebSocket connection carries:
   - Status updates (queued, thermal_wait, running, completed)
   - stdout/stderr lines (tagged by stream)
   - Final exit code and duration

3. **bench-web spawns bench-exec directly on the host** — not inside a container. This is simpler and equivalent to what the action does. The web server runs on the host as the `bench` user, which has sudoers access to bench-exec (same as runner containers).

4. **Repo validation** — the user must have a runner registered for the repo they're targeting. This reuses the existing trust model: admin invites user → user registers repo → user can benchmark against that repo.

5. **action.checkin is called by the proxy** — since the web server orchestrates the lock lifecycle, it calls action.checkin itself. No violation is triggered.

6. **No file upload** — the command runs in the runner's existing checkout directory, or the user provides a command that's already on the appliance (e.g., a script in a repo that was cloned by a previous CI run). For v1, the command is a string that gets passed to bench-exec. Future: could support git clone + run.

## Changes Required

### 1. IPC Protocol (`packages/shared/src/protocol.ts`)

No changes needed. The existing protocol messages (`lock.acquire`, `action.checkin`, `thermal.wait`, `exec.prepare`, `exec.validate`, `lock.release`) are sufficient. The web server will use `BenchdClient` to issue these on behalf of the CLI user.

### 2. Web API — New Routes (`packages/web/src/routes/bench.ts`) **NEW FILE**

```
POST /api/bench/submit
  Auth: Bearer token (authenticated user)
  Body: { repo, command, targetTemp?, cores?, timeoutSec? }
  Returns: { benchId }

  Validates:
    - User is authenticated
    - User owns a runner for this repo (or is admin)
    - Runner is not disabled
    - Command is non-empty string

  Creates a bench session record in a new `bench_sessions` table
  Returns a benchId for WebSocket connection

GET /ws/bench/:benchId
  Auth: query param token (same as /ws/status)
  Protocol: WebSocket

  Messages (server → client):
    { type: "status", state: "queued", position: number }
    { type: "status", state: "thermal_wait", currentTemp: number, targetTemp: number }
    { type: "status", state: "running" }
    { type: "stdout", data: string }
    { type: "stderr", data: string }
    { type: "status", state: "completed", exitCode: number, durationMs: number }
    { type: "status", state: "error", message: string }

  Messages (client → server):
    { type: "cancel" }  — abort the benchmark (kills cgroup, releases lock)
```

### 3. Web API — Bench Orchestrator (`packages/web/src/bench-orchestrator.ts`) **NEW FILE**

The core logic that manages a remote benchmark session:

```typescript
class BenchOrchestrator {
  constructor(benchId, repo, command, options, onEvent)

  async run():
    1. Connect to benchd via BenchdClient
    2. lock.acquire(jobId=benchId, owner=repo)
       → emit { state: "queued" } or { state: "locked" }
       → receive jobToken
    3. action.checkin(jobToken)
    4. thermal.wait(jobToken, targetTemp)
       → emit { state: "thermal_wait", currentTemp }
       → wait for thermal.ready
    5. exec.prepare(jobToken, cores)
       → receive sessionId
    6. Spawn: sudo bench-exec --cores ... -- <command>
       with env BENCH_SESSION_ID, BENCH_JOB_TOKEN
       → pipe stdout/stderr to onEvent callback
       → emit { state: "running" }
    7. Wait for exit
       → emit { state: "completed", exitCode, durationMs }
    8. lock.release(jobToken, jobId=benchId)
    9. Cleanup (close benchd client)

  cancel():
    - Kill child process
    - Release lock
    - Emit { state: "cancelled" }
```

### 4. Database Schema (`packages/web/src/db.ts`)

New table for tracking remote bench sessions:

```sql
CREATE TABLE IF NOT EXISTS bench_sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    repo TEXT NOT NULL,
    command TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'pending',  -- pending, queued, thermal_wait, running, completed, error, cancelled
    exit_code INTEGER,
    duration_ms INTEGER,
    created_at INTEGER NOT NULL,
    completed_at INTEGER
);
```

### 5. CLI — New `run` Command (`packages/cli/src/commands/run.ts`) **NEW FILE**

```
bench run [--repo owner/repo] [--target-temp 45] [--timeout 300] -- <command...>

Options:
  --repo         Target repo (must have a registered runner)
  --target-temp  CPU temp target in °C (default: 45)
  --timeout      Thermal wait timeout in seconds (default: 300)
  --server       Override bench-web URL
  --json         Output results as JSON instead of streaming
```

**Implementation:**

1. Load credentials (require auth)
2. `POST /api/bench/submit` with command + options → get benchId
3. Open WebSocket to `/ws/bench/{benchId}?token=<token>`
4. Render Ink TUI showing:
   - Current state (queued → thermal wait → running → done)
   - Live stdout/stderr pass-through
   - Temperature while waiting
   - Duration timer while running
   - Exit code on completion
5. Handle Ctrl+C → send `{ type: "cancel" }` over WebSocket
6. Exit with benchmark's exit code

### 6. CLI — Run Command TUI (`packages/cli/src/commands/run.tsx`) **NEW FILE**

Ink component for the run command display:

```
  noron run — owner/repo

  [thermal] Waiting for CPU to reach 45°C (currently 52.3°C)
  ━━━━━━━━━━━━━━━━━░░░░░

  --- or when running: ---

  noron run — owner/repo

  [running] 12.4s elapsed

  > fibonacci(1000) x 1,234,567 ops/sec
  > mean: 810ns, min: 790ns, max: 830ns

  [done] exit code 0 in 14.2s
```

### 7. Web Server — Sudoers Update

The `bench` user (which runs bench-web) needs sudoers access to bench-exec:

```
bench ALL=(root) NOPASSWD: /usr/local/bin/bench-exec
```

This line likely already exists for the runner container user. Need to verify it also covers the `bench` user, or add it.

**File:** `provisioning/ansible/roles/benchd/templates/sudoers.j2` (or wherever sudoers is managed)

### 8. CLI — Register `run` Command (`packages/cli/src/main.ts`)

Add to Clipanion router:

```typescript
import { RunCommand } from "./commands/run";
cli.register(RunCommand);
```

### 9. Web Server — Register Routes (`packages/web/src/main.ts`)

```typescript
import { benchRoutes, benchWsHandler } from "./routes/bench";
app.route("/api", benchRoutes(db));

// In fetch handler, add WebSocket upgrade for /ws/bench/:id
```

### 10. Dashboard — Bench Sessions View (optional, phase 2)

Add a "Sessions" tab or section showing recent remote bench runs:
- Who ran what, when, duration, exit code
- Reuses the `bench_sessions` table

### 11. Violations — Remote Bench Exemption

Remote bench sessions call `action.checkin` via the orchestrator, so they will NOT trigger violations. However, the `owner` field in `lock.acquire` must match a registered repo to pass validation.

## File Change Summary

| File | Change Type | Description |
|------|-------------|-------------|
| `packages/web/src/routes/bench.ts` | **NEW** | HTTP + WebSocket endpoints for bench submit/stream |
| `packages/web/src/bench-orchestrator.ts` | **NEW** | Lock lifecycle + bench-exec spawn + output streaming |
| `packages/cli/src/commands/run.ts` | **NEW** | `bench run` command (Clipanion) |
| `packages/cli/src/commands/run.tsx` | **NEW** | Ink TUI for run progress + stdout streaming |
| `packages/web/src/db.ts` | Modify | Add `bench_sessions` table |
| `packages/web/src/main.ts` | Modify | Register bench routes + WebSocket handler |
| `packages/cli/src/main.ts` | Modify | Register RunCommand |
| `provisioning/ansible/roles/benchd/templates/sudoers.j2` | Modify | Ensure `bench` user has bench-exec access |

## What does NOT change

- **benchd** — no changes to the daemon, protocol, or lock manager
- **bench-exec** — no changes to the privileged executor
- **shared** — no protocol type changes needed
- **action** — GitHub Action is unaffected
- **hooks** — job-started/job-completed hooks are for the runner flow only
- **dashboard** — phase 1 is CLI-only (dashboard view is phase 2)

## Security Considerations

1. **Command injection** — bench-exec already handles this by passing positionals directly to `Bun.spawn()` (no shell expansion). The web API must pass the command as an array, not a shell string.

2. **Repo authorization** — user must have a registered runner for the target repo. Admin can run against any repo.

3. **Rate limiting** — add rate limit on `/api/bench/submit` (e.g., 5 req/min per user) to prevent lock queue flooding.

4. **Concurrent sessions** — only one bench can run at a time (machine-wide lock). Additional submissions queue in FIFO order. The CLI shows queue position.

5. **Cancellation** — Ctrl+C sends cancel over WebSocket → orchestrator kills cgroup processes → releases lock. If WebSocket drops, benchd auto-releases after disconnect grace period.

6. **Output size** — stdout/stderr streaming should have a reasonable buffer limit (e.g., 10MB) to prevent memory exhaustion on the web server.

7. **Timeout** — the existing per-repo `job_timeout_ms` applies to remote bench sessions too, since they go through the same lock manager.

## Implementation Order

1. **BenchOrchestrator** — core logic, can test independently
2. **Web routes + WebSocket** — HTTP submit + WS streaming
3. **DB migration** — bench_sessions table
4. **CLI run command** — submit + WS client + TUI
5. **Sudoers** — verify/update provisioning
6. **Testing** — integration test: submit → queue → thermal → run → stream → complete
