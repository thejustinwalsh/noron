# @noron/web

## 0.3.2

### Patch Changes

- [#13](https://github.com/thejustinwalsh/noron/pull/13) [`c023daa`](https://github.com/thejustinwalsh/noron/commit/c023daaa1f13789fc6c5850500921a38b404f60a) Thanks [@thejustinwalsh](https://github.com/thejustinwalsh)! - > Branch: fix-update-ui

  > PR: https://github.com/thejustinwalsh/noron/pull/13

  **Health checking**

  - Health check now verifies benchd socket liveness before inspecting individual containers; if benchd is unreachable, all online runners are immediately queued for healing
  - New `stale` runner-ctl status (socket present in container but not reachable) triggers heal workflow with a descriptive reason
  - Health check query narrowed to `status = 'online'` only; `markOfflineAndHeal` accepts an optional reason string passed through to the status message

  **Auth security**

  - OAuth callback error page no longer exposes internal error messages or configuration hints; replaced with a generic "Unable to complete sign-in" message

  **Data integrity**

  - Deleting a runner via the status DELETE endpoint or the `deleteRunner` workflow helper now also removes associated `violations` records first
  - Fixes a foreign-key / orphan-row issue when removing pending, failed, or offline runners

  **Heal workflow**

  - Heal workflow idempotency key now includes a millisecond timestamp, allowing the same runner to be healed multiple times (previously a second heal for the same runner was a no-op)

  **Rollback endpoint**

  - New `POST /api/update/rollback` endpoint (admin only) — checks for a rollback backup, invokes `bench-updater rollback`, and writes an audit log entry
  - Returns 400 if no rollback backup exists; 500 with stderr output on script failure
  - Dashboard admin panel now shows a Rollback button with confirm/cancel flow alongside the existing update controls

  **Self-update workflow reliability**

  - Apply + health-verify cycle now retried up to 2 times before falling back to automatic rollback
  - Health verification expanded: checks version file on disk, benchd daemon responsiveness, runner-ctl daemon responsiveness, and bench-web HTTP reachability
  - 10s post-restart settle, 30s between health-check retries per apply attempt

  **Update check**

  - Release tag format changed from `@noron/iso@X.Y.Z` to `vX.Y.Z`; `parseReleaseTag` and tests updated accordingly
  - Dashboard release URL links now point to `v{version}` tags

  Self-update reliability is significantly improved with multi-attempt apply, comprehensive four-component health verification, and a new admin-accessible manual rollback; health checks now detect and recover from stale socket bind mounts automatically.

- Updated dependencies [[`c023daa`](https://github.com/thejustinwalsh/noron/commit/c023daaa1f13789fc6c5850500921a38b404f60a)]:
  - @noron/shared@0.3.2

## 0.3.1

### Patch Changes

- [#11](https://github.com/thejustinwalsh/noron/pull/11) [`5101300`](https://github.com/thejustinwalsh/noron/commit/5101300fe81fff57b5a14bca3c73e2bb1317d705) Thanks [@thejustinwalsh](https://github.com/thejustinwalsh)! - > Branch: fix-security-audit-2

  > PR: https://github.com/thejustinwalsh/noron/pull/11

  Authentication hardening:

  - Invite OAuth flow now uses a random nonce + PKCE code challenge; the invite token is no longer passed directly as OAuth `state`, eliminating CSRF and state-fixation risks
  - OAuth callback rejects unknown `state` prefixes with `400` instead of falling through to invite handling
  - Session cookies changed from `SameSite=Lax` to `SameSite=Strict`
  - Auth error messages genericized — login failure and "not registered" paths now return `auth_failed` to avoid user enumeration

  HTTP security:

  - CORS enforcement added for all `/api/*` routes; cross-origin requests are rejected with `403`
  - Security headers added to all responses: `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `X-XSS-Protection: 0`, `Referrer-Policy: strict-origin-when-cross-origin`, `Content-Security-Policy`

  Audit logging:

  - New `audit_logs` database table with index on `created_at`
  - `logAudit()` helper records admin actions; currently logs `invite.created`, `invite.revoked`, `pat.added`, and `pat.removed`
  - `invites` table gains a `created_by` column tracking which user generated each invite

  Admin API additions:

  - `DELETE /api/invites/:id` — admins can revoke unused invites
  - `GET /api/audit-logs` — returns the last 200 audit log entries (admin only)

  Dashboard additions:

  - Revoke button on active invites in the Admin Panel
  - New Audit Log panel showing time, user, action, and details

  Self-update integrity:

  - `update-check` now requires a `.sha256` checksum file alongside each release archive; update is aborted if the file is missing or malformed
  - `self-update` workflow verifies SHA-256 of downloaded archive before extraction
  - `computeSha256` utility added to `crypto.ts`

  Input validation:

  - PAT submissions rejected if the token exceeds 256 characters

  ## BREAKING CHANGES

  The invite OAuth flow now requires PKCE and a `device_codes` nonce; any in-flight invite links from before this release will be invalidated and users will need to request a new invite link.

  This release completes a comprehensive security audit addressing CSRF, user enumeration, missing integrity checks, and privilege escalation vectors across the web service.

- Updated dependencies [[`3be0e74`](https://github.com/thejustinwalsh/noron/commit/3be0e74ba45268693c27eddb5a0734e039622e62)]:
  - @noron/shared@0.3.1

## 0.3.0

### Minor Changes

- [#9](https://github.com/thejustinwalsh/noron/pull/9) [`d3056b4`](https://github.com/thejustinwalsh/noron/commit/d3056b40f93ef6052d7ea85f9291164d3eddb46d) Thanks [@thejustinwalsh](https://github.com/thejustinwalsh)! - > Branch: fix-runner-auth-flow

  > PR: https://github.com/thejustinwalsh/noron/pull/9

  **Runner provisioning workflows**

  - Provision and heal workflows now use `RunnerCtlClient` to communicate with the `runner-ctld` Unix socket daemon instead of invoking podman directly
  - Default callback URL port corrected from `3000` to `9216` (matches the bench-web service port)
  - `deprovision-runner` and `self-update` workflows updated accordingly
  - Health check updated to work with new runner-ctld architecture

  **Admin API**

  - Lock status in admin route now includes `timeoutMs`

  **Config API**

  - `/api/config` response now includes `runnerLabel` so the dashboard can display the correct runner label in workflow YAML snippets

  Runner provisioning is now fully mediated through runner-ctld, separating privileged container operations from the web process.

### Patch Changes

- Updated dependencies [[`d3056b4`](https://github.com/thejustinwalsh/noron/commit/d3056b40f93ef6052d7ea85f9291164d3eddb46d)]:
  - @noron/shared@0.3.0

## 0.2.2

### Patch Changes

- Updated dependencies []:
  - @noron/shared@0.2.2

## 0.2.1

### Patch Changes

- Updated dependencies []:
  - @noron/shared@0.2.1

## 0.2.0

### Patch Changes

- Updated dependencies []:
  - @noron/shared@0.2.0

## 0.1.1

### Patch Changes

- [#2](https://github.com/thejustinwalsh/noron/pull/2) [`72bd838`](https://github.com/thejustinwalsh/noron/commit/72bd8388a4e64ade1eda9e638923dbadfd8422eb) Thanks [@thejustinwalsh](https://github.com/thejustinwalsh)! - > Branch: refactor-disk-image-flow

  > PR: https://github.com/thejustinwalsh/noron/pull/2

  - WebSocket upgrade auth now accepts token from cookie or `Authorization` header in addition to the `?token=` query parameter, using the shared `extractToken` helper

  Allows WebSocket clients (e.g. the dashboard in a browser with an existing session cookie) to authenticate without exposing the token in the URL.

- [`32647e1`](https://github.com/thejustinwalsh/noron/commit/32647e1447e65002631fcb6aefd5110c52f2fb3c) Thanks [@thejustinwalsh](https://github.com/thejustinwalsh)! - > Branch: main

  ### f7a95a1498ba99c0fc88a4dc467ece64672001ce

  fix: lint + types + optional chaining errors
  Files: biome.json, dev/local-test.ts, dev/mock-benchd.ts, packages/action/src/index.ts, packages/bench-exec/src/**tests**/syscalls.test.ts, packages/bench-exec/src/main.ts, packages/bench-exec/src/syscalls.ts, packages/benchd/src/**tests**/cgroup.test.ts, packages/benchd/src/**tests**/connection.test.ts, packages/benchd/src/**tests**/lock.test.ts, packages/benchd/src/**tests**/thermal.test.ts, packages/benchd/src/**tests**/tmpfs-cleanup.test.ts, packages/benchd/src/cgroup.ts, packages/benchd/src/connection.ts, packages/benchd/src/hooks/job-completed.ts, packages/benchd/src/hooks/job-started.ts, packages/benchd/src/lock.ts, packages/benchd/src/main.ts, packages/benchd/src/server.ts, packages/benchd/src/thermal.ts, packages/benchmark/src/bench.ts, packages/benchmark/src/report.ts, packages/cli/src/commands/monitor.tsx, packages/cli/src/commands/runners.ts, packages/cli/src/commands/status.ts, packages/cli/src/commands/update.ts, packages/cli/src/main.ts, packages/dashboard/src/App.tsx, packages/dashboard/src/components/AdminPanel.tsx, packages/dashboard/src/components/Layout.tsx, packages/dashboard/src/components/LockStatus.tsx, packages/dashboard/src/components/LoginPrompt.tsx, packages/dashboard/src/components/Onboarding.tsx, packages/dashboard/src/components/RepoCombobox.tsx, packages/dashboard/src/components/RunnerList.tsx, packages/dashboard/src/components/RunnerSetup.tsx, packages/dashboard/src/components/SparklineChart.tsx, packages/dashboard/src/components/StatusBar.tsx, packages/dashboard/src/components/SystemInfo.tsx, packages/dashboard/src/components/WorkflowDetail.tsx, packages/dashboard/src/components/WorkflowList.tsx, packages/dashboard/src/components/WorkflowsPage.tsx, packages/dashboard/src/hooks/useApi.ts, packages/dashboard/src/hooks/useWebSocket.ts, packages/dashboard/src/main.tsx, packages/dashboard/src/types.ts, packages/dashboard/vite-mock-plugin.ts, packages/dashboard/vite.config.ts, packages/iso/build-iso.ts, packages/iso/collect.ts, packages/setup/src/installer.ts, packages/shared/src/**tests**/protocol.test.ts, packages/shared/src/ipc-client.ts, packages/web/src/**tests**/ws-auth.test.ts, packages/web/src/crypto.ts, packages/web/src/main.ts, packages/web/src/routes/auth.ts, packages/web/src/routes/ws-status.ts, packages/web/src/workflows/**tests**/provision-runner.test.ts, tests/e2e/benchmark-lifecycle.test.ts
  Stats: 60 files changed, 820 insertions(+), 443 deletions(-)

- Updated dependencies [[`72bd838`](https://github.com/thejustinwalsh/noron/commit/72bd8388a4e64ade1eda9e638923dbadfd8422eb), [`32647e1`](https://github.com/thejustinwalsh/noron/commit/32647e1447e65002631fcb6aefd5110c52f2fb3c)]:
  - @noron/shared@0.1.1
