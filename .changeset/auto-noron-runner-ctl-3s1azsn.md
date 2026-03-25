---
"@noron/runner-ctl": patch
---

> Branch: fix-security-audit-2
> PR: https://github.com/thejustinwalsh/noron/pull/11

**Security audit and bug fixes**

- Replaced `--cap-add=SYS_ADMIN` with `--cap-add=CAP_PERFMON` for runner Podman containers, reducing the container privilege surface to the minimum needed for performance counters
- Removed unused `escapeEnvValue()` shell-escape helper

Runner containers no longer receive `SYS_ADMIN`; only `SYS_NICE` and `CAP_PERFMON` are granted.
