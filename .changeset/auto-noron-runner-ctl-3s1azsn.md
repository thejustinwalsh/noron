---
"@noron/runner-ctl": patch
---

> Branch: fix-security-audit-2
> PR: https://github.com/thejustinwalsh/noron/pull/11

Socket path and container volume fix:
- Default benchd socket path updated from `/var/run/benchd.sock` to `/run/benchd/benchd.sock`
- Runner container now mounts the socket's parent directory (`/run/benchd`) instead of the socket file itself, fixing volume mount failures when the socket is recreated between runs

Capability reduction:
- Runner container capability changed from `SYS_ADMIN` to `CAP_PERFMON`; removes unnecessary privilege while retaining perf event access
- Removed unused `escapeEnvValue` helper

These commits correct the container volume mount strategy and reduce the runner container's Linux capabilities to the minimum required.
