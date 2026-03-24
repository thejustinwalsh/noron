---
"@noron/benchd": minor
---

> Branch: fix-runner-auth-flow
> PR: https://github.com/thejustinwalsh/noron/pull/9

**Lock manager**
- Lock holder disconnecting no longer triggers an auto-release grace period; lock stays held until the job-completed hook fires or the job timeout expires — this matches the expected lifecycle where the job-started hook process exits immediately after writing the token
- Lock status response now includes `timeoutMs` (the effective timeout for the current holder)

**System metrics**
- Disk usage for the root filesystem now included in status broadcasts (`usedGb`, `totalGb`, `percent`) via `statfsSync`

These changes stabilize lock handling for short-lived hook processes and extend status data to include disk metrics.
