---
"@noron/web": patch
---

> Branch: fix-update-ui
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
