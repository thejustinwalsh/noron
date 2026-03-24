---
"@noron/shared": minor
---

> Branch: fix-runner-auth-flow
> PR: https://github.com/thejustinwalsh/noron/pull/9

**Protocol additions**

- `LockStatusInfo` now includes `timeoutMs: number` — the effective job timeout for the current lock holder
- Added new IPC constants for runner-ctl socket paths and message types

**New: `RunnerCtlClient`**

- Added `RunnerCtlClient` class for typed Unix socket IPC with `runner-ctld`, used by `bench-web` workflows to provision and deprovision runner containers

Extends the shared IPC protocol to cover the new runner-ctl daemon and exposes lock timeout info for dashboard display.
