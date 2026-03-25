---
"@noron/runner-ctl": patch
---

> Branch: fix-security-audit-2
> PR: https://github.com/thejustinwalsh/noron/pull/11

- Runner containers now receive `CAP_PERFMON` instead of `SYS_ADMIN`, scoping container privilege to performance monitoring only
- Removed dead `escapeEnvValue()` helper that was no longer referenced

This reduces the privilege surface of runner containers to the minimum required for benchmark execution.
