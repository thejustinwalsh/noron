---
"@noron/runner-ctl": patch
---

> Branch: fix-security-audit-2
> PR: https://github.com/thejustinwalsh/noron/pull/11

- Container volume mount changed from the socket file to its parent directory (`dirname(SOCKET_PATH)`) so the mount survives daemon restarts that recreate the socket
- Runner container capability changed from `SYS_ADMIN` to `CAP_PERFMON`, following least-privilege principles

## BREAKING CHANGES

- Socket path default is now `/run/benchd/benchd.sock`; the directory `/run/benchd/` is now mounted instead of the socket file directly

Reduces container privileges to `SYS_NICE` + `CAP_PERFMON` only, and fixes a race condition where the volume mount became stale after a daemon restart.
