---
"@noron/web": minor
---

> Branch: fix-runner-auth-flow
> PR: https://github.com/thejustinwalsh/noron/pull/9

**Runner lifecycle workflows**

- `provision-runner`, `deprovision-runner`, `heal-runner`, and `self-update` workflows now communicate with `runner-ctld` over Unix socket IPC via `RunnerCtlClient` instead of invoking shell commands directly
- Fixed default callback port: was `3000`, now correctly defaults to `9216`

**Admin & status routes**

- Admin route exposes `timeoutMs` from lock status
- Status route includes disk usage (`usedGb`, `totalGb`, `percent`) from the new sysmetrics disk reader

**Health check**

- Improved health check to better detect runner container state transitions

Runner management is now fully driven by the typed `runner-ctld` IPC daemon, replacing direct subprocess invocations in workflow steps.
