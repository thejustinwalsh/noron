# Security Hardening Plan

## Problem

The benchd IPC socket has zero authentication. Any process that can reach `/var/run/benchd.sock` can:
1. Acquire the machine-wide lock with fake credentials
2. Prepare cgroup sessions and validate arbitrary PIDs
3. Execute arbitrary commands on isolated benchmark cores via `sudo bench-exec`

Additionally, users can abuse the appliance as a free CI runner without ever running a benchmark, and there is no time limit on job execution.

## Phase 1: Job Token (IPC Hardening)

**Goal:** Privileged IPC operations require a cryptographic token that only legitimate job flows possess.

### Mechanism

1. `lock.acquire` response now includes a `jobToken` (32-byte hex, `crypto.randomBytes(32)`)
2. `job-started` hook writes the token to `/opt/actions-runner/.benchd-token` (mode 0600)
3. The noron action reads the token file and includes `jobToken` on all privileged requests
4. `bench-exec` receives token via `BENCH_JOB_TOKEN` env var, includes it in `exec.validate`
5. benchd validates `jobToken` on: `thermal.wait`, `exec.prepare`, `exec.validate`, `action.checkin`
6. Non-privileged ops remain open: `config.get`, `status.subscribe`, `lock.status`, `thermal.status`
7. Token is invalidated on lock release

### Files Changed

| File | Change |
|------|--------|
| `shared/src/protocol.ts` | Add `jobToken` to `LockAcquiredResponse`, privileged request types, new `ActionCheckinRequest/Response`, `LockReleasedResponse.violation` |
| `shared/src/constants.ts` | Add `JOB_TOKEN_PATH`, `DEFAULT_JOB_TIMEOUT_MS` |
| `benchd/src/lock.ts` | Generate token in `grantLock()`, store on `ActiveLock`, add `actionInvoked` tracking, `validateToken()`, timeout timer |
| `benchd/src/server.ts` | Token validation middleware in `handleMessage()`, handle `action.checkin`, wire up timeout+killAll |
| `benchd/src/cgroup.ts` | Add `killAll()` for timeout enforcement |
| `benchd/src/hooks/job-started.ts` | Write token file after lock acquired |
| `benchd/src/hooks/job-completed.ts` | Read token file, pass to release, delete token file, handle violations (3-strike tracking) |
| `action/src/index.ts` | Read token file, send `action.checkin`, include `jobToken` on all requests, pass to bench-exec |
| `bench-exec/src/main.ts` | Read `BENCH_JOB_TOKEN` env, include in `exec.validate` |

## Phase 2: Require the Noron Action (3-Strike Rule)

**Goal:** Users must invoke the noron action during every job. Failure to do so accumulates strikes; 3 strikes disables the runner.

### Mechanism

1. New `action.checkin` IPC message sent by the noron action at startup (requires `jobToken`)
2. benchd tracks `actionInvoked: boolean` on `ActiveLock`
3. On `lock.release`, if `actionInvoked === false`:
   - Check `GITHUB_JOB_STATUS` env: skip violation if `cancelled`
   - Check for skip state: the GitHub Actions runner does not reliably set a skip status, so we also check `GITHUB_ACTION_STATUS` — if either indicates the job was not fully executed, skip violation
   - If it's a real violation: return `violation: "action_not_used"` in `lock.released`
4. `job-completed` hook receives the violation, reports to bench-web
5. bench-web tracks violations per repo in a `violations` table
6. Strike count: 3 violations within 30 days → runner disabled (`status = 'disabled'`)
7. Admin can reset strikes from the dashboard

### DB Migration (bench-web)

```sql
CREATE TABLE IF NOT EXISTS violations (
    id TEXT PRIMARY KEY,
    repo TEXT NOT NULL,
    runner_id TEXT REFERENCES runners(id),
    job_id TEXT,
    run_id TEXT,
    reason TEXT NOT NULL,
    created_at INTEGER NOT NULL
);

ALTER TABLE runners ADD COLUMN disabled_at INTEGER;
ALTER TABLE runners ADD COLUMN disabled_reason TEXT;
```

## Phase 3: Job Time Limit

**Goal:** Enforce a maximum job duration. Default 10 minutes globally, per-repo override by admin.

### Mechanism

1. New config: `job_timeout_ms = 600000` (10 min default) in `BenchdConfig`
2. Timer starts in `grantLock()` via `setTimeout`
3. On timeout:
   - Log warning with job details
   - Kill all processes in the benchmark cgroup via `cgroup.kill`
   - Force-release the lock with `timeout: true` flag
   - Record a violation (distinct reason: `"job_timeout"`)
4. Timer cleared on normal `release()` or `handleDisconnect()`

### Per-Repo Timeout Override

- bench-web stores per-repo timeout in `runners` table (`job_timeout_ms` column, nullable)
- When `lock.acquire` arrives with an `owner` (repo slug), benchd queries bench-web's API for the repo-specific timeout: `GET /api/runners/timeout?repo=owner/repo`
- If no override exists, uses global `job_timeout_ms` from config
- Admin sets overrides via dashboard

### DB Migration

```sql
ALTER TABLE runners ADD COLUMN job_timeout_ms INTEGER;
```

## Implementation Order

1. **Protocol types** — shared package, zero runtime impact
2. **Config changes** — add `jobTimeoutMs` to config
3. **Lock token + timeout** — core security in lock.ts
4. **Server wiring** — token validation middleware, action.checkin, timeout hookup
5. **Cgroup killAll** — timeout enforcement
6. **Hooks update** — token file read/write, violation reporting
7. **Action update** — token reading, action.checkin
8. **bench-exec update** — token passing
9. **DB migration + API** — violations table, per-repo timeout, strike enforcement
10. **dev/local-test.ts** — update for token flow
