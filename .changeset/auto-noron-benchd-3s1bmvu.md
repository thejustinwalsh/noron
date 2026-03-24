---
"@noron/benchd": minor
---

> Branch: fix-runner-auth-flow
> PR: https://github.com/thejustinwalsh/noron/pull/9

**Lock manager**

- `LockStatus` now includes `timeoutMs` (the effective job timeout in ms)
- Fixed disconnect behavior: lock-holder disconnecting is expected (hook process exits after writing the token); removed the grace-period auto-release timer — lock now stays held until the `job-completed` hook fires or the job timeout expires

**Disk metrics**

- Added `readDisk()` to `SysMetrics` using `statfsSync("/")`, reporting used/total GB and percent
- Disk stats are now included in the IPC status broadcast

These changes improve lock correctness for the two-connection hook flow and surface disk utilization in real-time status responses.
