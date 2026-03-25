---
"@noron/runner-ctl": patch
---

> Branch: fix-security-audit-2
> PR: https://github.com/thejustinwalsh/noron/pull/11

- Container volume mount changed to bind the socket directory (`dirname(SOCKET_PATH)`) instead of the socket file; required by the new `/run/benchd/` path layout
- Container capability changed from `SYS_ADMIN` to `CAP_PERFMON` (least-privilege)
- Updated default socket path reference to `/run/benchd/benchd.sock`

Reduced container privileges and aligned volume mounts with the new socket directory layout.
