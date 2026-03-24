---
"@noron/shared": minor
---

> Branch: fix-runner-auth-flow
> PR: https://github.com/thejustinwalsh/noron/pull/9

**Protocol**
- Lock status response now includes `timeoutMs` (effective job timeout for the current holder)
- `StatusUpdate` type extended with `disk` field (`usedGb`, `totalGb`, `percent`)

**Runner-ctl client**
- Added `RunnerCtlClient` for IPC communication with the `runner-ctld` daemon (provision, deprovision, status requests over a Unix socket)
- Added shared constants for runner-ctl socket path, image name, and default values
- Updated package index exports

Extends the IPC protocol with lock timeout visibility and disk metrics, and adds the client-side interface for the new runner-ctld daemon.
